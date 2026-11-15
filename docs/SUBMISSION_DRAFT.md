# Submission draft (paste-ready)

Form fields in the order of the Project tab. Resolve every `TODO(link)` and `TODO(verify)` before pasting, and do not paste a claim whose TODO is still open. Deadline Sun 15 Nov 2026, 23:59 SGT. Target: submit at 18:00 SGT.

---

## Project Name

HeyMars

---

## High-Level Project Summary

Earth is 11 light-minutes away [1], so a crew on Mars cannot wait for Earth to plan each walk. HeyMars is a 3D map of the whole planet from NASA terrain and imagery [2], with a 20 m terrain model of Jezero Crater [3]. Click a point and ask. MarsAgent, an AI agent, runs deterministic tools: A* routes under a slope limit, suit battery, sun position [4], radio line of sight and landing-site criteria [5]. It answers GO, HOLD or NO GO with the limiting reason, shows every formula with its numbers, and exports a report. Geology [6] and Perseverance photos [7] show what a stop offers. A 3D lander replays NASA's landing timeline [8]. The terrain agrees with 708 Perseverance waypoints, median offset 1.1 m [7]. The impact: a crew can test its limits, see why a plan fails and replan on the spot, from data anyone can check. It is a planning aid, not a safety certification.

References

1. NASA JPL Horizons, Earth to Mars light time. https://ssd.jpl.nasa.gov/horizons/
2. NASA JPL Mars Trek: global 3D terrain, Viking MDIM 2.1 and CTX global mosaics. https://trek.nasa.gov/mars/
3. MRO CTX DEM of Jezero, 20 m (USGS Astrogeology), via JPL Mars Trek. https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0
4. Allison, M. and McEwen, M., 2000, Mars24 algorithm, NASA GISS. https://www.giss.nasa.gov/tools/mars24/
5. JPL, 2006, MSL Landing Site Selection User's Guide to Engineering Constraints. https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf
6. Sun, V.Z. and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, USGS SIM 3464. https://pubs.usgs.gov/publication/sim3464
7. NASA Mars 2020 Perseverance waypoints (MMGIS) and raw images. https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json and https://mars.nasa.gov/mars2020/multimedia/raw-images/
8. NASA/JPL Mars 2020 Perseverance Landing Press Kit, Entry, Descent and Landing. https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/

---

## Link to Project Demo

Video, 30 s or less: TODO(link)

## Link to Final Project

Live app: https://heymars.up.railway.app
Repository: https://github.com/fountainnnnn/NASA-Hackathon

Both must open in a private window with no login.

---

## Detailed Project Description

Live app: https://heymars.up.railway.app. Code: https://github.com/fountainnnnn/NASA-Hackathon

### What it does

HeyMars is a mission planning map for the first crews on Mars. It covers the whole planet and goes down to walking scale at Jezero Crater, where Perseverance landed.

- **Whole planet.** A 3D globe with JPL Mars Trek terrain, the Viking MDIM 2.1 colour mosaic and the CTX global mosaic. You can turn on MOLA elevation and slope, the USGS geologic map of Mars, Mars Odyssey water-equivalent hydrogen, TES thermal inertia and TES dust cover.
- **Click and ask.** A small reticle follows the cursor. Click a point and MarsAgent opens a card there: elevation, regional slope, geologic unit, orbital layers, nearby landing sites and named places. The same turn appears in the MarsAgent panel, which shows the full working.
- **Could we land here?** MarsAgent checks 8 criteria from NASA's MSL landing-site engineering guide. Latitude, elevation and thermal inertia are scored from global data. The other 5 need finer terrain or rock data than exists globally, so MarsAgent fills them with a derived estimate (marked est.) or a fixed placeholder (marked mock) and always says so in the card, the reasoning and the report.
- **Landing simulation.** 10,000 seeded Monte Carlo touchdowns in a 7.7 by 6.6 km ellipse, the size NASA gives for Perseverance. Then a 3D lander flies the Mars 2020 timeline on real terrain: parachute, heat shield separation, radar, Terrain-Relative Navigation, powered descent and sky crane.
- **Plan a walk at Jezero.** Drag from the base to a target. MarsAgent plans a round trip on the 20 m terrain model and checks slope, suit battery, EVA time, daylight, radio line of sight to the base mast and terrain coverage. The verdict is GO, HOLD or NO GO with the one limiting reason.
- **Replan.** If there is no path, the card says why and offers the smallest slope limit that works or the nearest reachable point. If a radio shadow blocks the plan, it offers a taller mast. Each change replans with the same tools.
- **See it.** Two astronauts walk the route with a chase camera at 1x to 600x. A helmet view shows heading, distance to the next stop, slope ahead and battery reserve. There is also rover assist, base camp reach contours, and a lasso that reports slope share and geology for an area.
- **Science at the target.** The geologic unit from the USGS Jezero map, the nearest catalogued Perseverance science site, and the nearest Perseverance raw image as a view from the ground, with sol, camera and credit.
- **Report.** Each plan has a mission planning report: summary and verdict, inputs tagged observed, computed or assumption, route legs, every calculation with numbers, go/no-go rules with sources, data and validation, assumptions, and the agent trace. It exports as PDF, Markdown, JSON and GeoJSON (route legs with per-vertex elevation). A cuff checklist exports as SVG and text.

