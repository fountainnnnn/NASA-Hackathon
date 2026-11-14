/* @ts-self-types="./scenario.d.ts" */

/**
 * Monte-Carlo touchdown scatter.
 *
 * Returns `[ok_fraction, nodata_fraction, p50, p95, n_kept, (lon, lat, slope) x n_kept]`.
 * * `ok_fraction`: touchdowns with valid slope <= `max_slope_deg`, over all `samples`.
 * * `nodata_fraction`: touchdowns outside the grid or touching NaN cells, over all `samples`.
 * * `p50`/`p95`: slope percentiles over valid samples only (0.1 degree histogram, NaN if none valid).
 * * kept points are the first `min(keep_points, samples)` draws (iid, so unbiased); slope is NaN for nodata.
 * Deterministic for a given `seed` (xoshiro256** seeded by splitmix64).
 * @param {Float32Array | number[]} slope
 * @param {number} width
 * @param {number} height
 * @param {number} lon_min
 * @param {number} lat_max
 * @param {number} dlon
 * @param {number} dlat
 * @param {number} center_lon
 * @param {number} center_lat
 * @param {number} semi_major_km
 * @param {number} semi_minor_km
 * @param {number} azimuth_deg
 * @param {number} samples
 * @param {number} max_slope_deg
 * @param {bigint} seed
 * @param {number} keep_points
 * @returns {Float32Array}
 */
export function landing_monte_carlo(slope, width, height, lon_min, lat_max, dlon, dlat, center_lon, center_lat, semi_major_km, semi_minor_km, azimuth_deg, samples, max_slope_deg, seed, keep_points) {
    const val2 = +width;
    const val3 = +height;
    const val4 = +lon_min;
    const val5 = +lat_max;
    const val6 = +dlon;
    const val7 = +dlat;
    const val8 = +center_lon;
    const val9 = +center_lat;
    const val10 = +semi_major_km;
    const val11 = +semi_minor_km;
    const val12 = +azimuth_deg;
    const val13 = +samples;
    const val14 = +max_slope_deg;
    const val15 = BigInt.asIntN(64, seed);
    const val16 = +keep_points;
    const ptr0 = passArrayF32ToWasm0(slope, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.landing_monte_carlo(ptr0, len0, val2, val3, val4, val5, val6, val7, val8, val9, val10, val11, val12, val13, val14, val15, val16);
    var v17 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v17;
}

/**
 * Horn slope field; see `slope_field_core`. Matches `computeSlopeField` in src/lib/terrain/slope.ts.
 * @param {Float32Array | number[]} elev
 * @param {number} width
 * @param {number} height
 * @param {number} lat_max
 * @param {number} dlat
 * @param {number} dlon
 * @returns {Float32Array}
 */
export function slope_field(elev, width, height, lat_max, dlat, dlon) {
    const val2 = +width;
    const val3 = +height;
    const val4 = +lat_max;
    const val5 = +dlat;
    const val6 = +dlon;
    const ptr0 = passArrayF32ToWasm0(elev, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slope_field(ptr0, len0, val2, val3, val4, val5, val6);
    var v7 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v7;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./scenario_bg.js": import0,
    };
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        throw new Error("scenario wasm: pass module_or_path explicitly");
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
