const {
  ensureString,
  ensureEmail,
  ensurePositiveInteger,
  compactErrors,
  lower,
  normalizeString,
} = require('../_common/validation.helper');
const { STATUS } = require('../_common/constants');

const ACL_ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  CONFIG: 'config',
};

module.exports = class StudentsManager {
  constructor({ managers }) {
    this.managers = managers;

    this.httpExposed = [
      'post=v1_enrollStudent',
      'get=v1_getStudent',
      'get=v1_listStudents',
      'patch=v1_updateStudent',
      'post=v1_transferStudent',
      'delete=v1_deleteStudent',
    ];

    this.restExposed = [
      {
        method: 'post',
        path: '/api/v1/students',
        fnName: 'v1_enrollStudent',
      },
      {
        method: 'get',
        path: '/api/v1/students',
        fnName: 'v1_listStudents',
      },
      {
        method: 'get',
        path: '/api/v1/students/:studentId',
        fnName: 'v1_getStudent',
        queryFromParams: ['studentId'],
      },
      {
        method: 'patch',
        path: '/api/v1/students/:studentId',
        fnName: 'v1_updateStudent',
        bodyFromParams: ['studentId'],
      },
      {
        method: 'delete',
        path: '/api/v1/students/:studentId',
        fnName: 'v1_deleteStudent',
        bodyFromParams: ['studentId'],
      },
      {
        method: 'post',
        path: '/api/v1/students/:studentId/transfer',
        fnName: 'v1_transferStudent',
        bodyFromParams: ['studentId'],
      },
    ];
  }

  _auth() {
    return this.managers.auth;
  }

  _dataStore() {
    return this.managers.dataStore;
  }

  _sanitizeStudent(student) {
    if (!student) {
      return null;
    }

    return {
      _id: student._id,
      schoolId: student.schoolId,
      classroomId: student.classroomId,
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email,
      age: Number(student.age),
      status: student.status,
      enrollmentDate: student.enrollmentDate,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }

  async _ensureSchoolExists(schoolId) {
    return this._dataStore().getDoc({ collection: 'schools', id: schoolId });
  }

  async _ensureClassroom({ classroomId, schoolId }) {
    if (!classroomId) {
      return null;
    }

    const classroom = await this._dataStore().getDoc({ collection: 'classrooms', id: classroomId });
    if (!classroom) {
      return { error: 'classroom not found' };
    }

    if (classroom.schoolId !== schoolId) {
      return { error: 'classroom does not belong to school' };
    }

    return { classroom };
  }

  async _ensureClassroomCapacity({ classroomId, schoolId, excludingStudentId = null }) {
    if (!classroomId) {
      return { ok: true };
    }

    const classroom = await this._dataStore().getDoc({ collection: 'classrooms', id: classroomId });
    if (!classroom) {
      return { ok: false, error: 'classroom not found' };
    }

    if (classroom.schoolId !== schoolId) {
      return { ok: false, error: 'classroom does not belong to school' };
    }

    const studentIds = await this._dataStore().listStudentIdsBySchool({ schoolId });
    const students = await this._dataStore().listDocs({ collection: 'students', ids: studentIds });

    const enrolled = students.filter(
      (student) =>
        student.classroomId === classroomId &&
        student.status === STATUS.ACTIVE &&
        student._id !== excludingStudentId
    );

    if (enrolled.length >= Number(classroom.capacity)) {
      return {
        ok: false,
        error: 'classroom capacity reached',
      };
    }

    return { ok: true };
  }

  async _findStudentByEmailInSchool({ schoolId, email, excludingStudentId = null }) {
    const normalizedEmail = lower(email);
    const ids = await this._dataStore().listStudentIdsBySchool({ schoolId });
    const students = await this._dataStore().listDocs({ collection: 'students', ids });

    return (
      students.find(
        (student) => student.email === normalizedEmail && student._id !== excludingStudentId
      ) || null
    );
  }

  async v1_enrollStudent({ __auth, __authorize, schoolId, classroomId, firstName, lastName, email, age }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const targetSchoolId = schoolId || actor.schoolId;

    const errors = compactErrors([
      ensureString({ value: targetSchoolId, field: 'schoolId', min: 3, max: 64 }),
      ensureString({ value: firstName, field: 'firstName', min: 2, max: 80 }),
      ensureString({ value: lastName, field: 'lastName', min: 2, max: 80 }),
      ensureEmail({ value: email }),
      ensurePositiveInteger({ value: age, field: 'age', min: 3, max: 120 }),
      ensureString({ value: classroomId, field: 'classroomId', min: 3, max: 64, required: false }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const canEnrollInSchool = await this._auth().canAccessStudent({
      actor,
      schoolId: targetSchoolId,
      studentId: null,
      action: ACL_ACTIONS.CREATE,
    });
    if (!canEnrollInSchool) {
      return { error: 'forbidden' };
    }

    const school = await this._ensureSchoolExists(targetSchoolId);
    if (!school) {
      return { error: 'school not found' };
    }

    const emailInUse = await this._findStudentByEmailInSchool({
      schoolId: targetSchoolId,
      email,
    });

    if (emailInUse) {
      return { error: 'student email already exists in school' };
    }

    if (classroomId) {
      const classroomCheck = await this._ensureClassroom({ classroomId, schoolId: targetSchoolId });
      if (classroomCheck?.error) {
        return { error: classroomCheck.error };
      }

      const capacityCheck = await this._ensureClassroomCapacity({
        classroomId,
        schoolId: targetSchoolId,
      });

      if (!capacityCheck.ok) {
        return { error: capacityCheck.error };
      }
    }

    const student = await this._dataStore().upsertDoc({
      collection: 'students',
      doc: {
        schoolId: targetSchoolId,
        classroomId: classroomId || null,
        firstName: normalizeString(firstName),
        lastName: normalizeString(lastName),
        email: lower(email),
        age: Number(age),
        enrollmentDate: new Date().toISOString(),
        status: STATUS.ACTIVE,
      },
    });

    await this._dataStore().addStudentToSchool({
      schoolId: targetSchoolId,
      studentId: student._id,
    });

    return {
      student: this._sanitizeStudent(student),
    };
  }

  async v1_getStudent({ __auth, __authorize, __query }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const studentId = __query?.studentId || __query?.id;
    const studentIdErr = ensureString({ value: studentId, field: 'studentId', min: 3, max: 64 });
    if (studentIdErr) {
      return { errors: [studentIdErr] };
    }

    const student = await this._dataStore().getDoc({ collection: 'students', id: studentId });
    if (!student) {
      return { error: 'student not found' };
    }

    const canReadStudent = await this._auth().canAccessStudent({
      actor,
      schoolId: student.schoolId,
      studentId: student._id,
      action: ACL_ACTIONS.READ,
    });
    if (!canReadStudent) {
      return { error: 'forbidden' };
    }

    return {
      student: this._sanitizeStudent(student),
    };
  }

  async v1_listStudents({ __auth, __authorize, __query }) {
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
      const students = await this._dataStore().listDocs({ collection: 'students' });
      return {
        students: students.map((student) => this._sanitizeStudent(student)),
      };
    }

    if (!schoolId) {
      return { error: 'schoolId is required' };
    }

    const schoolIdErr = ensureString({ value: schoolId, field: 'schoolId', min: 3, max: 64 });
    if (schoolIdErr) {
      return { errors: [schoolIdErr] };
    }

    const canReadSchool = await this._auth().canAccessStudent({
      actor,
      schoolId,
      studentId: null,
      action: ACL_ACTIONS.READ,
    });
    if (!canReadSchool) {
      return { error: 'forbidden' };
    }

    const ids = await this._dataStore().listStudentIdsBySchool({ schoolId });
    const students = await this._dataStore().listDocs({ collection: 'students', ids });
    return {
      students: students.map((student) => this._sanitizeStudent(student)),
    };
  }

  async v1_updateStudent({ __auth, __authorize, studentId, firstName, lastName, age, classroomId, status }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const studentIdErr = ensureString({ value: studentId, field: 'studentId', min: 3, max: 64 });
    if (studentIdErr) {
      return { errors: [studentIdErr] };
    }

    const student = await this._dataStore().getDoc({ collection: 'students', id: studentId });
    if (!student) {
      return { error: 'student not found' };
    }

    const canUpdateStudent = await this._auth().canAccessStudent({
      actor,
      schoolId: student.schoolId,
      studentId: student._id,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!canUpdateStudent) {
      return { error: 'forbidden' };
    }

    const errors = compactErrors([
      ensureString({ value: firstName, field: 'firstName', min: 2, max: 80, required: false }),
      ensureString({ value: lastName, field: 'lastName', min: 2, max: 80, required: false }),
      ensurePositiveInteger({ value: age, field: 'age', required: false, min: 3, max: 120 }),
      ensureString({ value: classroomId, field: 'classroomId', min: 3, max: 64, required: false }),
      ensureString({ value: status, field: 'status', min: 6, max: 12, required: false }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    if (status && !Object.values(STATUS).includes(status)) {
      return { errors: [`status must be one of: ${Object.values(STATUS).join(', ')}`] };
    }

    if (classroomId !== undefined) {
      if (classroomId) {
        const classroomCheck = await this._ensureClassroom({
          classroomId,
          schoolId: student.schoolId,
        });

        if (classroomCheck?.error) {
          return { error: classroomCheck.error };
        }

        const canAssignToClassroom = await this._auth().canAccessClassroom({
          actor,
          schoolId: student.schoolId,
          classroomId,
          action: ACL_ACTIONS.CONFIG,
        });
        if (!canAssignToClassroom) {
          return { error: 'forbidden for target classroom' };
        }

        const capacityCheck = await this._ensureClassroomCapacity({
          classroomId,
          schoolId: student.schoolId,
          excludingStudentId: student._id,
        });

        if (!capacityCheck.ok) {
          return { error: capacityCheck.error };
        }
      }
    }

    const updated = await this._dataStore().upsertDoc({
      collection: 'students',
      id: student._id,
      doc: {
        ...(firstName !== undefined ? { firstName: normalizeString(firstName) } : {}),
        ...(lastName !== undefined ? { lastName: normalizeString(lastName) } : {}),
        ...(age !== undefined ? { age: Number(age) } : {}),
        ...(classroomId !== undefined ? { classroomId: classroomId || null } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });

    return {
      student: this._sanitizeStudent(updated),
    };
  }

  async v1_transferStudent({ __auth, __authorize, studentId, targetSchoolId, targetClassroomId }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const errors = compactErrors([
      ensureString({ value: studentId, field: 'studentId', min: 3, max: 64 }),
      ensureString({ value: targetSchoolId, field: 'targetSchoolId', min: 3, max: 64, required: false }),
      ensureString({ value: targetClassroomId, field: 'targetClassroomId', min: 3, max: 64, required: false }),
    ]);

    if (errors.length > 0) {
      return { errors };
    }

    const student = await this._dataStore().getDoc({ collection: 'students', id: studentId });
    if (!student) {
      return { error: 'student not found' };
    }

    const destinationSchoolId = targetSchoolId || student.schoolId;

    const canTransferFromSource = await this._auth().canAccessStudent({
      actor,
      schoolId: student.schoolId,
      studentId: student._id,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!canTransferFromSource) {
      return { error: 'forbidden' };
    }

    const canTransferToDestination = await this._auth().canAccessStudent({
      actor,
      schoolId: destinationSchoolId,
      studentId: null,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!canTransferToDestination) {
      return { error: 'forbidden for target school' };
    }

    const destinationSchool = await this._ensureSchoolExists(destinationSchoolId);
    if (!destinationSchool) {
      return { error: 'target school not found' };
    }

    const duplicateEmail = await this._findStudentByEmailInSchool({
      schoolId: destinationSchoolId,
      email: student.email,
      excludingStudentId: student._id,
    });
    if (duplicateEmail) {
      return { error: 'student email already exists in school' };
    }

    if (targetClassroomId) {
      const classroomCheck = await this._ensureClassroom({
        classroomId: targetClassroomId,
        schoolId: destinationSchoolId,
      });

      if (classroomCheck?.error) {
        return { error: classroomCheck.error };
      }

      const canAssignToClassroom = await this._auth().canAccessClassroom({
        actor,
        schoolId: destinationSchoolId,
        classroomId: targetClassroomId,
        action: ACL_ACTIONS.CONFIG,
      });
      if (!canAssignToClassroom) {
        return { error: 'forbidden for target classroom' };
      }

      const capacityCheck = await this._ensureClassroomCapacity({
        classroomId: targetClassroomId,
        schoolId: destinationSchoolId,
        excludingStudentId: student._id,
      });

      if (!capacityCheck.ok) {
        return { error: capacityCheck.error };
      }
    }

    if (student.schoolId !== destinationSchoolId) {
      await this._dataStore().removeStudentFromSchool({
        schoolId: student.schoolId,
        studentId: student._id,
      });

      await this._dataStore().addStudentToSchool({
        schoolId: destinationSchoolId,
        studentId: student._id,
      });
    }

    const updated = await this._dataStore().upsertDoc({
      collection: 'students',
      id: student._id,
      doc: {
        schoolId: destinationSchoolId,
        classroomId: targetClassroomId || null,
      },
    });

    return {
      student: this._sanitizeStudent(updated),
    };
  }

  async v1_deleteStudent({ __auth, __authorize, studentId }) {
    const actor = await this._auth().ensureAuthenticatedActor({ __auth });
    if (!actor) {
      return { error: 'unauthorized' };
    }

    const studentIdErr = ensureString({ value: studentId, field: 'studentId', min: 3, max: 64 });
    if (studentIdErr) {
      return { errors: [studentIdErr] };
    }

    const student = await this._dataStore().getDoc({ collection: 'students', id: studentId });
    if (!student) {
      return { error: 'student not found' };
    }

    const canDeleteStudent = await this._auth().canAccessStudent({
      actor,
      schoolId: student.schoolId,
      studentId: student._id,
      action: ACL_ACTIONS.CONFIG,
    });
    if (!canDeleteStudent) {
      return { error: 'forbidden' };
    }

    await this._dataStore().deleteDoc({ collection: 'students', id: studentId });
    await this._dataStore().removeStudentFromSchool({
      schoolId: student.schoolId,
      studentId,
    });

    return {
      deleted: {
        studentId,
      },
    };
  }
};