### How it works

**Data pipeline.** Node scripts download the NASA and USGS products once, crop and convert them, and write small static files to `public/data`. They record the source URL, download date, checksum, processing and credit of each file in `data/source_manifest.json`. At runtime the app reads JPL Mars Trek terrain and imagery tiles directly, and Perseverance raw-image metadata through a small server proxy with a cache. Everything else is static.

**Frame.** Mars 2000 sphere, R = 3,396,190 m, planetocentric latitude, east-positive longitude, heights above the MOLA areoid.

**MarsAgent loop.** Every click, drag, rail tool, card button and question becomes one MarsAgent turn in a shared thread. The turn streams first-person narration lines as each step runs, then records each step (tool, calculation, verdict) with its formula, the substituted numbers, its source and how long it took. Each step can be opened as raw JSON.

- Map actions, rail tools, card buttons and maths follow-ups run fixed code. No language model is called for them.
- Free-text questions go to a server route. It holds the OpenRouter key and fixes the model (Claude Haiku 5.5), the system prompt and the tool list, and it rate-limits by IP and per day. The model can only choose tools. The browser runs the tools and returns the results, for at most 8 rounds and 12 tool calls per turn.
- Tool inputs are checked with Zod. Scene changes go through an allowlisted command reducer. A number guard compares every number in the model's answer with the tool results and flags those it cannot match.

**Tools (20).** get_scene_context, get_location_context, find_science_context, get_rover_images_near, analyze_terrain, set_mission_constraints, suggest_science_stops, plan_route, plan_multi_stop, compare_routes, find_hazard_segments, issue_scene_commands, export_mission_plan, get_site_conditions, check_landing_site, run_landing_scenario, show_edl_timeline, compare_sites, globe_commands, go_to_jezero. After each plan, fixed code adds the comms, sun, Earth link and go/no-go checks.

**Formulas.**

- Slope: Horn 3x3 gradient on the 20 m DEM, slope = atan(sqrt((dz/dx)^2 + (dz/dy)^2)).
- Planning grid: 40 m cells. Elevation is the 2x2 mean, slope is the 2x2 maximum.
- Route: 8-connected A*. An edge is allowed only if its grade and the slope of both cells are within the limit, so a path from a to b exists exactly when one from b to a does. Outbound and return legs are solved separately. A plan is all or nothing, and the round trip is the sum of its legs.
- Walking speed (Tobler 1993, scaled): v = f x 6 x exp(-3.5 x |tan(theta) + 0.05|) km/h, with suit factor f = 0.6.
- EVA time = walking time + dwell at the target.
- Battery used (%) = P x t / C x 100, with P = 250 W and C = 2,000 Wh.
- Climb work = m x g x ascent, with m = 180 kg and g = 3.721 m/s^2.
- Comms: line of sight from a 10 m base mast to a 1.8 m suit antenna along each route vertex, sampled every 10 m, including the curvature drop d^2 / 2R of the Mars sphere. Any hidden stretch longer than 0.5 km is no-go.
- Sun: Mars24 (Allison and McEwen 2000) for local true solar time, sun elevation, sunset and the daylight margin at return. Tested against the NASA GISS worked examples.
- Earth link: one-way light time = range / c from JPL Horizons, and Earth's elevation above the Jezero horizon.
- Verdict: each check is go, caution or no-go; the worst one sets GO, HOLD or NO GO.
- Landing Monte Carlo: truncated 2-D Gaussian with 3 sigma at the ellipse semi-axes, 10,000 seeded draws, slope sampled at each touchdown. Rust compiled to WebAssembly, with a TypeScript fallback. The two agree within histogram resolution (tested).

