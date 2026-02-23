const useragent = require('useragent');
const requestIp = require('request-ip');

module.exports = () => {
    return ({ req, next }) => {
        let ip = 'N/A';
        let agent = 'N/A';
        ip = requestIp.getClientIp(req) || ip;
        agent = useragent.lookup(req.headers['user-agent']) || agent;

        next({ ip, agent });
    };
};
