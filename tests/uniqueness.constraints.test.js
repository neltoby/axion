const test = require('node:test');
const assert = require('node:assert/strict');
const SchoolsManager = require('../managers/schools/Schools.manager');
const ClassroomsManager = require('../managers/classrooms/Classrooms.manager');
const StudentsManager = require('../managers/students/Students.manager');

const createSchoolsManager = ({ schools }) => {
  const schoolStore = new Map(schools.map((school) => [school._id, { ...school }]));
  let seq = 0;

  const dataStore = {
    listDocs: async ({ collection }) => {
      if (collection === 'schools') {
        return Array.from(schoolStore.values());
      }
      return [];
    },
    getDoc: async ({ collection, id }) => {
      if (collection === 'schools') {
        return schoolStore.get(id) || null;
      }
      return null;
    },
    upsertDoc: async ({ collection, id, doc }) => {
      if (collection !== 'schools') {
        return null;
      }

      const safeId = id || `school-${++seq}`;
      const prev = schoolStore.get(safeId) || {};
      const next = { ...prev, ...doc, _id: safeId };
      schoolStore.set(safeId, next);
      return next;
    },
  };

  const auth = {
    ensureSuperadmin: async () => ({ actor: { _id: 'super-1' } }),
  };

  return {
    schools: new SchoolsManager({
      managers: {
        auth,
        dataStore,
      },
    }),
    schoolStore,
  };
};

const createClassroomsManager = ({ schools, classrooms }) => {
  const schoolStore = new Map(schools.map((school) => [school._id, { ...school }]));
  const classroomStore = new Map(classrooms.map((classroom) => [classroom._id, { ...classroom }]));
  let seq = 0;

  const dataStore = {
    getDoc: async ({ collection, id }) => {
      if (collection === 'schools') {
        return schoolStore.get(id) || null;
      }
      if (collection === 'classrooms') {
        return classroomStore.get(id) || null;
      }
      return null;
    },
    listDocs: async ({ collection }) => {
      if (collection === 'classrooms') {
        return Array.from(classroomStore.values());
      }
      return [];
    },
    upsertDoc: async ({ collection, id, doc }) => {
      if (collection !== 'classrooms') {
        return null;
      }

      const safeId = id || `class-${++seq}`;
      const prev = classroomStore.get(safeId) || {};
      const next = { ...prev, ...doc, _id: safeId };
      classroomStore.set(safeId, next);
      return next;
    },
    addClassroomToSchool: async () => true,
    listStudentIdsBySchool: async () => [],
    removeClassroomFromSchool: async () => true,
  };

  const auth = {
    ensureAuthenticatedActor: async () => ({ _id: 'admin-1', schoolId: 'school-1', role: 'school_admin' }),
    canAccessClassroom: async () => true,
    hasGlobalSchoolPermission: async () => false,
  };

  return {
    classrooms: new ClassroomsManager({
      managers: {
        auth,
        dataStore,
      },
    }),
    classroomStore,
  };
};

const createStudentsManager = ({ schools, students }) => {
  const schoolStore = new Map(schools.map((school) => [school._id, { ...school }]));
  const studentStore = new Map(students.map((student) => [student._id, { ...student }]));
  const transferOps = [];

  const dataStore = {
    getDoc: async ({ collection, id }) => {
      if (collection === 'schools') {
        return schoolStore.get(id) || null;
      }
      if (collection === 'students') {
        return studentStore.get(id) || null;
      }
      return null;
    },
    listStudentIdsBySchool: async ({ schoolId }) => {
      return Array.from(studentStore.values())
        .filter((student) => student.schoolId === schoolId)
        .map((student) => student._id);
    },
    listDocs: async ({ collection, ids }) => {
      if (collection !== 'students') {
        return [];
      }
      if (!Array.isArray(ids)) {
        return Array.from(studentStore.values());
      }
      return ids
        .map((id) => studentStore.get(id))
        .filter(Boolean);
    },
    removeStudentFromSchool: async ({ schoolId, studentId }) => {
      transferOps.push({ type: 'remove', schoolId, studentId });
      return true;
    },
    addStudentToSchool: async ({ schoolId, studentId }) => {
      transferOps.push({ type: 'add', schoolId, studentId });
      return true;
    },
    upsertDoc: async ({ collection, id, doc }) => {
      if (collection !== 'students') {
        return null;
      }

      const prev = studentStore.get(id) || {};
      const next = { ...prev, ...doc, _id: id };
      studentStore.set(id, next);
      transferOps.push({ type: 'upsert', id });
      return next;
    },
  };

  const auth = {
    ensureAuthenticatedActor: async () => ({ _id: 'admin-1', schoolId: 'school-1', role: 'school_admin' }),
    canAccessStudent: async () => true,
    canAccessClassroom: async () => true,
    hasGlobalSchoolPermission: async () => false,
  };

  return {
    students: new StudentsManager({
      managers: {
        auth,
        dataStore,
      },
    }),
    transferOps,
  };
};

