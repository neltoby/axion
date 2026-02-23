const http              = require('http');
const express           = require('express');
const cors              = require('cors');
const app               = express();

module.exports = class UserServer {
    constructor({config, managers}){
        this.config        = config;
        this.userApi       = managers.userApi;
    }

    _aliasToApi({ moduleName, fnName, req, payload = {} }){
        req.params = req.params || {};
        req.params.moduleName = moduleName;
        req.params.fnName = fnName;

        req.body = req.body || {};
        req.query = req.query || {};

        if (payload.query){
            req.query = {
                ...req.query,
                ...payload.query,
            };
        }

        if (payload.body){
            req.body = {
                ...req.body,
                ...payload.body,
            };
        }
    }

    _bindRestRoutes(){
        const call = ({ moduleName, fnName, payloadFactory }) => {
            return (req, res, next) => {
                const payload = payloadFactory ? payloadFactory(req) : {};
                this._aliasToApi({ moduleName, fnName, req, payload });
                return this.userApi.mw(req, res, next);
            };
        };

        /** auth */
        app.post('/api/v1/auth/bootstrap-superadmin', call({
            moduleName: 'auth',
            fnName: 'v1_bootstrapSuperadmin',
        }));
        app.post('/api/v1/auth/login', call({
            moduleName: 'auth',
            fnName: 'v1_login',
        }));
        app.get('/api/v1/auth/me', call({
            moduleName: 'auth',
            fnName: 'v1_me',
        }));
        app.get('/api/v1/users', call({
            moduleName: 'auth',
            fnName: 'v1_listUsers',
        }));
        app.patch('/api/v1/users/:userId', call({
            moduleName: 'auth',
            fnName: 'v1_updateUser',
            payloadFactory: (req) => ({
                body: { userId: req.params.userId },
            }),
        }));
        app.delete('/api/v1/users/:userId', call({
            moduleName: 'auth',
            fnName: 'v1_deleteUser',
            payloadFactory: (req) => ({
                body: { userId: req.params.userId },
            }),
        }));
        app.post('/api/v1/schools/:schoolId/admins', call({
            moduleName: 'auth',
            fnName: 'v1_createSchoolAdmin',
            payloadFactory: (req) => ({
                body: { schoolId: req.params.schoolId },
            }),
        }));

        /** schools */
        app.post('/api/v1/schools', call({
            moduleName: 'schools',
            fnName: 'v1_createSchool',
        }));
        app.get('/api/v1/schools', call({
            moduleName: 'schools',
            fnName: 'v1_listSchools',
        }));
        app.get('/api/v1/schools/:schoolId', call({
            moduleName: 'schools',
            fnName: 'v1_getSchool',
            payloadFactory: (req) => ({
                query: { schoolId: req.params.schoolId },
            }),
        }));
        app.patch('/api/v1/schools/:schoolId', call({
            moduleName: 'schools',
            fnName: 'v1_updateSchool',
            payloadFactory: (req) => ({
                body: { schoolId: req.params.schoolId },
            }),
        }));
        app.delete('/api/v1/schools/:schoolId', call({
            moduleName: 'schools',
            fnName: 'v1_deleteSchool',
            payloadFactory: (req) => ({
                body: { schoolId: req.params.schoolId },
            }),
        }));

        /** classrooms */
        app.post('/api/v1/classrooms', call({
            moduleName: 'classrooms',
            fnName: 'v1_createClassroom',
        }));
        app.get('/api/v1/classrooms', call({
            moduleName: 'classrooms',
            fnName: 'v1_listClassrooms',
        }));
        app.get('/api/v1/classrooms/:classroomId', call({
            moduleName: 'classrooms',
            fnName: 'v1_getClassroom',
            payloadFactory: (req) => ({
                query: { classroomId: req.params.classroomId },
            }),
        }));
        app.patch('/api/v1/classrooms/:classroomId', call({
            moduleName: 'classrooms',
            fnName: 'v1_updateClassroom',
            payloadFactory: (req) => ({
                body: { classroomId: req.params.classroomId },
            }),
        }));
        app.delete('/api/v1/classrooms/:classroomId', call({
            moduleName: 'classrooms',
            fnName: 'v1_deleteClassroom',
            payloadFactory: (req) => ({
                body: { classroomId: req.params.classroomId },
            }),
        }));

        /** students */
        app.post('/api/v1/students', call({
            moduleName: 'students',
            fnName: 'v1_enrollStudent',
        }));
        app.get('/api/v1/students', call({
            moduleName: 'students',
            fnName: 'v1_listStudents',
        }));
        app.get('/api/v1/students/:studentId', call({
            moduleName: 'students',
            fnName: 'v1_getStudent',
            payloadFactory: (req) => ({
                query: { studentId: req.params.studentId },
            }),
        }));
        app.patch('/api/v1/students/:studentId', call({
            moduleName: 'students',
            fnName: 'v1_updateStudent',
            payloadFactory: (req) => ({
                body: { studentId: req.params.studentId },
            }),
        }));
        app.delete('/api/v1/students/:studentId', call({
            moduleName: 'students',
            fnName: 'v1_deleteStudent',
            payloadFactory: (req) => ({
                body: { studentId: req.params.studentId },
            }),
        }));
        app.post('/api/v1/students/:studentId/transfer', call({
            moduleName: 'students',
            fnName: 'v1_transferStudent',
            payloadFactory: (req) => ({
                body: { studentId: req.params.studentId },
            }),
        }));
    }
    
    /** for injecting middlewares */
    use(args){
        app.use(args);
    }

    /** server configs */
    run(){
        app.disable('x-powered-by');
        app.use(cors({origin: '*'}));
        app.use(express.json({ limit: '1mb' }));
        app.use(express.urlencoded({ extended: true, limit: '1mb' }));
        app.use('/static', express.static('public'));

        /** an error handler */
        app.use((err, req, res, next) => {
            console.error(err.stack)
            res.status(500).send('Something broke!')
        });
        
        /** REST-style aliases that map to the template dynamic handler */
        this._bindRestRoutes();

        /** template dynamic middleware to handle all modules/functions */
        app.all('/api/:moduleName/:fnName', this.userApi.mw);

        let server = http.createServer(app);
        server.listen(this.config.dotEnv.USER_PORT, () => {
            console.log(`${(this.config.dotEnv.SERVICE_NAME).toUpperCase()} is running on port: ${this.config.dotEnv.USER_PORT}`);
        });
    }
}