**Simulations.** The lander, parachute, heat shield, back shell and rover are original simple 3D models built in code, with matte materials and no insignia. They are drawn 3x to 4x true size so they are visible from the camera, and the legend states the factor. Near the ground the planet's relief is drawn 2.5 times true height so flat plains still read in a side view (Tilt button or right-drag); every number shown uses true heights. The astronauts are built from three.js primitives with jointed legs, so the planted boot stays on the ground. Phase times and altitudes come from the NASA/JPL Mars 2020 landing press kit.

**Validation.** The scripts sample the 20 m DEM at 708 Perseverance waypoints and compare it with each waypoint's recorded elevation: median offset -1.06 m, mean -0.89 m, standard deviation 3.25 m, 95th percentile of the absolute offset 6.44 m, largest 11.72 m on a steep slope. The global MOLA grid differs from the 20 m model by 11.3 m at the landing site. These show agreement between NASA products, not ground truth.

**Testing.** 519 unit tests in 49 files pass (Vitest). They cover A* symmetry and limits, a brute-force Dijkstra cross-check, Horn slope on known planes, line of sight with curvature, Mars24 against NASA GISS, Horizons light time, go/no-go rules, the EDL timeline and Rust against TypeScript Monte Carlo. Playwright end-to-end tests drive the real app in a browser: 16 of 16 pass. A layout QA script checks overlap, clipping, contrast and keyboard reach in 29 app states.

### Tools and languages

TypeScript, Next.js 15, React 19, CesiumJS 1.147.0 (planet view), three.js with React Three Fiber and drei (Jezero scene, crew, rover, base camp), Rust compiled to WebAssembly with wasm-bindgen (landing Monte Carlo), Zustand (state), Zod (tool and command validation), Lucide icons, Vitest and Playwright (tests), geotiff.js, sharp, jszip and shapefile (data preparation), OpenRouter (language-model gateway), Railway (hosting). Fonts: Schibsted Grotesk, Martian Mono and Michroma. The demo video was made with HyperFrames, GSAP, ffmpeg and Playwright screen capture.

### Benefits

- One map from orbit to walking scale, so a site can be judged for landing and then for a walk.
- Every number traces to a tool and a named source. Observed, computed and assumed values are labelled.
- A verdict with one limiting reason, which is what a crew needs to act on.
- What-if planning is fast: change a limit and the plan, the checks and the report are recomputed.
- The report and GeoJSON export can be checked by someone else.

### Goals

Show that an agent can plan inside a real map with tools a reviewer can check, as a companion for the first walks on Mars. Next steps: HiRISE terrain and rock abundance for metre-scale hazards, a validated suit model from a mission team, and more 20 m regions beyond Jezero.

### Limitations

- The 20 m Jezero model cannot see boulders or small scarps. The CTX imagery is 6 m per pixel.
- Outside Jezero the terrain is global: the MOLA grid is about 7.4 km per cell, so slope there is a regional value.
- Suit power, battery, speed factor, crew mass, mast height and the comms rule are assumptions, not a NASA EVA or life-support model.
- No live weather, dust, radiation or orbiter relay passes.
- Landing criteria are the MSL (Curiosity) constraints, used as a reference, not the Mars 2020 requirements.
- Values marked mock are placeholders, not measurements; values marked est. are derived from coarser data. Both are labelled wherever they appear.
- Scenario objects are drawn larger than true size for visibility (factor shown in the legend); distances, times and verdicts use true dimensions.
- The agent's prose can be wrong. The number guard checks numbers, not reasoning.

