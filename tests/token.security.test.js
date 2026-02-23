const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const TokenManager = require('../managers/token/Token.manager');

const buildManager = () => {
  return new TokenManager({
    config: {
      dotEnv: {
        SHORT_TOKEN_SECRET: 'fallback-secret',
        ACCESS_TOKEN_KEYS: 'v2:new-secret,v1:old-secret',
        ACCESS_TOKEN_ACTIVE_KID: 'v2',
        ACCESS_TOKEN_EXPIRES_IN: '12h',
        REFRESH_TOKEN_SECRET: 'refresh-secret',
        REFRESH_TOKEN_EXPIRES_IN: '30d',
        TOKEN_REVOKE_TTL_SEC: '604800',
      },
    },
  });
};

test('createAccessToken uses active kid and verifies successfully', async () => {
  const tokenManager = buildManager();

  const token = tokenManager.createAccessToken({
    userId: 'u-1',
    role: 'superadmin',
    email: 'super@axion.test',
    tokenVersion: 2,
  });

  const decoded = jwt.decode(token, { complete: true });
  assert.equal(decoded.header.kid, 'v2');

  const payload = tokenManager.verifyAccessToken({ token });
  assert.equal(payload.userId, 'u-1');
  assert.equal(payload.tokenType, 'access');
  assert.equal(payload.tokenVersion, 2);
  assert.ok(payload.jti);
});

test('verifyAccessToken accepts old key during rotation', async () => {
  const tokenManager = buildManager();

  const oldToken = jwt.sign(
    {
      userId: 'u-legacy',
      role: 'school_admin',
      schoolId: 'school-1',
      tokenType: 'access',
      tokenVersion: 1,
      jti: 'legacy-jti',
    },
    'old-secret',
    {
      expiresIn: '1h',
      header: {
        kid: 'v1',
      },
    }
  );

  const payload = tokenManager.verifyAccessToken({ token: oldToken });
  assert.equal(payload.userId, 'u-legacy');
  assert.equal(payload.jti, 'legacy-jti');
});

test('refresh token verify and revocation ttl computation work', async () => {
  const tokenManager = buildManager();

  const refreshToken = tokenManager.createRefreshToken({
    userId: 'u-22',
    role: 'school_admin',
    email: 'admin@axion.test',
    tokenVersion: 1,
  });

  const decoded = tokenManager.verifyRefreshToken({ token: refreshToken });
  assert.equal(decoded.userId, 'u-22');
  assert.equal(decoded.tokenType, 'refresh');
  assert.ok(decoded.jti);

  const ttl = tokenManager.computeRevocationTtlSec({ exp: Math.floor(Date.now() / 1000) + 300 });
  assert.ok(ttl >= 60);
});
