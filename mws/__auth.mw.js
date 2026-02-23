module.exports = ({ managers }) => {
  return ({ req, res, next }) => {
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

    return next(decoded);
  };
};
