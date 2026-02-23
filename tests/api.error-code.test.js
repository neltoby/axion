const test = require('node:test');
const assert = require('node:assert/strict');
const ApiHandler = require('../managers/api/Api.manager');

test('maps unauthorized and forbidden to proper status codes', () => {
  const codeUnauthorized = ApiHandler.prototype._errorToStatusCode({
    error: 'unauthorized',
  });
  const codeForbidden = ApiHandler.prototype._errorToStatusCode({
    error: 'forbidden',
  });

  assert.equal(codeUnauthorized, 401);
  assert.equal(codeForbidden, 403);
});

test('maps not found and conflict patterns to proper status codes', () => {
  const codeNotFound = ApiHandler.prototype._errorToStatusCode({
    error: 'school not found',
  });
  const codeConflict = ApiHandler.prototype._errorToStatusCode({
    error: 'email already in use',
  });

  assert.equal(codeNotFound, 404);
  assert.equal(codeConflict, 409);
});

test('defaults validation arrays to bad request', () => {
  const code = ApiHandler.prototype._errorToStatusCode({
    errors: ['name is required'],
  });

  assert.equal(code, 400);
});

test('maps internal server error from error string and errors array to 500', () => {
  const codeByError = ApiHandler.prototype._errorToStatusCode({
    error: 'internal server error',
  });
  const codeByErrors = ApiHandler.prototype._errorToStatusCode({
    errors: ['internal server error'],
  });

  assert.equal(codeByError, 500);
  assert.equal(codeByErrors, 500);
});

test('exec sets explicit 500 for unexpected runtime errors', async () => {
  const result = await ApiHandler.prototype._exec({
    targetModule: {
      async v1_boom() {
        throw new Error('unexpected');
      },
    },
    fnName: 'v1_boom',
    data: {},
  });

  assert.equal(result.code, 500);
  assert.equal(result.error, 'internal server error');
});
