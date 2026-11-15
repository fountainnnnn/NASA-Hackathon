# Science and validation

HeyMars is a planning model. Under stated assumptions it estimates whether a walk or a landing site is plausible. It is not a NASA EVA, life-support or EDL model and does not certify safety.

Test results on this page are from `npm test` on 15 Nov 2026 (519 of 519 passed, 49 files) and the last recorded Playwright run (15 of 15 passed).

## Coordinates

Mars 2000 sphere, R = 3,396,190 m, planetocentric latitude, east-positive longitude, heights above the MOLA areoid.

    x = R cos(phi_c) (lambda - lambda_c) pi/180        (east)
    z = -R (phi - phi_c) pi/180                        (south is +z)
    y = (h - h_ref) * exaggeration                     (up)

Ground distances use per-row spacing: dx = R cos(phi) d_lambda, dy = R d_phi (radians). Picking inverts the transform and then samples the true DEM, not the exaggerated mesh.

## Slope

Horn (1981) 3x3 gradient on the 20 m DEM:

    dz/dx = ((z3 + 2 z6 + z9) - (z1 + 2 z4 + z7)) / (8 dx)
    dz/dy = ((z7 + 2 z8 + z9) - (z1 + 2 z2 + z3)) / (8 dy)
    slope = atan( sqrt( (dz/dx)^2 + (dz/dy)^2 ) )

Cells with a nodata neighbour are nodata. Global slope uses central differences on the 1/8 degree MOLA grid, a baseline of about 14.8 km.

## Planning grid

40 m cells from 2x2 blocks of the 20 m DEM. Elevation is the mean. Slope is the maximum of the four sub-cell slopes, which is conservative.

## Routing

8-connected A* with an admissible heuristic.

- An edge is allowed only if both cells are valid, its grade |dh / d_horiz| is at most tan(limit), and both cells' maximum slope is at most the limit. The start and target cells are held to the same rule, so a path from a to b exists exactly when one from b to a does.
- Edge length (3D): sqrt(d_horiz^2 + dh^2).
- Objective `shortest`: cost = 3D length. Objective `fastest` (default): cost = time.
- Walking speed, Tobler (1993) scaled for a suited crew:

      v = f_suit x 6 x exp(-3.5 x |tan(theta) + 0.05|)  km/h

  where theta is the signed edge slope (uphill positive) and f_suit = 0.6.
- Outbound and return legs are solved separately. A plan is all or nothing: if any leg has no path, the plan has no legs and zero totals, and nothing is drawn. The round trip is always the sum of its legs.
- With no path, the solver retries in 1 degree steps up to 45 degrees and reports the smallest limit that works. "Pick nearest reachable point" floods out with the same rules and moves the target to the nearest reachable 40 m cell within 1 km, saying how far it moved.

## Resources

    walk time            t_walk = sum of edge length / v
    EVA time             t_eva  = t_walk + dwell
    battery used (%)     = P_suit x t_eva / C_batt x 100        (t in h, C in Wh)
    battery at return    = 100 - battery used
    climb work (kJ)      = m x g x ascent / 1000,   g = 3.721 m/s^2

Climb work is shown as a lower bound on effort and is not part of the battery model. A battery failure gives a turn-back vertex where the reserve would be reached.

## Comms line of sight

From the base mast (default 10 m) to a suit antenna (1.8 m) at each route vertex, sampled along the ray every half DEM cell (10 m) with bilinear heights. The terrain at distance d along a ray of length D is lowered by the curvature of the Mars sphere:

    curvature drop at d = d (D - d) / 2R          (the end-to-end drop is D^2 / 2R)
    visible  if  (z(d) - E) / d - d / 2R  <=  (T - E) / D - D / 2R   for every sample

where E and T are the eye and target heights above the areoid. Hidden vertices are grouped into shadow stretches. Any stretch longer than 0.5 km is no-go, a shorter one is a caution. Nodata on the ray counts as blocked. The same test between the two suits (the second walks 4 m behind the first on the same path) is run every 30 s of a walk and shown as the "Crew in sight of each other" row with the longest hidden stretch. It is not part of the verdict, and at 20 m the terrain cannot show boulders between them.

