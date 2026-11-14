# Submission draft (paste-ready, DRAFT)

Form fields in the order shown on the Project tab. Anything marked `TODO(verify)` or `TODO(link)` must be resolved before pasting. Do not paste a claim whose TODO is still open. Deadline: Sun 15 Nov 2026, 23:59 SGT. Target: submit Sun 18:00 SGT.

---

## Project Name

MarsWalk Copilot

---

## High-Level Project Summary

Mars maps cover regions; a crew needs to know if it can reach that ridge and get back on one battery. MarsWalk Copilot answers that for one place, the Jezero Crater region. It shows 3D terrain built from NASA elevation data [1], with optical, thermal and geologic layers on top [1][2][3]. You click a point and ask. An AI copilot runs deterministic route, terrain, geology and rover-photo tools [4] and draws the answer on the terrain, replanning when a constraint changes. The terrain agrees with 708 Perseverance waypoints [5], median offset 1.1 m, mean bias −0.9 m. Rover heights are a different NASA product, so this is a cross-check, not ground truth. The impact: a planner can try different slope, battery and time limits by asking, and every number traces to a tool and a named NASA source. It is a planning aid, not a safety certification.

References

1. USGS Astrogeology / Mars 2020 TRN team, MRO CTX DEM 20 m and orthomosaic 6 m, via JPL Mars Trek. https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0
2. Mars Odyssey THEMIS Day IR and Night IR 100 m controlled mosaics, via JPL Mars Trek. https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml
3. Sun, V.Z. and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: USGS SIM 3464. https://pubs.usgs.gov/publication/sim3464
4. NASA Mars 2020 Perseverance raw images. https://mars.nasa.gov/mars2020/multimedia/raw-images/
5. NASA MMGIS Perseverance waypoints. https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json

---

## Link to Project Demo

Video (30 s or less, the official Demo link): TODO(link) video URL

## Link to Final Project

Live app (Railway): TODO(link). Repository: https://github.com/fountainnnnn/NASA-Hackathon

The live app must open in a private window with no login.

---

## Detailed Project Description

Slides (7): TODO(link) deck URL. Live app: TODO(link). Code: https://github.com/fountainnnnn/NASA-Hackathon

### What it does

MarsWalk Copilot is a 3D planning console for one real place on Mars, the Jezero Crater region (77.16 to 77.70 degrees E, 18.21 to 18.72 degrees N). The terrain mesh comes from a NASA/USGS elevation model. Optical, thermal and geologic layers can be toggled and blended on it. The user clicks a point and gets its coordinates, elevation, slope, geologic unit, nearby named features, the closest Perseverance traverse point and nearby rover photos. TODO(verify): which of these ship.

An AI agent sits beside the terrain. It sees the clicked point and the current constraints, then calls tools. It can add pins, plan a round trip, plan a multi-stop science loop, compare two routes, highlight the steepest stretch, and focus the camera. Everything it draws is anchored to terrain coordinates and stays put as the camera moves. If constraints change (slope limit, battery reserve, objective), the route is recomputed. If no route fits, the answer is a named reason plus the smallest slope limit that would work or the point where the battery reserve would be reached.

The same tools are behind the HUD buttons, so planning works without the agent. TODO(verify): offline behaviour.

### How it works

Pipeline. A one-off script (`scripts/prepare-data.mjs`) downloads the CTX DEM and orthomosaic, THEMIS tiles, the USGS geologic map features, Perseverance waypoints and IAU names, crops everything to the DEM bounds and writes small static files to `public/data`. It also writes `data/source_manifest.json` (provenance) and `data/validation.json` (DEM elevation against rover waypoint elevations). Nothing is fetched from NASA at runtime except rover image links. TODO(verify): rover image caching.

Frame. Mars 2000 sphere, R = 3,396,190 m, east-positive longitude, heights above the areoid. Scene metres: x = R cos(lat_c) (lon - lon_c) pi/180, z = -R (lat - lat_c) pi/180, y = (h - h_ref) times the vertical exaggeration. Picking inverts this and then samples the true DEM, not the exaggerated mesh.

Agent loop. The browser sends the user's text and a scene snapshot to a server route. The server holds the OpenRouter key, fixes the model, system prompt and tool list, and rate-limits. The model returns tool calls. The browser executes them (terrain worker, science lookups) and sends results back, for at most 8 rounds and 12 tool calls per turn. Scene changes go through an allowlisted command reducer that rejects anything it does not know. A number guard compares every number in the final answer with the tool results and flags the ones it cannot match as unverified.

Algorithms.

