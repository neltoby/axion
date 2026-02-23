const test = require('node:test');
const assert = require('node:assert/strict');
const UserServer = require('../managers/http/UserServer.manager');

const buildServer = ({ existsImpl } = {}) => {
  const managers = {
    userApi: {},
    responseDispatcher: {
      dispatch: (res, payload) => {
        res.status(payload.code || 400).send(payload);
      },
    },
    dataStore: {
      cache: {
        key: {
          exists: existsImpl || (async () => false),
        },
      },
    },
  };

  const config = {
    dotEnv: {
      SERVICE_NAME: 'school-system',
      ENV: 'test',
      CORS_ALLOW_ALL: 'true',
      CORS_ORIGINS: '',
      REQUEST_MAX_DEPTH: '8',
      REQUEST_MAX_KEYS: '2000',
      ENABLE_DYNAMIC_API: 'false',
      USER_PORT: '5111',
    },
  };

  return new UserServer({
    config,
    managers,
  });
};

test('buildHealthPayload returns healthy payload when cache is reachable', async () => {
  const server = buildServer({
    existsImpl: async () => false,
  });

  const payload = await server._buildHealthPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.code, 200);
  assert.equal(payload.data.service, 'school-system');
  assert.equal(payload.data.env, 'test');
  assert.equal(payload.data.checks.app, 'up');
  assert.equal(payload.data.checks.cache, 'up');
  assert.equal(typeof payload.data.uptimeSec, 'number');
  assert.equal(typeof payload.data.timestamp, 'string');
});

test('buildHealthPayload returns 503 when cache check fails', async () => {
  const server = buildServer({
    existsImpl: async () => {
      throw new Error('redis unavailable');
    },
  });

  const payload = await server._buildHealthPayload();

  assert.equal(payload.ok, false);
  assert.equal(payload.code, 503);
  assert.equal(payload.data.checks.cache, 'down');
  assert.match(payload.message, /redis unavailable/i);
});
