const test = require('node:test');
const assert = require('node:assert/strict');
const AuthManager = require('../managers/auth/Auth.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES, STATUS } = require('../managers/_common/constants');

const buildAuthManager = () => {
  const user = {
    _id: 'u-1',
    email: 'admin@axion.test',
    role: ROLES.SCHOOL_ADMIN,
    schoolId: 'school-1',
    status: STATUS.ACTIVE,
    tokenVersion: 1,
  };

  const users = new Map([[user._id, user]]);
  const emailIndex = new Map([[user.email, user._id]]);
  const refreshSessions = new Map();
  const revoked = [];

  let refreshCounter = 0;

  const token = {
    createAccessToken: ({ userId }) => `access-${userId}`,
    createRefreshToken: ({ userId }) => {
      refreshCounter += 1;
      return `refresh-${userId}-${refreshCounter}`;
    },
    getTokenMeta: ({ token: rawToken }) => {
      const parts = String(rawToken).split('-');
      const suffix = parts[parts.length - 1];
      return {
        jti: `jti-${suffix}`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    },
    verifyRefreshToken: ({ token: rawToken }) => {
      const parts = String(rawToken).split('-');
      const suffix = parts[parts.length - 1];
      return {
        userId: 'u-1',
        tokenType: 'refresh',
        tokenVersion: 1,
        jti: `jti-${suffix}`,
      };
    },
    computeRevocationTtlSec: () => 111,
  };

  const dataStore = {
    getUserIdByEmail: async ({ email }) => emailIndex.get(email) || null,
    getDoc: async ({ collection, id }) => {
      if (collection !== 'users') return null;
      return users.get(id) || null;
    },
    createRefreshSession: async ({ tokenId, userId, expiresAt }) => {
      refreshSessions.set(tokenId, { tokenId, userId, expiresAt });
      return true;
    },
    getRefreshSession: async ({ tokenId }) => {
      return refreshSessions.get(tokenId) || null;
    },
    deleteRefreshSession: async ({ tokenId }) => {
      refreshSessions.delete(tokenId);
      return true;
    },
    revokeAccessToken: async ({ jti, ttlSec }) => {
      revoked.push({ jti, ttlSec });
      return true;
    },
    listDocs: async () => [],
    recordAuditEvent: async () => true,
  };

  const auth = new AuthManager({
    managers: {
      dataStore,
      authorization: new AuthorizationManager(),
      token,
      password: {
        compare: async () => true,
      },
    },
    config: {
      dotEnv: {},
    },
  });

  return {
    auth,
    dataStore,
    refreshSessions,
    revoked,
  };
};

test('refresh token rotates refresh session and returns new tokens', async () => {
  const { auth, dataStore, refreshSessions } = buildAuthManager();

  await dataStore.createRefreshSession({
    tokenId: 'jti-sessionA',
    userId: 'u-1',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  });

  const result = await auth.v1_refreshToken({
    refreshToken: 'refresh-u-1-sessionA',
  });

  assert.equal(result.token, 'access-u-1');
  assert.equal(result.user._id, 'u-1');
  assert.ok(result.refreshToken);
  assert.equal(refreshSessions.has('jti-sessionA'), false);
});

test('logout revokes current access token and deletes refresh session', async () => {
  const { auth, dataStore, revoked, refreshSessions } = buildAuthManager();

  await dataStore.createRefreshSession({
    tokenId: 'jti-7',
    userId: 'u-1',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  });

  const result = await auth.v1_logout({
    __auth: {
      userId: 'u-1',
      jti: 'access-jti-1',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
    refreshToken: 'refresh-u-1-7',
  });

  assert.deepEqual(result, { logout: true });
  assert.equal(revoked.length, 1);
  assert.deepEqual(revoked[0], { jti: 'access-jti-1', ttlSec: 111 });
  assert.equal(refreshSessions.has('jti-7'), false);
});
