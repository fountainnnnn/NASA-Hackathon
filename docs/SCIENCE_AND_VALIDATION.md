# Science and validation (DRAFT)

None of the test results below have been confirmed. Each says `TODO(verify)` until a run is pasted in with its date.

## Model summary

An educational planning model. It estimates, under stated assumptions, whether a walk is plausible. It is not a NASA EVA or life-support model and does not certify safety.

## Coordinates

Mars 2000 sphere, R = 3,396,190 m, east-positive longitude, heights above the areoid.

    x = R cos(phi_c) (lambda - lambda_c) pi/180        (east)
    z = -R (phi - phi_c) pi/180                        (south is +z)
    y = (h - h_ref) * exaggeration                     (up)

Analysis distances use per-row ground spacing: dx = R cos(phi_row) d_lambda (radians), dy = R d_phi (radians). Picking inverts the transform, then samples the true DEM.

## Slope

Horn (1981) 3x3 gradient on the 20 m DEM:

    dz/dx = ((z3 + 2 z6 + z9) - (z1 + 2 z4 + z7)) / (8 dx)
    dz/dy = ((z7 + 2 z8 + z9) - (z1 + 2 z2 + z3)) / (8 dy)
    slope = atan( sqrt( (dz/dx)^2 + (dz/dy)^2 ) )

Cells with any nodata neighbour are nodata.

## Planning grid

40 m cells from 2x2 blocks of the 20 m DEM. Elevation is the mean. Slope is the maximum of the four sub-cell slopes, which is conservative.

## Routing

8-connected A* with an admissible heuristic.

- An edge between two cells is allowed only if both cells are valid, the edge grade |dh / d_horiz| is at most tan(limit), and the entered cell's maximum slope is at most the limit.
- Edge length (3D): sqrt(d_horiz^2 + dh^2). Diagonals use true ground distance.
- Objective `shortest`: cost = 3D length.
- Objective `fastest`: cost = time = length / v, with the Tobler (1993) hiking function

      v = 6 exp(-3.5 |tan(theta) + 0.05|) km/h  times  f_suit

  where theta is the edge slope (signed, uphill positive) and f_suit is an assumed suit factor.
- The route solves outbound and return separately. A round trip is not assumed to be the outbound path reversed.
- If no path exists at the limit, the solver retries in 1 degree steps up to 45 degrees and reports the smallest limit that gives a path.

## Resources

    walk time        t_walk = sum of edge times
    EVA time         t_eva = t_walk + n_stops * t_dwell
    battery used (%) = P_suit * t_eva / C_batt * 100       (t in hours, C in Wh)
    climb work (kJ)  = m * g * ascent / 1000,   g = 3.721 m/s^2

Feasible if and only if a path exists AND battery used is at most 100 minus the reserve AND t_eva is at most the EVA limit. Otherwise the result lists reasons from `no_path_slope`, `battery_reserve`, `eva_time`, `nodata_endpoint`, `out_of_bounds`. For a battery failure it gives a turn-back vertex where the reserve would be reached.

Climb work is reported for information and is not part of the battery model.

## Assumptions

All are editable in the app and shown with an "Assumption" label. None is from a NASA suit specification.

| Constant | Default | Why | Class |
| --- | --- | --- | --- |
| Max slope | 15 degrees | Round conservative number for walking on loose ground. Not a NASA limit. | Assumption |
| Battery reserve | 20% | Common planning margin. | Assumption |
| EVA limit | 360 min | Order of magnitude of a long surface EVA. | Assumption |
| Dwell per stop | 30 min | Time for sampling and observation. | Assumption |
| Suit power | 250 W | Order of magnitude for life support and cooling. | Assumption |
| Battery capacity | 2000 Wh | Chosen so that default walks use a plausible fraction. | Assumption |
| Crew + suit + kit mass | 180 kg | Rough total mass. | Assumption |
| Suit speed factor | 0.6 | Suited walking is slower than unsuited Tobler speed. | Assumption |
| Tobler coefficients | 6, -3.5, 0.05 | Published hiking function for Earth terrain. | From the literature, applied to Mars (an extrapolation) |
| Surface gravity | 3.721 m/s^2 | NASA Mars Fact Sheet. | Observed (NASA) |

## Tests

Run `npm test` (Vitest). Fixtures are synthetic and labelled as test fixtures, never shown as NASA data. TODO(verify): paste the real run and date here.

| Test | What it checks | Result |
| --- | --- | --- |
| Transform round trip | lon/lat to local metres and back is within 1 mm | TODO(verify) |
| DEM sampling | bilinear sample matches known cells, null at nodata | TODO(verify) |
| Horn slope | a plane of known slope returns that slope | TODO(verify) |
| No blocked edge | no route edge exceeds the slope limit or enters a nodata cell | TODO(verify) |
| Length | route length equals the sum of segment lengths | TODO(verify) |
| Maximum slope | route max slope equals an independent recompute from the height grid | TODO(verify) |
| Slope sensitivity | tightening the limit changes the route or returns no path | TODO(verify) |
| Endpoint sensitivity | changing the destination changes the route endpoint | TODO(verify) |
| Reserve sensitivity | raising the reserve flips feasibility | TODO(verify) |
| Nodata | nodata endpoints are rejected cleanly | TODO(verify) |
| Commands | the reducer rejects unknown commands | TODO(verify) |
| Number guard | a planted number in an answer is flagged | TODO(verify) |
| Geology lookup | correct unit at known unit centroids | TODO(verify) |
| Browser e2e (Playwright) | click, pin position, layer toggles, route, replan | TODO(verify) |
| Solve time | route solve under 1.5 s | TODO(verify) |
| Agent tool selection (paid, live) | 10 prompts, correct tools at least 9 of 10 | TODO(verify) |

## Data validation

`data/validation.json`: DEM elevation sampled at Perseverance waypoints against the waypoints' recorded elevations. TODO(verify): n, mean residual (m), standard deviation (m), max absolute residual (m). Interpretation to add after the numbers exist.

## Limitations

- A 20 m DEM cannot resolve boulders, small craters or scarps. A route marked feasible can still cross obstacles.
- Slopes are averaged over the baseline, so short steep faces are under-reported. The 2x2 maximum reduces but does not remove this.
- Tobler's function is for Earth hikers. The suit factor is a guess, not a measurement.
- Battery is a linear power-times-time model. It does not include terrain-dependent metabolic load, thermal load or consumables such as oxygen.
- No radiation, dust, weather, communications or illumination model.
- THEMIS brightness is relative and uncalibrated.
- The geologic map is a 1:75,000 interpretation.
- The agent's prose can be wrong. The number guard checks numbers, not claims.

## References

- Horn, B.K.P., 1981, Hill shading and the reflectance map. Proc. IEEE 69(1), 14-47.
- Hart, P.E., Nilsson, N.J., Raphael, B., 1968, A formal basis for the heuristic determination of minimum cost paths. IEEE Trans. SSC 4(2), 100-107.
- Tobler, W., 1993, Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1.
- NASA Mars Fact Sheet. https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html
- Sun, V.Z., Stack, K.M., 2020, USGS SIM 3464. https://pubs.usgs.gov/publication/sim3464
