import { describe, expect, it } from 'vitest';
import {
  eastFromWest, formatHms, lmstHours, ltstHours, marsState, sunPosition, sunPositionFromState, sunriseSunset,
  ttMinusUtcSeconds, westFromEast,
} from '@/lib/ops/mars24';

/**
 * Expected numbers are copied verbatim from the NASA GISS "Mars24 Sunclock — Algorithm and Worked Examples"
 * page (https://www.giss.nasa.gov/tools/mars24/help/algorithm.html, updated 2025-01-07). The page prints
 * 5 decimals, so angle tolerances are ~2e-5 deg (rounding chain), with three documented exceptions where the
 * page's own printed numbers are not reproducible from its own formulas (see PAGE_QUIRK comments).
 */
describe('Mars24 worked example 1: near-coincident Earth/Mars midnight (2000-01-06 00:00 UTC, 0°W 0°N)', () => {
  const ms = 947116800000;
  const s = marsState(ms);
  it('A: time scales', () => {
    expect(s.jdUt).toBe(2451549.5);
    expect(s.ttMinusUtcS).toBeCloseTo(64.184, 6);
    expect(s.jdTt).toBeCloseTo(2451549.50074, 5);
    expect(s.dtJ2000).toBeCloseTo(4.50074, 5);
  });
  it('B: orbital parameters', () => {
    expect(s.meanAnomalyDeg).toBeCloseTo(21.74558, 4);
    expect(s.alphaFmsDeg).toBeCloseTo(272.74566, 4);
    expect(s.pbsDeg).toBeCloseTo(0.00142, 5);
    expect(s.equationOfCenterDeg).toBeCloseTo(4.44193, 4);
    expect(s.lsDeg).toBeCloseTo(277.18758, 4);
  });
  it('C: equation of time, MST, LMST, LTST, subsolar longitude', () => {
    expect(s.eotDeg).toBeCloseTo(-5.18774, 4);
    expect(s.eotHours).toBeCloseTo(-0.34585, 4);
    expect(formatHms(s.eotHours)).toBe('23:39:15'); // −00:20:45
    expect(s.mstHours).toBeCloseTo(23.99425, 4);
    expect(formatHms(s.mstHours)).toBe('23:59:39');
    expect(lmstHours(s, 0)).toBeCloseTo(23.99425, 4);
    expect(ltstHours(s, 0)).toBeCloseTo(23.6484, 4);
    expect(formatHms(ltstHours(s, 0))).toBe('23:38:54');
    expect(s.subsolarLonWestDeg).toBeCloseTo(174.726, 4);
    expect(s.subsolarLonEastDeg).toBeCloseTo(-174.726, 4);
  });
  it('MSD (AM2000 eq. 21) is consistent with the printed MST', () => {
    expect(s.msd).toBeCloseTo(44795.99976, 4);
    expect(((s.msd % 1) + 1) % 1 * 24).toBeCloseTo(23.99425, 3);
  });
  it('D: declination, heliocentric terms, zenith and azimuth', () => {
    expect(s.declinationDeg).toBeCloseTo(-25.22825, 4);
    expect(s.heliocentricDistanceAu).toBeCloseTo(1.39358, 5);
    expect(s.heliocentricLonDeg % 360).toBeCloseTo(2.26352, 4);
    expect(s.heliocentricLatDeg).toBeCloseTo(-1.35957, 4);
    const p = sunPositionFromState(s, 0, 0, { latitude: 'planetographic' });
    expect(p.zenithDeg).toBeCloseTo(154.26182, 3); // page 154.26182; implementation 154.26176 (page rounding chain)
    expect(p.elevationDeg).toBeCloseTo(90 - 154.26182, 3);
    expect(p.azimuthDeg).toBeCloseTo(191.03905, 4);
  });
});

