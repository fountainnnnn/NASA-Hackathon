/**
 * Where CesiumJS's prebuilt bundle comes from. Production loads it from jsDelivr at the exact version in package.json, with
 * Subresource Integrity on Cesium.js; its workers and assets load from the same immutable versioned path (CESIUM_BASE_URL).
 * If the CDN fails (offline dev), /cesium/ is tried: copy node_modules/cesium/Build/Cesium there (gitignored) to use it.
 * tests/planet/cesiumCdn.test.ts checks the version and hash against node_modules, so an upgrade cannot drift silently.
 */
export const CESIUM_VERSION = '1.147.0';
export const CESIUM_CDN_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
/** sha384 of Build/Cesium/Cesium.js for CESIUM_VERSION (identical on npm and jsDelivr). */
export const CESIUM_JS_SRI = 'sha384-MsL9BLNAnIOaKqfaH6xNODs0FmBa4Ol8wwzL5MJ+w3w+63xjOHH0MD8x1uZoKlZg';
export const CESIUM_LOCAL_BASE = '/cesium/';
