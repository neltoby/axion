
require('dotenv').config()
const pjson                            = require('../package.json');
const utils                            = require('../libs/utils');
const SERVICE_NAME                     = (process.env.SERVICE_NAME)? utils.slugify(process.env.SERVICE_NAME):pjson.name;
const USER_PORT                        = process.env.USER_PORT || 5111;
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
const PASSWORD_SALT_ROUNDS             = process.env.PASSWORD_SALT_ROUNDS || '10';
const API_RATE_LIMIT_MAX               = process.env.API_RATE_LIMIT_MAX || '120';
const API_RATE_LIMIT_WINDOW_SEC        = process.env.API_RATE_LIMIT_WINDOW_SEC || '60';

const dotEnv = {
    SERVICE_NAME,
    ENV,
    CORTEX_REDIS,
    CORTEX_PREFIX,
    CORTEX_TYPE,
    CACHE_REDIS,
    CACHE_PREFIX,
    USER_PORT,
    SHORT_TOKEN_SECRET,
    ACCESS_TOKEN_EXPIRES_IN,
    PASSWORD_SALT_ROUNDS,
    API_RATE_LIMIT_MAX,
    API_RATE_LIMIT_WINDOW_SEC,
};

const REQUIRED_ENV_KEYS = [
    'SHORT_TOKEN_SECRET',
];

const NUMERIC_ENV_RULES = [
    { key: 'USER_PORT', min: 1 },
    { key: 'PASSWORD_SALT_ROUNDS', min: 1 },
    { key: 'API_RATE_LIMIT_MAX', min: 1 },
    { key: 'API_RATE_LIMIT_WINDOW_SEC', min: 1 },
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
};

ensureDotEnvReady({ dotEnv });
config.dotEnv = dotEnv;


module.exports = config;
