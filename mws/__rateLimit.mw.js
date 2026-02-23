const requestIp = require('request-ip');

module.exports = ({ cache, managers, config }) => {
  const dotEnv = config?.dotEnv || {};
  const limit = Number(dotEnv.API_RATE_LIMIT_MAX || 120);
  const windowSec = Number(dotEnv.API_RATE_LIMIT_WINDOW_SEC || 60);

  return async ({ req, res, next }) => {
    const ip = requestIp.getClientIp(req) || 'unknown';
    const moduleName = req.params.moduleName || 'module';
    const fnName = req.params.fnName || 'fn';
    const bucket = String(Math.floor(Date.now() / (windowSec * 1000)));
    const key = `ratelimit:${ip}:${moduleName}:${fnName}`;

    try {
      const count = await cache.hash.incrby({
        key,
        field: bucket,
        incr: 1,
      });

      await cache.key.expire({ key, expire: windowSec * 2 });

      if (Number(count) > limit) {
        return managers.responseDispatcher.dispatch(res, {
          ok: false,
          code: 429,
          errors: ['too many requests'],
          message: `Rate limit exceeded (${limit} requests/${windowSec}s)`
        });
      }

      return next({
        ip,
        rateLimit: {
          limit,
          windowSec,
          count: Number(count),
        },
      });
    } catch (err) {
      // fail open on cache failure to avoid blocking critical traffic
      console.log('rate-limit middleware error', err?.message || err);
      return next({
        ip,
        rateLimit: {
          limit,
          windowSec,
          count: 0,
          bypassed: true,
        },
      });
    }
  };
};
