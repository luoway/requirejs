export const version = '2.3.6'

export const regExp = {
    comment: /\/\*[\s\S]*?\*\/|([^:"'=]|^)\/\/.*$/mg,   //m表示match
    cjsRequire: /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
    jsSuffix: /\.js$/,
    jsExtRegExp: /^\/|:|\?|\.js$/,
    currDir: /^\.\//,
}

export const isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document)

export const isWebWorker = !isBrowser && typeof importScripts !== 'undefined'

//PS3 indicates loaded and complete, but need to wait for complete
//specifically. Sequence is 'loading', 'loaded', execution,
// then 'complete'. The UA check is unfortunate, but not sure how
//to feature test w/o causing perf issues.
export const readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ? /^complete$/ : /^(complete|loaded)$/

export const defContextName = '_'