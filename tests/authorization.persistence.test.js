const test = require('node:test');
const assert = require('node:assert/strict');
const DataStore = require('../managers/data_store/DataStore.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES } = require('../managers/_common/constants');

const createMemoryCache = () => {
  const keys = new Map();
  const sets = new Map();

  return {
    key: {
      set: async ({ key, data }) => {
        keys.set(key, data);
        return true;
      },
      get: async ({ key }) => {
        return keys.has(key) ? keys.get(key) : null;
      },
      delete: async ({ key }) => {
        keys.delete(key);
        return true;
      },
    },
    set: {
      add: async ({ key, arr }) => {
        const bucket = sets.get(key) || new Set();
        for (const item of arr || []) {
          bucket.add(item);
        }
        sets.set(key, bucket);
        return true;
      },
      get: async ({ key }) => {
        return Array.from(sets.get(key) || []);
      },
      remove: async ({ key, arr }) => {
        const bucket = sets.get(key) || new Set();
        for (const item of arr || []) {
          bucket.delete(item);
        }
        sets.set(key, bucket);
        return true;
      },
    },
  };
};

test('authorization seeds default role permissions into datastore', async () => {
  const cache = createMemoryCache();
  const dataStore = new DataStore({ cache });
  const authorization = new AuthorizationManager({ managers: { dataStore } });

  const canCreateSchool = await authorization.hasPermission({
    actor: { role: ROLES.SUPERADMIN },
    resource: 'school',
    action: 'create',
  });
  assert.equal(canCreateSchool, true);

  const roleDoc = await dataStore.getRolePermissions({ role: ROLES.SUPERADMIN });
  assert.ok(roleDoc);
  assert.equal(Array.isArray(roleDoc.permissions), true);
  assert.equal(roleDoc.permissions.includes('school:create'), true);
});

test('setRolePermissions persists and changes authorization decisions', async () => {
  const cache = createMemoryCache();
  const dataStore = new DataStore({ cache });
  const authorization = new AuthorizationManager({ managers: { dataStore } });

  const update = await authorization.setRolePermissions({
    role: ROLES.SCHOOL_ADMIN,
    permissions: ['school:read', 'user:read'],
  });
  assert.ok(update.version);

  const canConfigClassroom = await authorization.hasPermission({
    actor: { role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' },
    resource: 'classroom',
    action: 'config',
  });
  assert.equal(canConfigClassroom, false);

  const canReadSchool = await authorization.hasPermission({
    actor: { role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' },
    resource: 'school',
    action: 'read',
  });
  assert.equal(canReadSchool, true);

  const roleDoc = await dataStore.getRolePermissions({ role: ROLES.SCHOOL_ADMIN });
  assert.deepEqual(roleDoc.permissions.sort(), ['school:read', 'user:read'].sort());
});
