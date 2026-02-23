const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

module.exports = class TokenManager {
    constructor({ config } = {}){
        this.config = config;
        this.accessTokenExpiresIn = this.config?.dotEnv?.ACCESS_TOKEN_EXPIRES_IN || '12h';
        this.refreshTokenExpiresIn = this.config?.dotEnv?.REFRESH_TOKEN_EXPIRES_IN || '30d';
        this.defaultRevokeTtlSec = Number(this.config?.dotEnv?.TOKEN_REVOKE_TTL_SEC || 604800);
        this.shortSecret = this.config?.dotEnv?.SHORT_TOKEN_SECRET;
        this.refreshTokenSecret = this.config?.dotEnv?.REFRESH_TOKEN_SECRET || this.shortSecret;
        this.accessKeyRing = this._buildAccessKeyRing({
            raw: this.config?.dotEnv?.ACCESS_TOKEN_KEYS,
            fallbackSecret: this.shortSecret,
        });
        this.activeAccessKid = this._resolveActiveAccessKid(this.config?.dotEnv?.ACCESS_TOKEN_ACTIVE_KID);
        this.httpExposed = [];
    }

    _buildAccessKeyRing({ raw, fallbackSecret }){
        const keys = [];
        const frags = String(raw || '')
            .split(',')
            .map((frag) => frag.trim())
            .filter(Boolean);

        frags.forEach((frag, index) => {
            if (frag.includes(':')) {
                const sepIndex = frag.indexOf(':');
                const kid = frag.slice(0, sepIndex).trim();
                const secret = frag.slice(sepIndex + 1).trim();
                if (kid && secret) {
                    keys.push({ kid, secret });
                }
                return;
            }

            keys.push({
                kid: `legacy-${index + 1}`,
                secret: frag,
            });
        });

        if (keys.length === 0 && fallbackSecret) {
            keys.push({
                kid: 'legacy-short',
                secret: fallbackSecret,
            });
        }

        return keys;
    }

    _resolveActiveAccessKid(preferredKid){
        if (preferredKid && this.accessKeyRing.find((item) => item.kid === preferredKid)) {
            return preferredKid;
        }

        return this.accessKeyRing?.[0]?.kid || 'legacy-short';
    }

    _getAccessSigningKey(){
        const selected = this.accessKeyRing.find((item) => item.kid === this.activeAccessKid);
        return selected || this.accessKeyRing[0] || null;
    }

    _decodeToken({ token }){
        try {
            return jwt.decode(token, { complete: true }) || null;
        } catch (_) {
            return null;
        }
    }

    _verifyWithSecret({ token, secret, complete = false }){
        let decoded = null;
        try {
            decoded = jwt.verify(token, secret, { complete });
        } catch (err) {
            decoded = null;
        }
        return decoded;
    }

    _candidateAccessKeys(token){
        const decoded = this._decodeToken({ token });
        const tokenKid = decoded?.header?.kid || null;

        if (!tokenKid) {
            return this.accessKeyRing;
        }

        const first = this.accessKeyRing.find((item) => item.kid === tokenKid);
        const rest = this.accessKeyRing.filter((item) => item.kid !== tokenKid);
        return first ? [first, ...rest] : this.accessKeyRing;
    }

    createAccessToken({ userId, role, schoolId = null, email, tokenVersion = 1, jti }){
        const signingKey = this._getAccessSigningKey();
        if (!signingKey || !signingKey.secret) {
            throw new Error('access token signing key not configured');
        }

        const tokenId = jti || randomUUID();
        return jwt.sign(
            {
                userId,
                role,
                schoolId,
                email,
                tokenType: 'access',
                tokenVersion,
                jti: tokenId,
            },
            signingKey.secret,
            {
                expiresIn: this.accessTokenExpiresIn,
                header: {
                    kid: signingKey.kid,
                },
            }
        );
    }

    createRefreshToken({ userId, role, schoolId = null, email, tokenVersion = 1, tokenId }){
        const refreshId = tokenId || randomUUID();
        return jwt.sign(
            {
                userId,
                role,
                schoolId,
                email,
                tokenType: 'refresh',
                tokenVersion,
                jti: refreshId,
            },
            this.refreshTokenSecret,
            {
                expiresIn: this.refreshTokenExpiresIn,
            }
        );
    }

    getTokenMeta({ token }){
        const decoded = this._decodeToken({ token });
        if (!decoded || !decoded.payload) {
            return null;
        }

        return {
            kid: decoded?.header?.kid || null,
            alg: decoded?.header?.alg || null,
            exp: decoded?.payload?.exp || null,
            iat: decoded?.payload?.iat || null,
            jti: decoded?.payload?.jti || null,
            tokenType: decoded?.payload?.tokenType || null,
        };
    }

    computeRevocationTtlSec({ exp }){
        const nowSec = Math.floor(Date.now() / 1000);
        if (!exp || !Number.isFinite(Number(exp))) {
            return this.defaultRevokeTtlSec;
        }

        return Math.max(60, Number(exp) - nowSec + 60);
    }

    verifyShortToken({ token }){
        if (!token || !this.shortSecret) {
            return null;
        }

        return this._verifyWithSecret({
            token,
            secret: this.shortSecret,
        });
    }

    verifyRefreshToken({ token }){
        if (!token || !this.refreshTokenSecret) {
            return null;
        }

        return this._verifyWithSecret({
            token,
            secret: this.refreshTokenSecret,
        });
    }

    verifyAccessToken({ token }){
        if (!token) {
            return null;
        }

        const candidates = this._candidateAccessKeys(token);
        for (const candidate of candidates) {
            const decoded = this._verifyWithSecret({
                token,
                secret: candidate.secret,
            });
            if (decoded) {
                return decoded;
            }
        }

        return this.verifyShortToken({ token });
    }
}
