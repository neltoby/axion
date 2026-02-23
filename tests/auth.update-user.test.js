const test = require('node:test');
const assert = require('node:assert/strict');
const AuthManager = require('../managers/auth/Auth.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES, STATUS } = require('../managers/_common/constants');

const createAuthManager = ({ users, schools = [] }) => {
  const userStore = new Map(users.map((user) => [user._id, { ...user }]));
  const schoolStore = new Map(schools.map((school) => [school._id, { ...school }]));
  const emailIndex = new Map(
    users
      .filter((user) => Boolean(user.email))
      .map((user) => [String(user.email).trim().toLowerCase(), user._id])
  );
  const clearedEmails = [];
  const setEmailIndexOps = [];

  const dataStore = {
    getDoc: async ({ collection, id }) => {
      if (collection === 'users') {
        return userStore.get(id) || null;
      }
      if (collection === 'schools') {
        return schoolStore.get(id) || null;
      }
      return null;
    },
    upsertDoc: async ({ collection, id, doc }) => {
      if (collection !== 'users') {
        return null;
      }

      const prev = userStore.get(id) || null;
      const next = {
        ...(prev || {}),
        ...doc,
        _id: id,
      };
      userStore.set(id, next);
      return next;
    },
    getUserIdByEmail: async ({ email }) => {
      return emailIndex.get(String(email).trim().toLowerCase()) || null;
    },
    clearUserEmailIndex: async ({ email }) => {
      const normalized = String(email).trim().toLowerCase();
      clearedEmails.push(normalized);
      emailIndex.delete(normalized);
      return true;
    },
    setUserEmailIndex: async ({ email, userId }) => {
      const normalized = String(email).trim().toLowerCase();
      setEmailIndexOps.push({ email: normalized, userId });
      emailIndex.set(normalized, userId);
      return true;
    },
    listDocs: async ({ collection }) => {
      if (collection === 'users') {
        return Array.from(userStore.values());
      }
      return [];
    },
  };

  const managers = {
    dataStore,
    authorization: new AuthorizationManager(),
    token: {},
    password: {
      hash: async ({ plain }) => `hashed:${plain}`,
    },
  };

  return {
    auth: new AuthManager({ managers }),
    userStore,
    schoolStore,
    emailIndex,
    clearedEmails,
    setEmailIndexOps,
  };
};

const superadmin = {
  _id: 'super-1',
  email: 'superadmin@axion.test',
  role: ROLES.SUPERADMIN,
  schoolId: null,
  status: STATUS.ACTIVE,
};

const schoolAdminA = {
  _id: 'admin-1',
  email: 'admin.one@axion.test',
  passwordHash: 'hashed:oldA',
  role: ROLES.SCHOOL_ADMIN,
  schoolId: 'school-1',
  firstName: 'Admin',
  lastName: 'One',
  status: STATUS.ACTIVE,
};

const schoolAdminB = {
  _id: 'admin-2',
  email: 'admin.two@axion.test',
  passwordHash: 'hashed:oldB',
  role: ROLES.SCHOOL_ADMIN,
  schoolId: 'school-2',
  firstName: 'Admin',
  lastName: 'Two',
  status: STATUS.ACTIVE,
};

test('superadmin can update school admin profile details', async () => {
  const { auth, userStore, emailIndex, clearedEmails, setEmailIndexOps } = createAuthManager({
    users: [superadmin, schoolAdminA],
    schools: [{ _id: 'school-1' }, { _id: 'school-2' }],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: superadmin._id },
    __authorize: { authorized: true },
    userId: schoolAdminA._id,
    email: 'updated.admin@axion.test',
    firstName: 'Updated',
    lastName: 'Manager',
    schoolId: 'school-2',
    status: STATUS.INACTIVE,
  });

  assert.equal(result.user.email, 'updated.admin@axion.test');
  assert.equal(result.user.firstName, 'Updated');
  assert.equal(result.user.lastName, 'Manager');
  assert.equal(result.user.schoolId, 'school-2');
  assert.equal(result.user.status, STATUS.INACTIVE);
  assert.equal(result.user.passwordHash, undefined);

  const storedUser = userStore.get(schoolAdminA._id);
  assert.equal(storedUser.email, 'updated.admin@axion.test');
  assert.equal(storedUser.schoolId, 'school-2');

  assert.equal(emailIndex.get('admin.one@axion.test'), undefined);
  assert.equal(emailIndex.get('updated.admin@axion.test'), schoolAdminA._id);
  assert.deepEqual(clearedEmails, ['admin.one@axion.test']);
  assert.deepEqual(setEmailIndexOps, [{ email: 'updated.admin@axion.test', userId: schoolAdminA._id }]);
});

test('superadmin can update school admin password hash', async () => {
  const { auth, userStore } = createAuthManager({
    users: [superadmin, schoolAdminA],
    schools: [{ _id: 'school-1' }],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: superadmin._id },
    __authorize: { authorized: true },
    userId: schoolAdminA._id,
    password: 'NewPass123',
  });

  assert.equal(result.user.passwordHash, undefined);
  assert.equal(userStore.get(schoolAdminA._id).passwordHash, 'hashed:NewPass123');
});

test('superadmin cannot update superadmin user', async () => {
  const secondSuperadmin = {
    _id: 'super-2',
    email: 'super2@axion.test',
    role: ROLES.SUPERADMIN,
    schoolId: null,
    status: STATUS.ACTIVE,
  };

  const { auth } = createAuthManager({
    users: [superadmin, secondSuperadmin],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: superadmin._id },
    __authorize: { authorized: true },
    userId: secondSuperadmin._id,
    firstName: 'Nope',
  });

  assert.equal(result.error, 'cannot update superadmin user');
});

test('school admin cannot update users', async () => {
  const { auth } = createAuthManager({
    users: [schoolAdminA, schoolAdminB],
    schools: [{ _id: 'school-1' }, { _id: 'school-2' }],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: schoolAdminA._id },
    __authorize: { authorized: true },
    userId: schoolAdminB._id,
    firstName: 'Blocked',
  });

  assert.equal(result.error, 'forbidden');
});

test('update user rejects duplicate email', async () => {
  const { auth } = createAuthManager({
    users: [superadmin, schoolAdminA, schoolAdminB],
    schools: [{ _id: 'school-1' }, { _id: 'school-2' }],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: superadmin._id },
    __authorize: { authorized: true },
    userId: schoolAdminA._id,
    email: schoolAdminB.email,
  });

  assert.equal(result.error, 'email already in use');
});

test('update user validates school assignment exists', async () => {
  const { auth } = createAuthManager({
    users: [superadmin, schoolAdminA],
    schools: [{ _id: 'school-1' }],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: superadmin._id },
    __authorize: { authorized: true },
    userId: schoolAdminA._id,
    schoolId: 'school-999',
  });

  assert.equal(result.error, 'school not found');
});

test('update user requires at least one actual change', async () => {
  const { auth } = createAuthManager({
    users: [superadmin, schoolAdminA],
    schools: [{ _id: 'school-1' }],
  });

  const result = await auth.v1_updateUser({
    __auth: { userId: superadmin._id },
    __authorize: { authorized: true },
    userId: schoolAdminA._id,
  });

  assert.equal(result.error, 'no update fields provided');
});
