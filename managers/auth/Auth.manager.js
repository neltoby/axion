const {
  ensureEmail,
  ensurePassword,
  ensureString,
  compactErrors,
  lower,
  normalizeString,
} = require('../_common/validation.helper');
const { ROLES, STATUS } = require('../_common/constants');

const ACL_ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  CONFIG: 'config',
};

const ACL_RESOURCES = {
  SCHOOL: 'school',
  CLASSROOM: 'classroom',
  STUDENT: 'student',
  USER: 'user',
};

module.exports = class AuthManager {
  constructor({ managers }) {
    this.managers = managers;

    this.httpExposed = [
      'post=v1_bootstrapSuperadmin',
      'post=v1_login',
      'get=v1_me',
      'post=v1_createSchoolAdmin',
      'get=v1_listUsers',
      'patch=v1_updateUser',
      'delete=v1_deleteUser',
    ];
  }

  _dataStore() {
    return this.managers.dataStore;
  }

  _token() {
    return this.managers.token;
  }

  _password() {
    return this.managers.password;
  }

  _authorization() {
    return this.managers.authorization;
  }

  _sanitizeUser(user) {
    if (!user) {
      return null;
    }

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async _findUserByEmail(email) {
    const userId = await this._dataStore().getUserIdByEmail({ email: lower(email) });
    if (!userId) {
      return null;
    }

    return this._dataStore().getDoc({ collection: 'users', id: userId });
  }

  async _findUserById(userId) {
    return this._dataStore().getDoc({ collection: 'users', id: userId });
  }

  async _countSuperadmins() {
    const users = await this._dataStore().listDocs({ collection: 'users' });
    return users.filter((user) => user.role === ROLES.SUPERADMIN).length;
  }

  _isSuperadmin(actor) {
    return Boolean(actor && actor.role === ROLES.SUPERADMIN);
  }

  isSchoolAdmin(actor) {
    return Boolean(actor && actor.role === ROLES.SCHOOL_ADMIN);
  }

  async hasGlobalSchoolPermission({ actor, action = ACL_ACTIONS.READ }) {
    return await this._authorization().hasGlobalPermission({
      actor,
      resource: ACL_RESOURCES.SCHOOL,
      action,
    });
  }

  async canAccessSchool({ actor, schoolId, action = ACL_ACTIONS.READ }) {
    return await this._authorization().canAccessSchool({
      actor,
      schoolId,
      action,
    });
  }

  async canAccessClassroom({ actor, schoolId, classroomId, action = ACL_ACTIONS.READ }) {
    return await this._authorization().canAccessClassroom({
      actor,
      schoolId,
      action,
    });
  }

  async canAccessStudent({ actor, schoolId, studentId, action = ACL_ACTIONS.READ }) {
    return await this._authorization().canAccessStudent({
      actor,
      schoolId,
      action,
    });
  }

  async grantSchoolAdminAccess() {
    return true;
  }

  async revokeSchoolAdminAccess() {
    return true;
  }

  async ensureAuthenticatedActor({ __auth }) {
    if (!__auth || !__auth.userId) {
      return null;
    }

    return this._findUserById(__auth.userId);
  }

  async ensureSuperadmin({ __auth }) {
    const actor = await this.ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const granted = await this.hasGlobalSchoolPermission({
      actor,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!granted) {
      return { error: 'forbidden' };
    }

    return { actor };
  }

  async v1_bootstrapSuperadmin({ email, password, firstName, lastName }) {
    const errors = compactErrors([
      ensureEmail({ value: email }),
      ensurePassword({ value: password }),
      ensureString({ value: firstName, field: 'firstName', min: 2, max: 80 }),
      ensureString({ value: lastName, field: 'lastName', min: 2, max: 80 }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const superadminCount = await this._countSuperadmins();
    if (superadminCount > 0) {
      return { error: 'superadmin already exists. use login.' };
    }

    const normalizedEmail = lower(email);
    const existingUser = await this._findUserByEmail(normalizedEmail);
    if (existingUser) {
      return { error: 'email already in use' };
    }

    const passwordHash = await this._password().hash({ plain: password });

    const user = await this._dataStore().upsertDoc({
      collection: 'users',
      doc: {
        email: normalizedEmail,
        passwordHash,
        firstName: normalizeString(firstName),
        lastName: normalizeString(lastName),
        role: ROLES.SUPERADMIN,
        schoolId: null,
        status: STATUS.ACTIVE,
      },
    });

    await this._dataStore().setUserEmailIndex({ email: normalizedEmail, userId: user._id });

    const token = this._token().createAccessToken({
      userId: user._id,
      role: user.role,
      schoolId: user.schoolId,
      email: user.email,
    });

    return {
      token,
      user: this._sanitizeUser(user),
    };
  }

  async v1_login({ email, password }) {
    const errors = compactErrors([
      ensureEmail({ value: email }),
      ensureString({ value: password, field: 'password', min: 1, max: 128 }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const user = await this._findUserByEmail(lower(email));
    if (!user) {
      return { error: 'invalid credentials' };
    }

    if (user.status !== STATUS.ACTIVE) {
      return { error: 'account is inactive' };
    }

    const ok = await this._password().compare({
      plain: password,
      hash: user.passwordHash,
    });
    if (!ok) {
      return { error: 'invalid credentials' };
    }

    const token = this._token().createAccessToken({
      userId: user._id,
      role: user.role,
      schoolId: user.schoolId,
      email: user.email,
    });

    return {
      token,
      user: this._sanitizeUser(user),
    };
  }

  async v1_me({ __auth, __authorize }) {
    const actor = await this.ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    return { user: this._sanitizeUser(actor) };
  }

  async v1_createSchoolAdmin({ __auth, __authorize, schoolId, email, password, firstName, lastName }) {
    const gate = await this.ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const errors = compactErrors([
      ensureString({ value: schoolId, field: 'schoolId', min: 3, max: 64 }),
      ensureEmail({ value: email }),
      ensurePassword({ value: password }),
      ensureString({ value: firstName, field: 'firstName', min: 2, max: 80 }),
      ensureString({ value: lastName, field: 'lastName', min: 2, max: 80 }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const school = await this._dataStore().getDoc({ collection: 'schools', id: schoolId });
    if (!school) {
      return { error: 'school not found' };
    }

    const normalizedEmail = lower(email);
    const existingUser = await this._findUserByEmail(normalizedEmail);
    if (existingUser) {
      return { error: 'email already in use' };
    }

    const passwordHash = await this._password().hash({ plain: password });
    const user = await this._dataStore().upsertDoc({
      collection: 'users',
      doc: {
        email: normalizedEmail,
        passwordHash,
        firstName: normalizeString(firstName),
        lastName: normalizeString(lastName),
        role: ROLES.SCHOOL_ADMIN,
        schoolId,
        status: STATUS.ACTIVE,
      },
    });

    await this._dataStore().setUserEmailIndex({ email: normalizedEmail, userId: user._id });

    return {
      user: this._sanitizeUser(user),
    };
  }

  async v1_listUsers({ __auth, __authorize, __query }) {
    const actor = await this.ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const roleFilter = __query?.role ? lower(__query.role) : null;

    if (roleFilter) {
      const roleErr = ensureString({
        value: roleFilter,
        field: 'role',
        min: 3,
        max: 50,
      });

      if (roleErr) {
        return { errors: [roleErr] };
      }
    }

    let users = await this._dataStore().listDocs({ collection: 'users' });

    const canViewAllUsers = await this._authorization().hasGlobalPermission({
      actor,
      resource: ACL_RESOURCES.USER,
      action: ACL_ACTIONS.CONFIG,
    });

    if (!canViewAllUsers) {
      if (!actor.schoolId) {
        return { error: 'forbidden' };
      }

      const canViewSchoolUsers = await this._authorization().canListUsersInSchool({
        actor,
        schoolId: actor.schoolId,
      });
      if (!canViewSchoolUsers) {
        return { error: 'forbidden' };
      }

      users = users.filter((user) => user.schoolId === actor.schoolId);
    }

    if (roleFilter) {
      users = users.filter((user) => user.role === roleFilter);
    }

    return {
      users: users.map((user) => this._sanitizeUser(user)),
    };
  }

  async v1_updateUser({
    __auth,
    __authorize,
    userId,
    email,
    password,
    firstName,
    lastName,
    status,
    schoolId,
  }) {
    const gate = await this.ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const userIdErr = ensureString({ value: userId, field: 'userId', min: 3, max: 64 });
    if (userIdErr) {
      return { errors: [userIdErr] };
    }

    const targetUser = await this._findUserById(userId);
    if (!targetUser) {
      return { error: 'user not found' };
    }

    if (targetUser.role === ROLES.SUPERADMIN) {
      return { error: 'cannot update superadmin user' };
    }

    const errors = compactErrors([
      ensureEmail({ value: email, required: false }),
      ensurePassword({ value: password, required: false }),
      ensureString({ value: firstName, field: 'firstName', min: 2, max: 80, required: false }),
      ensureString({ value: lastName, field: 'lastName', min: 2, max: 80, required: false }),
      ensureString({ value: status, field: 'status', min: 6, max: 12, required: false }),
      ensureString({ value: schoolId, field: 'schoolId', min: 3, max: 64, required: false }),
    ]);
    if (errors.length > 0) {
      return { errors };
    }

    if (status && !Object.values(STATUS).includes(status)) {
      return { errors: [`status must be one of: ${Object.values(STATUS).join(', ')}`] };
    }

    if (schoolId !== undefined) {
      const school = await this._dataStore().getDoc({ collection: 'schools', id: schoolId });
      if (!school) {
        return { error: 'school not found' };
      }
    }

    const updateDoc = {};
    let normalizedEmail = null;
    let shouldUpdateEmail = false;

    if (email !== undefined) {
      normalizedEmail = lower(email);
      if (normalizedEmail !== targetUser.email) {
        const existingUser = await this._findUserByEmail(normalizedEmail);
        if (existingUser && existingUser._id !== targetUser._id) {
          return { error: 'email already in use' };
        }
        updateDoc.email = normalizedEmail;
        shouldUpdateEmail = true;
      }
    }

    if (password !== undefined) {
      updateDoc.passwordHash = await this._password().hash({ plain: password });
    }

    if (firstName !== undefined) {
      updateDoc.firstName = normalizeString(firstName);
    }

    if (lastName !== undefined) {
      updateDoc.lastName = normalizeString(lastName);
    }

    if (status !== undefined) {
      updateDoc.status = status;
    }

    if (schoolId !== undefined) {
      updateDoc.schoolId = normalizeString(schoolId);
    }

    if (Object.keys(updateDoc).length === 0) {
      return { error: 'no update fields provided' };
    }

    const updatedUser = await this._dataStore().upsertDoc({
      collection: 'users',
      id: userId,
      doc: updateDoc,
    });

    if (shouldUpdateEmail) {
      if (targetUser.email && targetUser.email !== normalizedEmail) {
        await this._dataStore().clearUserEmailIndex({ email: targetUser.email });
      }
      await this._dataStore().setUserEmailIndex({
        email: normalizedEmail,
        userId: updatedUser._id,
      });
    }

    return {
      user: this._sanitizeUser(updatedUser),
    };
  }

  async v1_deleteUser({ __auth, __authorize, userId }) {
    const gate = await this.ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const userIdErr = ensureString({ value: userId, field: 'userId', min: 3, max: 64 });
    if (userIdErr) {
      return { errors: [userIdErr] };
    }

    const actor = gate.actor;
    if (actor._id === userId) {
      return { error: 'cannot delete current user' };
    }

    const targetUser = await this._findUserById(userId);
    if (!targetUser) {
      return { error: 'user not found' };
    }

    if (targetUser.role === ROLES.SUPERADMIN) {
      return { error: 'cannot delete superadmin user' };
    }

    await this._dataStore().deleteDoc({ collection: 'users', id: userId });
    if (targetUser.email) {
      await this._dataStore().clearUserEmailIndex({ email: targetUser.email });
    }

    return {
      deleted: {
        userId,
        role: targetUser.role,
      },
    };
  }
};
