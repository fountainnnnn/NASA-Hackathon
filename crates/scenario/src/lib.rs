//! Scenario maths for MarsWalk Copilot.
//!
//! * `landing_monte_carlo` - Monte-Carlo touchdown scatter inside a rotated landing ellipse,
//!   sampled against a slope grid (degrees, NaN = nodata).
//! * `slope_field` - Horn 3x3 slope with per-row E-W spacing; mirrors `src/lib/terrain/slope.ts`.
//!
//! Frame (see src/lib/contracts.ts): Mars 2000 sphere R = 3,396,190 m, lon positive east,
//! row 0 = north, pixel (c, r) centre at lon = lon_min + (c + 0.5) dlon, lat = lat_max - (r + 0.5) dlat.

use wasm_bindgen::prelude::*;

pub const R_MARS: f64 = 3_396_190.0;
const DEG: f64 = std::f64::consts::PI / 180.0;

/// Histogram resolution for percentiles: 0..90 degrees in 0.1 degree bins.
const BIN_DEG: f64 = 0.1;
const N_BINS: usize = 900;

/* ------------------------------------------------------------------ RNG */

struct SplitMix64(u64);
impl SplitMix64 {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// xoshiro256** seeded through splitmix64.
struct Xoshiro256 {
    s: [u64; 4],
}
impl Xoshiro256 {
    fn new(seed: u64) -> Self {
        let mut sm = SplitMix64(seed);
        Self { s: [sm.next(), sm.next(), sm.next(), sm.next()] }
    }
    fn next_u64(&mut self) -> u64 {
        let s = &mut self.s;
        let result = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }
    /// Uniform in [0, 1) with 53 bits.
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }
}

/* ------------------------------------------------------------------ sampling */

/// Bilinear sample on pixel centres. None if outside the grid outer edges or if any contributing
/// (nonzero-weight) cell is NaN. Same semantics as `sampleElevation` in src/lib/geo/frame.ts.
#[inline]
fn bilinear(grid: &[f32], w: usize, h: usize, fc: f64, fr: f64) -> Option<f64> {
    let eps = 1e-9;
    let (wf, hf) = (w as f64, h as f64);
    if !(fc >= -0.5 - eps && fc <= wf - 0.5 + eps && fr >= -0.5 - eps && fr <= hf - 0.5 + eps) {
        return None;
    }
    let mut fc = fc.clamp(0.0, wf - 1.0);
    let mut fr = fr.clamp(0.0, hf - 1.0);
    let rc = fc.round();
    let rr = fr.round();
    if (fc - rc).abs() < eps {
        fc = rc;
    }
    if (fr - rr).abs() < eps {
        fr = rr;
    }
    let c0 = fc.floor() as usize;
    let r0 = fr.floor() as usize;
    let tc = fc - c0 as f64;
    let tr = fr - r0 as f64;
    let c1 = (c0 + 1).min(w - 1);
    let r1 = (r0 + 1).min(h - 1);
    let mut acc = 0.0f64;
    for (c, r, wt) in [
        (c0, r0, (1.0 - tc) * (1.0 - tr)),
        (c1, r0, tc * (1.0 - tr)),
        (c0, r1, (1.0 - tc) * tr),
        (c1, r1, tc * tr),
    ] {
        if wt == 0.0 {
            continue;
        }
        let v = grid[r * w + c];
        if v.is_nan() {
            return None;
        }
        acc += v as f64 * wt;
    }
    Some(acc)
}

/// Linear-interpolated percentile (0..1) from a 0.1 degree histogram of `n` valid samples.
fn hist_percentile(hist: &[u32], n: u64, q: f64) -> f64 {
    if n == 0 {
        return f64::NAN;
    }
    let target = q * n as f64;
    let mut cum = 0.0f64;
    for (i, &cnt) in hist.iter().enumerate() {
        let next = cum + cnt as f64;
        if next >= target && cnt > 0 {
            let frac = (target - cum) / cnt as f64;
            return (i as f64 + frac.clamp(0.0, 1.0)) * BIN_DEG;
        }
        cum = next;
    }
    N_BINS as f64 * BIN_DEG
}