test('create school rejects duplicate school name (case-insensitive)', async () => {
  const { schools } = createSchoolsManager({
    schools: [
      {
        _id: 'school-1',
        name: 'Springfield High',
        code: 'SPH',
      },
    ],
  });

  const result = await schools.v1_createSchool({
    __auth: { userId: 'super-1' },
    __authorize: { authorized: true },
    name: '  springfield high  ',
    code: 'SPH-2',
    address: '12 Main Road',
    description: 'Secondary campus',
  });

  assert.equal(result.error, 'school name already exists');
});

test('update school rejects duplicate school name (case-insensitive)', async () => {
  const { schools } = createSchoolsManager({
    schools: [
      {
        _id: 'school-1',
        name: 'Springfield High',
        code: 'SPH',
        address: '12 Main Road',
      },
      {
        _id: 'school-2',
        name: 'Riverdale Academy',
        code: 'RDA',
        address: '44 River Street',
      },
    ],
  });

  const result = await schools.v1_updateSchool({
    __auth: { userId: 'super-1' },
    __authorize: { authorized: true },
    schoolId: 'school-1',
    name: '  RIVERDALE academy ',
  });

  assert.equal(result.error, 'school name already exists');
});

test('create classroom rejects duplicate name inside the same school', async () => {
  const { classrooms } = createClassroomsManager({
    schools: [{ _id: 'school-1' }],
    classrooms: [
      {
        _id: 'class-1',
        schoolId: 'school-1',
        name: 'JSS 1',
        capacity: 20,
      },
    ],
  });

  const result = await classrooms.v1_createClassroom({
    __auth: { userId: 'admin-1' },
    __authorize: { authorized: true },
    schoolId: 'school-1',
    name: '  jSs 1 ',
    capacity: 25,
    resources: [],
  });

  assert.equal(result.error, 'classroom name already exists in school');
});

test('create classroom allows same class name in a different school', async () => {
  const { classrooms } = createClassroomsManager({
    schools: [{ _id: 'school-1' }, { _id: 'school-2' }],
    classrooms: [
      {
        _id: 'class-1',
        schoolId: 'school-2',
        name: 'JSS 1',
        capacity: 20,
      },
    ],
  });

  const result = await classrooms.v1_createClassroom({
    __auth: { userId: 'admin-1' },
    __authorize: { authorized: true },
    schoolId: 'school-1',
    name: 'JSS 1',
    capacity: 25,
    resources: [],
  });

  assert.ok(result.classroom);
  assert.equal(result.classroom.schoolId, 'school-1');
  assert.equal(result.classroom.name, 'JSS 1');
});

test('update classroom rejects duplicate name inside the same school', async () => {
  const { classrooms } = createClassroomsManager({
    schools: [{ _id: 'school-1' }],
    classrooms: [
      {
        _id: 'class-1',
        schoolId: 'school-1',
        name: 'JSS 1',
        capacity: 20,
      },
      {
        _id: 'class-2',
        schoolId: 'school-1',
        name: 'JSS 2',
        capacity: 20,
      },
    ],
  });

  const result = await classrooms.v1_updateClassroom({
    __auth: { userId: 'admin-1' },
    __authorize: { authorized: true },
    classroomId: 'class-1',
    name: '  jss 2 ',
  });

  assert.equal(result.error, 'classroom name already exists in school');
});

test('transfer student rejects destination school when email already exists there', async () => {
  const { students, transferOps } = createStudentsManager({
    schools: [{ _id: 'school-1' }, { _id: 'school-2' }],
    students: [
      {
        _id: 'student-1',
        schoolId: 'school-1',
        classroomId: null,
        email: 'student@axion.test',
      },
      {
        _id: 'student-2',
        schoolId: 'school-2',
        classroomId: null,
        email: 'student@axion.test',
      },
    ],
  });

  const result = await students.v1_transferStudent({
    __auth: { userId: 'admin-1' },
    __authorize: { authorized: true },
    studentId: 'student-1',
    targetSchoolId: 'school-2',
  });

  assert.equal(result.error, 'student email already exists in school');
  assert.deepEqual(transferOps, []);
});