## Sun and local time

Mars24 (Allison and McEwen 2000, NASA GISS): Mars sol date, areocentric solar longitude Ls, equation of time, local mean and true solar time, solar declination and the sun's elevation and azimuth at each route sample. The daylight check needs the sun at or above 0 degrees at every sample from the start to the end of the last dwell, and reports the margin to sunset at return. Refraction, dust opacity and terrain shading are not modelled.

The EVA start defaults to the next 09:00 local true solar time at the base after the page opens (`DEFAULT_START_LTST_H` in `src/state/hud.ts`), so a normal walk is planned in daylight whatever the time of day the app is opened. Limits offers Now, 09:00 and Local noon.

## Earth link

    one-way light time = range / c = range (au) x 499.005 s/au

Range and Earth's azimuth and elevation at Jezero come from tabulated JPL Horizons queries, interpolated linearly. On 15 Nov 2026 the one-way light time is 10.95 min (tested). The panel reports whether Earth is above the horizon during the EVA.

## Go / no-go

| Check | No-go | Caution |
| --- | --- | --- |
| Slope | no path under the limit | maximum slope at or above 80 % of the limit |
| Battery | battery at return below the reserve | within 10 percentage points of the reserve |
| EVA time | over the EVA limit | over 85 % of the limit |
| Daylight | sun below 0 degrees at any sample | lowest sun within 5 degrees of the minimum, or not evaluated |
| Comms | a shadow stretch over 0.5 km | a shorter shadow, or no station |
| Data | a route vertex without DEM data, or an unreachable endpoint | missing inputs |

The worst item sets the verdict: GO, HOLD (caution) or NO GO, shown with its single limiting reason. Blockers and cautions are numbered in one order (blockers first, and within each group the radio shadow first because it is the stretch drawn on the map); the card rows, the map label and the headline all use that order.

## Landing

- **Criteria.** 8 criteria quoted from the MSL Landing Site Selection User's Guide to Engineering Constraints (JPL, 2006): latitude within 60 degrees, elevation at most +2,000 m above the MOLA areoid, slope at most 3 degrees over 2 to 5 km, thermal inertia above 100 (load-bearing surface), slope at most 5 degrees over 200 to 500 m, at most 15 degrees over 20 to 40 m and over 5 m, and rock abundance around 10 % or less. The first four are required; the 2 to 5 km slope is not scored because the global slope baseline is about 14.8 km. The last four need rover-scale data and are shown as no data. These are Curiosity constraints used as a reference. The Mars 2020 limits could not be confirmed from a NASA page and are not used.
- **Monte Carlo.** Touchdown offsets are a 2-D Gaussian in the ellipse frame with 3 sigma at the semi-axes (3.85 and 3.3 km), truncated at the ellipse by rejection, 10,000 seeded draws. The slope at each touchdown is read from the terrain under it and compared with a user-set limit (default 15 degrees, an assumption). Rust compiled to WebAssembly, with a TypeScript fallback.
- **EDL timeline.** 11 phases from the NASA/JPL Mars 2020 landing press kit, from cruise stage separation (-600 s) to touchdown (420 s). Times stated relative to another event are added up and marked derived. Terrain-Relative Navigation is shown only between 4.2 and 2.2 km altitude. The approach track on the globe is schematic.

## Reach and rover assist

- Base camp reach: 24 round trips from base on evenly spaced bearings. Contours are labelled in minutes of battery reserve at turn-back. Battery, EVA time and slope are applied, and so is daylight: the EVA clock is the EVA limit or the time until the sun at the base drops below 0 degrees after the planned start (Mars24), whichever is shorter. Comms is not applied to reach; it is checked per route, so a point inside the reach can still be NO GO for a radio shadow.
- Rover assist: the rover carries the crew part of the way at an assumed 10 km/h. The suit stays powered while riding.

## Assumptions

Defaults from `src/lib/contracts.ts` (`DEFAULT_CONSTRAINTS`), `src/lib/ops/assumptions.ts`, `src/state/hud.ts` and `src/components/Scenario/model.ts`. None is from a NASA suit specification. The suit and limit values can be changed under Limits, and every one is labelled "assumption" in the panel and the report.

