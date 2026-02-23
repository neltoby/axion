const test = require('node:test');
const assert = require('node:assert/strict');
const AuthManager = require('../managers/auth/Auth.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES } = require('../managers/_common/constants');

const createAuthManager = ({ actor }) => {
  const managers = {
    authorization: new AuthorizationManager(),
    dataStore: {
      getDoc: async ({ collection, id }) => {
        if (collection === 'users' && id === actor?._id) {
          return actor;
        }

        return null;
      },
      listDocs: async () => [],
    },
    token: {},
    password: {},
  };

  return new AuthManager({ managers });
};

test('ensureSuperadmin authorizes only superadmin role', async () => {
  const superadmin = { _id: 'u-1', role: ROLES.SUPERADMIN, schoolId: null };
  const schoolAdmin = { _id: 'u-2', role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' };

  const adminAuth = createAuthManager({ actor: superadmin });
  const schoolAuth = createAuthManager({ actor: schoolAdmin });

  const okGate = await adminAuth.ensureSuperadmin({ __auth: { userId: superadmin._id } });
  const blockedGate = await schoolAuth.ensureSuperadmin({ __auth: { userId: schoolAdmin._id } });

  assert.ok(okGate.actor);
  assert.equal(blockedGate.error, 'forbidden');
});

test('canAccessClassroom keeps school scope for school_admin', async () => {
  const actor = { _id: 'u-3', role: ROLES.SCHOOL_ADMIN, schoolId: 'school-9' };
  const auth = createAuthManager({ actor });

  assert.equal(
    await auth.canAccessClassroom({
      actor,
      schoolId: 'school-9',
      classroomId: 'class-1',
      action: 'read',
    }),
    true
  );

  assert.equal(
    await auth.canAccessClassroom({
      actor,
      schoolId: 'school-10',
      classroomId: 'class-1',
      action: 'read',
    }),
    false
  );
});

test('hasGlobalSchoolPermission is true only for superadmin', async () => {
  const superadmin = createAuthManager({
    actor: { _id: 'u-4', role: ROLES.SUPERADMIN, schoolId: null },
  });
  const schoolAdmin = createAuthManager({
    actor: { _id: 'u-5', role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' },
  });

  assert.equal(
    await superadmin.hasGlobalSchoolPermission({
      actor: { _id: 'u-4', role: ROLES.SUPERADMIN, schoolId: null },
      action: 'read',
    }),
    true
  );
  assert.equal(
    await schoolAdmin.hasGlobalSchoolPermission({
      actor: { _id: 'u-5', role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' },
      action: 'read',
    }),
    false
  );
});
