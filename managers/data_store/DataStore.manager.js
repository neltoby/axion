const { nanoid } = require('nanoid');

module.exports = class DataStore {
  constructor({ cache }) {
    this.cache = cache;
    this.keyspace = 'sms';
  }

  _docKey(collection, id) {
    return `${this.keyspace}:${collection}:${id}`;
  }

  _indexKey(collection) {
    return `${this.keyspace}:idx:${collection}`;
  }

  _emailIndexKey(email) {
    return `${this.keyspace}:idx:users:email:${email}`;
  }

  _schoolClassroomsIndexKey(schoolId) {
    return `${this.keyspace}:idx:schools:${schoolId}:classrooms`;
  }

  _schoolStudentsIndexKey(schoolId) {
    return `${this.keyspace}:idx:schools:${schoolId}:students`;
  }

  _authorizationPolicyVersionKey() {
    return `${this.keyspace}:meta:authorization:policyVersion`;
  }

  _safeParse(raw) {
    if (!raw || raw === 'null') {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async _writeJson(key, value, ttl) {
    return this.cache.key.set({
      key,
      data: JSON.stringify(value),
      ttl,
    });
  }

  async _readJson(key) {
    const raw = await this.cache.key.get({ key });
    return this._safeParse(raw);
  }

  async _removeKey(key) {
    return this.cache.key.delete({ key });
  }

  _normalizeId(id) {
    return id || nanoid(16);
  }

  async upsertDoc({ collection, id, doc }) {
    const safeId = this._normalizeId(id);
    const now = new Date().toISOString();
    const previous = await this.getDoc({ collection, id: safeId });

    const payload = {
      ...(previous || {}),
      ...doc,
      _id: safeId,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };

    await this._writeJson(this._docKey(collection, safeId), payload);
    await this.cache.set.add({ key: this._indexKey(collection), arr: [safeId] });

    return payload;
  }

  async getDoc({ collection, id }) {
    if (!id) {
      return null;
    }

    return this._readJson(this._docKey(collection, id));
  }

  async listIds({ collection }) {
    const ids = await this.cache.set.get({ key: this._indexKey(collection) });
    return ids || [];
  }

  async listDocs({ collection, ids }) {
    const targetIds = ids || (await this.listIds({ collection }));
    if (!targetIds || targetIds.length === 0) {
      return [];
    }

    const docs = await Promise.all(
      targetIds.map((id) => this.getDoc({ collection, id }))
    );

    return docs.filter(Boolean);
  }

  async deleteDoc({ collection, id }) {
    if (!id) {
      return false;
    }

    await this._removeKey(this._docKey(collection, id));
    await this.cache.set.remove({ key: this._indexKey(collection), arr: [id] });
    return true;
  }

  async setUserEmailIndex({ email, userId }) {
    if (!email || !userId) {
      return false;
    }

    await this.cache.key.set({
      key: this._emailIndexKey(email),
      data: userId,
    });

    return true;
  }

  async getUserIdByEmail({ email }) {
    if (!email) {
      return null;
    }

    const userId = await this.cache.key.get({ key: this._emailIndexKey(email) });
    if (!userId || userId === 'null') {
      return null;
    }

    return userId;
  }

  async clearUserEmailIndex({ email }) {
    if (!email) {
      return false;
    }

    return this._removeKey(this._emailIndexKey(email));
  }

  async addClassroomToSchool({ schoolId, classroomId }) {
    if (!schoolId || !classroomId) {
      return false;
    }

    await this.cache.set.add({
      key: this._schoolClassroomsIndexKey(schoolId),
      arr: [classroomId],
    });

    return true;
  }

  async removeClassroomFromSchool({ schoolId, classroomId }) {
    if (!schoolId || !classroomId) {
      return false;
    }

    await this.cache.set.remove({
      key: this._schoolClassroomsIndexKey(schoolId),
      arr: [classroomId],
    });

    return true;
  }

  async listClassroomIdsBySchool({ schoolId }) {
    if (!schoolId) {
      return [];
    }

    const ids = await this.cache.set.get({ key: this._schoolClassroomsIndexKey(schoolId) });
    return ids || [];
  }

  async addStudentToSchool({ schoolId, studentId }) {
    if (!schoolId || !studentId) {
      return false;
    }

    await this.cache.set.add({
      key: this._schoolStudentsIndexKey(schoolId),
      arr: [studentId],
    });

    return true;
  }

  async removeStudentFromSchool({ schoolId, studentId }) {
    if (!schoolId || !studentId) {
      return false;
    }

    await this.cache.set.remove({
      key: this._schoolStudentsIndexKey(schoolId),
      arr: [studentId],
    });

    return true;
  }

  async listStudentIdsBySchool({ schoolId }) {
    if (!schoolId) {
      return [];
    }

    const ids = await this.cache.set.get({ key: this._schoolStudentsIndexKey(schoolId) });
    return ids || [];
  }

  async upsertRolePermissions({ role, permissions }) {
    if (!role || !Array.isArray(permissions)) {
      return null;
    }

    const uniquePermissions = Array.from(new Set(permissions.filter(Boolean)));
    return this.upsertDoc({
      collection: 'role_permissions',
      id: role,
      doc: {
        role,
        permissions: uniquePermissions,
      },
    });
  }

  async getRolePermissions({ role }) {
    if (!role) {
      return null;
    }

    return this.getDoc({ collection: 'role_permissions', id: role });
  }

  async listRolePermissions() {
    return this.listDocs({ collection: 'role_permissions' });
  }

  async setAuthorizationPolicyVersion({ version }) {
    const safeVersion = version || String(Date.now());
    await this.cache.key.set({
      key: this._authorizationPolicyVersionKey(),
      data: safeVersion,
    });

    return safeVersion;
  }

  async getAuthorizationPolicyVersion() {
    const version = await this.cache.key.get({
      key: this._authorizationPolicyVersionKey(),
    });

    return version || null;
  }
};