---

## Use of Super Intelligence (SI)

- **Idea and approach.** Chosen by the human participant before coding: the challenge, the click-and-ask map, Jezero as the walking region, the data approach and the safety checks. AI tools did not come up with the idea.
- **Code.** Written with Claude Code (Anthropic). Claude Opus 5.5 planned and integrated the work, Claude Sonnet subagents built separate modules, and Claude Fable 5.2 reviewed screenshots and the live app for QA. The participant set the brief, approved the UI design, reviewed the running app and screenshots, and directed each revision. The participant reviewed the architecture, the science and maths modules and their outputs; most UI code was AI-written and checked through tests and browser QA rather than line by line.
- **Runtime agent.** MarsAgent uses Claude Haiku 5.5 through OpenRouter for free-text questions only. It chooses tools and writes the explanation. Every distance, slope, time, battery figure and coordinate comes from a deterministic tool. Map actions, checks and maths follow-ups run fixed code with no model.
- **Images.** No AI-generated images are shown in the app or the video. Early SVG art made with Codex CLI (OpenAI) is still in `public/art/` with its prompts in `public/art/CREDITS.json`, but the app does not use it. The reticle and map symbols are drawn in code. The 3D models are built in code.
- **Audio.** The video's music bed is synthesised by a Python script (`deliverables/video/tools/music.py`) written with AI assistance. No generative audio model was used. There is no voice. The browser's built-in synthetic voice reads narration aloud only when the user turns it on.
- **Docs.** Drafted with AI assistance and checked against the code, data files and test output.
- NASA imagery and data are never labelled as AI output, and no AI content uses NASA logos or mission marks.

Full detail: docs/AI_USE.md.

---

## NASA Data

"Resources tab" says whether the challenge page lists the source (JPL Mars Trek, USGS-NASA Planetary Geologic Mapping, Perseverance raw images).

