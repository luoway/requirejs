import {isBrowser, isWebWorker, regExp} from "./constants";
import {each, eachProp, getOwn, hasProp, isArray, isFunction, makeError, scripts} from "./utils";

export default function newContext(contextName, globalDefQueue, req) {
    const config = {
        waitSeconds: 7,
        baseUrl: './',
        paths: {},
        bundles: {},
        pkgs: {},
        shim: {},
        config: {}
    }
    const registry = {}
    const enabledRegistry = {}
    const defined = {}
    const defQueue = []

    const undefEvents = {}
    const urlFetched = {}
    const bundlesMap = {}

    let requireCounter = 1
    let unnormalizedCounter = 1

    function normalize(name, baseName, applyMap) {
        let baseParts = baseName && baseName.split('/')
        let map = config.map
        let starMap = map && map['*']

        let lastIndex

        if(name){
            name = name.split('/')
            lastIndex = name.length - 1

            //兼容node ID：由于node允许索引有无.js后缀的文件，所以去掉后缀
            if(config.nodeIdCompat && regExp.jsSuffix.test(name[lastIndex])){
                name[lastIndex] = name[lastIndex].replace(regExp.jsSuffix, '')
            }

            if (name[0].charAt(0) === '.' && baseParts) {

                let normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                name = normalizedBaseParts.concat(name);
            }

            trimDots(name)
            name = name.join('/')
        }

        if(applyMap && map && (baseParts || starMap)){
            let nameParts = name.split('/')
            let foundStarMap, startI

            const found = ()=>{
                //查找匹配config最长的baseName片段
                for(let i=nameParts.length; i>0; i--){
                    let nameSegment = nameParts.slice(0,i).join('/')

                    if(baseParts){
                        for(let j = baseParts.length; j>0; j--){
                            let mapValue = getOwn(map, baseParts.slice(0, j).join('/'))
                            if(mapValue){
                                mapValue = getOwn(mapValue, nameSegment)
                                if(mapValue){
                                    return {
                                        map: mapValue,
                                        i
                                    }
                                }
                            }
                        }
                    }

                    if(!foundStarMap && starMap && getOwn(starMap, nameSegment)){
                        foundStarMap = getOwn(starMap, nameSegment)
                        startI = i
                    }
                }
            }

            let {map: foundMap, i: foundI} = found()

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        const pkgMain = getOwn(config.pkgs, name)
        return pkgMain ? pkgMain : name
    }

    function hasPathFallback(id) {
        const pathConfig = getOwn(config.paths, id);
        if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
            //当第一项失败了，推出它，重试
            pathConfig.shift();
            context.require.undef(id);

            //Custom require that does not do map translation, since
            //ID is "absolute", already mapped/resolved.
            context.makeRequire(null, {
                skipMap: true
            })([id]);

            return true;
        }
    }

    function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
        let prefix = null
        let parentName = parentModuleMap ? parentModuleMap.name : null
        let isDefine = true
        let normalizedName = ''
        let pluginModule, url
        const originalName = name

        if(!name){
            isDefine = false
            name = `_@r${requireCounter++}`
        }

        [prefix, name] = splitPrefix(name)

        if(prefix){
            prefix = normalize(prefix, parentName, applyMap)
            pluginModule = getOwn(defined, prefix)
        }

        if(name){
            if(prefix){
                if(isNormalized){
                    normalizedName = name
                }
                else if (pluginModule && pluginModule.normalize){
                    normalizedName = pluginModule.normalize(name, name => normalize(name, parentName, applyMap))
                }else{
                    normalizedName = name.indexOf('!') ? name : normalize(name, parentName, applyMap)
                }
            }else{
                normalizedName = normalize(name, parentName, applyMap)
                [prefix, normalizedName] = splitPrefix(normalizedName)
                isNormalized = true

                url = context.nameToUrl(normalizedName)
            }
        }

        let suffix = prefix && !pluginModule && !isNormalized ? `_unnormalized${unnormalizedCounter++}` : ''

        return {
            prefix,
            name: normalizedName,
            originalName,
            unnormalized: !!suffix,
            url,
            isDefine,
            id: `${prefix ? prefix + '!' : ''}${normalizedName}${suffix}`
        }

    }

    function getModule(depMap) {
        let id = depMap.id
        let mod = getOwn(registry, id)

        if(!mod){
            mod = registry[id] = new context.Module(depMap)
        }

        return mod
    }

    function on(depMap, name, fn) {
        const id = depMap.id
        let mod = getOwn(registry, id);

        if (hasProp(defined, id) && (!mod || mod.defineEmitComplete)) {
            if (name === 'defined') {
                fn(defined[id]);
            }
        } else {
            mod = getModule(depMap);
            if (mod.error && name === 'error') {
                fn(mod.error);
            } else {
                mod.on(name, fn);
            }
        }
    }

    function onError(err, errback) {
        const ids = err.requireModules
        let notified = false;

        if (errback) {
            errback(err);
            return
        }

        each(ids, function (id) {
            const mod = getOwn(registry, id);
            if (mod) {
                //Set error on module, so it skips timeout checks.
                mod.error = err;
                if (mod.events.error) {
                    notified = true;
                    mod.emit('error', err);
                }
            }
        });

        if (!notified) {
            req.onError(err);
        }
    }

    function tackGlobalQueue() {
        if(globalDefQueue.length === 0) return

        each(globalDefQueue, item=>{
            const id = item[0]
            if(typeof id === 'string'){
                context.defQueueMap[id] = true
            }
            defQueue.push(item)
        })

        globalDefQueue = []
    }

    const handlers = {
        require(mod){
            return mod.require || (mod.require = context.makeRequire(mod.map))
        },
        exports(mod){
            mod.usingExports = true
            if(mod.map.isDefine){
                if(mod.exports){
                    defined[mod.map.id] = mod.exports
                }else{
                    defined[mod.map.id] = mod.exports = {}
                }
                return mod.exports
            }
        },
        module(mod){
            if(!mod.module){
                mod.module = {
                    id: mod.map.id,
                    uri: mod.map.url,
                    config: () => getOwn(config.config, mod.map.id) || {},
                    exports: mod.exports || (mod.exports = {})
                }
            }
            return mod.module
        }
    }

    function cleanRegistry(id) {
        delete registry[id]
        delete enabledRegistry[id]
    }
    
    function breakCycle(mod, traced, processed) {
        if(mod.error) {
            mod.emit('error', mod.error)
            return
        }

        const id = mod.map.id;
        traced[id] = true;
        each(mod.depMaps, (depMap, i) => {
            const depId = depMap.id             
            const dep = getOwn(registry, depId);

            //Only force things that have not completed
            //being defined, so still in the registry,
            //and only if it has not been matched up
            //in the module already.
            if (dep && !mod.depMatched[i] && !processed[depId]) {
                if (getOwn(traced, depId)) {
                    mod.defineDep(i, defined[depId]);
                    mod.check(); //pass false?
                } else {
                    breakCycle(dep, traced, processed);
                }
            }
        });
        processed[id] = true;
    }

    let inCheckLoaded
    let checkLoadedTimeoutId

    function checkLoaded() {
        if(inCheckLoaded) return

        inCheckLoaded = true

        const waitInterval = config.waitSeconds * 1000
        const expired = waitInterval && context.startTime + waitInterval < new Date().getTime()
        const reqCalls = []
        const noLoads = []

        let usingPathFallback = false
        let stillLoading = false
        let needCycleCheck = true

        eachProp(enabledRegistry, mod=>{
            const map = mod.map
            const modId = map.id

            if(!mod.enabled) return

            if(!map.isDefine) reqCalls.push(mod)

            if(!mod.error){
                if(!mod.inited && expired){
                    if (hasPathFallback(modId)) {
                        usingPathFallback = true;
                        stillLoading = true;
                    } else {
                        noLoads.push(modId);
                        removeScript(modId);
                    }
                }
                else if (!mod.inited && mod.fetched && map.isDefine) {
                    stillLoading = true
                    if(!map.prefix){
                        needCycleCheck = false
                        return
                    }
                }
            }
        })

        if(expired && noLoads.length){
            const err = makeError('timeout', `Load timeout for modules: ${noLoads}`, null, noLoads)
            err.contextName = context.contextName
            return onError(err)
        }

        if(needCycleCheck){
            each(reqCalls, mode=>breakCycle(mod, {}, {}))
        }

        if((!expired || usingPathFallback) && stillLoading){
            if((isBrowser || isWebWorker) && !checkLoadedTimeoutId){
                checkLoadedTimeoutId = setTimeout(()=>{
                    checkLoadedTimeoutId = 0
                    checkLoaded()
                })
            }
        }

        inCheckLoaded = false
    }

    class Module {
        constructor(map){
            this.map = map
            this.events = getOwn(undefEvents, map.id) || {}
            this.shim = getOwn(config.shim, map.id)
            this.depExports = []
            this.depMaps = []
            this.depMatched = []
            this.pluginMaps = {}
            this.depCount = 0
        }
        defineDep(i, depExports) {
            //Because of cycles, defined callback for a given
            //export can be called more than once.
            if (!this.depMatched[i]) {
                this.depMatched[i] = true
                this.depCount--
                this.depExports[i] = depExports
            }
        }
        load(){
            const {id, url} = this.map

            if(!urlFetched[url]){
                urlFetched[url] = true
                context.load(id, url)
            }
        }
        check(){
            if(!this.enabled || this.enabling) return

            let {map, depMaps, depExports, exports, factory} = this
            const {id, isDefine} = map

            if(!this.inited){
                if(!hasProp(context.defQueueMap), id){
                    this.fetch()
                }
            }
            else if (this.error){
                this.emit('error', this.error)
            }
            else if (!this.defining){
                if(this.depCount <1 && !this.defined){
                    this.defining = true
                    if(isFunction(factory)){

                    }else{
                        exports = factory
                    }

                    this.exports = exports

                    if(isDefine && !this.ignore){
                        defined[id] = exports

                        if(req.onResourceLoad){
                            const resLoadMaps = []
                            each(depMaps, depMap => resLoadMaps.push(depMap.normalizedMap || depMap))
                            req.onResourceLoad(context, map, resLoadMaps)
                        }
                    }

                    cleanRegistry(id)

                    this.defined = true
                    this.defining = false
                }

                if(this.defined && !this.defineEmitted){
                    this.defineEmitted = true
                    this.emit('defined', exports)
                    this.defineEmitComplete = true
                }
            }
        }
        callPlugin(){
            const map = this.map
            const {id, parentMap, prefix, unnormalized} = map
            let {name} = map
            const pluginMap = makeModuleMap(prefix)

            this.depMaps.push(pluginMap)

            on(pluginMap, 'defined', plugin=>{
                const bundleId = getOwn(bundlesMap, id)
                const parentName = parentMap ? pluginMap.name : null
                const localRequire = context.makeRequire(parentMap, {
                    enableBuildCallback: true
                })

                if(unnormalized){
                    if(plugin.normalize){
                        name = plugin.normalize(name, name=>normalize(name, parentName, true)) || ''
                    }

                    const normalizedMap = makeModuleMap(`${prefix}!${name}`, parentMap, true)
                    on(normalizedMap, 'defined', value=>{
                        this.map.normalizedMap = normalizedMap
                        this.init([], ()=>value, null, {
                            enabled: true,
                            ignore: true
                        })
                    })

                    const normalizedMod = getOwn(registry, normalizedMap.id)

                    if(normalizedMod){
                        this.depMaps.push(normalizedMap)
                        if(this.events.error){
                            normalizedMod.on('error', err=>this.emit('error', err))
                        }
                        normalizedMod.enable()
                    }

                    return
                }

                if(bundleId){
                    this.map.url = context.nameToUrl(bundleId)
                    this.load()
                    return
                }

                const load = value => this.init([], ()=>value, null, {enabled: true})
                load.error = err => {
                    this.inited = true
                    this.error = err
                    err.requireModules = [id]

                    eachProp(registry, mod=>{
                        if(mod.map.id.indexOf(id + '_unnormalized') === 0){
                            cleanRegistry(mod.map.id)
                        }
                    })

                    onError(err)
                }
                load.fromText = (text, textAlt) => {
                    const moduleName = map.name
                    const moduleMap = makeModuleMap(moduleName)

                    if(textAlt) text = textAlt

                    getModule(moduleMap)

                    if(hasProp(config.config, id)){
                        config.config[moduleName] = config.config[id]
                    }

                    try {
                        req.exec(text)
                    } catch (e) {
                        return onError(makeError('fromtexteval', `fromText eval for ${id} failed: ${e}`, e, [id]))
                    }

                    this.depMaps.push(moduleMap)

                    context.completeLoad(moduleName)

                    localRequire([moduleName], load)
                }

                plugin.load(name, localRequire, load, config)
            })
            context.enable(pluginMap, this)
            this.pluginMaps[pluginMap.id] = pluginMap
        }
        enable(){
            const {map, depMaps, errback, events, skipMap, pluginMaps} = this
            const {id, isDefine, parentMap} = map
            enabledRegistry[id] = this
            this.enabled = true
            this.enabling = true

            each(depMaps, (depMap, i)=>{
                if(typeof depMap === 'string'){
                    depMap = makeModuleMap(depMap, isDefine? map : parentMap, false, !skipMap)
                    depMaps[i] = depMap

                    let handler = getOwn(handlers, depMap.id)
                    if(handler){
                        this.depExports[i] = handler(this)
                        return
                    }

                    this.depCount++

                    on(depMap, 'defined', exports=>{
                        if(this.undefed) return
                        this.defineDep(i, exports)
                        this.check()
                    })

                    const onerror = cb => on(depMap, 'error', cb)
                    if(errback){
                        onerror(errback.bind(this))
                    }
                    else if(events.error){
                        onerror(err=>this.emit('error', err))
                    }
                }

                const mod = registry[depMap.id]
                if(!hasProp(handlers, id) && mod && !mod.enabled){
                    context.enable(depMap, this)
                }
            })

            eachProp(pluginMaps, pluginMap=>{
                const mod = getOwn(registry, pluginMap.id)
                if(mod && !mod.enabled){
                    context.enable(pluginMap, this)
                }
            })

            this.enabling = false

            this.check()
        }
        fetch(){
            if(this.fetched) return
            context.startTime = new Date().getTime()

            const {map, shim} = this

            if(shim){
                context.makeRequire(map, {
                    enableBuildCallback: true
                })(shim.deps || [], () => map.prefix ? this.callPlugin() : this.load())
            }else{
                return map.prefix ? this.callPlugin() : this.load()
            }
        }
        init(depMaps, factory, errback, options = {}){
            if(this.inited) return

            this.factory = factory

            if(errback){
                this.on('error', errback)
            }else if(this.events.error){
                errback = err => this.emit('error', err)
            }

            this.depMaps = depMaps && depMaps.slice(0)
            this.errback = errback

            this.inited = true
            this.ignore = options.ignore

            if(options.enabled || this.enabled){
                this.enable()
            }else{
                this.check()
            }
        }
        on(name, cb){
            if(!this.events[name]){
                this.events[name] = []
            }
            this.events[name].push(cb)
        }
        emit(name, evt){
            each(this.events[name], cb=>cb(evt))
            if(name === 'error'){
                //error handler 触发后，移除监听
                //因为损坏的Module实例会留存在registry中
                delete this.events[name]
            }
        }
    }

    function callGetModule(args) {
        if(!hasProp(defined, args[0])){
            getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2])
        }
    }

    function getScriptData(evt) {
        const node = evt.currentTarget || evt.srcElement

        removeListener(node, context.onScriptLoad, 'load')
        removeListener(node, context.onScriptError, 'error')

        return {
            node,
            id: node && node.getAttribute('data-requiremodule')
        }
    }

    function intakeDefines() {
        tackGlobalQueue()

        let args
        while (defQueue.length){
            args = defQueue.shift()

            if(args[0] === null){
                return onError(makeError('mismatch', `Mismatched anonymous define() module: ${args[args.length - 1]}`))
            }else{
                callGetModule(args)
            }
        }

        context.defQueueMap = {}
    }

    const context = {
        config, contextName, registry, defined, urlFetched, defQueue,
        defQueueMap: {},
        Module, makeModuleMap, onError,
        nextTick: req.nextTick,

        configure(cfg){

        }
    }
}

//去除多余的./..
function trimDots(ary) {
    for(let i = 0; i< ary.length; i++){
        const part = ary[i]
        if(part === '.'){//.直接移除
            ary.splice(i, 1)
            i--
        }
        else if (part === '..'){
            if(i === 0 || i===1 && ary[2] === '..' || ary[i-1] === '..'){
                continue
            }else if(i > 0){//..去掉当前项和前一项非..的项
                ary.splice(i-1, 2)
                i -= 2
            }
        }
    }
}

function removeScript(name) {
    if (isBrowser) {
        each(scripts(), scriptNode => {
            if (scriptNode.getAttribute('data-requiremodule') === name &&
                scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                scriptNode.parentNode.removeChild(scriptNode);
                return true;
            }
        });
    }
}

function splitPrefix(name) {
    const index = name ? name.indexOf('!') : -1
    let prefix
    if(index > -1){
        prefix = name.substring(0, index);
        name = name.substring(index + 1, name.length);
    }
    return [prefix, name]
}

function removeListener(node, func, name) {
    node.removeEventListener(name, func, false)
}