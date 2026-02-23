const express = require('express');
const cors = require('cors');
const app = express();

module.exports = class UserServer {
	constructor({ config, managers }) {
		this.config = config;
		this.managers = managers;
		this.userApi = managers.userApi;
	}

	_isTrue(value) {
		return String(value).trim().toLowerCase() === 'true';
	}

	_dispatch(res, payload) {
		if (this.managers?.responseDispatcher?.dispatch) {
			return this.managers.responseDispatcher.dispatch(res, payload);
		}

		const status = payload.code || 500;
		return res.status(status).send(payload);
	}

	_buildCorsOptions() {
		const allowAll = this._isTrue(this.config.dotEnv.CORS_ALLOW_ALL);
		const allowedOrigins = new Set(
			String(this.config.dotEnv.CORS_ORIGINS || '')
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean),
		);

		return {
			origin: (origin, cb) => {
				if (!origin) {
					return cb(null, true);
				}

				if (allowAll || allowedOrigins.has(origin)) {
					return cb(null, true);
				}

				return cb(new Error('origin not allowed by cors'));
			},
			credentials: true,
			methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
			allowedHeaders: [
				'Authorization',
				'Content-Type',
				'Token',
				'X-Requested-With',
			],
			optionsSuccessStatus: 204,
		};
	}

	_securityHeadersMw() {
		return (req, res, next) => {
			res.setHeader('X-Content-Type-Options', 'nosniff');
			res.setHeader('X-Frame-Options', 'DENY');
			res.setHeader('Referrer-Policy', 'no-referrer');
			res.setHeader(
				'Permissions-Policy',
				'camera=(), microphone=(), geolocation=()',
			);
			res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
			res.setHeader(
				'Content-Security-Policy',
				"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
			);

			const proto = req.headers['x-forwarded-proto'];
			const isSecure = req.secure || proto === 'https';
			if (isSecure) {
				res.setHeader(
					'Strict-Transport-Security',
					'max-age=31536000; includeSubDomains',
				);
			}

			return next();
		};
	}

	_isDangerousObjectKey(key) {
		if (!key) {
			return false;
		}

		return (
			key === '__proto__' ||
			key === 'constructor' ||
			key === 'prototype' ||
			key.startsWith('$') ||
			key.includes('.')
		);
	}

	_sanitizeValue(value, ctx) {
		const { depth, maxDepth, maxKeys, counter } = ctx;
		if (value === null || value === undefined) {
			return value;
		}

		if (typeof value !== 'object') {
			return value;
		}

		if (depth >= maxDepth) {
			return Array.isArray(value) ? [] : {};
		}

		if (Array.isArray(value)) {
			return value.map((item) =>
				this._sanitizeValue(item, {
					depth: depth + 1,
					maxDepth,
					maxKeys,
					counter,
				}),
			);
		}

		const safeObj = {};
		Object.keys(value).forEach((key) => {
			if (counter.count >= maxKeys) {
				return;
			}

			if (this._isDangerousObjectKey(key)) {
				return;
			}

			counter.count += 1;
			safeObj[key] = this._sanitizeValue(value[key], {
				depth: depth + 1,
				maxDepth,
				maxKeys,
				counter,
			});
		});

		return safeObj;
	}

	_sanitizeRequestPayloadMw() {
		const maxDepth = Number(this.config.dotEnv.REQUEST_MAX_DEPTH || 8);
		const maxKeys = Number(this.config.dotEnv.REQUEST_MAX_KEYS || 2000);

		return (req, res, next) => {
			const bodyCounter = { count: 0 };
			req.body = this._sanitizeValue(req.body || {}, {
				depth: 0,
				maxDepth,
				maxKeys,
				counter: bodyCounter,
			});

			const queryCounter = { count: 0 };
			req.query = this._sanitizeValue(req.query || {}, {
				depth: 0,
				maxDepth,
				maxKeys,
				counter: queryCounter,
			});

			return next();
		};
	}

	_aliasToApi({ moduleName, fnName, req, payload = {} }) {
		req.params = req.params || {};
		req.params.moduleName = moduleName;
		req.params.fnName = fnName;

		req.body = req.body || {};
		req.query = req.query || {};

		if (payload.query) {
			req.query = {
				...req.query,
				...payload.query,
			};
		}

		if (payload.body) {
			req.body = {
				...req.body,
				...payload.body,
			};
		}
	}

	_pickMappedValues({ source = {}, mapping }) {
		const mapped = {};
		if (!mapping || !source) {
			return mapped;
		}

		if (Array.isArray(mapping)) {
			mapping.forEach((sourceKey) => {
				if (source[sourceKey] !== undefined) {
					mapped[sourceKey] = source[sourceKey];
				}
			});
			return mapped;
		}

		if (typeof mapping === 'object') {
			Object.keys(mapping).forEach((sourceKey) => {
				const targetKey = mapping[sourceKey];
				if (source[sourceKey] !== undefined && targetKey) {
					mapped[targetKey] = source[sourceKey];
				}
			});
		}

		return mapped;
	}

	_mergePayloadBucket(payload, key, values) {
		if (!values || Object.keys(values).length === 0) {
			return;
		}

		payload[key] = {
			...(payload[key] || {}),
			...values,
		};
	}

	_buildPayloadFromRoute({ route, req }) {
		const payload = {};

		this._mergePayloadBucket(
			payload,
			'body',
			this._pickMappedValues({
				source: req.params || {},
				mapping: route.bodyFromParams,
			}),
		);
		this._mergePayloadBucket(
			payload,
			'query',
			this._pickMappedValues({
				source: req.params || {},
				mapping: route.queryFromParams,
			}),
		);
		this._mergePayloadBucket(
			payload,
			'body',
			this._pickMappedValues({
				source: req.query || {},
				mapping: route.bodyFromQuery,
			}),
		);
		this._mergePayloadBucket(
			payload,
			'query',
			this._pickMappedValues({
				source: req.body || {},
				mapping: route.queryFromBody,
			}),
		);

		if (typeof route.payloadFactory === 'function') {
			const customPayload = route.payloadFactory(req) || {};
			if (customPayload.body) {
				this._mergePayloadBucket(payload, 'body', customPayload.body);
			}

			if (customPayload.query) {
				this._mergePayloadBucket(payload, 'query', customPayload.query);
			}
		}

		return payload;
	}

	_normalizeRestRoute({ moduleName, route, index }) {
		if (!route || typeof route !== 'object') {
			throw Error(
				`invalid restExposed route for module ${moduleName} at index ${index}`,
			);
		}

		const method = String(route.method || '')
			.toLowerCase()
			.trim();
		const path = route.path;
		const fnName = route.fnName;

		if (!method || typeof app[method] !== 'function') {
			throw Error(
				`invalid REST method on ${moduleName}.${fnName || 'unknown'} route at index ${index}`,
			);
		}

		if (typeof path !== 'string' || !path.startsWith('/')) {
			throw Error(
				`invalid REST path on ${moduleName}.${fnName || 'unknown'} route at index ${index}`,
			);
		}

		if (typeof fnName !== 'string' || fnName.trim() === '') {
			throw Error(`missing fnName on route ${method.toUpperCase()} ${path}`);
		}

		if (typeof this.managers[moduleName][fnName] !== 'function') {
			throw Error(`handler ${moduleName}.${fnName} is not a function`);
		}

		return {
			...route,
			moduleName,
			method,
			path,
			fnName,
		};
	}

	_buildRestRouteRegistry() {
		const routes = [];

		Object.keys(this.managers).forEach((moduleName) => {
			const manager = this.managers[moduleName];
			if (!manager || !Array.isArray(manager.restExposed)) {
				return;
			}

			manager.restExposed.forEach((route, index) => {
				routes.push(this._normalizeRestRoute({ moduleName, route, index }));
			});
		});

		const seen = new Set();
		routes.forEach((route) => {
			const key = `${route.method}:${route.path}`;
			if (seen.has(key)) {
				throw Error(
					`duplicate REST route definition: ${route.method.toUpperCase()} ${route.path}`,
				);
			}
			seen.add(key);
		});

		return routes;
	}

	async _checkCacheHealth() {
		const existsFn =
			this.managers?.dataStore?.cache?.key &&
			this.managers.dataStore.cache.key.exists;

		if (typeof existsFn !== 'function') {
			return {
				ok: true,
				status: 'skipped',
			};
		}

		try {
			await existsFn.call(this.managers.dataStore.cache.key, {
				key: '__health__:cache',
			});
			return {
				ok: true,
				status: 'up',
			};
		} catch (err) {
			return {
				ok: false,
				status: 'down',
				message: err?.message || 'cache unavailable',
			};
		}
	}

	async _buildHealthPayload() {
		const cacheHealth = await this._checkCacheHealth();
		const ok = cacheHealth.ok;

		const payload = {
			ok,
			code: ok ? 200 : 503,
			data: {
				service: this.config.dotEnv.SERVICE_NAME,
				env: this.config.dotEnv.ENV,
				timestamp: new Date().toISOString(),
				uptimeSec: Math.floor(process.uptime()),
				checks: {
					app: 'up',
					cache: cacheHealth.status,
				},
			},
		};

		if (!ok) {
			payload.message = cacheHealth.message;
		}

		return payload;
	}

	_bindHealthRoutes() {
		const handler = async (req, res) => {
			const payload = await this._buildHealthPayload();
			return this._dispatch(res, payload);
		};

		app.get('/health', handler);
		app.get('/healthz', handler);
	}

	_bindRestRoutes() {
		const call = ({ moduleName, fnName, route }) => {
			return (req, res, next) => {
				const payload = this._buildPayloadFromRoute({ route, req });
				this._aliasToApi({ moduleName, fnName, req, payload });
				return this.userApi.mw(req, res, next);
			};
		};

		const routes = this._buildRestRouteRegistry();

		routes.forEach((route) => {
			app[route.method](
				route.path,
				call({
					moduleName: route.moduleName,
					fnName: route.fnName,
					route,
				}),
			);
		});
	}

	/** for injecting middlewares */
	use(args) {
		app.use(args);
	}

	/** server configs */
	run() {
		app.set('trust proxy', 1);
		app.disable('x-powered-by');
		app.use(cors(this._buildCorsOptions()));
		app.use(express.json({ limit: '1mb' }));
		app.use(express.urlencoded({ extended: true, limit: '1mb' }));
		app.use(this._sanitizeRequestPayloadMw());
		app.use(this._securityHeadersMw());

		this._bindHealthRoutes();

		/** REST-style aliases that map to the template dynamic handler */
		this._bindRestRoutes();

		/** template dynamic middleware to handle all modules/functions */
		if (this._isTrue(this.config.dotEnv.ENABLE_DYNAMIC_API)) {
			app.all('/api/:moduleName/:fnName', this.userApi.mw);
		}

		app.use((req, res) => {
			return this._dispatch(res, {
				ok: false,
				code: 404,
				message: 'endpoint not found',
			});
		});

		/** an error handler */
		app.use((err, req, res, next) => {
			console.error(err.stack);
			return this._dispatch(res, {
				ok: false,
				code: 500,
				message: 'internal server error',
			});
		});

		const port = Number(this.config.dotEnv.USER_PORT);
		const host = this.config.dotEnv.USER_HOST || '0.0.0.0';

		app.listen(port, host, () => {
			console.log(
				`${this.config.dotEnv.SERVICE_NAME.toUpperCase()} is running on ${host}:${port}`,
			);
		});
	}
};