| Dataset | Mission and instrument | Exact source | What it lets the astronaut decide | Resources tab |
| --- | --- | --- | --- | --- |
| Mars Trek global 3D terrain | Terrain tiles used by Mars Trek's own 3D viewer; heights match MOLA after a fixed 8,201 m offset (tested) | https://marshub.s3.amazonaws.com/mars_v14/ | The shape of the ground anywhere on Mars, from orbit to an oblique ground view | Yes, Mars Trek |
| Viking MDIM 2.1 colour mosaic, 232 m | Viking Orbiters (USGS Astrogeology) | https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml | Where a region is, and its broad colour and terrain | Yes, Mars Trek |
| CTX global mosaic, about 5 m (beta01, uncontrolled) | MRO Context Camera (Caltech Murray Lab) | https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml (tiles served from astro.arcgis.com) | Craters, ridges and dunes near a candidate site | Yes, Mars Trek |
| MOLA MEGDR 1/8 degree | MGS Mars Orbiter Laser Altimeter | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img | Elevation and regional slope anywhere, for the landing elevation check | No, PDS |
| MOLA MEGDR 128 pixels per degree | MGS MOLA | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img | The terrain around the 20 m Jezero patch, so the horizon is real | No, PDS |
| Geologic Map of Mars, SIM 3292 | USGS-NASA mapping (Tanaka et al. 2014) | https://pubs.usgs.gov/sim/3292/ | The rock unit at any point on the planet | Yes, USGS-NASA PGM |
| Water-equivalent hydrogen | Mars Odyssey Gamma Ray Spectrometer (Boynton et al. 2007) | https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.tab | Where near-surface ground ice or hydrated minerals are likely, at regional scale | No, PDS |
| Nighttime thermal inertia | MGS Thermal Emission Spectrometer (Putzig and Mellon 2007) | https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.img | Firm ground or loose dust, used in the landing check | No, PDS |
| Dust cover index | MGS TES (Ruff and Christensen 2002) | https://trek.nasa.gov/mars/#v=0.1&x=0&y=0&z=1&p=EQ&i=TES_Dust | How dust-covered a region is (display only) | Yes, Mars Trek |
| CTX DEM of Jezero, 20 m | MRO CTX stereo, MOLA-controlled (USGS Astrogeology) | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0 | Whether a slope can be walked, how much climbing a route needs, where the radio shadow falls | Yes, Mars Trek |
| CTX orthomosaic of Jezero, 6 m | MRO CTX | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0 | What the ground looks like along the route and at a stop | Yes, Mars Trek |
| THEMIS Day IR and Night IR, 100 m | Mars Odyssey THEMIS | https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml and https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml | Which ground holds heat after dark, a cue for rock versus dust | Yes, Mars Trek |
| Geologic map of Jezero, SIM 3464 | USGS-NASA mapping (Sun and Stack 2020) | https://pubs.usgs.gov/publication/sim3464 and its feature service https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8 | The rock unit at a stop, so the walk has a science target | Yes, USGS-NASA PGM |
| Perseverance traverse path | Mars 2020, via Mars Trek | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=Perseverance_Traverse_Path | Ground the rover has already crossed | Yes, Mars Trek |
| Perseverance waypoints | Mars 2020 rover localisation (NASA MMGIS) | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json | The base position, and the 708-point check of the terrain | No, MMGIS |
| Perseverance raw images | Mars 2020 Mastcam-Z, Navcam, Hazcam | https://mars.nasa.gov/mars2020/multimedia/raw-images/ (API https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N) | What a stop looks like from the ground | Yes |
| Perseverance science sites | NASA mission pages (6 sites, for example the Three Forks sample depot) | `public/data/science_sites.json` lists each page URL | The nearest catalogued science stop to a target | No |
| IAU Mars nomenclature | IAU WGPSN via USGS and Mars Trek | https://planetarynames.wr.usgs.gov/ | Place names on the map and in answers | Yes, Mars Trek |
| JPL Horizons ephemeris | NASA JPL Solar System Dynamics (DE441, mar099) | https://ssd.jpl.nasa.gov/horizons/ | Earth light delay, and whether Earth is above the horizon during the EVA | No |
| Mars24 algorithm | NASA GISS | https://www.giss.nasa.gov/tools/mars24/ | Local solar time, sun elevation and daylight left at return | No |
| Mars 2020 EDL timeline | NASA/JPL landing press kit | https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/ | The phases and altitudes of the landing simulation | No |
| Perseverance landing ellipse size | NASA Science | https://science.nasa.gov/resource/perseverance-rover-landing-ellipse-in-jezero-crater/ | The 7.7 by 6.6 km ellipse for the Monte Carlo | No |
| MSL landing-site engineering constraints | NASA/JPL | https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf | Which landing criteria a site passes, and which cannot be judged from global data | No |
| Mars Fact Sheet | NASA NSSDC | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | Surface gravity 3.721 m/s^2 for climb work | No |

The Resources tab also lists the Curiosity proposed path example and NASA Worldview. Neither is used as data.

---

## Space Agency Partner Data and Other References

No space-agency partner (non-NASA) data is used.

**Data and science**

- All items in the NASA Data table above.
- Tobler, W., 1993, Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1. (walking speed)
- Allison, M. and McEwen, M., 2000, A post-Pathfinder evaluation of areocentric solar coordinates with improved timing recipes for Mars seasonal/diurnal climate studies. Planetary and Space Science 48, 215-235. (Mars24)
- Sun, V.Z. and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars. USGS SIM 3464. https://pubs.usgs.gov/publication/sim3464
- Tanaka, K.L., Skinner, J.A. Jr., Dohm, J.M., Irwin, R.P. III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G. and Hare, T.M., 2014, Geologic map of Mars. USGS SIM 3292. https://pubs.usgs.gov/sim/3292/
- Boynton, W.V. et al., 2007, Concentration of H, Si, Cl, K, Fe, and Th in the low- and mid-latitude regions of Mars. JGR 112, E12S99.
- Putzig, N.E. and Mellon, M.T., 2007, Apparent thermal inertia and the surface heterogeneity of Mars. Icarus 191, 68-94.
- Ruff, S.W. and Christensen, P.R., 2002, Bright and dark regions on Mars: particle size and mineralogical characteristics based on Thermal Emission Spectrometer data. JGR 107(E12), 5127.
- Smith, D.E. et al., MGS MOLA Mission Experiment Gridded Data Records, PDS MGS-M-MOLA-5-MEGDR-L3-V1.0.
- JPL, 2006, MSL Landing Site Selection User's Guide to Engineering Constraints. https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf
- NASA/JPL, Mars 2020 Perseverance Landing Press Kit, Entry, Descent and Landing. https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/
- NASA JPL Horizons on-line ephemeris system. https://ssd.jpl.nasa.gov/horizons/
- Horn, B.K.P., 1981, Hill shading and the reflectance map. Proceedings of the IEEE 69(1), 14-47. (slope operator)
- Hart, P.E., Nilsson, N.J. and Raphael, B., 1968, A formal basis for the heuristic determination of minimum cost paths. IEEE Transactions on Systems Science and Cybernetics 4(2), 100-107. (A*)

