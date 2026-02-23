const test = require('node:test');
const assert = require('node:assert/strict');
const SchoolsManager = require('../managers/schools/Schools.manager');

const createSchoolsManager = ({
  ensureSuperadminResult,
  school,
  indexedClassroomIds = [],
  indexedStudentIds = [],
  classrooms = [],
  students = [],
  users = [],
  failDeleteOn = null,
}) => {
  const deletedDocs = [];
  const upsertedDocs = [];
  const removedClassroomRefs = [];
  const addedClassroomRefs = [];
  const removedStudentRefs = [];
  const addedStudentRefs = [];
  const clearedUserEmails = [];

  const dataStore = {
    getDoc: async ({ collection, id }) => {
      if (collection === 'schools' && school && school._id === id) {
        return school;
      }
      return null;
    },
    listClassroomIdsBySchool: async () => indexedClassroomIds,
    listStudentIdsBySchool: async () => indexedStudentIds,
    listDocs: async ({ collection }) => {
      if (collection === 'classrooms') return classrooms;
      if (collection === 'students') return students;
      if (collection === 'users') return users;
      return [];
    },
    deleteDoc: async ({ collection, id }) => {
      if (failDeleteOn && failDeleteOn.collection === collection && failDeleteOn.id === id) {
        throw new Error(`simulated delete failure: ${collection}.${id}`);
      }
      deletedDocs.push({ collection, id });
      return true;
    },
    upsertDoc: async ({ collection, id, doc }) => {
      upsertedDocs.push({ collection, id, doc });
      return { _id: id || doc?._id, ...doc };
    },
    removeClassroomFromSchool: async ({ schoolId, classroomId }) => {
      removedClassroomRefs.push({ schoolId, classroomId });
      return true;
    },
    addClassroomToSchool: async ({ schoolId, classroomId }) => {
      addedClassroomRefs.push({ schoolId, classroomId });
      return true;
    },
    removeStudentFromSchool: async ({ schoolId, studentId }) => {
      removedStudentRefs.push({ schoolId, studentId });
      return true;
    },
    addStudentToSchool: async ({ schoolId, studentId }) => {
      addedStudentRefs.push({ schoolId, studentId });
      return true;
    },
    clearUserEmailIndex: async ({ email }) => {
      clearedUserEmails.push(email);
      return true;
    },
  };

  const auth = {
    ensureSuperadmin: async () => ensureSuperadminResult,
  };

  return {
    schools: new SchoolsManager({
      managers: {
        auth,
        dataStore,
      },
    }),
    deletedDocs,
    upsertedDocs,
    removedClassroomRefs,
    addedClassroomRefs,
    removedStudentRefs,
    addedStudentRefs,
    clearedUserEmails,
  };
};

