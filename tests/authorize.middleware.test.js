const test = require('node:test');
const assert = require('node:assert/strict');
const authorizeMiddlewareBuilder = require('../mws/__authorize.mw');

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

test('authorize middleware skips unknown handlers', async () => {
  const middleware = authorizeMiddlewareBuilder({
    managers: {
      responseDispatcher: {
        dispatch: () => {
          throw new Error('dispatch should not be called');
        },
      },
    },
  });

  const req = { params: { moduleName: 'unknown', fnName: 'x' } };
  const res = createRes();

  let nextPayload = null;
  await middleware({
    req,
    res,
    results: {},
    next: (payload) => {
      nextPayload = payload;
    },
  });

  assert.equal(nextPayload.authorized, true);
  assert.equal(nextPayload.skipped, true);
});

test('authorize middleware denies when permission check fails', async () => {
  const middleware = authorizeMiddlewareBuilder({
    managers: {
      auth: {
        ensureAuthenticatedActor: async () => ({
          _id: 'u-1',
          role: 'school_admin',
          schoolId: 'school-1',
        }),
      },
      authorization: {
        hasPermission: async () => false,
        hasGlobalPermission: async () => false,
      },
      responseDispatcher: {
        dispatch: (res, payload) => {
          res.status(payload.code).send(payload);
          return res;
        },
      },
    },
  });

  const req = { params: { moduleName: 'classrooms', fnName: 'v1_updateClassroom' } };
  const res = createRes();

  await middleware({
    req,
    res,
    results: { __auth: { userId: 'u-1' } },
    next: () => {},
  });

  assert.equal(res.statusCode, 403);
  assert.equal(Array.isArray(res.payload.errors), true);
  assert.equal(res.payload.errors[0], 'forbidden');
});

test('authorize middleware allows global rule when actor is superadmin', async () => {
  const middleware = authorizeMiddlewareBuilder({
    managers: {
      auth: {
        ensureAuthenticatedActor: async () => ({
          _id: 'u-2',
          role: 'superadmin',
          schoolId: null,
        }),
      },
      authorization: {
        hasPermission: async () => true,
        hasGlobalPermission: async () => true,
      },
      responseDispatcher: {
        dispatch: () => {
          throw new Error('dispatch should not be called');
        },
      },
    },
  });

  const req = { params: { moduleName: 'schools', fnName: 'v1_deleteSchool' } };
  const res = createRes();

  let nextPayload = null;
  await middleware({
    req,
    res,
    results: { __auth: { userId: 'u-2' } },
    next: (payload) => {
      nextPayload = payload;
    },
  });

  assert.equal(nextPayload.authorized, true);
  assert.equal(nextPayload.actor.role, 'superadmin');
});