describe('Mars24 worked example 2: MER-A Spirit landing (2004-01-04 UTC, 184.702°W −14.640°N)', () => {
  const ms = 1073137591000;
  const s = marsState(ms);
  const lonEast = eastFromWest(184.702);
  it('A/B', () => {
    expect(s.jdUt).toBeCloseTo(2453008.07397, 5);
    expect(s.jdTt).toBeCloseTo(2453008.07471, 5);
    expect(s.dtJ2000).toBeCloseTo(1463.07471, 5);
    expect(s.meanAnomalyDeg).toBeCloseTo(786.06858, 4);
    expect(s.alphaFmsDeg).toBeCloseTo(1037.09457, 4);
    expect(s.pbsDeg).toBeCloseTo(0.01614, 5);
    expect(s.equationOfCenterDeg).toBeCloseTo(10.22959, 4);
    expect(s.lsDeg).toBeCloseTo(327.32416, 4);
  });
  it('C: EOT, MST, LMST, LTST (≈ local midnight), subsolar longitude', () => {
    expect(s.eotDeg).toBeCloseTo(-12.77553, 4);
    expect(s.eotHours).toBeCloseTo(-0.8517, 4);
    expect(s.mstHours).toBeCloseTo(13.16537, 4);
    expect(formatHms(s.mstHours)).toBe('13:09:55');
    expect(lmstHours(s, lonEast)).toBeCloseTo(0.8519, 4);
    expect(formatHms(lmstHours(s, lonEast))).toBe('00:51:07');
    // PAGE_QUIRK: page prints LTST 0.00025 h although its own LMST+EOT = 0.00020 h; we get 0.00020 h (< 1 s).
    expect(ltstHours(s, lonEast)).toBeCloseTo(0.00025, 3);
    expect(Math.abs(ltstHours(s, lonEast))).toBeLessThan(2 / 3600);
    expect(s.subsolarLonWestDeg).toBeCloseTo(4.705, 4);
  });
  it('D: declination, R, l, b, zenith, azimuth', () => {
    // PAGE_QUIRK: page prints δ = −13.42065 and Z = 151.93895; the page's own D-1 formula applied to its own Ls
    // gives −13.42040 / 151.93960 (differences 2.5e-4° / 6.5e-4°, 1 and 2 units of the 3rd decimal).
    expect(s.declinationDeg).toBeCloseTo(-13.42065, 3);
    expect(s.heliocentricDistanceAu).toBeCloseTo(1.47767, 5);
    expect(s.heliocentricLonDeg % 360).toBeCloseTo(52.37564, 4);
    expect(s.heliocentricLatDeg).toBeCloseTo(0.08965, 4);
    const p = sunPositionFromState(s, -14.64, lonEast, { latitude: 'planetographic' });
    expect(p.zenithDeg).toBeCloseTo(151.93895, 2);
    expect(p.azimuthDeg).toBeCloseTo(179.99383, 3);
    expect(Math.abs(p.hourAngleDeg)).toBeCloseTo(179.997, 2);
  });
});

describe('Mars24 helpers', () => {
  it('east/west longitude conversion round-trips', () => {
    expect(westFromEast(77.4)).toBeCloseTo(282.6, 9);
    expect(eastFromWest(282.6)).toBeCloseTo(77.4, 9);
    expect(eastFromWest(184.702)).toBeCloseTo(175.298, 9);
    for (const lon of [-179.5, -10, 0, 10, 179.5]) expect(eastFromWest(westFromEast(lon))).toBeCloseTo(lon, 9);
  });
  it('TT−UTC: 2017 leap-second example from the page = 69.184 s; 2000 = 64.184 s', () => {
    expect(ttMinusUtcSeconds(Date.UTC(2017, 0, 1))).toBeCloseTo(69.184, 6);
    expect(ttMinusUtcSeconds(Date.UTC(2000, 0, 6))).toBeCloseTo(64.184, 6);
    expect(ttMinusUtcSeconds(Date.UTC(1960, 0, 1))).toBeGreaterThan(30); // polynomial branch
  });
  it('local time increases 15°/h eastward: LMST(lon+15°E) = LMST(lon) + 1 h', () => {
    const s = marsState(Date.UTC(2026, 10, 14, 3, 0, 0));
    const d = (ltstHours(s, 25) - ltstHours(s, 10) + 24) % 24;
    expect(d).toBeCloseTo(1, 9);
  });
  it('latitude option: ellipsoidal conversion changes elevation by < 0.25°', () => {
    const t = Date.UTC(2026, 10, 14, 6, 0, 0);
    const a = sunPosition(t, 18.4, 77.4).elevationDeg;
    const b = sunPosition(t, 18.4, 77.4, { latitude: 'planetocentric-ellipsoid' }).elevationDeg;
    expect(Math.abs(a - b)).toBeLessThan(0.25);
    expect(a).not.toBe(b);
  });
});

