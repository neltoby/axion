const { ROLES } = require('./constants');

const isSuperadmin = (actor) => {
  return Boolean(actor && actor.role === ROLES.SUPERADMIN);
};

const isSchoolAdmin = (actor) => {
  return Boolean(actor && actor.role === ROLES.SCHOOL_ADMIN);
};

const canAccessSchool = ({ actor, schoolId }) => {
  if (!actor || !schoolId) {
    return false;
  }

  if (isSuperadmin(actor)) {
    return true;
  }

  if (isSchoolAdmin(actor) && actor.schoolId === schoolId) {
    return true;
  }

  return false;
};

module.exports = {
  isSuperadmin,
  isSchoolAdmin,
  canAccessSchool,
};
