const test = require('node:test');
const assert = require('node:assert/strict');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const { ROLES } = require('../managers/_common/constants');

const manager = new AuthorizationManager();

test('superadmin has global school create permission', async () => {
  const actor = { role: ROLES.SUPERADMIN };
  assert.equal(
    await manager.hasGlobalPermission({ actor, resource: 'school', action: 'create' }),
    true
  );
});

test('school_admin cannot create schools', async () => {
  const actor = { role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' };
  assert.equal(
    await manager.hasPermission({ actor, resource: 'school', action: 'create' }),
    false
  );
});

test('school_admin classroom access is scoped to assigned school', async () => {
  const actor = { role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' };
  assert.equal(
    await manager.canAccessClassroom({ actor, schoolId: 'school-1', action: 'config' }),
    true
  );
  assert.equal(
    await manager.canAccessClassroom({ actor, schoolId: 'school-2', action: 'config' }),
    false
  );
});
