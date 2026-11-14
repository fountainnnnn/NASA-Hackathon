/**
 * NASA GISS Mars24 algorithm (Allison & McEwen 2000, Planet. Space Sci. 48, 215; Allison 1997 GRL 24, 1967),
 * steps A–D exactly as published at https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
 * (page "Updated 2025-01-07", incl. the 2015 revisions to B-1, B-2, C-2, D-2).
 *
 * Longitude conventions: Mars24 works in planetographic WEST-positive longitude (Λ). The rest of this
 * project is planetocentric EAST-positive. Every public function here takes EAST-positive longitude
 * (`lonEastDeg`) and converts internally with Λ_west = (−lon_east) mod 360. Use `westFromEast` /
 * `eastFromWest` for explicit conversions.
 *
 * Latitude: the formulas use planetographic latitude φ. By default the supplied latitude is used as
 * given (spherical assumption, consistent with the project's R=3,396,190 m sphere; difference to the
 * ellipsoidal value is ≤ 0.2°). Pass `latitude: 'planetographic'` to use the value as-is under the
 * Mars24 definition, or `'planetocentric-ellipsoid'` to convert with the IAU Mars axes.
 *
 * Time system: input is a JS Date (POSIX/UT-like, no leap seconds, as Mars24's Java millis). UTC→TT uses the
 * leap-second table (TAI−UTC + 32.184 s) after 1972 and the published polynomial before (A-4).
 * No leap second after 2017-01-01 is assumed (none occurred as of the page's update).
 *
 * Sun elevation is geometric: no atmospheric refraction, no solar disc radius (centre of disc).
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const mod = (x: number, m: number): number => ((x % m) + m) % m;

/** IAU/NASA Mars equatorial and polar radii (km), for the optional ellipsoidal latitude conversion. */
const MARS_EQ_KM = 3396.19, MARS_POL_KM = 3376.2;

export const westFromEast = (lonEastDeg: number): number => mod(-lonEastDeg, 360);
export const eastFromWest = (lonWestDeg: number): number => {
  const e = mod(-lonWestDeg, 360);
  return e > 180 ? e - 360 : e;
};

/** Planetocentric -> planetographic latitude (deg) on the IAU Mars ellipsoid. */
export function planetographicFromPlanetocentric(latDeg: number): number {
  return Math.atan(Math.tan(latDeg * DEG) * (MARS_EQ_KM / MARS_POL_KM) ** 2) * RAD;
}

/* ------------------------------------------------------------------ A: time scales */

/** TAI−UTC (s) effective from each UTC date (IERS leap-second table, 1972–2017). */
const LEAPS: [number, number][] = ([
  [1972, 1, 1, 10], [1972, 7, 1, 11], [1973, 1, 1, 12], [1974, 1, 1, 13], [1975, 1, 1, 14], [1976, 1, 1, 15],
  [1977, 1, 1, 16], [1978, 1, 1, 17], [1979, 1, 1, 18], [1980, 1, 1, 19], [1981, 7, 1, 20], [1982, 7, 1, 21],
  [1983, 7, 1, 22], [1985, 7, 1, 23], [1988, 1, 1, 24], [1990, 1, 1, 25], [1991, 1, 1, 26], [1992, 7, 1, 27],
  [1993, 7, 1, 28], [1994, 7, 1, 29], [1996, 1, 1, 30], [1997, 7, 1, 31], [1999, 1, 1, 32], [2006, 1, 1, 33],
  [2009, 1, 1, 34], [2012, 7, 1, 35], [2015, 7, 1, 36], [2017, 1, 1, 37],
] as [number, number, number, number][]).map(([y, m, d, s]) => [Date.UTC(y, m - 1, d), s]);

/** A-4: TT − UTC in seconds for a given Unix time (ms). */
export function ttMinusUtcSeconds(millis: number): number {
  if (millis >= LEAPS[0][0]) {
    let s = LEAPS[0][1];
    for (const [t, v] of LEAPS) if (millis >= t) s = v;
    return s + 32.184;
  }
  const jdUt = 2440587.5 + millis / 8.64e7;
  const T = (jdUt - 2451545.0) / 36525;
  return 64.184 + 59 * T - 51.2 * T ** 2 - 67.1 * T ** 3 - 16.4 * T ** 4;
}

/** Perturbers table (A_i, τ_i, φ_i), B-3. */
const PERT: [number, number, number][] = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
];

