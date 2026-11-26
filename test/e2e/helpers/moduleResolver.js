import fs from 'fs';
import path from 'path';

const CLIENT_ROOT = path.resolve(__dirname, '../../../src/assets/scripts/client');

/**
 * Resolve a module path relative to `src/assets/scripts/client/`.
 *
 * @function resolveClientPath
 * @param relPath {string}
 * @return {string}
 */
export function resolveClientPath(relPath) {
    const normalized = String(relPath || '').replace(/^\/+/, '');
    const direct = path.resolve(CLIENT_ROOT, normalized);

    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
        return direct;
    }

    if (!normalized.endsWith('.js')) {
        const withExt = `${direct}.js`;

        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
            return withExt;
        }
    }

    return direct;
}

/**
 * Safely attempt to require an optional or in-flight client module without
 * crashing AVA at import time if the file is missing or partially refactored.
 *
 * @function tryRequireClient
 * @param relPath {string}
 * @return {object} { available, exports, defaultExport, error, resolvedPath }
 */
export function tryRequireClient(relPath) {
    const resolvedPath = resolveClientPath(relPath);

    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        return {
            available: false,
            exports: null,
            defaultExport: null,
            error: new Error(`Module not found: ${relPath} (${resolvedPath})`),
            resolvedPath
        };
    }

    try {
        /* eslint-disable global-require, import/no-dynamic-require */
        const mod = require(resolvedPath);
        /* eslint-enable global-require, import/no-dynamic-require */
        const defaultExport = mod && mod.__esModule ? mod.default : mod;

        return {
            available: true,
            exports: mod,
            defaultExport,
            error: null,
            resolvedPath
        };
    } catch (error) {
        return {
            available: false,
            exports: null,
            defaultExport: null,
            error,
            resolvedPath
        };
    }
}

/**
 * Assert that a client module is available and return its resolved descriptor.
 *
 * @function requireAvailable
 * @param t {object} AVA execution context
 * @param relPath {string}
 * @param contractLabel {string}
 * @return {object}
 */
export function requireAvailable(t, relPath, contractLabel = relPath) {
    const result = tryRequireClient(relPath);
    const reason = result.error ? result.error.message : 'unknown error';

    t.true(result.available, `Missing ${contractLabel} (${relPath}): ${reason}`);

    return result;
}
