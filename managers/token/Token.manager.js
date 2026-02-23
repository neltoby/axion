const jwt = require('jsonwebtoken');

module.exports = class TokenManager {
    constructor({ config } = {}){
        this.config = config;
        this.accessTokenExpiresIn = this.config?.dotEnv?.ACCESS_TOKEN_EXPIRES_IN || '12h';
        this.httpExposed = [];
    }

    createAccessToken({ userId, role, schoolId = null, email }){
        return jwt.sign(
            {
                userId,
                role,
                schoolId,
                email,
                tokenType: 'access',
            },
            this.config.dotEnv.SHORT_TOKEN_SECRET,
            {
                expiresIn: this.accessTokenExpiresIn,
            }
        );
    }

    _verifyToken({ token, secret }){
        let decoded = null;
        try {
            decoded = jwt.verify(token, secret);
        } catch (err) {
            decoded = null;
        }
        return decoded;
    }

    verifyShortToken({ token }){
        return this._verifyToken({
            token,
            secret: this.config.dotEnv.SHORT_TOKEN_SECRET,
        });
    }

    verifyAccessToken({ token }){
        return this.verifyShortToken({ token });
    }
}
