const test = require('node:test');
const assert = require('node:assert/strict');
const ApiHandler = require('../managers/api/Api.manager');

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

const buildApiHandler = () => {
  const managers = {
    mwsExec: {
      createBolt: () => {
        throw new Error('middleware stack should not run for route validation failures');
      },
    },
    responseDispatcher: {
      dispatch: (res, payload) => {
        res.status(payload.code || 400).send(payload);
      },
    },
    schools: {
      httpExposed: ['get=v1_listSchools'],
      async v1_listSchools() {
        return { schools: [] };
      },
    },
  };

  return new ApiHandler({
    config: {},
    cache: {},
    managers,
    mwsRepo: {},
    prop: 'httpExposed',
    cortex: {
      sub: () => {},
    },
  });
};

test('returns 404 when module does not exist', async () => {
  const api = buildApiHandler();
  const req = {
    method: 'GET',
    params: {
      moduleName: 'unknown',
      fnName: 'v1_anything',
    },
    body: {},
  };
  const res = createRes();

  await api.mw(req, res);

  assert.equal(res.statusCode, 404);
  assert.match(res.payload.message, /module unknown not found/i);
});

test('returns 405 when HTTP method is not exposed for module', async () => {
  const api = buildApiHandler();
  const req = {
    method: 'POST',
    params: {
      moduleName: 'schools',
      fnName: 'v1_listSchools',
    },
    body: {},
  };
  const res = createRes();

  await api.mw(req, res);

  assert.equal(res.statusCode, 405);
  assert.match(res.payload.message, /unsupported method post for schools/i);
  assert.match(res.payload.message, /allowed: GET/i);
});

test('returns 404 when function is not exposed for method', async () => {
  const api = buildApiHandler();
  const req = {
    method: 'GET',
    params: {
      moduleName: 'schools',
      fnName: 'v1_missing',
    },
    body: {},
  };
  const res = createRes();

  await api.mw(req, res);

  assert.equal(res.statusCode, 404);
  assert.match(res.payload.message, /unable to find function v1_missing with method get/i);
});