- Slope: Horn 3x3 gradient on the 20 m DEM, with per-row ground spacing dx = R cos(lat) d(lon), dy = R d(lat).
- Planning grid: 40 m cells. Elevation is the 2x2 mean, slope is the 2x2 maximum (conservative).
- Routing: 8-connected A*. An edge is allowed only if |grade| <= limit and the maximum slope of the cell entered is <= limit. Objective "shortest" minimises 3D length. Objective "fastest" minimises time using the Tobler hiking function, v = 6 exp(-3.5 |tan(theta) + 0.05|) km/h, multiplied by an assumed suit factor (default 0.6). Round trips solve each leg separately.
- Resources: battery % = P_suit t / C_batt times 100. Climb work = m g ascent, with g = 3.721 m/s^2. Total EVA time = walking time plus dwell.
- Feasibility: a path exists AND battery use <= 100 - reserve AND EVA time <= limit. Otherwise the reasons are named.
- Sources for the methods: Horn (1981) for slope, Hart, Nilsson and Raphael (1968) for A*, Tobler (1993) for walking speed, NASA Mars Fact Sheet for surface gravity. Full citations are under "Space Agency Partner Data and Other References".

Validation. `scripts/prepare-data.mjs` samples the DEM at all 708 Perseverance waypoints inside the patch and compares it with each waypoint's recorded elevation (`data/validation.json`). Median offset 1.1 m (DEM lower), mean bias -0.9 m, standard deviation 3.2 m, 95th percentile 6.4 m, largest 11.7 m. This shows the terrain agrees with another NASA product. It does not make the DEM ground truth.

### Benefits

- A walking-scale view, finer than the regional and global views in Mars Trek and the USGS-NASA mapping portal.
- Slope, geology, thermal context and rover photos in one scene, so the trade-offs for a route are visible together.
- Every figure comes from a tool, and the assumptions behind it are visible. Observed, computed and assumed values are labelled differently.
- Fast what-if planning by conversation.

### Goals

Show that an agent can work inside a spatial scene with verifiable tools, as a planning companion for the first Marswalks. A natural next step is higher-resolution HiRISE terrain and rock-abundance data, and a validated suit model from a mission team.

### Tools and languages

TypeScript, Next.js, React, React Three Fiber and three.js (3D), Zustand (state), Zod (tool and command validation), Vitest and Playwright (tests), geotiff.js and sharp (data preparation), jszip and shapefile (reading USGS data), Lucide (UI icons), OpenRouter (LLM gateway). Node.js scripts for data preparation. TODO(verify): hosting platform, e.g. Railway.

### Limitations

- The 20 m DEM cannot resolve boulders, small scarps or loose regolith. Slopes are averaged over the baseline.
- Walking speed, suit factor, suit power, battery capacity, crew mass, EVA limit and dwell time are assumptions. This is not a NASA EVA or life-support model and does not certify safety.
- No radiation, dust, weather, communications or live data.
- THEMIS brightness is shown as relative, not calibrated temperature.
- The geologic map is a 1:75,000 interpretation.
- The agent can be wrong in prose. The number guard catches unmatched numbers, not wrong reasoning.
- One patch of Jezero only. TODO(verify): validation residuals, see docs/SCIENCE_AND_VALIDATION.md.

---

## Use of Super Intelligence (SI)

AI was used, and we want to be specific about where.

- Idea and approach: chosen by the human participant before coding. The participant's own written brief defined the challenge, the hero use case, the data approach and the architecture. AI tools did not come up with the idea for solving the challenge.
- Coding: Claude Code (Anthropic) was the coding assistant, with Claude Sonnet sub-agents writing modules to a shared interface file. Code was run, tested and reviewed by the human participant. TODO(verify): extent of human review.
- Art: the mascot (five states), map markers, favicon and wordmark are AI-authored SVG files written by Codex CLI (OpenAI) from text prompts, 13 files in all. They are marked "AI-generated" in the app's Sources panel and listed with tool, prompt and review status in `public/art/CREDITS.json`. TODO(verify): the mark in the Sources panel.
- Runtime: the app contains an LLM agent (Claude Haiku 5.5 via OpenRouter, fallback GPT-6 Luna). It chooses tools and writes explanations. Distances, slopes, times and coordinates come only from deterministic tools.
- Docs: drafted with AI assistance and checked by the participant. TODO(verify)
- NASA imagery and data are never labelled as AI output. No AI media imitates NASA logos or mission marks.

Full detail: docs/AI_USE.md.

---

## NASA Data

The Resources tab column says whether the challenge page lists the source.

