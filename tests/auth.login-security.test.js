const test = require('node:test');
const assert = require('node:assert/strict');
const AuthManager = require('../managers/auth/Auth.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES, STATUS } = require('../managers/_common/constants');

const buildAuthManager = ({
  passwordMatches,
  maxFailures = 2,
  windowSec = 300,
  lockSec = 600,
}) => {
  const user = {
    _id: 'u-1',
    email: 'admin@axion.test',
    passwordHash: 'hashed:pw',
    role: ROLES.SCHOOL_ADMIN,
    schoolId: 'school-1',
    status: STATUS.ACTIVE,
    tokenVersion: 1,
  };

  const users = new Map([[user._id, user]]);
  const emailIndex = new Map([[user.email, user._id]]);
  const loginFailures = new Map();
  const loginLocks = new Map();
  const refreshSessions = [];
  const audits = [];

  let refreshCounter = 0;

  const dataStore = {
    getUserIdByEmail: async ({ email }) => emailIndex.get(String(email).toLowerCase()) || null,
    getDoc: async ({ collection, id }) => {
      if (collection !== 'users') {
        return null;
      }

      return users.get(id) || null;
    },
    registerLoginFailure: async ({ email }) => {
      const current = Number(loginFailures.get(email) || 0) + 1;
      loginFailures.set(email, current);
      return current;
    },
    clearLoginFailures: async ({ email }) => {
      loginFailures.delete(email);
      return true;
    },
    setLoginLock: async ({ email, lockSec: lockDuration }) => {
      loginLocks.set(email, {
        until: new Date(Date.now() + Number(lockDuration) * 1000).toISOString(),
        reason: 'too_many_attempts',
      });
      return true;
    },
    getLoginLock: async ({ email }) => {
      const lock = loginLocks.get(email);
      if (!lock) return null;
      if (new Date(lock.until).getTime() <= Date.now()) {
        loginLocks.delete(email);
        return null;
      }
      return lock;
    },
    clearLoginLock: async ({ email }) => {
      loginLocks.delete(email);
      return true;
    },
    createRefreshSession: async ({ tokenId, userId, expiresAt }) => {
      refreshSessions.push({ tokenId, userId, expiresAt });
      return true;
    },
    listDocs: async () => [],
    recordAuditEvent: async (event) => {
      audits.push(event);
      return event;
    },
  };

  const token = {
    createAccessToken: ({ userId }) => `access-${userId}`,
    createRefreshToken: ({ userId }) => {
      refreshCounter += 1;
      return `refresh-${userId}-${refreshCounter}`;
    },
    getTokenMeta: () => {
      refreshCounter += 1;
      return {
        jti: `refresh-jti-${refreshCounter}`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    },
  };

  const auth = new AuthManager({
    managers: {
      dataStore,
      authorization: new AuthorizationManager(),
      token,
      password: {
        compare: async () => passwordMatches,
      },
    },
    config: {
      dotEnv: {
        AUTH_LOGIN_MAX_FAILURES: String(maxFailures),
        AUTH_LOGIN_WINDOW_SEC: String(windowSec),
        AUTH_LOGIN_LOCK_SEC: String(lockSec),
      },
    },
  });

  return {
    auth,
    loginFailures,
    loginLocks,
    refreshSessions,
    audits,
    user,
  };
};

test('login locks account after repeated failed attempts', async () => {
  const { auth, loginFailures, loginLocks, user } = buildAuthManager({
    passwordMatches: false,
    maxFailures: 2,
  });

  const first = await auth.v1_login({
    email: user.email,
    password: 'WrongPass123',
  });
  const second = await auth.v1_login({
    email: user.email,
    password: 'WrongPass123',
  });
  const third = await auth.v1_login({
    email: user.email,
    password: 'WrongPass123',
  });

  assert.equal(first.error, 'invalid credentials');
  assert.equal(second.error, 'account temporarily locked. try again later');
  assert.equal(second.code, 423);
  assert.equal(third.error, 'account temporarily locked. try again later');
  assert.equal(loginFailures.get(user.email), 2);
  assert.ok(loginLocks.has(user.email));
});

test('successful login clears lock guards and issues refresh token', async () => {
  const { auth, loginFailures, loginLocks, refreshSessions, user } = buildAuthManager({
    passwordMatches: true,
    maxFailures: 3,
  });

  loginFailures.set(user.email, 2);
  loginLocks.set(user.email, {
    until: new Date(Date.now() + 30 * 1000).toISOString(),
    reason: 'manual-test-lock',
  });

  await auth._clearLoginGuards({ email: user.email });

  const result = await auth.v1_login({
    email: user.email,
    password: 'CorrectPass123',
  });

  assert.equal(result.token, 'access-u-1');
  assert.ok(result.refreshToken);
  assert.equal(result.user._id, 'u-1');
  assert.equal(loginFailures.has(user.email), false);
  assert.equal(loginLocks.has(user.email), false);
  assert.equal(refreshSessions.length, 1);
});
