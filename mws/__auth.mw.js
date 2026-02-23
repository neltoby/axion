module.exports = ({ managers }) => {
	return async ({ req, res, next }) => {
		try {
			const authHeader = req.headers.authorization || '';
			let token = req.headers.token;

			if (!token && authHeader.startsWith('Bearer ')) {
				token = authHeader.slice(7).trim();
			}

			if (!token) {
				return managers.responseDispatcher.dispatch(res, {
					ok: false,
					code: 401,
					errors: ['unauthorized'],
				});
			}

			let decoded = null;

			if (managers.token.verifyAccessToken) {
				decoded = managers.token.verifyAccessToken({ token });
			}

			if (!decoded) {
				decoded = managers.token.verifyShortToken({ token });
			}

			if (!decoded) {
				return managers.responseDispatcher.dispatch(res, {
					ok: false,
					code: 401,
					errors: ['unauthorized'],
				});
			}

			if (decoded.tokenType && decoded.tokenType !== 'access') {
				return managers.responseDispatcher.dispatch(res, {
					ok: false,
					code: 401,
					errors: ['unauthorized'],
				});
			}

			if (decoded.jti && managers.dataStore?.isAccessTokenRevoked) {
				const revoked = await managers.dataStore.isAccessTokenRevoked({
					jti: decoded.jti,
				});
				if (revoked) {
					return managers.responseDispatcher.dispatch(res, {
						ok: false,
						code: 401,
						errors: ['unauthorized'],
					});
				}
			}

			if (decoded.userId && managers.dataStore?.getDoc) {
				const actor = await managers.dataStore.getDoc({
					collection: 'users',
					id: decoded.userId,
				});

				if (!actor || actor.status !== 'active') {
					return managers.responseDispatcher.dispatch(res, {
						ok: false,
						code: 401,
						errors: ['unauthorized'],
					});
				}

				const decodedTokenVersion = Number(decoded.tokenVersion || 1);
				const actorTokenVersion = Number(actor.tokenVersion || 1);
				if (decodedTokenVersion !== actorTokenVersion) {
					return managers.responseDispatcher.dispatch(res, {
						ok: false,
						code: 401,
						errors: ['unauthorized'],
					});
				}
			}

			return next({
				...decoded,
				rawToken: token,
			});
		} catch (err) {
			console.log('auth middleware error', err?.message || err);
			return managers.responseDispatcher.dispatch(res, {
				ok: false,
				code: 401,
				errors: ['unauthorized'],
			});
		}
	};
};
