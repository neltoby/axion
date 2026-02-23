module.exports = () => {
    return ({ req, next }) => {
        next(req.query);
    };
};
