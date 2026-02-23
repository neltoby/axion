
const Bolt = require('./Bolt.manager');

module.exports = class VirtualStack {

    /**
     * 
     * @param {object} mwsRepo key=middlewar key value=functon
     * @param {array of strings} prestack array of default 
     * middlewares that will be executed before any stack
     */
    constructor({mwsRepo, preStack}){
        this.mwsRepo = mwsRepo; 
        this.preStack = preStack || []
    }

    createBolt(args){
        /** inject the prestack at the start */
        const merged = this.preStack.concat(args.stack || []);
        args.stack = merged.filter((mw, index) => merged.indexOf(mw) === index);
        return new Bolt({...{mwsRepo: this.mwsRepo}, ...args});
    }

}
