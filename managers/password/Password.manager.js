const bcrypt = require('bcrypt');

module.exports = class PasswordManager {
  constructor({ config } = {}) {
    this.config = config || {};
    this.saltRounds = Number(this.config?.dotEnv?.PASSWORD_SALT_ROUNDS || 10);
  }

  async hash({ plain }) {
    if (typeof plain !== 'string' || plain.length === 0) {
      throw new Error('invalid password input');
    }

    return bcrypt.hash(plain, this.saltRounds);
  }

  async compare({ plain, hash }) {
    if (typeof plain !== 'string' || typeof hash !== 'string') {
      return false;
    }

    return bcrypt.compare(plain, hash);
  }
};