export interface MarsState {
  millis: number;
  jdUt: number; ttMinusUtcS: number; jdTt: number;
  /** Δt since J2000 (TT), days — A-6. */
  dtJ2000: number;
  /** Mean anomaly M, deg (not wrapped) — B-1. */
  meanAnomalyDeg: number;
  alphaFmsDeg: number; pbsDeg: number;
  /** Equation of centre ν − M, deg — B-4. */
  equationOfCenterDeg: number;
  /** Areocentric solar longitude Ls, deg in [0,360) — B-5. */
  lsDeg: number;
  /** Equation of time, hours — C-1 (deg value in eotDeg). */
  eotDeg: number; eotHours: number;
  /** Mean solar time at the prime meridian (Airy Mean Time = Coordinated Mars Time), hours [0,24) — C-2. */
  mstHours: number;
  /** Mars Sol Date (AM2000 eq. 21): (JD_TT − 2451549.5)/1.0274912517 + 44796.0 − 0.0009626. */
  msd: number;
  /** Subsolar longitude, planetographic WEST-positive deg [0,360) — C-5. */
  subsolarLonWestDeg: number;
  /** Same, east-positive, range (−180,180]. */
  subsolarLonEastDeg: number;
  /** Solar declination (planetographic), deg — D-1. */
  declinationDeg: number;
  /** Heliocentric distance AU, longitude deg, latitude deg — D-2..D-4. */
  heliocentricDistanceAu: number; heliocentricLonDeg: number; heliocentricLatDeg: number;
}

/** Steps A-1 … D-4 for a UTC instant (Date or Unix ms). */
export function marsState(when: Date | number): MarsState {
  const millis = typeof when === 'number' ? when : when.getTime();
  // A
  const jdUt = 2440587.5 + millis / 8.64e7;
  const ttMinusUtcS = ttMinusUtcSeconds(millis);
  const jdTt = jdUt + ttMinusUtcS / 86400;
  const dt = jdTt - 2451545.0;
  // B
  const M = 19.3871 + 0.52402073 * dt;
  const alphaFms = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [A, tau, phi] of PERT) pbs += A * Math.cos((0.985626 * dt / tau + phi) * DEG);
  const nuMinusM =
    (10.691 + 3.0e-7 * dt) * Math.sin(M * DEG) + 0.623 * Math.sin(2 * M * DEG) + 0.050 * Math.sin(3 * M * DEG) +
    0.005 * Math.sin(4 * M * DEG) + 0.0005 * Math.sin(5 * M * DEG) + pbs;
  const Ls = alphaFms + nuMinusM;
  const LsW = mod(Ls, 360);
  // C
  const eotDeg = 2.861 * Math.sin(2 * LsW * DEG) - 0.071 * Math.sin(4 * LsW * DEG) + 0.002 * Math.sin(6 * LsW * DEG) - nuMinusM;
  const msdRaw = (jdTt - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mst = mod(24 * msdRaw, 24);
  const subW = mod(mst * 15 + eotDeg + 180, 360);
  // D
  const decl = Math.asin(0.42565 * Math.sin(LsW * DEG)) * RAD + 0.25 * Math.sin(LsW * DEG);
  const RM = 1.52367934 * (1.00436 - 0.09309 * Math.cos(M * DEG) - 0.004336 * Math.cos(2 * M * DEG) -
    0.00031 * Math.cos(3 * M * DEG) - 0.00003 * Math.cos(4 * M * DEG));
  const lM = LsW + 85.061 - 0.015 * Math.sin((71 + 2 * LsW) * DEG) - 5.5e-6 * dt;
  const bM = -(1.8497 - 2.23e-5 * dt) * Math.sin((LsW - 144.5 + 2.57e-6 * dt) * DEG);
  return {
    millis, jdUt, ttMinusUtcS, jdTt, dtJ2000: dt, meanAnomalyDeg: M, alphaFmsDeg: alphaFms, pbsDeg: pbs,
    equationOfCenterDeg: nuMinusM, lsDeg: LsW, eotDeg, eotHours: eotDeg / 15, mstHours: mst, msd: msdRaw,
    subsolarLonWestDeg: subW, subsolarLonEastDeg: eastFromWest(subW), declinationDeg: decl,
    heliocentricDistanceAu: RM, heliocentricLonDeg: lM, heliocentricLatDeg: bM,
  };
}

/* ------------------------------------------------------------------ C: local times */

/** Coordinated Mars Time (= MST at the prime meridian), hours [0,24). */
export const coordinatedMarsTimeHours = (when: Date | number): number => marsState(when).mstHours;

/** Local Mean Solar Time at an EAST-positive longitude, hours [0,24) — C-3 with Λ = west(lon). */
export function lmstHours(st: MarsState, lonEastDeg: number): number {
  return mod(st.mstHours - westFromEast(lonEastDeg) / 15, 24);
}

/** Local True Solar Time at an EAST-positive longitude, hours [0,24) — C-4. */
export function ltstHours(st: MarsState, lonEastDeg: number): number {
  return mod(lmstHours(st, lonEastDeg) + st.eotHours, 24);
}