**Software in the app** (versions and licences from each installed package's `package.json`)

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| cesium (CesiumJS) | 1.147.0 | Apache-2.0 | Planet view, loaded from jsDelivr at the pinned version with SRI |
| next | 15.5.29 | MIT | App framework |
| react, react-dom | 19.1.0 | MIT | UI |
| three | 0.187.0 | MIT | 3D rendering, glTF export of the models |
| @react-three/fiber | 9.8.2 | MIT | React renderer for three.js |
| @react-three/drei | 10.7.9 | MIT | three.js helpers |
| zustand | 5.1.0 | MIT | State |
| zod | 4.6.7 | MIT | Tool and command validation |
| lucide-react | 1.73.0 | ISC | Icons |
| wasm-bindgen (Rust crate) | 0.2.130 | MIT OR Apache-2.0 | Rust to WebAssembly bindings |

**Development and data tools**

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| typescript | 5.9.3 | Apache-2.0 | Language |
| vitest | 5.1.0 | MIT | Unit tests |
| vite | 8.3.8 | MIT | Test bundling |
| @playwright/test | 1.65.1 | Apache-2.0 | Browser tests, layout QA, video capture |
| eslint, eslint-config-next, @eslint/eslintrc | 9.39.5, 15.5.29, 3.3.7 | MIT | Linting |
| tsx | 4.23.15 | MIT | Running TypeScript scripts |
| geotiff | 3.0.5 | MIT | Reading GeoTIFF DEM and ortho |
| sharp | 0.35.5 | Apache-2.0 | Image conversion |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later (used under MIT) | Reading zipped data |
| shapefile | 0.6.6 | BSD-3-Clause | Reading USGS shapefiles |
| @types/node, @types/react, @types/react-dom, @types/three | 22.20.5, 19.3.0, 19.3.0, 0.187.0 | MIT | Type definitions |

Transitive dependencies are pinned in `package-lock.json`.

**Demo video tools**: HyperFrames 0.9.45 (Apache-2.0), GSAP 3.14.2 (GreenSock standard no-charge licence), ffmpeg via ffmpeg-static 5.3.0 (GPL-3.0-or-later), ffprobe-static 3.1.0 (MIT), puppeteer-core 25.17.0 (Apache-2.0), Playwright. Music synthesised with NumPy in `deliverables/video/tools/music.py`.

**Fonts**: Schibsted Grotesk, Martian Mono and Michroma, from Google Fonts via `next/font`, SIL Open Font License 1.1.

**Images**: Perseverance raw images, NASA/JPL-Caltech (Mastcam-Z: NASA/JPL-Caltech/ASU), shown unaltered with sol, camera and credit. No AI-generated images are shown.

**Services**: OpenRouter (https://openrouter.ai) with Claude Haiku 5.5 for the runtime agent; Claude Code with Claude Opus 5.5, Sonnet and Fable 5.2 for development; JPL Mars Trek, PDS Geosciences Node, USGS and NASA Mars APIs for data; jsDelivr for CesiumJS; Railway for hosting.

---

## Pre-paste checks

- [ ] No TODO remains in the text above.
- [ ] Summary is about 150 words and citations [1] to [8] resolve.
- [ ] Every number matches the app, `data/validation.json` and docs/SCIENCE_AND_VALIDATION.md.
- [ ] The live app shows the HeyMars build (redeploy after the last commit) and the repo has the last commit pushed.
