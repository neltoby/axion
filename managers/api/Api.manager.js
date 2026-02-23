const getParamNames = require('./_common/getParamNames');
/**
 * scans all managers for exposed methods
 * and makes them available through a handler middleware
 */

module.exports = class ApiHandler {
	/**
	 * @param {object} containing instance of all managers
	 * @param {string} prop with key to scan for exposed methods
	 */

	constructor({ config, cortex, cache, managers, mwsRepo, prop }) {
		this.config = config;
		this.cache = cache;
		this.cortex = cortex;
		this.managers = managers;
		this.mwsRepo = mwsRepo;
		this.mwsExec = this.managers.mwsExec;
		this.prop = prop;
		this.exposed = {};
		this.methodMatrix = {};
		this.mwsStack = {};
		this.mw = this.mw.bind(this);

		/** filter only the modules that have interceptors */
		// console.log(`# Http API`);
		Object.keys(this.managers).forEach((mk) => {
			if (this.managers[mk][this.prop]) {
				// console.log('managers - mk ', this.managers[mk])
				this.methodMatrix[mk] = {};
				// console.log(`## ${mk}`);
				this.managers[mk][this.prop].forEach((i) => {
					/** creating the method matrix */
					let method = 'post';
					let fnName = i;
					if (i.includes('=')) {
						let frags = i.split('=');
						method = frags[0];
						fnName = frags[1];
					}
					if (!this.methodMatrix[mk][method]) {
						this.methodMatrix[mk][method] = [];
					}
					this.methodMatrix[mk][method].push(fnName);

					let params = getParamNames(this.managers[mk][fnName], fnName, mk);
					params = params.split(',').map((i) => {
						i = i.trim();
						i = i.replace('{', '');
						i = i.replace('}', '');
						return i;
					});
					/** building middlewares stack */

					params.forEach((param) => {
						if (!this.mwsStack[`${mk}.${fnName}`]) {
							this.mwsStack[`${mk}.${fnName}`] = [];
						}
						if (param.startsWith('__')) {
							// this is a middleware identifier
							// mws are executed in the same order they existed
							/** check if middleware exists */
							// console.log(this.mwsRepo);
							if (!this.mwsRepo[param]) {
								throw Error(`Unable to find middleware ${param}`);
							} else {
								this.mwsStack[`${mk}.${fnName}`].push(param);
							}
						}
					});

					// console.log(`* ${i} :`, 'args=', params);
				});
			}
		});

		/** expose apis through cortex */
		Object.keys(this.managers).forEach((mk) => {
			if (this.managers[mk].interceptor) {
				this.exposed[mk] = this.managers[mk];
				// console.log(`## ${mk}`);
				if (this.exposed[mk].cortexExposed) {
					this.exposed[mk].cortexExposed.forEach((i) => {
						// console.log(`* ${i} :`,getParamNames(this.exposed[mk][i]));
					});
				}
			}
		});

		/** expose apis through cortex */
		this.cortex.sub('*', (d, meta, cb) => {
			let [moduleName, fnName] = meta.event.split('.');
			let targetModule = this.exposed[moduleName];
			if (!targetModule) return cb({ error: `module ${moduleName} not found` });
			try {
				targetModule.interceptor({ data: d, meta, cb, fnName });
			} catch (err) {
				cb({ error: `failed to execute ${fnName}` });
			}
		});
	}

	_errorToStatusCode({ error, errors, code }) {
		if (code && Number.isInteger(Number(code))) {
			return Number(code);
		}

		if (Array.isArray(errors) && errors.length > 0) {
			const hasInternalError = errors.some(
				(item) =>
					typeof item === 'string' &&
					(item.toLowerCase().includes('internal server error') ||
						item.toLowerCase().includes('failed to execute')),
			);
			if (hasInternalError) {
				return 500;
			}
			return 400;
		}

		if (!error || typeof error !== 'string') {
			return 400;
		}

		const normalized = error.trim().toLowerCase();
		if (normalized.includes('unauthorized')) return 401;
		if (normalized.includes('forbidden')) return 403;
		if (normalized.includes('not found')) return 404;
		if (
			normalized.includes('already exists') ||
			normalized.includes('already in use')
		)
			return 409;
		if (
			normalized.includes('internal server error') ||
			normalized.includes('failed to execute')
		)
			return 500;
		return 400;
	}

	async _exec({ targetModule, fnName, cb, data }) {
		let result = {};

		try {
			result = await targetModule[`${fnName}`](data);
		} catch (err) {
			console.log(`error`, err);
			result.error = 'internal server error';
			result.code = 500;
		}

		if (cb) cb(result);
		return result;
	}

	/** a middle for executing admin apis trough HTTP */
	async mw(req, res, next) {
		let method = req.method.toLowerCase();
		let moduleName = req.params.moduleName;
		let fnName = req.params.fnName;
		let moduleMatrix = this.methodMatrix[moduleName];

		/** validate module */
		if (!moduleMatrix) {
			return this.managers.responseDispatcher.dispatch(res, {
				ok: false,
				code: 404,
				message: `module ${moduleName} not found`,
			});
		}

		/** validate method */
		if (!moduleMatrix[method]) {
			const allowedMethods = Object.keys(moduleMatrix).map((m) =>
				m.toUpperCase(),
			);
			return this.managers.responseDispatcher.dispatch(res, {
				ok: false,
				code: 405,
				message: `unsupported method ${method} for ${moduleName}. allowed: ${allowedMethods.join(', ')}`,
			});
		}

		if (!moduleMatrix[method].includes(fnName)) {
			return this.managers.responseDispatcher.dispatch(res, {
				ok: false,
				code: 404,
				message: `unable to find function ${fnName} with method ${method}`,
			});
		}

		// console.log(`${moduleName}.${fnName}`);

		let targetStack = this.mwsStack[`${moduleName}.${fnName}`];

		let hotBolt = this.mwsExec.createBolt({
			stack: targetStack,
			req,
			res,
			onDone: async ({ req, res, results }) => {
				/** executed after all middleware finished */

				let body = req.body || {};
				let result = await this._exec({
					targetModule: this.managers[moduleName],
					fnName,
					data: {
						...body,
						...results,
						res,
					},
				});
				if (!result) result = {};

				if (result.selfHandleResponse) {
					// do nothing if response handeled
				} else {
					if (result.errors) {
						return this.managers.responseDispatcher.dispatch(res, {
							ok: false,
							code: this._errorToStatusCode({
								errors: result.errors,
								code: result.code,
							}),
							errors: result.errors,
						});
					} else if (result.error) {
						return this.managers.responseDispatcher.dispatch(res, {
							ok: false,
							code: this._errorToStatusCode({
								error: result.error,
								code: result.code,
							}),
							message: result.error,
						});
					} else {
						return this.managers.responseDispatcher.dispatch(res, {
							ok: true,
							data: result,
						});
					}
				}
			},
		});
		hotBolt.run();
	}
};
