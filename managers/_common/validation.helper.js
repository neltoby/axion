const { ROLES } = require('./constants');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isObject = (value) => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const ensureString = ({ value, field, min = 1, max = 255, trim = true, required = true }) => {
  if (value === undefined || value === null) {
    if (required) {
      return `${field} is required`;
    }
    return null;
  }

  if (typeof value !== 'string') {
    return `${field} must be a string`;
  }

  const normalized = trim ? value.trim() : value;
  if (required && normalized.length < min) {
    return `${field} must be at least ${min} characters`;
  }

  if (normalized.length > max) {
    return `${field} must be at most ${max} characters`;
  }

  return null;
};

const ensureEmail = ({ value, field = 'email', required = true }) => {
  const err = ensureString({ value, field, min: 5, max: 255, required });
  if (err) {
    return err;
  }

  if (value === undefined || value === null) {
    return null;
  }

  if (!EMAIL_REGEX.test(value.trim().toLowerCase())) {
    return `${field} is invalid`;
  }

  return null;
};

const ensureRole = ({ value, required = true }) => {
  const err = ensureString({ value, field: 'role', min: 3, max: 50, required });
  if (err) {
    return err;
  }

  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!Object.values(ROLES).includes(normalized)) {
    return `role must be one of: ${Object.values(ROLES).join(', ')}`;
  }

  return null;
};

const ensurePositiveInteger = ({ value, field, required = true, min = 1, max = Number.MAX_SAFE_INTEGER }) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      return `${field} is required`;
    }
    return null;
  }

  const casted = Number(value);
  if (!Number.isInteger(casted)) {
    return `${field} must be an integer`;
  }

  if (casted < min || casted > max) {
    return `${field} must be between ${min} and ${max}`;
  }

  return null;
};

const ensureBoolean = ({ value, field, required = true }) => {
  if (value === undefined || value === null) {
    if (required) {
      return `${field} is required`;
    }
    return null;
  }

  if (typeof value !== 'boolean') {
    return `${field} must be a boolean`;
  }

  return null;
};

const ensureArrayOfStrings = ({ value, field, required = true, maxItems = 200, maxItemLength = 100 }) => {
  if (value === undefined || value === null) {
    if (required) {
      return `${field} is required`;
    }
    return null;
  }

  if (!Array.isArray(value)) {
    return `${field} must be an array`;
  }

  if (value.length > maxItems) {
    return `${field} must have at most ${maxItems} items`;
  }

  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') {
      return `${field}[${i}] must be a string`;
    }
    if (value[i].trim().length > maxItemLength) {
      return `${field}[${i}] must be at most ${maxItemLength} characters`;
    }
  }

  return null;
};

const ensurePassword = ({ value, field = 'password', required = true }) => {
  const err = ensureString({ value, field, min: 8, max: 128, required, trim: false });
  if (err) {
    return err;
  }

  if (value === undefined || value === null) {
    return null;
  }

  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return `${field} must include uppercase, lowercase, and number`;
  }

  return null;
};

const lower = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim().toLowerCase();
};

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
};

const compactErrors = (errors) => {
  return errors.filter(Boolean);
};

module.exports = {
  isObject,
  ensureString,
  ensureEmail,
  ensureRole,
  ensurePositiveInteger,
  ensureBoolean,
  ensureArrayOfStrings,
  ensurePassword,
  lower,
  normalizeString,
  compactErrors,
};
