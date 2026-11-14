# EVA plan: base to 18.441N 77.415E, Jezero Crater

Round trip from the Octavia E. Butler landing site, prepared for surface operations review.

Report HM-2026-11-14-R1, generated 2026-11-14 23:46 UTC.

**Verdict: NO GO.** Radio shadow of 2.6 km with no line of sight to base from a 10 m mast.

## 1. Summary and verdict

1 blocker. Radio shadow of 2.6 km with no line of sight to base from a 10 m mast.

| Item | Value | Limit | Status |
| --- | ---: | ---: | --- |
| Round trip distance | 4.31 km | n/a | info |
| EVA duration incl. 30 min at target | 1 h 56 min | 6 h 00 min | pass |
| Suit battery at return | 75.8 % | >= 20 % | pass |
| Maximum slope on route | 3.4° | <= 15° | pass |
| Longest comms shadow | 2.64 km | <= 0.5 km | fail |
| Daylight margin at return | 7 h 32 min | >= 0 | pass |

| Landing criterion | Value | Limit | Status |
| --- | ---: | --- | --- |
| Latitude band | 20.01° | \|latitude\| <= 60° | pass |
| Landing-site elevation (MOLA areoid) | -264.43 m | elevation <= +2000 m above the MOLA areoid | pass |
| Regional slope (2-5 km length scale) | 0.26° | slope <= 3° over a 2-5 km length scale | not scored at this scale |
| Thermal inertia (not dust-dominated) | 331 J m-2 s-0.5 K-1 | thermal inertia > 100 J m-2 s-0.5 K-1 | pass |
| Slope at 200-500 m length scale | no data at this scale | slope <= 5° over a 200-500 m length scale | no data |
| Slope at 20-40 m length scale | no data at this scale | slope <= 15° over a 20-40 m length scale | no data |
| Slope at 5 m length scale | no data at this scale | slope <= 15° over a 5 m length scale | no data |
| Rock abundance (damaging rocks under the rover) | no data at this scale | rock abundance of around 10% or less (less than 0.25% chance of a rock taller than 0.6 m in a 4 m2 area) | no data |

| Landing simulation | Value |
| --- | ---: |
| Site | 20.006N 72.000E |
| Ellipse | 7.7 by 6.6 km (semi-axes 3.85 and 3.3 km) |
| Simulated touchdowns | 10,000 |
| Touchdowns on ground at or under 15° (assumption) | 100 % |
| Median / 95th percentile slope | 0.3° / 0.3° |
| Terrain model | global DEM, ~7.4 km posting |

| Science at target | Value | Source |
| --- | --- | --- |
| Geologic unit | Jezero floor unit (Njf) | USGS SIM 3464, observed |
| Nearest catalogued science site | Three Forks sample depot, 0.8 km | Perseverance's 'Three Forks' Sample Depot Map |
| View from the ground | Sol 652, Navigation Camera Right, 0.79 km from the target, 2022-12-20: https://mars.nasa.gov/mars2020/multimedia/raw-images/NRF_0652_0724830918_993ECM_N0320148NCAM12652_01_195J | NASA/JPL-Caltech, Perseverance raw image |

## 2. Inputs and constraints

| Parameter | Value | Type |
| --- | ---: | --- |
| Start (base) | 18.4446N 77.4509E, -2,567 m | observed, Perseverance waypoint sol 13 |
| Target | 18.4410N 77.4148E, -2,551 m | computed, CTX DEM bilinear |
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
| Outbound | 2.15 km | 32.6 m | 3.4° | 44 min |
| Return | 2.15 km | 18.7 m | 3.4° | 42 min |
| Round trip (sum of legs) | 4.31 km | 51.3 m | 3.4° | 1 h 26 min |

A* on a 40 m grid derived from the 20 m MRO CTX DEM; path snapped to cell centres. The GeoJSON export carries every leg with per-vertex elevation.

## 4. Calculations

**4.1 Walking speed and EVA duration (Tobler 1993, scaled for a suited crew)**

```
v(θ) = f × 6 km/h × e^(-3.5 × |tan θ + 0.05|)
outbound: tan θ = (33 - 17) m ÷ 2,152 m = 0.007  →  v = 0.6 × 6 × e^(-3.5 × |0.007 + 0.05|) = 2.95 km/h
return: tan θ = (19 - 35) m ÷ 2,152 m = -0.007  →  v = 0.6 × 6 × e^(-3.5 × |-0.007 + 0.05|) = 3.1 km/h
t = Σ segment length ÷ v(θ segment) + dwell = 44 min + 42 min + 30 min = 1 h 56 min
```

