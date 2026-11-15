# EVA plan: base to 18.434N 77.393E, Jezero Crater

Round trip from the Octavia E. Butler landing site, prepared for surface operations review.

Report HM-2026-11-15-R1, generated 2026-11-15 08:56 UTC.

**Verdict: NO GO.** Radio shadow of 2.8 km with no line of sight to base from a 10 m mast.

## 1. Summary and verdict

1 blocker. Radio shadow of 2.8 km with no line of sight to base from a 10 m mast.

| Item | Value | Limit | Status |
| --- | ---: | ---: | --- |
| Round trip distance | 7.08 km | n/a | info |
| EVA duration incl. 30 min at target | 2 h 52 min | 6 h 00 min | pass |
| Suit battery at return | 64.2 % | >= 20 % | pass |
| Maximum slope on route | 5.3° | <= 15° | pass |
| Longest comms shadow | 2.77 km | <= 0.5 km | fail |
| Daylight margin at return | 6 h 36 min | >= 0 | pass |

| Landing criterion | Value | Limit | Status |
| --- | ---: | --- | --- |
| Latitude band | 20.01° | \|latitude\| <= 60° | pass |
| Landing-site elevation (MOLA areoid) | -263.16 m | elevation <= +2000 m above the MOLA areoid | pass |
| Regional slope (2-5 km length scale) | 0.37° (estimate) | slope <= 3° over a 2-5 km length scale | pass |
| Thermal inertia (not dust-dominated) | 331 J m-2 s-0.5 K-1 | thermal inertia > 100 J m-2 s-0.5 K-1 | pass |
| Slope at 200-500 m length scale | 0.66° (estimate) | slope <= 5° over a 200-500 m length scale | pass |
| Slope at 20-40 m length scale | 1.23° (estimate) | slope <= 15° over a 20-40 m length scale | pass |
| Slope at 5 m length scale | 1.92° (estimate) | slope <= 15° over a 5 m length scale | pass |
| Rock abundance (damaging rocks under the rover) | 6.5 % area (Mock) | rock abundance of around 10% or less (less than 0.25% chance of a rock taller than 0.6 m in a 4 m2 area) | pass |

| Landing simulation | Value |
| --- | ---: |
| Site | 20.013N 72.000E |
| Ellipse | 7.7 by 6.6 km (semi-axes 3.85 and 3.3 km) |
| Simulated touchdowns | 10,000 |
| Touchdowns on ground at or under 15° (assumption) | 100 % |
| Median / 95th percentile slope | 0.3° / 0.3° |
| Terrain model | global DEM, ~7.4 km posting |

| Science at target | Value | Source |
| --- | --- | --- |
| Geologic unit | Eolian bedform unit (Aeb) | USGS SIM 3464, observed |
| Nearest catalogued science site | Three Forks sample depot, 1.39 km | Perseverance's 'Three Forks' Sample Depot Map |
| View from the ground | Sol 418, Navigation Camera Right, 1.03 km from the target, 2022-04-24: https://mars.nasa.gov/mars2020/multimedia/raw-images/NRF_0418_0704059288_987ECM_N0232096NCAM02418_01_195J | NASA/JPL-Caltech, Perseverance raw image |

## 2. Inputs and constraints

| Parameter | Value | Type |
| --- | ---: | --- |
| Start (base) | 18.4446N 77.4509E, -2,567 m | observed, Perseverance waypoint sol 13 |
| Target | 18.4340N 77.3927E, -2,521 m | computed, CTX DEM bilinear |
| Max slope | 15° | assumption, default |
| Battery reserve | 20 % | assumption, default |
| EVA time limit | 6 h 00 min | assumption, default |
| Dwell at the target | 30 min | assumption, default |
| Suit power / battery capacity | 250 W / 2,000 Wh | assumption, not a NASA suit spec |
| Suit speed factor | 0.6 × Tobler | assumption |
| Crew, suit and kit mass | 180 kg | assumption |
| Comms mast / suit antenna | 10 m / 1.8 m | assumption |
| EVA start | 2026-11-15 16:04 UTC, 09:00 local solar time at the base | assumption: default 09:00 local solar time at the base, or user set |
| Gravity | 3.721 m/s² | observed, NASA Mars Fact Sheet |

## 3. Route legs

| Leg | Length | Ascent | Max slope | Walk time |
| --- | ---: | ---: | ---: | ---: |
| Outbound | 3.54 km | 66.5 m | 5.3° | 1 h 14 min |
| Return | 3.54 km | 21.7 m | 4.7° | 1 h 08 min |
| Round trip (sum of legs) | 7.08 km | 88.2 m | 5.3° | 2 h 22 min |