| Dataset | Mission and instrument | Exact product | What it lets the astronaut decide | Resources tab |
| --- | --- | --- | --- | --- |
| CTX DEM, 20 m | Mars Reconnaissance Orbiter, Context Camera stereo terrain model | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0 | Whether a slope can be walked, how much climbing a route needs, the elevation of any picked point | Yes, Mars Trek |
| CTX orthomosaic, 6 m | Mars Reconnaissance Orbiter, Context Camera | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0 | What the ground looks like at a candidate stop: ridge, scarp, dunes, crater rim | Yes, Mars Trek |
| THEMIS Day IR, 100 m | Mars Odyssey, THEMIS | https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml | Daytime thermal context for the area, as relative brightness | Yes, Mars Trek |
| THEMIS Night IR, 100 m | Mars Odyssey, THEMIS | https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml | Which ground holds heat after dark, a qualitative cue for rocky versus dusty surfaces | Yes, Mars Trek |
| Geologic map of Jezero, 1:75,000 (SIM 3464) | USGS-NASA Planetary Geologic Mapping Program, map compiled on MRO imagery | https://pubs.usgs.gov/publication/sim3464 and the map's feature services https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/2 and .../FeatureServer/8 | What rock unit is at a point and which stops are worth the walk | Yes, USGS-NASA Planetary Geologic Mapping |
| Perseverance waypoints | Mars 2020, rover localisation (NASA MMGIS) | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json | Where the rover has driven, so which ground is known to be passable, and the 708-point check of the terrain | No, found through NASA MMGIS |
| Perseverance traverse path | Mars 2020, via Mars Trek | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=Perseverance_Traverse_Path | The rover's continuous drive line drawn on the terrain | Yes, Mars Trek |
| Perseverance raw images | Mars 2020, rover cameras | API https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N ; gallery https://mars.nasa.gov/mars2020/multimedia/raw-images/ | What a place looks like from the ground, with sol and camera | Yes, Perseverance raw images |
| Mars Fact Sheet | NASA NSSDC | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | Climb work on Mars, using surface gravity 3.721 m/s^2 | No |

The Resources tab also lists the Curiosity proposed path and NASA Worldview. Neither is used as data.

---

## Space Agency Partner Data and Other References

No space-agency partner data (non-NASA) is used.

**Data and science**

- All items in the NASA Data table above.
- Sun, V.Z. and Stack, K.M., 2020, USGS SIM 3464. https://pubs.usgs.gov/publication/sim3464
- Tobler, W., 1993, Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1.
- Horn, B.K.P., 1981, Hill shading and the reflectance map. Proceedings of the IEEE, 69(1), 14-47. (slope operator)
- Hart, P.E., Nilsson, N.J. and Raphael, B., 1968, A formal basis for the heuristic determination of minimum cost paths. IEEE Trans. Systems Science and Cybernetics, 4(2), 100-107. (A*)
- Mars 2000 sphere and IAU conventions as used by Mars Trek and USGS. TODO(verify): exact citation

**Software** (licence taken from each installed package's `package.json`, versions as installed)

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| next | 15.5.29 | MIT | App framework |
| react, react-dom | 19.1.0 | MIT | UI |
| three | 0.187.0 | MIT | 3D rendering |
| @react-three/fiber | 9.8.2 | MIT | React renderer for three.js |
| @react-three/drei | 10.7.9 | MIT | three.js helpers |
| zustand | 5.1.0 | MIT | World state |
| zod | 4.6.7 | MIT | Validation |
| lucide-react | 1.73.0 | ISC | UI icons |
| geotiff | 3.0.5 | MIT | Reading GeoTIFF DEM and ortho |
| sharp | 0.35.5 | Apache-2.0 | Image conversion |
| vitest | 5.1.0 | MIT | Unit tests |
| @playwright/test | 1.65.1 | Apache-2.0 | Browser tests |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later (used under MIT) | Reading zipped data |
| shapefile | 0.6.6 | BSD-3-Clause | Reading USGS shapefiles |

Other dev tooling (TypeScript, ESLint, tsx, type packages): TODO(verify) licences from node_modules before submitting. Transitive dependencies are covered by `package-lock.json`.

**Fonts**: Inter and IBM Plex, SIL Open Font License 1.1. TODO(verify): which families actually ship, and how they are loaded.

**Services and tools**: OpenRouter (https://openrouter.ai), Claude Haiku 5.5 and GPT-6 Luna (runtime agent); Claude Code and Claude Sonnet (coding assistance); Codex CLI (art generation); NASA Mars Trek and USGS Astrogeology portals (data access).

**Images**: mascot and marker art, AI-generated with Codex CLI and watermarked, see `public/art/CREDITS.json`. TODO(verify) Rover photos: NASA/JPL-Caltech, shown unaltered with sol and camera.

**Hosting**: TODO(verify)

---

## Pre-paste checks

- [ ] No TODO remains in the text above.
- [ ] Summary is 130 to 170 words, citations [1] to [5] resolve.
- [ ] Every number in the description matches the app and docs/SCIENCE_AND_VALIDATION.md.
- [ ] Participant name and team name filled in the demo.
