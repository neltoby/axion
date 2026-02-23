const {
  ensureString,
  compactErrors,
  normalizeString,
} = require('../_common/validation.helper');
const { STATUS } = require('../_common/constants');

module.exports = class SchoolsManager {
  constructor({ managers }) {
    this.managers = managers;

    this.httpExposed = [
      'post=v1_createSchool',
      'get=v1_getSchool',
      'get=v1_listSchools',
      'patch=v1_updateSchool',
      'delete=v1_deleteSchool',
    ];
  }

  _auth() {
    return this.managers.auth;
  }

  _dataStore() {
    return this.managers.dataStore;
  }

  _sanitizeSchool(school) {
    if (!school) {
      return null;
    }

    return {
      _id: school._id,
      name: school.name,
      code: school.code,
      address: school.address,
      description: school.description,
      status: school.status,
      createdAt: school.createdAt,
      updatedAt: school.updatedAt,
    };
  }

  _uniqueIds(items = []) {
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  async v1_createSchool({ __auth, __authorize, name, code, address, description }) {
    const gate = await this._auth().ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const errors = compactErrors([
      ensureString({ value: name, field: 'name', min: 2, max: 120 }),
      ensureString({ value: code, field: 'code', min: 2, max: 25 }),
      ensureString({ value: address, field: 'address', min: 4, max: 255 }),
      ensureString({ value: description, field: 'description', min: 4, max: 500, required: false }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const allSchools = await this._dataStore().listDocs({ collection: 'schools' });
    const exists = allSchools.find(
      (school) => (school.code || '').toLowerCase() === normalizeString(code).toLowerCase()
    );

    if (exists) {
      return { error: 'school code already exists' };
    }

    const school = await this._dataStore().upsertDoc({
      collection: 'schools',
      doc: {
        name: normalizeString(name),
        code: normalizeString(code),
        address: normalizeString(address),
        description: description ? normalizeString(description) : '',
        status: STATUS.ACTIVE,
      },
    });

    return {
      school: this._sanitizeSchool(school),
    };
  }

  async v1_getSchool({ __auth, __authorize, __query }) {
    const gate = await this._auth().ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const actor = gate.actor;

    const schoolId = __query?.schoolId || __query?.id || actor.schoolId;
    const schoolIdErr = ensureString({ value: schoolId, field: 'schoolId', min: 3, max: 64 });
    if (schoolIdErr) {
      return { errors: [schoolIdErr] };
    }

    const school = await this._dataStore().getDoc({ collection: 'schools', id: schoolId });
    if (!school) {
      return { error: 'school not found' };
    }

    return {
      school: this._sanitizeSchool(school),
    };
  }

  async v1_listSchools({ __auth, __authorize }) {
    const gate = await this._auth().ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const schools = await this._dataStore().listDocs({ collection: 'schools' });
    return {
      schools: schools.map((school) => this._sanitizeSchool(school)),
    };
  }

  async v1_updateSchool({ __auth, __authorize, schoolId, name, address, description, status }) {
    const gate = await this._auth().ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const targetSchoolId = schoolId;
    const schoolIdErr = ensureString({ value: targetSchoolId, field: 'schoolId', min: 3, max: 64 });
    if (schoolIdErr) {
      return { errors: [schoolIdErr] };
    }

    const school = await this._dataStore().getDoc({ collection: 'schools', id: targetSchoolId });
    if (!school) {
      return { error: 'school not found' };
    }

    const errors = compactErrors([
      ensureString({ value: name, field: 'name', min: 2, max: 120, required: false }),
      ensureString({ value: address, field: 'address', min: 4, max: 255, required: false }),
      ensureString({ value: description, field: 'description', min: 4, max: 500, required: false }),
      ensureString({ value: status, field: 'status', min: 6, max: 12, required: false }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    if (status && !Object.values(STATUS).includes(status)) {
      return { errors: [`status must be one of: ${Object.values(STATUS).join(', ')}`] };
    }

    const updated = await this._dataStore().upsertDoc({
      collection: 'schools',
      id: targetSchoolId,
      doc: {
        ...(name !== undefined ? { name: normalizeString(name) } : {}),
        ...(address !== undefined ? { address: normalizeString(address) } : {}),
        ...(description !== undefined ? { description: normalizeString(description) } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });

    return {
      school: this._sanitizeSchool(updated),
    };
  }

  async v1_deleteSchool({ __auth, __authorize, schoolId }) {
    const gate = await this._auth().ensureSuperadmin({ __auth });
    if (gate.error) {
      return { error: gate.error };
    }

    const schoolIdErr = ensureString({ value: schoolId, field: 'schoolId', min: 3, max: 64 });
    if (schoolIdErr) {
      return { errors: [schoolIdErr] };
    }

    const school = await this._dataStore().getDoc({ collection: 'schools', id: schoolId });
    if (!school) {
      return { error: 'school not found' };
    }

    const indexedClassroomIds = await this._dataStore().listClassroomIdsBySchool({ schoolId });
    const indexedStudentIds = await this._dataStore().listStudentIdsBySchool({ schoolId });

    const [allClassrooms, allStudents, allUsers] = await Promise.all([
      this._dataStore().listDocs({ collection: 'classrooms' }),
      this._dataStore().listDocs({ collection: 'students' }),
      this._dataStore().listDocs({ collection: 'users' }),
    ]);

    const classroomIds = this._uniqueIds(
      indexedClassroomIds.concat(
        allClassrooms
          .filter((classroom) => classroom.schoolId === schoolId)
          .map((classroom) => classroom._id)
      )
    );

    const studentIds = this._uniqueIds(
      indexedStudentIds.concat(
        allStudents
          .filter((student) => student.schoolId === schoolId)
          .map((student) => student._id)
      )
    );

    const userIds = this._uniqueIds(
      allUsers
        .filter((user) => user.schoolId === schoolId)
        .map((user) => user._id)
    );

    await Promise.all(
      classroomIds.map(async (id) => {
        await this._dataStore().deleteDoc({ collection: 'classrooms', id });
        if (this._dataStore().removeClassroomFromSchool) {
          await this._dataStore().removeClassroomFromSchool({ schoolId, classroomId: id });
        }
      })
    );

    await Promise.all(
      studentIds.map(async (id) => {
        await this._dataStore().deleteDoc({ collection: 'students', id });
        if (this._dataStore().removeStudentFromSchool) {
          await this._dataStore().removeStudentFromSchool({ schoolId, studentId: id });
        }
      })
    );

    await Promise.all(
      userIds.map(async (id) => {
        const user = allUsers.find((item) => item._id === id);
        await this._dataStore().deleteDoc({ collection: 'users', id });
        if (user?.email && this._dataStore().clearUserEmailIndex) {
          await this._dataStore().clearUserEmailIndex({ email: user.email });
        }
      })
    );

    await this._dataStore().deleteDoc({ collection: 'schools', id: schoolId });

    return {
      deleted: {
        schoolId,
        classrooms: classroomIds.length,
        students: studentIds.length,
        users: userIds.length,
      },
    };
  }
};