A* on a 40 m grid derived from the 20 m MRO CTX DEM; path snapped to cell centres. The GeoJSON export carries every leg with per-vertex elevation.

## 4. Calculations

**4.1 Walking speed and EVA duration (Tobler 1993, scaled for a suited crew)**

```
v(θ) = f × 6 km/h × e^(-3.5 × |tan θ + 0.05|)
outbound: tan θ = (67 - 20) m ÷ 3,538 m = 0.013  →  v = 0.6 × 6 × e^(-3.5 × |0.013 + 0.05|) = 2.89 km/h
return: tan θ = (22 - 68) m ÷ 3,538 m = -0.013  →  v = 0.6 × 6 × e^(-3.5 × |-0.013 + 0.05|) = 3.16 km/h
t = Σ segment length ÷ v(θ segment) + dwell = 74 min + 68 min + 30 min = 2 h 52 min
```

**4.2 Suit battery**

```
used = P × t ÷ C = 250 W × 2.87 h ÷ 2,000 Wh = 35.8 %
left = 100 % - 35.8 % = 64.2 %  (reserve 20 %)  pass
```

**4.3 Mechanical work of climbing (lower bound on effort)**

```
W = m × g × ascent = 180 kg × 3.721 m/s² × 88.2 m = 59 kJ
```

**4.4 Comms line of sight with planetary curvature**

```
mast 10 m (assumption), suit antenna 1.8 m, ray sampled every 10 m
curvature drop = d² ÷ 2R = (3,318 m)² ÷ (2 × 3,396,190 m) = 1.62 m
3 hidden stretches, longest vertices 67 to 130, 2.77 km
limit 0.5 km per stretch  fail
```

**4.5 Sun position (NASA GISS Mars24, Allison and McEwen 2000)**

```
Mars24: MSD 54,344.2, Ls 22.4°, LTST 09:00 at the start
sun elevation 46° at the start, 80° at the end, lowest 46°
sunset 18:12 LTST, daylight margin at return 6 h 36 min  pass
```

**4.6 Earth link (NASA JPL Horizons)**

```
one-way light time = range ÷ c = 1.312876 au × 499.005 s/au = 655.1 s = 10.9 min
```

**4.7 Landing criteria at 20.013N 72.000E**

```
Latitude band: 20.01° vs limit |latitude| <= 60°  pass
Landing-site elevation (MOLA areoid): -263.16 m vs limit elevation <= +2000 m above the MOLA areoid  pass
Regional slope (2-5 km length scale): 0.37° (estimate: Regional slope (2-5 km length scale): MOLA slope 0.26° at a ~14.8 km baseline scaled to 3.5 km as s(L) = s(L0) * (L0 / L)^(1 - H), H = 0.75 (assumption)) vs limit slope <= 3° over a 2-5 km length scale  pass
Thermal inertia (not dust-dominated): 331 J m-2 s-0.5 K-1 vs limit thermal inertia > 100 J m-2 s-0.5 K-1  pass
Slope at 200-500 m length scale: 0.66° (estimate: Slope at 200-500 m length scale: MOLA slope 0.26° at a ~14.8 km baseline scaled to 350 m as s(L) = s(L0) * (L0 / L)^(1 - H), H = 0.75 (assumption)) vs limit slope <= 5° over a 200-500 m length scale  pass
Slope at 20-40 m length scale: 1.23° (estimate: Slope at 20-40 m length scale: MOLA slope 0.26° at a ~14.8 km baseline scaled to 30 m as s(L) = s(L0) * (L0 / L)^(1 - H), H = 0.75 (assumption)) vs limit slope <= 15° over a 20-40 m length scale  pass
Slope at 5 m length scale: 1.92° (estimate: Slope at 5 m length scale: MOLA slope 0.26° at a ~14.8 km baseline scaled to 5 m as s(L) = s(L0) * (L0 / L)^(1 - H), H = 0.75 (assumption)) vs limit slope <= 15° over a 5 m length scale  pass
Rock abundance (damaging rocks under the rover): 6.5 % area (mock: mock rock abundance, seeded by lon/lat, 3 to 12 % around the Mars median of about 6 % (Nowicki & Christensen 2007)) vs limit rock abundance of around 10% or less (less than 0.25% chance of a rock taller than 0.6 m in a 4 m2 area)  pass
```

**4.8 Landing Monte Carlo**

