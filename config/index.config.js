
require('dotenv').config()
const pjson                            = require('../package.json');
const utils                            = require('../libs/utils');
const SERVICE_NAME                     = (process.env.SERVICE_NAME)? utils.slugify(process.env.SERVICE_NAME):pjson.name;
const USER_PORT                        = process.env.PORT || process.env.USER_PORT || 5111;
const USER_HOST                        = process.env.USER_HOST || '0.0.0.0';
const ENV                              = process.env.ENV || "development";
const REDIS_URI                        = process.env.REDIS_URI || "redis://127.0.0.1:6379";

const CORTEX_REDIS                     = process.env.CORTEX_REDIS || REDIS_URI;
const CORTEX_PREFIX                    = process.env.CORTEX_PREFIX || 'none';
const CORTEX_TYPE                      = process.env.CORTEX_TYPE || SERVICE_NAME;

const CACHE_REDIS                      = process.env.CACHE_REDIS || REDIS_URI;
const CACHE_PREFIX                     = process.env.CACHE_PREFIX || `${SERVICE_NAME}:ch`;

const config                           = require(`./envs/${ENV}.js`);
const SHORT_TOKEN_SECRET               = process.env.SHORT_TOKEN_SECRET || null;
const ACCESS_TOKEN_EXPIRES_IN          = process.env.ACCESS_TOKEN_EXPIRES_IN || '12h';
const ACCESS_TOKEN_KEYS                = process.env.ACCESS_TOKEN_KEYS || '';
const ACCESS_TOKEN_ACTIVE_KID          = process.env.ACCESS_TOKEN_ACTIVE_KID || '';
const PASSWORD_SALT_ROUNDS             = process.env.PASSWORD_SALT_ROUNDS || '10';
const API_RATE_LIMIT_MAX               = process.env.API_RATE_LIMIT_MAX || '120';
const API_RATE_LIMIT_WINDOW_SEC        = process.env.API_RATE_LIMIT_WINDOW_SEC || '60';
const RATE_LIMIT_FAIL_OPEN             = process.env.RATE_LIMIT_FAIL_OPEN || 'false';
const AUTH_LOGIN_MAX_FAILURES          = process.env.AUTH_LOGIN_MAX_FAILURES || '5';
const AUTH_LOGIN_WINDOW_SEC            = process.env.AUTH_LOGIN_WINDOW_SEC || '900';
const AUTH_LOGIN_LOCK_SEC              = process.env.AUTH_LOGIN_LOCK_SEC || '900';
const TOKEN_REVOKE_TTL_SEC             = process.env.TOKEN_REVOKE_TTL_SEC || '604800';
const CORS_ORIGINS                     = process.env.CORS_ORIGINS || '';
const CORS_ALLOW_ALL                   = process.env.CORS_ALLOW_ALL || 'true';
const ENABLE_DYNAMIC_API               = process.env.ENABLE_DYNAMIC_API || 'false';
const REQUEST_MAX_DEPTH                = process.env.REQUEST_MAX_DEPTH || '8';
const REQUEST_MAX_KEYS                 = process.env.REQUEST_MAX_KEYS || '2000';

const dotEnv = {
    SERVICE_NAME,
    ENV,
    CORTEX_REDIS,
    CORTEX_PREFIX,
    CORTEX_TYPE,
    CACHE_REDIS,
    CACHE_PREFIX,
    USER_PORT,
    USER_HOST,
    SHORT_TOKEN_SECRET,
    ACCESS_TOKEN_EXPIRES_IN,
    ACCESS_TOKEN_KEYS,
    ACCESS_TOKEN_ACTIVE_KID,
    PASSWORD_SALT_ROUNDS,
    API_RATE_LIMIT_MAX,
    API_RATE_LIMIT_WINDOW_SEC,
    RATE_LIMIT_FAIL_OPEN,
    AUTH_LOGIN_MAX_FAILURES,
    AUTH_LOGIN_WINDOW_SEC,
    AUTH_LOGIN_LOCK_SEC,
    TOKEN_REVOKE_TTL_SEC,
    CORS_ORIGINS,
    CORS_ALLOW_ALL,
    ENABLE_DYNAMIC_API,
    REQUEST_MAX_DEPTH,
    REQUEST_MAX_KEYS,
};

const REQUIRED_ENV_KEYS = [
    'SHORT_TOKEN_SECRET',
];

const NUMERIC_ENV_RULES = [
    { key: 'USER_PORT', min: 1 },
    { key: 'PASSWORD_SALT_ROUNDS', min: 1 },
    { key: 'API_RATE_LIMIT_MAX', min: 1 },
    { key: 'API_RATE_LIMIT_WINDOW_SEC', min: 1 },
    { key: 'AUTH_LOGIN_MAX_FAILURES', min: 1 },
    { key: 'AUTH_LOGIN_WINDOW_SEC', min: 1 },
    { key: 'AUTH_LOGIN_LOCK_SEC', min: 1 },
    { key: 'TOKEN_REVOKE_TTL_SEC', min: 1 },
    { key: 'REQUEST_MAX_DEPTH', min: 1 },
    { key: 'REQUEST_MAX_KEYS', min: 1 },
];

const BOOLEAN_ENV_KEYS = [
    'RATE_LIMIT_FAIL_OPEN',
    'CORS_ALLOW_ALL',
    'ENABLE_DYNAMIC_API',
];

const ensureDotEnvReady = ({ dotEnv }) => {
    const missing = REQUIRED_ENV_KEYS.filter((key) => {
        const value = dotEnv[key];
        return value === undefined || value === null || String(value).trim() === '';
    });

    if (missing.length > 0) {
        throw Error(`missing required env variables: ${missing.join(', ')}`);
    }

    const invalidNumeric = NUMERIC_ENV_RULES.filter(({ key, min }) => {
        const value = Number(dotEnv[key]);
        return !Number.isFinite(value) || value < min;
    }).map(({ key }) => key);

    if (invalidNumeric.length > 0) {
        throw Error(`invalid numeric env variables: ${invalidNumeric.join(', ')}`);
    }

    const invalidBoolean = BOOLEAN_ENV_KEYS.filter((key) => {
        const value = String(dotEnv[key]).trim().toLowerCase();
        return value !== 'true' && value !== 'false';
    });

    if (invalidBoolean.length > 0) {
        throw Error(`invalid boolean env variables (use true|false): ${invalidBoolean.join(', ')}`);
    }

    const corsAllowAll = String(dotEnv.CORS_ALLOW_ALL).trim().toLowerCase() === 'true';
    const hasCorsOrigins = String(dotEnv.CORS_ORIGINS || '').trim().length > 0;
    if (String(dotEnv.ENV).toLowerCase() === 'production' && !corsAllowAll && !hasCorsOrigins) {
        throw Error('CORS_ORIGINS must be set in production when CORS_ALLOW_ALL=false');
    }
};

ensureDotEnvReady({ dotEnv });
config.dotEnv = dotEnv;


module.exports = config;
