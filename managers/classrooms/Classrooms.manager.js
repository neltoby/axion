const {
  ensureString,
  ensurePositiveInteger,
  ensureArrayOfStrings,
  compactErrors,
  normalizeString,
} = require('../_common/validation.helper');
const { STATUS } = require('../_common/constants');

const ACL_ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  CONFIG: 'config',
};

module.exports = class ClassroomsManager {
  constructor({ managers }) {
    this.managers = managers;

    this.httpExposed = [
      'post=v1_createClassroom',
      'get=v1_getClassroom',
      'get=v1_listClassrooms',
      'patch=v1_updateClassroom',
      'delete=v1_deleteClassroom',
    ];

    this.restExposed = [
      {
        method: 'post',
        path: '/api/v1/classrooms',
        fnName: 'v1_createClassroom',
      },
      {
        method: 'get',
        path: '/api/v1/classrooms',
        fnName: 'v1_listClassrooms',
      },
      {
        method: 'get',
        path: '/api/v1/classrooms/:classroomId',
        fnName: 'v1_getClassroom',
        queryFromParams: ['classroomId'],
      },
      {
        method: 'patch',
        path: '/api/v1/classrooms/:classroomId',
        fnName: 'v1_updateClassroom',
        bodyFromParams: ['classroomId'],
      },
      {
        method: 'delete',
        path: '/api/v1/classrooms/:classroomId',
        fnName: 'v1_deleteClassroom',
        bodyFromParams: ['classroomId'],
      },
    ];
  }

  _auth() {
    return this.managers.auth;
  }

  _dataStore() {
    return this.managers.dataStore;
  }

  _sanitizeClassroom(classroom) {
    if (!classroom) {
      return null;
    }

    return {
      _id: classroom._id,
      schoolId: classroom.schoolId,
      name: classroom.name,
      capacity: Number(classroom.capacity),
      resources: classroom.resources || [],
      status: classroom.status,
      createdAt: classroom.createdAt,
      updatedAt: classroom.updatedAt,
    };
  }

  async _ensureSchoolExists(schoolId) {
    return this._dataStore().getDoc({ collection: 'schools', id: schoolId });
  }

  _normalizedKey(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return normalizeString(value).toLowerCase();
  }

  async _findClassroomByNameInSchool({ schoolId, name, excludingId = null }) {
    const normalizedName = this._normalizedKey(name);
    if (!normalizedName || !schoolId) {
      return null;
    }

    const classrooms = await this._dataStore().listDocs({ collection: 'classrooms' });
    return (
      classrooms.find((classroom) => {
        if (!classroom || classroom.schoolId !== schoolId) {
          return false;
        }
        if (excludingId && classroom._id === excludingId) {
          return false;
        }
        return this._normalizedKey(classroom.name) === normalizedName;
      }) || null
    );
  }

  async v1_createClassroom({ __auth, __authorize, schoolId, name, capacity, resources }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const targetSchoolId = schoolId || actor.schoolId;
    const errors = compactErrors([
      ensureString({ value: targetSchoolId, field: 'schoolId', min: 3, max: 64 }),
      ensureString({ value: name, field: 'name', min: 2, max: 120 }),
      ensurePositiveInteger({ value: capacity, field: 'capacity', min: 1, max: 500 }),
      ensureArrayOfStrings({
        value: resources === undefined ? [] : resources,
        field: 'resources',
        required: false,
        maxItems: 100,
        maxItemLength: 100,
      }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const canCreateClassroom = await this._auth().canAccessClassroom({
      actor,
      schoolId: targetSchoolId,
      classroomId: null,
      action: ACL_ACTIONS.CREATE,
    });
    if (!canCreateClassroom) {
      return { error: 'forbidden' };
    }

    const school = await this._ensureSchoolExists(targetSchoolId);
    if (!school) {
      return { error: 'school not found' };
    }

    const normalizedName = normalizeString(name);
    const existingClassroom = await this._findClassroomByNameInSchool({
      schoolId: targetSchoolId,
      name: normalizedName,
    });
    if (existingClassroom) {
      return { error: 'classroom name already exists in school' };
    }

    const classroom = await this._dataStore().upsertDoc({
      collection: 'classrooms',
      doc: {
        schoolId: targetSchoolId,
        name: normalizedName,
        capacity: Number(capacity),
        resources: Array.isArray(resources) ? resources.map((item) => normalizeString(item)) : [],
        status: STATUS.ACTIVE,
      },
    });

    await this._dataStore().addClassroomToSchool({
      schoolId: targetSchoolId,
      classroomId: classroom._id,
    });

    return {
      classroom: this._sanitizeClassroom(classroom),
    };
  }

  async v1_getClassroom({ __auth, __authorize, __query }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const classroomId = __query?.classroomId || __query?.id;
    const classroomIdErr = ensureString({ value: classroomId, field: 'classroomId', min: 3, max: 64 });
    if (classroomIdErr) {
      return { errors: [classroomIdErr] };
    }

    const classroom = await this._dataStore().getDoc({ collection: 'classrooms', id: classroomId });
    if (!classroom) {
      return { error: 'classroom not found' };
    }

    const canReadClassroom = await this._auth().canAccessClassroom({
      actor,
      schoolId: classroom.schoolId,
      classroomId: classroom._id,
      action: ACL_ACTIONS.READ,
    });
    if (!canReadClassroom) {
      return { error: 'forbidden' };
    }

    return {
      classroom: this._sanitizeClassroom(classroom),
    };
  }

  async v1_listClassrooms({ __auth, __authorize, __query }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    let schoolId = __query?.schoolId;
    let canReadAllSchools = false;

    if (!schoolId) {
      canReadAllSchools = await this._auth().hasGlobalSchoolPermission({
        actor,
        action: ACL_ACTIONS.READ,
      });

      if (!canReadAllSchools) {
        schoolId = actor.schoolId;
      }
    }

    if (!schoolId && canReadAllSchools) {
      const classrooms = await this._dataStore().listDocs({ collection: 'classrooms' });
      return {
        classrooms: classrooms.map((classroom) => this._sanitizeClassroom(classroom)),
      };
    }

    if (!schoolId) {
      return { error: 'schoolId is required' };
    }

    const schoolIdErr = ensureString({ value: schoolId, field: 'schoolId', min: 3, max: 64 });
    if (schoolIdErr) {
      return { errors: [schoolIdErr] };
    }

    const canReadSchool = await this._auth().canAccessClassroom({
      actor,
      schoolId,
      classroomId: null,
      action: ACL_ACTIONS.READ,
    });
    if (!canReadSchool) {
      return { error: 'forbidden' };
    }

    const ids = await this._dataStore().listClassroomIdsBySchool({ schoolId });
    const classrooms = await this._dataStore().listDocs({ collection: 'classrooms', ids });
    return {
      classrooms: classrooms.map((classroom) => this._sanitizeClassroom(classroom)),
    };
  }

  async v1_updateClassroom({ __auth, __authorize, classroomId, name, capacity, resources, status }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const classroomIdErr = ensureString({ value: classroomId, field: 'classroomId', min: 3, max: 64 });
    if (classroomIdErr) {
      return { errors: [classroomIdErr] };
    }

    const classroom = await this._dataStore().getDoc({ collection: 'classrooms', id: classroomId });
    if (!classroom) {
      return { error: 'classroom not found' };
    }

    const canUpdateClassroom = await this._auth().canAccessClassroom({
      actor,
      schoolId: classroom.schoolId,
      classroomId: classroom._id,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!canUpdateClassroom) {
      return { error: 'forbidden' };
    }

    const errors = compactErrors([
      ensureString({ value: name, field: 'name', min: 2, max: 120, required: false }),
      ensurePositiveInteger({ value: capacity, field: 'capacity', required: false, min: 1, max: 500 }),
      ensureArrayOfStrings({
        value: resources,
        field: 'resources',
        required: false,
        maxItems: 100,
        maxItemLength: 100,
      }),
      ensureString({ value: status, field: 'status', min: 6, max: 12, required: false }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    if (status && !Object.values(STATUS).includes(status)) {
      return { errors: [`status must be one of: ${Object.values(STATUS).join(', ')}`] };
    }

    const normalizedName = name !== undefined ? normalizeString(name) : undefined;
    if (normalizedName !== undefined) {
      const existingClassroom = await this._findClassroomByNameInSchool({
        schoolId: classroom.schoolId,
        name: normalizedName,
        excludingId: classroom._id,
      });
      if (existingClassroom) {
        return { error: 'classroom name already exists in school' };
      }
    }

    const updated = await this._dataStore().upsertDoc({
      collection: 'classrooms',
      id: classroom._id,
      doc: {
        ...(name !== undefined ? { name: normalizedName } : {}),
        ...(capacity !== undefined ? { capacity: Number(capacity) } : {}),
        ...(resources !== undefined
          ? { resources: resources.map((item) => normalizeString(item)) }
          : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });

    return {
      classroom: this._sanitizeClassroom(updated),
    };
  }

  async v1_deleteClassroom({ __auth, __authorize, classroomId }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const classroomIdErr = ensureString({ value: classroomId, field: 'classroomId', min: 3, max: 64 });
    if (classroomIdErr) {
      return { errors: [classroomIdErr] };
    }

    const classroom = await this._dataStore().getDoc({ collection: 'classrooms', id: classroomId });
    if (!classroom) {
      return { error: 'classroom not found' };
    }

    const canDeleteClassroom = await this._auth().canAccessClassroom({
      actor,
      schoolId: classroom.schoolId,
      classroomId: classroom._id,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!canDeleteClassroom) {
      return { error: 'forbidden' };
    }

    const studentIds = await this._dataStore().listStudentIdsBySchool({ schoolId: classroom.schoolId });
    const students = await this._dataStore().listDocs({ collection: 'students', ids: studentIds });
    const linked = students.filter((student) => student.classroomId === classroom._id);

    await Promise.all(
      linked.map((student) =>
        this._dataStore().upsertDoc({
          collection: 'students',
          id: student._id,
          doc: { classroomId: null },
        })
      )
    );

    await this._dataStore().deleteDoc({ collection: 'classrooms', id: classroom._id });
    await this._dataStore().removeClassroomFromSchool({
      schoolId: classroom.schoolId,
      classroomId: classroom._id,
    });

    return {
      deleted: {
        classroomId: classroom._id,
        unassignedStudents: linked.length,
      },
    };
  }
};