**4.2 Suit battery**

```
used = P × t ÷ C = 250 W × 1.93 h ÷ 2,000 Wh = 24.2 %
left = 100 % - 24.2 % = 75.8 %  (reserve 20 %)  pass
```

**4.3 Mechanical work of climbing (lower bound on effort)**

```
W = m × g × ascent = 180 kg × 3.721 m/s² × 51.3 m = 34 kJ
```

**4.4 Comms line of sight with planetary curvature**

```
mast 10 m (assumption), suit antenna 1.8 m, ray sampled every 10 m
curvature drop = d² ÷ 2R = (2,056 m)² ÷ (2 × 3,396,190 m) = 0.62 m
1 hidden stretch, longest vertices 21 to 88, 2.64 km
limit 0.5 km per stretch  fail
```

**4.5 Sun position (NASA GISS Mars24, Allison and McEwen 2000)**

```
Mars24: MSD 54,344.2, Ls 22.4°, LTST 09:00 at the start
sun elevation 46° at the start, 71° at the end, lowest 46°
sunset 18:12 LTST, daylight margin at return 7 h 32 min  pass
```

**4.6 Earth link (NASA JPL Horizons)**

```
one-way light time = range ÷ c = 1.316131 au × 499.005 s/au = 656.8 s = 10.9 min
```

**4.7 Landing criteria at 20.006N 72.000E**

```
Latitude band: 20.01° vs limit |latitude| <= 60°  pass
Landing-site elevation (MOLA areoid): -264.43 m vs limit elevation <= +2000 m above the MOLA areoid  pass
Regional slope (2-5 km length scale): 0.26° vs limit slope <= 3° over a 2-5 km length scale  no data
Thermal inertia (not dust-dominated): 331 J m-2 s-0.5 K-1 vs limit thermal inertia > 100 J m-2 s-0.5 K-1  pass
Slope at 200-500 m length scale: no data vs limit slope <= 5° over a 200-500 m length scale  no data
Slope at 20-40 m length scale: no data vs limit slope <= 15° over a 20-40 m length scale  no data
Slope at 5 m length scale: no data vs limit slope <= 15° over a 5 m length scale  no data
Rock abundance (damaging rocks under the rover): no data vs limit rock abundance of around 10% or less (less than 0.25% chance of a rock taller than 0.6 m in a 4 m2 area)  no data
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
| 1 | Asked on the map: What is here? | input | 23:45:53 |
| 2 | get_site_conditions | tool | 313 ms |
| 3 | Asked on the map: Could we land here? | input | 23:45:54 |
| 4 | check_landing_site | tool | 57 ms |
| 5 | Not enough data to judge: latitude band pass, landing-site elevation (mola areoid) pass, regional slope (2-5 km length scale) no data, therm | deterministic | under 1 ms |
| 6 | Used a tool: Run landing simulation | input | 23:45:54 |
| 7 | show_edl_timeline | tool | 52 ms |
| 8 | run_landing_scenario | tool | 0.39 s |
| 9 | Used a tool: Take me to Jezero | input | 23:46:32 |
| 10 | Dragged on the map: Plan a round trip from base to 18.44N 77.41E | input | 23:46:49 |
| 11 | You dragged from base to a point: target 18.4410N 77.4148E, elevation -2,551 m (CTX DEM, bilinear) | deterministic | 23:46:49 |
| 12 | plan_round_trip | tool | 2 ms |
| 13 | Walking time | deterministic | under 1 ms |
| 14 | Suit battery | deterministic | under 1 ms |
| 15 | Climbing work | deterministic | under 1 ms |
| 16 | Comms line of sight from base | deterministic | 3 ms |
| 17 | Sun along the route | deterministic | under 1 ms |
| 18 | Earth link delay | deterministic | under 1 ms |
| 19 | Verdict NO GO: slope pass, battery pass, EVA time pass, daylight pass, comms fail, data pass | deterministic | under 1 ms |
| 20 | science_at_target | tool | 16 ms |
| 21 | issue_scene_commands: clear_annotations, draw_route R1, highlight_segment 21 to 54 | tool | under 1 ms |

Arguments and results of every step are in the JSON export.

---

Prepared with HeyMars by Ng Yu Hang, team Ecliptical, NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA.