| Constant | Value | Where | Class |
| --- | --- | --- | --- |
| Maximum slope | 15 degrees | contracts.ts | Assumption |
| Battery reserve | 20 % | contracts.ts | Assumption |
| EVA limit | 360 min | contracts.ts | Assumption |
| Dwell at target | 30 min | contracts.ts | Assumption |
| Suit power | 250 W | contracts.ts | Assumption |
| Battery capacity | 2,000 Wh | contracts.ts | Assumption |
| Crew, suit and kit mass | 180 kg | contracts.ts | Assumption |
| Suit speed factor | 0.6 of Tobler | contracts.ts | Assumption |
| Objective | fastest | contracts.ts | Default |
| Base comms mast | 10 m (range 2 to 30 m) | hud.ts | Assumption |
| EVA start | next 09:00 local true solar time at the base | hud.ts | Assumption |
| Station mast when none is given | 2 m | assumptions.ts | Assumption |
| Suit antenna height | 1.8 m | assumptions.ts | Assumption |
| Comms no-go shadow | 0.5 km | assumptions.ts | Assumption |
| Minimum sun elevation | 0 degrees | assumptions.ts | Assumption |
| Sun caution margin | 5 degrees | assumptions.ts | Assumption |
| Slope caution | 80 % of the limit | assumptions.ts | Assumption |
| Battery caution | within 10 points of the reserve | assumptions.ts | Assumption |
| EVA caution | over 85 % of the limit | assumptions.ts | Assumption |
| Cuff card: turn | 30 degrees | assumptions.ts | Assumption |
| Cuff card: simplify tolerance | 40 m | assumptions.ts | Assumption |
| Cuff card: maximum rows | 12 | assumptions.ts | Layout choice |
| Rover cruise speed | 10 km/h | model.ts | Assumption |
| Crew pair separation | 4 m | model.ts | Assumption |
| Landing slope limit | 15 degrees | user set | Assumption |
| Landing ellipse azimuth | 0 degrees | landing_criteria.json | Assumption (not published) |
| Tobler coefficients | 6, -3.5, 0.05 | literature | Published for Earth hikers, applied to Mars |
| Surface gravity | 3.721 m/s^2 | NASA Mars Fact Sheet | Observed |

## Validation

| Check | Result | File |
| --- | --- | --- |
| 20 m DEM vs 708 Perseverance waypoints (DEM minus waypoint) | median -1.06 m, mean -0.89 m, standard deviation 3.25 m, 95th percentile of absolute value 6.44 m, maximum 11.72 m; 0 skipped | `data/validation.json` |
| Landing waypoint, sol 13 | +2.46 m | `data/validation.json` |
| Global MOLA grid vs 20 m model at the Perseverance site | -2,555.7 m vs -2,567 m, difference 11.3 m (one MOLA cell averages floor, rim and plain) | `data/global_validation.json` |
| Global extremes | Olympus Mons 21,159 m, Hellas -8,135 m | `data/global_validation.json` |
| Mars24 | matches the NASA GISS worked examples (time scales, orbital terms, EOT, LMST, LTST, declination, zenith and azimuth) | `tests/ops/mars24.test.ts` |
| Horizons light time | 10.95 min one way on 15 Nov 2026; light time equals range / c at every sample | `tests/ops/earthLink.test.ts` |

The waypoint check compares two NASA products, so it shows agreement, not ground truth. The five largest residuals cluster on steep ground near 77.258 E, 18.462 N, which points to local relief rather than a georeferencing offset.

## Tests

`npm test` (Vitest): 519 tests in 49 files, all passing on 15 Nov 2026. Fixtures are synthetic and labelled as test data, never shown as NASA data.

