# Submission draft (paste-ready, DRAFT)

Form fields in the order shown on the Project tab. Anything marked `TODO(verify)` or `TODO(link)` must be resolved before pasting. Do not paste a claim whose TODO is still open. Deadline: Sun 15 Nov 2026, 23:59 SGT.

---

## Project Name

MarsWalk Copilot

---

## High-Level Project Summary

(About 150 words. Numbers in brackets point to the reference list directly below.)

MarsWalk Copilot is a hyperlocal, layered 3D map of a 30 km patch of Jezero Crater for planning a Marswalk. It combines a 20 m Mars Reconnaissance Orbiter CTX elevation model and 6 m orthomosaic [1], Mars Odyssey THEMIS thermal mosaics [2], the USGS geologic map of Jezero [3], and Perseverance waypoints and raw images [4][5]. Click a point and an AI agent reads its coordinates, calls deterministic tools for slope, geology and routing, and draws the results on the terrain. Routes come from an A* search over slope-limited cells, with a Tobler hiking-speed model [6] and an assumed battery model. Change a limit and the route is recomputed, or the app names the reason none exists. Climb work uses NASA's Mars surface gravity [7]. The challenge asks for a view finer than regional tools [8]. Suit constants are assumptions, not a NASA EVA model, and a 20 m DEM cannot show boulders.

**References for the summary**

1. USGS Astrogeology Science Center / Mars 2020 Terrain Relative Navigation team. CTX DEM 20 m and CTX orthomosaic 6 m, Jezero (`JEZ_ctx_B_soc_008`), distributed by NASA JPL Mars Trek. https://trek.nasa.gov/mars/
2. NASA Mars Odyssey THEMIS Day IR and Night IR 100 m controlled mosaics, via JPL Mars Trek. https://trek.nasa.gov/mars/
3. Sun, V.Z. and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: USGS Scientific Investigations Map 3464, scale 1:75,000. https://pubs.usgs.gov/publication/sim3464
4. NASA Mars 2020 Perseverance raw images. https://mars.nasa.gov/mars2020/multimedia/raw-images/
5. NASA MMGIS Perseverance waypoints (`M20_waypoints.json`). TODO(link): exact URL used by scripts/prepare-data.mjs
6. Tobler, W., 1993, Three presentations on geographical analysis and modeling: NCGIA Technical Report 93-1.
7. NASA Mars Fact Sheet (surface gravity 3.721 m/s^2). https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html
8. NASA Space Apps 2026, Interplanetary Survival Guide: Martian Map. https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/

---

## Link to Project Demo

Video (30 s or less): TODO(link)
Slides (7 or fewer), supplementary, mention in the description: TODO(link)

## Link to Final Project

Live app: TODO(link). Source: TODO(link). Must open in a private window with no login.

---

## Detailed Project Description

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
- Art: the mascot and map-marker art was generated with Codex CLI (OpenAI). Each AI-generated image is marked "AI-generated" inside the app. Listed in `public/art/CREDITS.json`. TODO(verify)
- Runtime: the app contains an LLM agent (Claude Haiku 5.5 via OpenRouter, fallback GPT-6 Luna). It chooses tools and writes explanations. Distances, slopes, times and coordinates come only from deterministic tools.
- Docs: drafted with AI assistance and checked by the participant. TODO(verify)
- NASA imagery and data are never labelled as AI output. No AI media imitates NASA logos or mission marks.

Full detail: docs/AI_USE.md.

---

## NASA Data

| Dataset | Link | Use |
| --- | --- | --- |
| MRO CTX DEM, 20 m, `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0` (USGS Astrogeology for Mars 2020 TRN, via JPL Mars Trek) | https://trek.nasa.gov/mars/ | Terrain mesh, slope, routing, elevation at picked points |
| MRO CTX orthomosaic, 6 m, `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | https://trek.nasa.gov/mars/ | Optical terrain texture |
| Mars Odyssey THEMIS Day IR and Night IR, 100 m controlled mosaics (Mars Trek WMTS) | https://trek.nasa.gov/mars/ | Thermal layers (relative brightness) |
| USGS SIM 3464 geologic map of Jezero, 1:75,000 (USGS-NASA Planetary Geologic Mapping Program) | https://pubs.usgs.gov/publication/sim3464 ; https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars | Geology layer and "what is here" answers |
| Perseverance raw images | https://mars.nasa.gov/mars2020/multimedia/raw-images/ | Rover point-of-view photos near a point |
| Perseverance waypoints (NASA MMGIS `M20_waypoints.json`) | TODO(link) | Traverse overlay, DEM validation, sol-to-place mapping |
| Perseverance traverse path and IAU nomenclature via Mars Trek | https://trek.nasa.gov/mars/ | Traverse overlay, place names |
| NASA Mars Fact Sheet | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | Surface gravity 3.721 m/s^2 for climb work |

All of the first five items are on the challenge's Resources tab. Challenge resources also listed (not used as data): Curiosity proposed path, NASA Worldview.

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
- [ ] Summary is 120 to 180 words, citations [1] to [8] resolve.
- [ ] Every number in the description matches the app and docs/SCIENCE_AND_VALIDATION.md.
- [ ] Participant name and team name filled in the demo.
