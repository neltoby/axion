module.exports = ({ managers }) => {
  const ACTIONS_BY_HANDLER = {
    schools: {
      v1_createSchool: { resource: 'school', action: 'config', global: true },
      v1_getSchool: { resource: 'school', action: 'read', global: true },
      v1_listSchools: { resource: 'school', action: 'read', global: true },
      v1_updateSchool: { resource: 'school', action: 'config', global: true },
      v1_deleteSchool: { resource: 'school', action: 'config', global: true },
    },
    classrooms: {
      v1_createClassroom: { resource: 'classroom', action: 'create' },
      v1_getClassroom: { resource: 'classroom', action: 'read' },
      v1_listClassrooms: { resource: 'classroom', action: 'read' },
      v1_updateClassroom: { resource: 'classroom', action: 'config' },
      v1_deleteClassroom: { resource: 'classroom', action: 'config' },
    },
    students: {
      v1_enrollStudent: { resource: 'student', action: 'create' },
      v1_getStudent: { resource: 'student', action: 'read' },
      v1_listStudents: { resource: 'student', action: 'read' },
      v1_updateStudent: { resource: 'student', action: 'config' },
      v1_transferStudent: { resource: 'student', action: 'config' },
      v1_deleteStudent: { resource: 'student', action: 'config' },
    },
    auth: {
      v1_createSchoolAdmin: { resource: 'user', action: 'create', global: true },
      v1_listUsers: { resource: 'user', action: 'read' },
      v1_updateUser: { resource: 'user', action: 'config', global: true },
      v1_deleteUser: { resource: 'user', action: 'config', global: true },
      v1_me: { skip: true },
    },
  };

  return async ({ req, res, results, next }) => {
    const moduleName = req.params.moduleName;
    const fnName = req.params.fnName;
    const rule = ACTIONS_BY_HANDLER?.[moduleName]?.[fnName];

    if (!rule || rule.skip) {
      return next({ authorized: true, skipped: true });
    }

    const authPayload = results?.__auth;
    if (!authPayload || !authPayload.userId) {
      return managers.responseDispatcher.dispatch(res, {
        ok: false,
        code: 401,
        errors: ['unauthorized'],
      });
    }

    const actor = await managers.auth.ensureAuthenticatedActor({ __auth: authPayload });
    if (!actor) {
      return managers.responseDispatcher.dispatch(res, {
        ok: false,
        code: 401,
        errors: ['unauthorized'],
      });
    }

    const authorization = managers.authorization;
    if (!authorization) {
      return managers.responseDispatcher.dispatch(res, {
        ok: false,
        code: 500,
        errors: ['authorization manager unavailable'],
      });
    }

    let authorized = false;
    if (rule.global) {
      authorized = await authorization.hasGlobalPermission({
        actor,
        resource: rule.resource,
        action: rule.action,
      });
    } else {
      authorized = await authorization.hasPermission({
        actor,
        resource: rule.resource,
        action: rule.action,
      });
    }

    if (!authorized) {
      return managers.responseDispatcher.dispatch(res, {
        ok: false,
        code: 403,
        errors: ['forbidden'],
      });
    }

    return next({
      authorized: true,
      actor: {
        _id: actor._id,
        role: actor.role,
        schoolId: actor.schoolId || null,
      },
    });
  };
};