```
ellipse 7.7 by 6.6 km (semi-axes 3.85 and 3.3 km); dispersion: truncated 2-D Gaussian, 3σ = semi-axes, azimuth 0°
ok fraction = N_ok ÷ N = 10,000 ÷ 10,000 = 100 %  at or under 15°
slope p50 0.3°, p95 0.3°, terrain global DEM, ~7.4 km posting, engine ts
```

## 5. Go / no-go rules

| Check | Rule | Source | Status |
| --- | --- | --- | --- |
| Slope | every edge and cell <= limit; caution at 80 % of it | CTX DEM, Horn slope | go |
| Battery | left >= reserve; caution within 10 points | assumed suit model | go |
| EVA time | t <= limit; caution above 85 % | user limit | go |
| Daylight | sun >= 0° for the whole EVA | Mars24 | go |
| Comms | no single shadow > 0.5 km | viewshed, assumed rule | no-go |
| Data | every route vertex has DEM data | CTX DEM coverage | go |

## 6. Data sources and validation

| Dataset | Mission / instrument | Use |
| --- | --- | --- |
| JEZ CTX DTM 20 m, controlled (JPL Mars Trek) | MRO CTX | elevation, slope, routes, comms |
| JEZ CTX ortho mosaic 6 m | MRO CTX | imagery |
| SIM 3464 geologic map (Sun and Stack 2020) | USGS / NASA | units at stops |
| Perseverance waypoints and raw images | Mars 2020 | base position, validation, photos |
| Horizons ephemeris | NASA JPL | Earth light time and visibility |
| Mars24 sunclock algorithm | NASA GISS | local solar time and sun elevation |
| Mars 2020 EDL timeline | NASA JPL | landing simulation phases |

Validation: DEM heights agree with 708 Perseverance waypoints, median offset 1.1 m, mean bias -0.9 m, 95th percentile |difference| 6.4 m.

## 7. Assumptions and limits

- The 20 m DEM cannot resolve boulders or small scarps; slopes are averaged over the baseline.
- Walking speed, suit power and battery are stated assumptions, not a NASA EVA or life-support model.
- Comms uses line of sight from a mast on the habitat; mast and antenna heights are assumptions and no relay or orbiter pass is modelled.
- Daylight uses geometric sun elevation from Mars24; no refraction, dust opacity or terrain shading.
- No live weather, dust or radiation data.
- Feasible means feasible under this model, not certified safe.

## 8. Agent trace

| # | Step | Kind | Time |
| --- | --- | --- | ---: |
| 1 | Asked on the map: What is here? | input | 08:54:52 |
| 2 | get_site_conditions | tool | 61 ms |
| 3 | Asked on the map: Could we land here? | input | 08:54:53 |
| 4 | Filled values | deterministic | under 1 ms |
| 5 | check_landing_site | tool | 63 ms |
| 6 | Meets every listed criterion (includes estimates): latitude band pass, landing-site elevation (mola areoid) pass, regional slope (2-5 km len | deterministic | under 1 ms |
| 7 | Used a tool: Run landing simulation | input | 08:54:53 |
| 8 | show_edl_timeline | tool | 54 ms |
| 9 | run_landing_scenario | tool | 0.98 s |
| 10 | Landing verdict: GO (includes estimates): 100.0 % of touchdowns land within 15° (GO needs 99 %) and 0.0 % have no data. The terrain cell is  | deterministic | under 1 ms |
| 11 | Used a tool: Take me to Jezero | input | 08:55:33 |
| 12 | Dragged on the map: Plan a round trip from base to 18.43N 77.39E | input | 08:56:10 |
| 13 | You dragged from base to a point: target 18.4340N 77.3927E, elevation -2,521 m (CTX DEM, bilinear) | deterministic | 08:56:10 |
| 14 | plan_round_trip | tool | 7 ms |
| 15 | Walking time | deterministic | under 1 ms |
| 16 | Suit battery | deterministic | under 1 ms |
| 17 | Climbing work | deterministic | under 1 ms |
| 18 | Comms line of sight from base | deterministic | 9 ms |
| 19 | Sun along the route | deterministic | 2 ms |
| 20 | Earth link delay | deterministic | under 1 ms |
| 21 | Verdict NO GO: slope pass, battery pass, EVA time pass, daylight pass, comms fail, data pass | deterministic | under 1 ms |
| 22 | science_at_target | tool | 66 ms |
| 23 | issue_scene_commands: clear_annotations, draw_route R1, highlight_segment 67 to 86 | tool | 1 ms |

Arguments and results of every step are in the JSON export.

---

Prepared with HeyMars by Ng Yu Hang, team Ecliptical, NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA.