/// Core (non-wasm-bindgen) implementation. Returns the packed vector documented on the export.
#[allow(clippy::too_many_arguments)]
pub fn landing_monte_carlo_core(
    slope: &[f32],
    width: u32,
    height: u32,
    lon_min: f64,
    lat_max: f64,
    dlon: f64,
    dlat: f64,
    center_lon: f64,
    center_lat: f64,
    semi_major_km: f64,
    semi_minor_km: f64,
    azimuth_deg: f64,
    samples: u32,
    max_slope_deg: f32,
    seed: u64,
    keep_points: u32,
) -> Vec<f32> {
    let (w, h) = (width as usize, height as usize);
    let valid_grid = w > 0 && h > 0 && slope.len() >= w * h && dlon != 0.0 && dlat != 0.0;
    let keep = keep_points.min(samples) as usize;
    let mut out: Vec<f32> = Vec::with_capacity(5 + keep * 3);
    out.extend_from_slice(&[0.0; 5]);

    let a_m = semi_major_km * 1000.0;
    let b_m = semi_minor_km * 1000.0;
    let az = azimuth_deg * DEG;
    let (saz, caz) = az.sin_cos();
    let m_per_deg_lat = R_MARS * DEG;
    let m_per_deg_lon = R_MARS * (center_lat * DEG).cos() * DEG;

    let mut rng = Xoshiro256::new(seed);
    let mut hist = vec![0u32; N_BINS];
    let (mut n_ok, mut n_nodata, mut n_valid) = (0u64, 0u64, 0u64);

    for i in 0..samples as usize {
        // uniform in unit disc, scaled to the ellipse (major axis along azimuth, clockwise from north)
        let rad = rng.next_f64().sqrt();
        let theta = std::f64::consts::TAU * rng.next_f64();
        let (st, ct) = theta.sin_cos();
        let da = a_m * rad * ct; // along major axis
        let db = b_m * rad * st; // along minor axis (azimuth + 90 deg)
        let east = da * saz + db * caz;
        let north = da * caz - db * saz;
        let lon = center_lon + east / m_per_deg_lon;
        let lat = center_lat + north / m_per_deg_lat;

        let s: Option<f64> = if valid_grid {
            let fc = (lon - lon_min) / dlon - 0.5;
            let fr = (lat_max - lat) / dlat - 0.5;
            bilinear(slope, w, h, fc, fr)
        } else {
            None
        };
        match s {
            Some(v) => {
                n_valid += 1;
                if v <= max_slope_deg as f64 {
                    n_ok += 1;
                }
                let bin = ((v / BIN_DEG) as usize).min(N_BINS - 1);
                hist[bin] += 1;
            }
            None => n_nodata += 1,
        }
        if i < keep {
            out.push(lon as f32);
            out.push(lat as f32);
            out.push(s.map_or(f32::NAN, |v| v as f32));
        }
    }

    let n = samples.max(1) as f64;
    out[0] = (n_ok as f64 / n) as f32;
    out[1] = (n_nodata as f64 / n) as f32;
    out[2] = hist_percentile(&hist, n_valid, 0.50) as f32;
    out[3] = hist_percentile(&hist, n_valid, 0.95) as f32;
    out[4] = keep as f32;
    out
}

/// Monte-Carlo touchdown scatter.
///
/// Returns `[ok_fraction, nodata_fraction, p50, p95, n_kept, (lon, lat, slope) x n_kept]`.
/// * `ok_fraction`: touchdowns with valid slope <= `max_slope_deg`, over all `samples`.
/// * `nodata_fraction`: touchdowns outside the grid or touching NaN cells, over all `samples`.
/// * `p50`/`p95`: slope percentiles over valid samples only (0.1 degree histogram, NaN if none valid).
/// * kept points are the first `min(keep_points, samples)` draws (iid, so unbiased); slope is NaN for nodata.
/// Deterministic for a given `seed` (xoshiro256** seeded by splitmix64).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn landing_monte_carlo(
    slope: &[f32],
    width: u32,
    height: u32,
    lon_min: f64,
    lat_max: f64,
    dlon: f64,
    dlat: f64,
    center_lon: f64,
    center_lat: f64,
    semi_major_km: f64,
    semi_minor_km: f64,
    azimuth_deg: f64,
    samples: u32,
    max_slope_deg: f32,
    seed: u64,
    keep_points: u32,
) -> Vec<f32> {
    landing_monte_carlo_core(
        slope, width, height, lon_min, lat_max, dlon, dlat, center_lon, center_lat,
        semi_major_km, semi_minor_km, azimuth_deg, samples, max_slope_deg, seed, keep_points,
    )
}