describe('sunrise / sunset (Jezero ≈ 18.4°N 77.4°E; geometric, refraction ignored)', () => {
  const when = Date.UTC(2026, 10, 14, 12, 0, 0);
  const { noonMs, sunriseMs, sunsetMs, maxElevationDeg, polar } = sunriseSunset(18.4, 77.4, when);
  const el = (t: number) => sunPosition(t, 18.4, 77.4).elevationDeg;
  it('sunrise < noon < sunset, polar is null', () => {
    expect(polar).toBeNull();
    expect(sunriseMs).not.toBeNull(); expect(sunsetMs).not.toBeNull();
    expect(sunriseMs!).toBeLessThan(noonMs);
    expect(noonMs).toBeLessThan(sunsetMs!);
  });
  it('elevation is 0 at sunrise/sunset and positive between', () => {
    expect(Math.abs(el(sunriseMs!))).toBeLessThan(0.01);
    expect(Math.abs(el(sunsetMs!))).toBeLessThan(0.01);
    expect(el(noonMs)).toBeGreaterThan(20);
    expect(el((sunriseMs! + noonMs) / 2)).toBeGreaterThan(0);
  });
  it('LTST at noon is 12 h and elevation there is the day maximum', () => {
    const lt = ltstHours(marsState(noonMs), 77.4);
    expect(Math.abs(lt - 12)).toBeLessThan(1 / 3600);
    let best = -90, bestT = 0;
    for (let t = sunriseMs!; t <= sunsetMs!; t += 60_000) { const e = el(t); if (e > best) { best = e; bestT = t; } }
    expect(Math.abs(bestT - noonMs)).toBeLessThan(15 * 60_000); // declination drift shifts the maximum by minutes
    expect(maxElevationDeg).toBeGreaterThan(best - 0.05);
  });
  it('sunrise/sunset local times are near 06:00 / 18:00 LTST and symmetric about noon', () => {
    const lr = ltstHours(marsState(sunriseMs!), 77.4), ls = ltstHours(marsState(sunsetMs!), 77.4);
    expect(lr).toBeGreaterThan(5); expect(lr).toBeLessThan(7);
    expect(ls).toBeGreaterThan(17); expect(ls).toBeLessThan(19);
    expect(Math.abs((noonMs - sunriseMs!) - (sunsetMs! - noonMs))).toBeLessThan(10 * 60_000);
  });
  it('same sol for any instant inside it', () => {
    const b = sunriseSunset(18.4, 77.4, (sunriseMs! + noonMs) / 2);
    expect(Math.abs(b.noonMs - noonMs)).toBeLessThan(1000);
  });
  it('polar night / polar day', () => {
    // Ls ≈ 277 (2000-01-06): northern midwinter
    expect(sunriseSunset(89, 0, Date.UTC(2000, 0, 6)).polar).toBe('night');
    expect(sunriseSunset(-89, 0, Date.UTC(2000, 0, 6)).polar).toBe('day');
  });
});
