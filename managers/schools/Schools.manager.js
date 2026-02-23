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

    this.restExposed = [
      {
        method: 'post',
        path: '/api/v1/schools',
        fnName: 'v1_createSchool',
      },
      {
        method: 'get',
        path: '/api/v1/schools',
        fnName: 'v1_listSchools',
      },
      {
        method: 'get',
        path: '/api/v1/schools/:schoolId',
        fnName: 'v1_getSchool',
        queryFromParams: ['schoolId'],
      },
      {
        method: 'patch',
        path: '/api/v1/schools/:schoolId',
        fnName: 'v1_updateSchool',
        bodyFromParams: ['schoolId'],
      },
      {
        method: 'delete',
        path: '/api/v1/schools/:schoolId',
        fnName: 'v1_deleteSchool',
        bodyFromParams: ['schoolId'],
      },
    ];
  }

  _auth() {
    return this.managers.auth;
  }

  _dataStore() {
    return this.managers.dataStore;
  }

  async _recordAudit({ actorId = null, action, resourceId = null, status = 'success', metadata = {} }) {
    if (!this._dataStore()?.recordAuditEvent) {
      return null;
    }

    try {
      return await this._dataStore().recordAuditEvent({
        actorId,
        action,
        resourceType: 'school',
        resourceId,
        status,
        metadata,
      });
    } catch (err) {
      console.log('audit record failure', err?.message || err);
      return null;
    }
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

  _normalizedKey(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return normalizeString(value).toLowerCase();
  }

  async _findSchoolByField({ field, value, excludingId = null }) {
    const normalizedValue = this._normalizedKey(value);
    if (!normalizedValue) {
      return null;
    }

    const schools = await this._dataStore().listDocs({ collection: 'schools' });
    return (
      schools.find((school) => {
        if (!school) {
          return false;
        }
        if (excludingId && school._id === excludingId) {
          return false;
        }
        return this._normalizedKey(school[field]) === normalizedValue;
      }) || null
    );
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

    const normalizedName = normalizeString(name);
    const normalizedCode = normalizeString(code);

    const existingByCode = await this._findSchoolByField({
      field: 'code',
      value: normalizedCode,
    });
    if (existingByCode) {
      return { error: 'school code already exists' };
    }

    const existingByName = await this._findSchoolByField({
      field: 'name',
      value: normalizedName,
    });
    if (existingByName) {
      return { error: 'school name already exists' };
    }

    const school = await this._dataStore().upsertDoc({
      collection: 'schools',
      doc: {
        name: normalizedName,
        code: normalizedCode,
        address: normalizeString(address),
        description: description ? normalizeString(description) : '',
        status: STATUS.ACTIVE,
      },
    });

    await this._recordAudit({
      actorId: gate.actor._id,
      action: 'school.create',
      resourceId: school._id,
      status: 'success',
      metadata: { code: school.code },
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

    const normalizedName = name !== undefined ? normalizeString(name) : undefined;
    if (normalizedName !== undefined) {
      const existingByName = await this._findSchoolByField({
        field: 'name',
        value: normalizedName,
        excludingId: school._id,
      });
      if (existingByName) {
        return { error: 'school name already exists' };
      }
    }

    const updated = await this._dataStore().upsertDoc({
      collection: 'schools',
      id: targetSchoolId,
      doc: {
        ...(name !== undefined ? { name: normalizedName } : {}),
        ...(address !== undefined ? { address: normalizeString(address) } : {}),
        ...(description !== undefined ? { description: normalizeString(description) } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });

    await this._recordAudit({
      actorId: gate.actor._id,
      action: 'school.update',
      resourceId: updated._id,
      status: 'success',
      metadata: {
        fields: ['name', 'address', 'description', 'status'].filter((field) => {
          if (field === 'name') return name !== undefined;
          if (field === 'address') return address !== undefined;
          if (field === 'description') return description !== undefined;
          if (field === 'status') return status !== undefined;
          return false;
        }),
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

    const classroomById = new Map(allClassrooms.map((doc) => [doc._id, doc]));
    const studentById = new Map(allStudents.map((doc) => [doc._id, doc]));
    const userById = new Map(allUsers.map((doc) => [doc._id, doc]));

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

    const rollbackOps = [];
    const runStep = async ({ execute, rollback }) => {
      await execute();
      rollbackOps.push(rollback);
    };

    try {
      for (const id of classroomIds) {
        const classroomDoc = classroomById.get(id) || null;

        await runStep({
          execute: async () => {
            await this._dataStore().deleteDoc({ collection: 'classrooms', id });
            if (this._dataStore().removeClassroomFromSchool) {
              await this._dataStore().removeClassroomFromSchool({ schoolId, classroomId: id });
            }
          },
          rollback: async () => {
            if (classroomDoc) {
              await this._dataStore().upsertDoc({
                collection: 'classrooms',
                id,
                doc: classroomDoc,
              });
              if (this._dataStore().addClassroomToSchool) {
                await this._dataStore().addClassroomToSchool({ schoolId, classroomId: id });
              }
            }
          },
        });
      }

      for (const id of studentIds) {
        const studentDoc = studentById.get(id) || null;

        await runStep({
          execute: async () => {
            await this._dataStore().deleteDoc({ collection: 'students', id });
            if (this._dataStore().removeStudentFromSchool) {
              await this._dataStore().removeStudentFromSchool({ schoolId, studentId: id });
            }
          },
          rollback: async () => {
            if (studentDoc) {
              await this._dataStore().upsertDoc({
                collection: 'students',
                id,
                doc: studentDoc,
              });
              if (this._dataStore().addStudentToSchool) {
                await this._dataStore().addStudentToSchool({ schoolId, studentId: id });
              }
            }
          },
        });
      }

      for (const id of userIds) {
        const userDoc = userById.get(id) || null;

        await runStep({
          execute: async () => {
            await this._dataStore().deleteDoc({ collection: 'users', id });
            if (userDoc?.email && this._dataStore().clearUserEmailIndex) {
              await this._dataStore().clearUserEmailIndex({ email: userDoc.email });
            }
            if (userDoc?.email && this._dataStore().clearLoginFailures) {
              await this._dataStore().clearLoginFailures({ email: userDoc.email });
            }
            if (userDoc?.email && this._dataStore().clearLoginLock) {
              await this._dataStore().clearLoginLock({ email: userDoc.email });
            }
          },
          rollback: async () => {
            if (userDoc) {
              await this._dataStore().upsertDoc({
                collection: 'users',
                id,
                doc: userDoc,
              });
              if (userDoc.email && this._dataStore().setUserEmailIndex) {
                await this._dataStore().setUserEmailIndex({
                  email: userDoc.email,
                  userId: id,
                });
              }
            }
          },
        });
      }

      await runStep({
        execute: async () => {
          await this._dataStore().deleteDoc({ collection: 'schools', id: schoolId });
        },
        rollback: async () => {
          await this._dataStore().upsertDoc({
            collection: 'schools',
            id: schoolId,
            doc: school,
          });
        },
      });
    } catch (err) {
      for (let i = rollbackOps.length - 1; i >= 0; i -= 1) {
        try {
          await rollbackOps[i]();
        } catch (rollbackErr) {
          console.log('school delete rollback failure', rollbackErr?.message || rollbackErr);
        }
      }

      await this._recordAudit({
        actorId: gate.actor._id,
        action: 'school.delete',
        resourceId: schoolId,
        status: 'failure',
        metadata: {
          error: err?.message || String(err),
        },
      });

      return {
        error: 'failed to delete school atomically',
        code: 500,
      };
    }

    await this._recordAudit({
      actorId: gate.actor._id,
      action: 'school.delete',
      resourceId: schoolId,
      status: 'success',
      metadata: {
        classrooms: classroomIds.length,
        students: studentIds.length,
        users: userIds.length,
      },
    });

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