export function formatHms(hours: number): string {
  const s = Math.round(mod(hours, 24) * 3600) % 86400;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/* ------------------------------------------------------------------ D-5/D-6: sun position */

export type LatitudeKind = 'planetocentric-sphere' | 'planetographic' | 'planetocentric-ellipsoid';
export interface SunOptions { latitude?: LatitudeKind }

export interface SunPosition {
  elevationDeg: number; zenithDeg: number;
  /** Compass azimuth, deg clockwise from north [0,360). */
  azimuthDeg: number;
  /** Hour angle H = Λ − Λ_s (west-positive longitudes), deg wrapped to (−180,180]. */
  hourAngleDeg: number;
}

/** Solar elevation/azimuth at (lat, EAST-positive lon) for an already-computed Mars state. */
export function sunPositionFromState(st: MarsState, latDeg: number, lonEastDeg: number, opts: SunOptions = {}): SunPosition {
  const kind = opts.latitude ?? 'planetocentric-sphere';
  const phi = (kind === 'planetocentric-ellipsoid' ? planetographicFromPlanetocentric(latDeg) : latDeg) * DEG;
  const delta = st.declinationDeg * DEG;
  const Hdeg = westFromEast(lonEastDeg) - st.subsolarLonWestDeg;
  const H = Hdeg * DEG;
  const cosZ = Math.sin(delta) * Math.sin(phi) + Math.cos(delta) * Math.cos(phi) * Math.cos(H);
  const Z = Math.acos(Math.min(1, Math.max(-1, cosZ))) * RAD;
  const A = Math.atan2(Math.sin(H), Math.cos(phi) * Math.tan(delta) - Math.sin(phi) * Math.cos(H)) * RAD;
  const hw = mod(Hdeg + 180, 360) - 180;
  return { elevationDeg: 90 - Z, zenithDeg: Z, azimuthDeg: mod(A, 360), hourAngleDeg: hw };
}

export function sunPosition(when: Date | number, latDeg: number, lonEastDeg: number, opts: SunOptions = {}): SunPosition {
  return sunPositionFromState(marsState(when), latDeg, lonEastDeg, opts);
}

/* ------------------------------------------------------------------ sunrise / sunset */

export interface SunTimes {
  /** Local true solar noon of the sol containing `when` (UTC ms). */
  noonMs: number;
  /** Geometric sunrise/sunset (UTC ms) of that sol; null when the sun does not cross the horizon. */
  sunriseMs: number | null;
  sunsetMs: number | null;
  polar: 'day' | 'night' | null;
  /** Sun elevation at local true solar noon, deg. */
  maxElevationDeg: number;
}

/** One Mars-hour (1/24 sol) in Earth ms; 1 sol = 1.0274912517 days. */
const MARS_HOUR_MS = 1.0274912517 * 3600e3;

/**
 * Sunrise and sunset (elevation = 0, refraction and solar disc radius ignored) for the Mars sol — the LTST
 * 00:00→24:00 interval — that contains `when`. Found by scanning the sol in 15-min steps and bisecting each
 * sign change of elevation to < 0.1 s.
 */
export function sunriseSunset(latDeg: number, lonEastDeg: number, when: Date | number, opts: SunOptions = {}): SunTimes {
  const t0 = typeof when === 'number' ? when : when.getTime();
  const elev = (t: number) => sunPositionFromState(marsState(t), latDeg, lonEastDeg, opts).elevationDeg;
  // local true solar noon of the sol containing t0: LTST = 12 h (fixed-point refine; EOT varies slowly)
  let noon = t0 + (12 - ltstHours(marsState(t0), lonEastDeg)) * MARS_HOUR_MS;
  for (let k = 0; k < 3; k++) noon += (12 - ltstHours(marsState(noon), lonEastDeg)) * MARS_HOUR_MS;
  const start = noon - 12 * MARS_HOUR_MS, end = noon + 12 * MARS_HOUR_MS;
  const step = 15 * 60e3;
  let sunrise: number | null = null, sunset: number | null = null;
  let prevT = start, prevE = elev(start);
  const maxE = elev(noon);
  const bisect = (a: number, b: number, ea: number): number => {
    let lo = a, hi = b, elo = ea;
    while (hi - lo > 100) {
      const mid = (lo + hi) / 2, em = elev(mid);
      if ((em >= 0) === (elo >= 0)) { lo = mid; elo = em; } else hi = mid;
    }
    return (lo + hi) / 2;
  };
  for (let t = start + step; t <= end + step; t += step) {
    const tt = Math.min(t, end);
    const e = elev(tt);
    if ((prevE < 0) !== (e < 0)) {
      const x = bisect(prevT, tt, prevE);
      if (e >= 0) { if (sunrise === null) sunrise = x; } else if (sunset === null) sunset = x;
    }
    prevT = tt; prevE = e;
    if (tt >= end) break;
  }
  const polar = sunrise === null && sunset === null ? (elev(noon) > 0 ? 'day' : 'night') : null;
  return { noonMs: noon, sunriseMs: sunrise, sunsetMs: sunset, polar, maxElevationDeg: maxE };
}
