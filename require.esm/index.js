/**
 * 忽略IE兼容代码，以提高可读性
 */

import {
    isFunction, isArray, getOwn, each, defaultOnError, eachReverse, scripts, commentReplace, makeError
} from "./utils";
import {defContextName, isBrowser, isWebWorker, regExp, version} from "./constants";
import newContext from './new-context'

function init(global, setTimeout) {
    let cfg = {}
    let globalDefQueue = []

    if (typeof define !== 'undefined') {
        //如果define已通过其他AMD加载器赋值，则不覆盖
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //不覆盖已存在的requirejs实例
            return;
        }
        //若不为对象，则将全局变量requirejs视为配置
        cfg = requirejs;
        requirejs = undefined;
    }

    //定义requirejs方法,req是简写
    const req = requirejs = function (deps, callback, errback, optional) {
        let config
        let contextName = defContextName

        if(!isArray(deps) && typeof deps !== 'string'){
            //deps是配置对象
            config = deps
            if(isArray(callback)){
                deps = callback;
                callback = errback;
                errback = optional;
            }else{
                deps = []
            }
        }

        if(config && config.context){
            contextName = config.context
        }

        let context = getOwn(contexts, contextName)
        if(!context){
            context = contexts[contextName] = req.s.newContext(contextName, globalDefQueue, req)
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    }
    //支持require.config()方法
    req.config = config => req(config)

    //延迟执行，可以用更好的方法覆盖setTimeout
    req.nextTick = setTimeout ? fn => setTimeout(fn, 4) : fn => fn()

    //全局无require方法的情况下，给require赋值
    if(!require){
        require=req
    }

    req.version = version

    req.jsExtRegExp = regExp.jsExtRegExp
    req.isBrowser = isBrowser

    const s = req.s = {
        contexts,
        newContext
    }

    //预设上下文
    req({})

    //在全局require上导出上下文相关的方法
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], prop=>{
        const ctx = contexts[defContextName]
        return ctx.require[prop].apply(ctx, arguments)
    })

    if(isBrowser){
        s.head = document.querySelector('head')
    }

    //任何需要明确生成的错误都会调用该方法
    //如果想自定义错误处理，就拦截/覆盖它
    req.onError = defaultOnError

    //用于load方法创建节点，只用于浏览器环境
    req.createNode = config => {
        const node = config.xhtml ? document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') : document.createElement('script')
        node.type = config.scriptType || 'text/javascript'
        node.charset = 'utf-8';
        node.async = true;
        return node;
    }

    req.load = (context, moduleName, url)=>{
        if(isBrowser){
            let config = context && context.config || {}
            let node = req.createNode(config, moduleName, url)

            node.addEventListener('load', context.onScriptLoad)
            node.addEventListener('error', context.onScriptError)

            s.head.appendChild(node)
            return node
        }
        else if (isWebWorker){
            try {
                //往当前事件循环后置一个任务以解决一个WebKit bug:
                //worker调用importScripts()后被GC
                setTimeout(function() {}, 0)
                importScripts(url)
                //异步回调
                context.completeLoad(moduleName)
            } catch (e) {
                context.onError(makeError('importscripts',`importScripts failed for ${moduleName} at ${url}`, e, [moduleName]))
            }
        }
    }

    if(isBrowser && !cfg.skipDataMain){
        eachReverse(scripts(), script=>{
            let dataMain = script.getAttribute('data-main')
            if(dataMain){
                let mainScript = dataMain
                if (!cfg.baseUrl && mainScript.indexOf('!') === -1) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    let src = mainScript.split('/');
                    mainScript = src.pop();

                    cfg.baseUrl = src.length ? src.join('/')  + '/' : './';
                }

                mainScript = mainScript.replace(regExp.jsSuffixRegExp, '')

                if(reg.jsExtRegExp.test(mainScript)){
                    mainScript = dataMain
                }

                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript]
            }
        })
    }

    define = function (name, deps, callback) {
        //允许匿名模块
        if (typeof name !== 'string') {
            //调整参数
            callback = deps;
            deps = name;
            name = null;
        }
        //模块可能没有依赖
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }
        //如果没有name，且callback是函数
        //判断
        if(!deps && isFunction(callback)){
            deps = []
            if(callback.length){
                callback
                    .toString()
                    .replace(regExp.comment, commentReplace)
                    .replace(regExp.cjsRequire, (match, dep)=>deps.push(dep))
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps)
            }
        }

        if(context){
            context.defQueue.push([name, deps, callback])
            context.defQueueMap[name] = true
        }
        else {
            globalDefQueue.push([name, deps, callback])
        }
    }

    define.amd = {
        jQuery: true
    }

    req.exec = text => eval(text)

    req(cfg)
}
init(this, typeof setTimeout === 'undefined' ? undefined : setTimeout)