const { ROLES } = require('../_common/constants');

const RESOURCES = {
  SCHOOL: 'school',
  CLASSROOM: 'classroom',
  STUDENT: 'student',
  USER: 'user',
};

const ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  CONFIG: 'config',
};

const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.SUPERADMIN]: [
    'school:read',
    'school:create',
    'school:config',
    'classroom:read',
    'classroom:create',
    'classroom:config',
    'student:read',
    'student:create',
    'student:config',
    'user:read',
    'user:create',
    'user:config',
  ],
  [ROLES.SCHOOL_ADMIN]: [
    'school:read',
    'school:config',
    'classroom:read',
    'classroom:create',
    'classroom:config',
    'student:read',
    'student:create',
    'student:config',
    'user:read',
  ],
};

module.exports = class AuthorizationManager {
  constructor({ managers = {}, cortex = null } = {}) {
    this.managers = managers;
    this.cortex = cortex;

    this.httpExposed = [];
    this.policyUpdateTopic = 'internal.authorization.policyUpdated';
    this.policyCacheTtlMs = 30 * 1000;
    this.rolePermissionsCache = null;
    this.policyVersionCache = null;
    this.cacheLoadedAt = 0;

    this._subPolicyUpdates();
  }

  _dataStore() {
    return this.managers?.dataStore || null;
  }

  _permissionKey({ resource, action }) {
    return `${resource}:${action}`;
  }

  _isSuperadmin(actor) {
    return Boolean(actor && actor.role === ROLES.SUPERADMIN);
  }

  _isCacheStale() {
    return Date.now() - this.cacheLoadedAt >= this.policyCacheTtlMs;
  }

  _invalidateCache() {
    this.rolePermissionsCache = null;
    this.cacheLoadedAt = 0;
  }

  _normalizePermissions(permissions) {
    if (!Array.isArray(permissions)) {
      return [];
    }

    return Array.from(new Set(permissions.filter(Boolean)));
  }

  _defaultRolePermissionsMap() {
    const map = new Map();
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      map.set(role, new Set(this._normalizePermissions(permissions)));
    }
    return map;
  }

  _subPolicyUpdates() {
    if (!this.cortex || !this.cortex.sub) {
      return;
    }

    this.cortex.sub(this.policyUpdateTopic, (payload = {}) => {
      if (payload.version && payload.version === this.policyVersionCache) {
        return;
      }

      this.policyVersionCache = payload.version || null;
      this._invalidateCache();
    });
  }

  _emitPolicyUpdate({ version, role }) {
    if (!this.cortex || !this.cortex.AsyncEmitToAllOf) {
      return;
    }

    try {
      this.cortex.AsyncEmitToAllOf({
        type: this.cortex.nodeType,
        call: this.policyUpdateTopic,
        args: { version, role },
      });
    } catch (err) {
      console.log('failed to publish authorization policy update', err);
    }
  }

  async _recordAudit({ action, status = 'success', metadata = {}, actorId = null }) {
    if (!this._dataStore()?.recordAuditEvent) {
      return null;
    }

    try {
      return await this._dataStore().recordAuditEvent({
        actorId,
        action,
        resourceType: 'authorization_policy',
        resourceId: null,
        status,
        metadata,
      });
    } catch (err) {
      console.log('authorization audit failure', err?.message || err);
      return null;
    }
  }

  async _ensureDefaultPolicySeeded() {
    if (!this._dataStore()) {
      return;
    }

    const roleDocs = await this._dataStore().listRolePermissions();
    if (roleDocs.length > 0) {
      return;
    }

    await Promise.all(
      Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, permissions]) =>
        this._dataStore().upsertRolePermissions({
          role,
          permissions,
        })
      )
    );

    const version = await this._dataStore().setAuthorizationPolicyVersion({});
    this.policyVersionCache = version;
    this._emitPolicyUpdate({ version });
  }

  async _refreshRolePermissionsCache({ force = false } = {}) {
    if (!this._dataStore()) {
      this.rolePermissionsCache = this._defaultRolePermissionsMap();
      this.cacheLoadedAt = Date.now();
      return this.rolePermissionsCache;
    }

    if (!force && this.rolePermissionsCache && !this._isCacheStale()) {
      return this.rolePermissionsCache;
    }

    await this._ensureDefaultPolicySeeded();

    const [version, roleDocs] = await Promise.all([
      this._dataStore().getAuthorizationPolicyVersion(),
      this._dataStore().listRolePermissions(),
    ]);

    if (!force && this.rolePermissionsCache && version && version === this.policyVersionCache) {
      this.cacheLoadedAt = Date.now();
      return this.rolePermissionsCache;
    }

    const map = this._defaultRolePermissionsMap();
    for (const doc of roleDocs) {
      if (!doc || !doc.role) {
        continue;
      }

      map.set(doc.role, new Set(this._normalizePermissions(doc.permissions)));
    }

    this.rolePermissionsCache = map;
    this.policyVersionCache = version || this.policyVersionCache;
    this.cacheLoadedAt = Date.now();

    return this.rolePermissionsCache;
  }

  async _getRolePermissionsSet({ role }) {
    if (!role) {
      return null;
    }

    const map = await this._refreshRolePermissionsCache();
    return map.get(role) || null;
  }

  _canAccessSchoolScope({ actor, schoolId }) {
    if (!actor || !schoolId) {
      return false;
    }

    if (this._isSuperadmin(actor)) {
      return true;
    }

    return actor.role === ROLES.SCHOOL_ADMIN && actor.schoolId === schoolId;
  }

  async getRolePermissions({ role }) {
    const permissionsSet = await this._getRolePermissionsSet({ role });
    if (!permissionsSet) {
      return [];
    }

    return Array.from(permissionsSet);
  }

  async listRolePermissions() {
    const map = await this._refreshRolePermissionsCache();
    return Array.from(map.entries()).map(([role, permissions]) => ({
      role,
      permissions: Array.from(permissions),
    }));
  }

  async setRolePermissions({ role, permissions }) {
    if (!role) {
      return { error: 'role is required' };
    }

    const normalizedPermissions = this._normalizePermissions(permissions);
    if (normalizedPermissions.length === 0) {
      return { error: 'permissions must be a non-empty array' };
    }

    if (!this._dataStore()) {
      return { error: 'data store unavailable' };
    }

    const roleDoc = await this._dataStore().upsertRolePermissions({
      role,
      permissions: normalizedPermissions,
    });

    const version = await this._dataStore().setAuthorizationPolicyVersion({});
    this.policyVersionCache = version;
    this._invalidateCache();
    this._emitPolicyUpdate({ version, role });

    await this._recordAudit({
      action: 'authorization.set_role_permissions',
      status: 'success',
      metadata: {
        role,
        permissions: normalizedPermissions,
        version,
      },
    });

    return {
      role: roleDoc?.role || role,
      permissions: roleDoc?.permissions || normalizedPermissions,
      version,
    };
  }

  async hasPermission({ actor, resource, action }) {
    if (!actor || !actor.role || !resource || !action) {
      return false;
    }

    const permissions = await this._getRolePermissionsSet({ role: actor.role });
    if (!permissions) {
      return false;
    }

    return permissions.has(this._permissionKey({ resource, action }));
  }

  async hasGlobalPermission({ actor, resource, action }) {
    if (!(await this.hasPermission({ actor, resource, action }))) {
      return false;
    }

    return this._isSuperadmin(actor);
  }

  async canAccessSchool({ actor, schoolId, action }) {
    if (!(await this.hasPermission({ actor, resource: RESOURCES.SCHOOL, action }))) {
      return false;
    }

    return this._canAccessSchoolScope({ actor, schoolId });
  }

  async canAccessClassroom({ actor, schoolId, action }) {
    if (!(await this.hasPermission({ actor, resource: RESOURCES.CLASSROOM, action }))) {
      return false;
    }

    return this._canAccessSchoolScope({ actor, schoolId });
  }

  async canAccessStudent({ actor, schoolId, action }) {
    if (!(await this.hasPermission({ actor, resource: RESOURCES.STUDENT, action }))) {
      return false;
    }

    return this._canAccessSchoolScope({ actor, schoolId });
  }

  async canListUsersInSchool({ actor, schoolId }) {
    if (!(await this.hasPermission({ actor, resource: RESOURCES.USER, action: ACTIONS.READ }))) {
      return false;
    }

    return this._canAccessSchoolScope({ actor, schoolId });
  }
};
