const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessSchool } = require('../managers/_common/rbac.helper');
const { ROLES } = require('../managers/_common/constants');

test('superadmin can access any school', () => {
  const actor = { role: ROLES.SUPERADMIN };
  assert.equal(canAccessSchool({ actor, schoolId: 'school-1' }), true);
});

test('school_admin can only access assigned school', () => {
  const actor = { role: ROLES.SCHOOL_ADMIN, schoolId: 'school-1' };
  assert.equal(canAccessSchool({ actor, schoolId: 'school-1' }), true);
  assert.equal(canAccessSchool({ actor, schoolId: 'school-2' }), false);
});
