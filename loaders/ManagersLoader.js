const MiddlewaresLoader = require('./MiddlewaresLoader');
const ApiHandler = require('../managers/api/Api.manager');
const UserServer = require('../managers/http/UserServer.manager');
const ResponseDispatcher = require('../managers/response_dispatcher/ResponseDispatcher.manager');
const VirtualStack = require('../managers/virtual_stack/VirtualStack.manager');

const TokenManager = require('../managers/token/Token.manager');
const DataStore = require('../managers/data_store/DataStore.manager');
const PasswordManager = require('../managers/password/Password.manager');
const AuthorizationManager = require('../managers/authorization/Authorization.manager');
const AuthManager = require('../managers/auth/Auth.manager');
const SchoolsManager = require('../managers/schools/Schools.manager');
const ClassroomsManager = require('../managers/classrooms/Classrooms.manager');
const StudentsManager = require('../managers/students/Students.manager');

/**
 * load sharable modules
 * @return modules tree with instance of each module
 */
module.exports = class ManagersLoader {
	constructor({ config, cortex, cache }) {
		this.managers = {};
		this.config = config;
		this.cache = cache;
		this.cortex = cortex;

		this.injectable = {
			cache,
			config,
			cortex,
			managers: this.managers,
		};
	}

	load() {
		this.managers.responseDispatcher = new ResponseDispatcher();
		const middlewaresLoader = new MiddlewaresLoader(this.injectable);
		const mwsRepo = middlewaresLoader.load();
		this.injectable.mwsRepo = mwsRepo;
		/*****************************************CUSTOM MANAGERS*****************************************/
		this.managers.token = new TokenManager(this.injectable);
		this.managers.dataStore = new DataStore(this.injectable);
		this.managers.password = new PasswordManager(this.injectable);
		this.managers.authorization = new AuthorizationManager(this.injectable);
		this.managers.auth = new AuthManager(this.injectable);
		this.managers.schools = new SchoolsManager(this.injectable);
		this.managers.classrooms = new ClassroomsManager(this.injectable);
		this.managers.students = new StudentsManager(this.injectable);
		/*************************************************************************************************/
		this.managers.mwsExec = new VirtualStack({
			...{ preStack: ['__device', '__rateLimit'] },
			...this.injectable,
		});
		this.managers.userApi = new ApiHandler({
			...this.injectable,
			...{ prop: 'httpExposed' },
		});
		this.managers.userServer = new UserServer({
			config: this.config,
			managers: this.managers,
		});

		return this.managers;
	}
};
