const test = require('node:test');
const assert = require('node:assert/strict');
const buildAuthMw = require('../mws/__auth.mw');

const createRes = () => {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
};

test('__auth denies revoked access token', async () => {
  const res = createRes();
  let nextCalled = false;

  const middleware = buildAuthMw({
    managers: {
      token: {
        verifyAccessToken: () => ({
          userId: 'u-1',
          tokenType: 'access',
          jti: 'j-1',
          tokenVersion: 1,
        }),
      },
      dataStore: {
        isAccessTokenRevoked: async () => true,
        getDoc: async () => ({ _id: 'u-1', status: 'active', tokenVersion: 1 }),
      },
      responseDispatcher: {
        dispatch: (targetRes, payload) => {
          targetRes.status(payload.code || 400).send(payload);
        },
      },
    },
  });

  await middleware({
    req: { headers: { authorization: 'Bearer token' } },
    res,
    next: () => {
      nextCalled = true;
    },
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('__auth denies token when tokenVersion mismatches user record', async () => {
  const res = createRes();
  let nextCalled = false;

  const middleware = buildAuthMw({
    managers: {
      token: {
        verifyAccessToken: () => ({
          userId: 'u-2',
          tokenType: 'access',
          jti: 'j-2',
          tokenVersion: 1,
        }),
      },
      dataStore: {
        isAccessTokenRevoked: async () => false,
        getDoc: async () => ({ _id: 'u-2', status: 'active', tokenVersion: 4 }),
      },
      responseDispatcher: {
        dispatch: (targetRes, payload) => {
          targetRes.status(payload.code || 400).send(payload);
        },
      },
    },
  });

  await middleware({
    req: { headers: { authorization: 'Bearer token' } },
    res,
    next: () => {
      nextCalled = true;
    },
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('__auth allows valid token and forwards rawToken', async () => {
  const res = createRes();
  let nextPayload = null;

  const middleware = buildAuthMw({
    managers: {
      token: {
        verifyAccessToken: () => ({
          userId: 'u-3',
          tokenType: 'access',
          jti: 'j-3',
          tokenVersion: 2,
        }),
      },
      dataStore: {
        isAccessTokenRevoked: async () => false,
        getDoc: async () => ({ _id: 'u-3', status: 'active', tokenVersion: 2 }),
      },
      responseDispatcher: {
        dispatch: (targetRes, payload) => {
          targetRes.status(payload.code || 400).send(payload);
        },
      },
    },
  });

  await middleware({
    req: { headers: { authorization: 'Bearer abc123' } },
    res,
    next: (payload) => {
      nextPayload = payload;
    },
  });

  assert.equal(res.statusCode, 200);
  assert.ok(nextPayload);
  assert.equal(nextPayload.userId, 'u-3');
  assert.equal(nextPayload.rawToken, 'abc123');
});