/// Horn 3x3 slope (degrees), per-row dx = R cos(lat_row) dlon, dy = R dlat. Border and any
/// window touching a NaN are NaN. `dlat`/`dlon` are in degrees.
pub fn slope_field_core(elev: &[f32], width: u32, height: u32, lat_max: f64, dlat: f64, dlon: f64) -> Vec<f32> {
    let (w, h) = (width as usize, height as usize);
    let mut out = vec![f32::NAN; w * h];
    if w < 3 || h < 3 || elev.len() < w * h {
        return out;
    }
    let dy = R_MARS * dlat * DEG;
    for r in 1..h - 1 {
        let lat = (lat_max - (r as f64 + 0.5) * dlat) * DEG;
        let dx = R_MARS * lat.cos() * dlon * DEG;
        let k = 1.0 / 8.0;
        for c in 1..w - 1 {
            let i = r * w + c;
            let g = |j: usize| elev[j] as f64;
            let (a, b, cc) = (g(i - w - 1), g(i - w), g(i - w + 1));
            let (d, e, f) = (g(i - 1), g(i), g(i + 1));
            let (gg, hh, ii) = (g(i + w - 1), g(i + w), g(i + w + 1));
            let sum = a + b + cc + d + e + f + gg + hh + ii;
            if sum.is_nan() {
                continue;
            }
            let dzdx = ((cc + 2.0 * f + ii) - (a + 2.0 * d + gg)) * k / dx;
            let dzdy = ((gg + 2.0 * hh + ii) - (a + 2.0 * b + cc)) * k / dy;
            out[i] = (dzdx.hypot(dzdy).atan() / DEG) as f32;
        }
    }
    out
}

/// Horn slope field; see `slope_field_core`. Matches `computeSlopeField` in src/lib/terrain/slope.ts.
#[wasm_bindgen]
pub fn slope_field(elev: &[f32], width: u32, height: u32, lat_max: f64, dlat: f64, dlon: f64) -> Vec<f32> {
    slope_field_core(elev, width, height, lat_max, dlat, dlon)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(grid: &[f32], seed: u64, n: u32) -> Vec<f32> {
        // 100x100 grid over lon 77.3..77.4, lat 18.5..18.4 (synthetic test fixture)
        landing_monte_carlo_core(grid, 100, 100, 77.3, 18.5, 0.001, 0.001, 77.35, 18.45, 2.0, 1.0, 30.0, n, 10.0, seed, 50)
    }

    #[test]
    fn deterministic() {
        let g = vec![3.0f32; 10_000];
        assert_eq!(run(&g, 7, 5000), run(&g, 7, 5000));
        assert_ne!(run(&g, 7, 5000), run(&g, 8, 5000));
    }

    #[test]
    fn flat_ok_and_steep_not() {
        let flat = vec![3.0f32; 10_000];
        let r = run(&flat, 1, 4000);
        assert_eq!(r[0], 1.0);
        assert_eq!(r[1], 0.0);
        assert!((r[2] - 3.0).abs() < 0.11);
        let steep = vec![25.0f32; 10_000];
        assert_eq!(run(&steep, 1, 4000)[0], 0.0);
    }

    #[test]
    fn nodata_counted() {
        let g = vec![f32::NAN; 10_000];
        let r = run(&g, 1, 1000);
        assert_eq!(r[1], 1.0);
        assert!(r[2].is_nan());
    }

    #[test]
    fn flat_dem_has_zero_slope() {
        let e = vec![-2000.0f32; 50 * 50];
        let s = slope_field_core(&e, 50, 50, 18.5, 0.0003, 0.0003);
        assert_eq!(s[25 * 50 + 25], 0.0);
        assert!(s[0].is_nan());
    }
}
