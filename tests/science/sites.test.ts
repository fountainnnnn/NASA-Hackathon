import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScienceObjective, ScienceSite } from '@/lib/contracts';

const file = join(process.cwd(), 'public/data/science_sites.json');
const OBJ: ScienceObjective[] = ['delta-sediments', 'crater-floor', 'rim-bedrock', 'aeolian', 'astrobiology-samples'];
const HOSTS = /^https:\/\/(www\.)?(science\.nasa\.gov|nasa\.gov|mars\.nasa\.gov|jpl\.nasa\.gov|[a-z0-9.-]*usgs\.gov)\//;

describe.skipIf(!existsSync(file))('public/data/science_sites.json', () => {
  const sites = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []) as ScienceSite[];
  it('has 6-10 unique entries', () => {
    expect(sites.length).toBeGreaterThanOrEqual(6);
    expect(sites.length).toBeLessThanOrEqual(10);
    expect(new Set(sites.map((s) => s.id)).size).toBe(sites.length);
  });
  it.each(sites.map((s) => [s.id, s] as const))('%s is well-formed, in DEM bounds, NASA/USGS-sourced', (_id, s) => {
    expect(s.lon).toBeGreaterThanOrEqual(77.1605);
    expect(s.lon).toBeLessThanOrEqual(77.699);
    expect(s.lat).toBeGreaterThanOrEqual(18.211);
    expect(s.lat).toBeLessThanOrEqual(18.7212);
    expect(s.objectives.length).toBeGreaterThan(0);
    for (const o of s.objectives) expect(OBJ).toContain(o);
    expect(s.sourceUrl).toMatch(HOSTS);
    expect(s.summary.length).toBeGreaterThan(20);
    expect(s.sourceTitle && s.mission && s.name).toBeTruthy();
    expect(s.coordinateSource).toMatch(/waypoint sol \d+|IAU|USGS/i);
  });
});
