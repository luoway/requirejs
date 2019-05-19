export function commentReplace(match, singlePrefix) {
    return singlePrefix || '';
}

export function isFunction(it) {
    return Object.prototype.toString.call(it) === '[object Function]';
}

export function isArray(it) {
    return Object.prototype.toString.call(it) === '[object Array]';
}
/**
 * Helper function for iterating over an array. If the func returns
 * a true value, it will break out of the loop.
 */
export function each(ary, func) {
    if (ary) {
        for (let i = 0; i < ary.length; i++) {
            if (ary[i] && func(ary[i], i, ary)) {
                break;
            }
        }
    }
}
/**
 * Helper function for iterating over an array backwards. If the func
 * returns a true value, it will break out of the loop.
 */
export function eachReverse(ary, func) {
    if (ary) {
        for (i = ary.length - 1; i > -1; i --) {
            if (ary[i] && func(ary[i], i, ary)) {
                break;
            }
        }
    }
}

export function hasProp(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

export function getOwn(obj, prop) {
    return hasProp(obj, prop) && obj[prop];
}
/**
 * Cycles over properties in an object and calls a function for each
 * property value. If the function returns a truthy value, then the
 * iteration is stopped.
 */
export function eachProp(obj, func) {
    for (let prop in obj) {
        if (hasProp(obj, prop)) {
            if (func(obj[prop], prop)) {
                break;
            }
        }
    }
}

/**
 * Simple function to mix in properties from source into target,
 * but only if target does not already have a property of the same name.
 */
export function mixin(target, source, force, deepStringMixin) {
    if (source) {
        eachProp(source, function (value, prop) {
            if (force || !hasProp(target, prop)) {
                if (deepStringMixin && typeof value === 'object' && value &&
                    !isArray(value) && !isFunction(value) &&
                    !(value instanceof RegExp)) {

                    if (!target[prop]) {
                        target[prop] = {};
                    }
                    mixin(target[prop], value, force, deepStringMixin);
                } else {
                    target[prop] = value;
                }
            }
        });
    }
    return target;
}

//Similar to Function.prototype.bind, but the 'this' object is specified
//first, since it is easier to read/figure out what 'this' will be.
export function bind(obj, fn) {
    return function () {
        return fn.apply(obj, arguments);
    };
}

export function scripts() {
    return document.getElementsByTagName('script');
}

export function defaultOnError(err) {
    throw err;
}

//Allow getting a global that is expressed in
//dot notation, like 'a.b.c'.
export function getGlobal(value) {
    if (!value) {
        return value;
    }
    const g = this;
    each(value.split('.'), function (part) {
        g = g[part];
    });
    return g;
}

/**
 * Constructs an error with a pointer to an URL with more information.
 * @param {String} id the error ID that maps to an ID on a web page.
 * @param {String} message human readable error.
 * @param {Error} [err] the original error, if there is one.
 *
 * @returns {Error}
 */
export function makeError(id, msg, err, requireModules) {
    const e = new Error(msg + '\nhttps://requirejs.org/docs/errors.html#' + id);
    e.requireType = id;
    e.requireModules = requireModules;
    if (err) {
        e.originalError = err;
    }
    return e;
}