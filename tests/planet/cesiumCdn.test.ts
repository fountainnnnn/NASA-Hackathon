import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CESIUM_CDN_BASE, CESIUM_JS_SRI, CESIUM_VERSION } from '../../src/components/Planet/cesiumCdn';

const build = join(__dirname, '../../node_modules/cesium');

describe('Cesium CDN pin', () => {
  it('loads the exact installed version', () => {
    const pkg = JSON.parse(readFileSync(join(build, 'package.json'), 'utf8')) as { version: string };
    expect(CESIUM_VERSION).toBe(pkg.version);
    expect(CESIUM_CDN_BASE).toBe(`https://cdn.jsdelivr.net/npm/cesium@${pkg.version}/Build/Cesium/`);
  });
  it('SRI hash matches the installed Build/Cesium/Cesium.js', () => {
    const hash = createHash('sha384').update(readFileSync(join(build, 'Build/Cesium/Cesium.js'))).digest('base64');
    expect(CESIUM_JS_SRI).toBe(`sha384-${hash}`);
  });
});