| Area | Tests | What they check |
| --- | --- | --- |
| Terrain (`tests/terrain`) | 32 | Transform round trip under 1e-6 m; DEM decoding; Horn slope on planes of known slope; no edge or cell over the limit across random pairs; `solvePath(a, b).ok === solvePath(b, a).ok`; all-or-nothing plans; round trip equals the sum of legs; match with brute-force Dijkstra; reserve flips feasibility; smallest feasible slope; nearest reachable point; solve under 1.5 s on an 800x800 grid |
| Ops (`tests/ops`) | 94 | Mars24 vs NASA GISS; Horizons light time and Earth rise and set; line of sight with curvature, ridges, nodata and crew pairs; go/no-go bands; cuff card |
| Agent (`tests/agent`) | 59 | Tool schemas and executors, globe tools, explain formulas, runner limits, number guard (flags a planted number, accepts unit conversions) |
| Global science and scenario (`tests/globalSci`, `tests/scenario`, `tests/wasm`) | 104 | Landing criteria, Monte Carlo statistics, Rust/WASM vs TypeScript within histogram resolution, timeline, playback, reach, chase camera, landing |
| Planet (`tests/planet`) | 32 | CesiumJS version and SRI hash, terrain datum offset, EDL descent (TRN only between 4.2 and 2.2 km, every phase cited), imagery fusion |
| Scene, science, globe, companion, report | 114 | Command reducer, context terrain, geology and site lookups, rover image selection, globe reducer, companion state, report model and exports |

Browser tests (Playwright, `npm run e2e`): 15 tests. They cover the intro, shell layout, panel toggle, globe click with the synced card and panel turn, landing check narration, a Jezero drag with formulas and a maths follow-up, report scroll lock and real file exports, walk and helmet view, the Sources sheet, the Limits popover, the steep-target no-path card, and that every red card row really fails its limit. The last recorded run passed 15 of 15.

Layout QA (`scripts/qa-layout.mjs`): overlap, clipping, contrast of at least 4.5:1 and keyboard reach for every state at 1440x810, 1280x720, 1024x768 and 390x844. The e2e suite runs it at 1440x810 and it passed. TODO(verify): result of the last full four-viewport run.

Not done: a paid live test of the language model's tool choice.

## Limitations

- The 20 m DEM cannot resolve boulders, small craters or scarps. A route marked feasible can still cross obstacles.
- Slopes are averaged over the cell, so short steep faces are under-reported. The 2x2 maximum reduces this but does not remove it.
- CTX imagery is 6 m per pixel at best. The app does not add synthetic detail.
- Outside the 20 m Jezero patch, terrain comes from global products. The MOLA grid is about 7.4 km per cell, larger than a landing ellipse, so the landing Monte Carlo there describes the region, not the touchdown spots. The app says "Coarse terrain only" in that case.
- Tobler's function is for Earth hikers. The suit factor is a guess, not a measurement.
- Battery is a linear power-times-time model. It leaves out terrain-dependent metabolic load, thermal load and consumables such as oxygen.
- Comms is line of sight from one mast. No relay, orbiter pass or radio propagation model.
- No radiation, live weather or dust.
- THEMIS brightness is relative and uncalibrated. The TES dust layer is display only.
- Geologic maps are interpretations at 1:75,000 and 1:20,000,000.
- The agent's prose can be wrong. The number guard checks numbers, not reasoning.

## References

- Allison, M. and McEwen, M., 2000. Planetary and Space Science 48, 215-235. https://www.giss.nasa.gov/tools/mars24/
- Boynton, W.V. et al., 2007. JGR 112, E12S99.
- Hart, P.E., Nilsson, N.J. and Raphael, B., 1968. IEEE Trans. SSC 4(2), 100-107.
- Horn, B.K.P., 1981. Proc. IEEE 69(1), 14-47.
- JPL, 2006, MSL Landing Site Selection User's Guide to Engineering Constraints. https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf
- NASA/JPL, Mars 2020 Perseverance Landing Press Kit. https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/
- NASA JPL Horizons. https://ssd.jpl.nasa.gov/horizons/
- NASA Mars Fact Sheet. https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html
- Putzig, N.E. and Mellon, M.T., 2007. Icarus 191, 68-94.
- Ruff, S.W. and Christensen, P.R., 2002. JGR 107(E12), 5127.
- Sun, V.Z. and Stack, K.M., 2020, USGS SIM 3464. https://pubs.usgs.gov/publication/sim3464
- Tanaka, K.L. et al., 2014, USGS SIM 3292. https://pubs.usgs.gov/sim/3292/
- Tobler, W., 1993. NCGIA Technical Report 93-1.
