const test = require('node:test');
const assert = require('node:assert/strict');
const AuthManager = require('../managers/auth/Auth.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES, STATUS } = require('../managers/_common/constants');

const createAuthManager = ({ users }) => {
  const userStore = new Map(users.map((user) => [user._id, { ...user }]));
  const deletedUsers = [];
  const clearedEmails = [];

  const dataStore = {
    getDoc: async ({ collection, id }) => {
      if (collection !== 'users') {
        return null;
      }

      return userStore.get(id) || null;
    },
    deleteDoc: async ({ collection, id }) => {
      if (collection !== 'users') {
        return false;
      }

      deletedUsers.push(id);
      return userStore.delete(id);
    },
    clearUserEmailIndex: async ({ email }) => {
      clearedEmails.push(email);
      return true;
    },
    listDocs: async ({ collection }) => {
      if (collection !== 'users') {
        return [];
      }

      return Array.from(userStore.values());
    },
  };

  const managers = {
    dataStore,
    authorization: new AuthorizationManager(),
    token: {},
    password: {},
  };

  return {
    auth: new AuthManager({ managers }),
    userStore,
    deletedUsers,
    clearedEmails,
  };
};

const superadminUser = {
  _id: 'super-1',
  email: 'superadmin@axion.test',
  role: ROLES.SUPERADMIN,
  schoolId: null,
  status: STATUS.ACTIVE,
};

const schoolAdminUser = {
  _id: 'school-admin-1',
  email: 'school.admin@axion.test',
  role: ROLES.SCHOOL_ADMIN,
  schoolId: 'school-1',
  status: STATUS.ACTIVE,
};

test('superadmin can delete a school admin user', async () => {
  const { auth, userStore, deletedUsers, clearedEmails } = createAuthManager({
    users: [superadminUser, schoolAdminUser],
  });

  const result = await auth.v1_deleteUser({
    __auth: { userId: superadminUser._id },
    __authorize: { authorized: true },
    userId: schoolAdminUser._id,
  });

  assert.deepEqual(result, {
    deleted: {
      userId: schoolAdminUser._id,
      role: ROLES.SCHOOL_ADMIN,
    },
  });
  assert.equal(userStore.has(schoolAdminUser._id), false);
  assert.deepEqual(deletedUsers, [schoolAdminUser._id]);
  assert.deepEqual(clearedEmails, [schoolAdminUser.email]);
});

test('superadmin cannot delete current signed-in user', async () => {
  const { auth, deletedUsers } = createAuthManager({
    users: [superadminUser, schoolAdminUser],
  });

  const result = await auth.v1_deleteUser({
    __auth: { userId: superadminUser._id },
    __authorize: { authorized: true },
    userId: superadminUser._id,
  });

  assert.equal(result.error, 'cannot delete current user');
  assert.deepEqual(deletedUsers, []);
});

test('superadmin cannot delete another superadmin user', async () => {
  const secondSuperadmin = {
    _id: 'super-2',
    email: 'superadmin.two@axion.test',
    role: ROLES.SUPERADMIN,
    schoolId: null,
    status: STATUS.ACTIVE,
  };

  const { auth, deletedUsers } = createAuthManager({
    users: [superadminUser, secondSuperadmin],
  });

  const result = await auth.v1_deleteUser({
    __auth: { userId: superadminUser._id },
    __authorize: { authorized: true },
    userId: secondSuperadmin._id,
  });

  assert.equal(result.error, 'cannot delete superadmin user');
  assert.deepEqual(deletedUsers, []);
});

test('school admin cannot delete users', async () => {
  const anotherSchoolAdmin = {
    _id: 'school-admin-2',
    email: 'school.admin.two@axion.test',
    role: ROLES.SCHOOL_ADMIN,
    schoolId: 'school-1',
    status: STATUS.ACTIVE,
  };

  const { auth, deletedUsers } = createAuthManager({
    users: [schoolAdminUser, anotherSchoolAdmin],
  });

  const result = await auth.v1_deleteUser({
    __auth: { userId: schoolAdminUser._id },
    __authorize: { authorized: true },
    userId: anotherSchoolAdmin._id,
  });

  assert.equal(result.error, 'forbidden');
  assert.deepEqual(deletedUsers, []);
});

test('delete user returns not found for unknown user id', async () => {
  const { auth, deletedUsers } = createAuthManager({
    users: [superadminUser],
  });

  const result = await auth.v1_deleteUser({
    __auth: { userId: superadminUser._id },
    __authorize: { authorized: true },
    userId: 'user-does-not-exist',
  });

  assert.equal(result.error, 'user not found');
  assert.deepEqual(deletedUsers, []);
});