test('delete school cascades to school users, classrooms, and students', async () => {
  const schoolId = 'school-1';
  const { schools, deletedDocs, removedClassroomRefs, removedStudentRefs, clearedUserEmails } =
    createSchoolsManager({
      ensureSuperadminResult: { actor: { _id: 'super-1' } },
      school: { _id: schoolId, name: 'School One' },
      indexedClassroomIds: ['c-1'],
      indexedStudentIds: ['s-1'],
      classrooms: [
        { _id: 'c-1', schoolId },
        { _id: 'c-2', schoolId },
        { _id: 'c-3', schoolId: 'school-2' },
      ],
      students: [
        { _id: 's-1', schoolId },
        { _id: 's-2', schoolId },
        { _id: 's-3', schoolId: 'school-2' },
      ],
      users: [
        { _id: 'u-1', schoolId, email: 'admin1@axion.test' },
        { _id: 'u-2', schoolId, email: 'admin2@axion.test' },
        { _id: 'u-3', schoolId: 'school-2', email: 'other@axion.test' },
      ],
    });

  const result = await schools.v1_deleteSchool({
    __auth: { userId: 'super-1' },
    __authorize: { authorized: true },
    schoolId,
  });

  const deletedClassrooms = deletedDocs
    .filter((entry) => entry.collection === 'classrooms')
    .map((entry) => entry.id)
    .sort();
  const deletedStudents = deletedDocs
    .filter((entry) => entry.collection === 'students')
    .map((entry) => entry.id)
    .sort();
  const deletedUsers = deletedDocs
    .filter((entry) => entry.collection === 'users')
    .map((entry) => entry.id)
    .sort();
  const deletedSchools = deletedDocs
    .filter((entry) => entry.collection === 'schools')
    .map((entry) => entry.id);

  assert.deepEqual(deletedClassrooms, ['c-1', 'c-2']);
  assert.deepEqual(deletedStudents, ['s-1', 's-2']);
  assert.deepEqual(deletedUsers, ['u-1', 'u-2']);
  assert.deepEqual(deletedSchools, [schoolId]);

  assert.deepEqual(
    removedClassroomRefs.sort((a, b) => a.classroomId.localeCompare(b.classroomId)),
    [
      { schoolId, classroomId: 'c-1' },
      { schoolId, classroomId: 'c-2' },
    ]
  );

  assert.deepEqual(
    removedStudentRefs.sort((a, b) => a.studentId.localeCompare(b.studentId)),
    [
      { schoolId, studentId: 's-1' },
      { schoolId, studentId: 's-2' },
    ]
  );

  assert.deepEqual(clearedUserEmails.sort(), ['admin1@axion.test', 'admin2@axion.test']);

  assert.deepEqual(result, {
    deleted: {
      schoolId,
      classrooms: 2,
      students: 2,
      users: 2,
    },
  });
});

test('delete school returns forbidden when caller is not superadmin', async () => {
  const { schools, deletedDocs } = createSchoolsManager({
    ensureSuperadminResult: { error: 'forbidden' },
    school: { _id: 'school-1' },
  });

  const result = await schools.v1_deleteSchool({
    __auth: { userId: 'not-super' },
    __authorize: { authorized: true },
    schoolId: 'school-1',
  });

  assert.equal(result.error, 'forbidden');
  assert.deepEqual(deletedDocs, []);
});

test('delete school returns not found when school does not exist', async () => {
  const { schools, deletedDocs } = createSchoolsManager({
    ensureSuperadminResult: { actor: { _id: 'super-1' } },
    school: null,
  });

  const result = await schools.v1_deleteSchool({
    __auth: { userId: 'super-1' },
    __authorize: { authorized: true },
    schoolId: 'school-1',
  });

  assert.equal(result.error, 'school not found');
  assert.deepEqual(deletedDocs, []);
});

test('delete school rolls back earlier operations when cascade fails mid-flight', async () => {
  const schoolId = 'school-1';
  const {
    schools,
    deletedDocs,
    upsertedDocs,
    addedClassroomRefs,
  } = createSchoolsManager({
    ensureSuperadminResult: { actor: { _id: 'super-1' } },
    school: { _id: schoolId, name: 'School One' },
    indexedClassroomIds: ['c-1'],
    indexedStudentIds: ['s-1'],
    classrooms: [{ _id: 'c-1', schoolId }],
    students: [{ _id: 's-1', schoolId }],
    users: [{ _id: 'u-1', schoolId, email: 'admin1@axion.test' }],
    failDeleteOn: { collection: 'students', id: 's-1' },
  });

  const result = await schools.v1_deleteSchool({
    __auth: { userId: 'super-1' },
    __authorize: { authorized: true },
    schoolId,
  });

  assert.equal(result.error, 'failed to delete school atomically');
  assert.equal(result.code, 500);

  const deletedSchool = deletedDocs.find((entry) => entry.collection === 'schools');
  assert.equal(deletedSchool, undefined);

  const classroomRollback = upsertedDocs.find(
    (entry) => entry.collection === 'classrooms' && entry.id === 'c-1'
  );
  assert.ok(classroomRollback);
  assert.deepEqual(addedClassroomRefs, [{ schoolId, classroomId: 'c-1' }]);
});
