# HeyMars

Point at Mars. Ask. It plans.

A solo entry to the NASA Space Apps Challenge 2026, Singapore Local Event, by Ng Yu Hang (team Ecliptical).
Challenge: **Interplanetary Survival Guide: Martian Map**, https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/

Earth is about 11 light-minutes from Mars, so a crew there has to plan its own walks. HeyMars is a 3D map of the whole planet built from NASA terrain and imagery, with a 20 m terrain model of Jezero Crater for walking-scale plans. You click a point and ask. MarsAgent, the app's agent, runs deterministic tools for terrain, routes, suit battery, sun position, radio line of sight and landing criteria. It answers on the map with a GO, HOLD or NO GO verdict and the one reason that limits it, shows each formula with the real numbers, and builds a report you can export. Every number comes from a tool and a named NASA or USGS source. It is a planning aid, not a safety certification.

- Demo video (30 s): TODO(link)
- Live app: https://web-production-9b58e394.up.railway.app
- Repository: https://github.com/fountainnnnn/NASA-Hackathon

## Screenshots

| | |
| --- | --- |
| ![The whole planet in the planet view, with the MarsAgent panel](deliverables/screens/r1-idle-globe.png) | ![A planned round trip at Jezero with a NO GO card for a radio shadow](deliverables/screens/r1-route.png) |
| Whole planet: JPL Mars Trek terrain with Viking and CTX imagery. | Jezero round trip: NO GO, 1.9 km out of radio contact with base, with the view from the ground. |
| ![Two astronauts walking the route, chase camera](deliverables/screens/r1-walk-chase.png) | ![The lander under its parachute over real terrain](deliverables/screens/r1-landing-chute.png) |
| Walk simulation: two crew on the route at 60x, suit battery on each tag. | Landing simulation: Mars 2020 EDL phases over Mars Trek terrain, after 10,000 Monte Carlo touchdowns. |

More states are in `deliverables/screens/`. A sample report is in `deliverables/report-samples/` (PDF, Markdown, JSON, GeoJSON).

## What it does

- **Whole planet.** CesiumJS globe with JPL Mars Trek 3D terrain, the Viking MDIM 2.1 colour mosaic and the CTX global mosaic. Layers: MOLA elevation and slope, USGS geologic map (SIM 3292), Mars Odyssey GRS water-equivalent hydrogen, TES thermal inertia, TES dust cover index.
- **Click anywhere.** MarsAgent reads elevation, regional slope, geologic unit, orbital layers, nearby landing sites and named places at the point.
- **Could we land here?** Checks 8 published criteria from the MSL (Curiosity) landing-site engineering guide. Latitude, elevation and thermal inertia are scored from global data. The 2 to 5 km slope is not scored, because the global grid's baseline is about 15 km. Slopes at finer scales and rock abundance need data the global set does not have and are listed as "no data".
- **Landing simulation.** 10,000 seeded Monte Carlo touchdowns in a 7.7 by 6.6 km ellipse, the size NASA gives for Perseverance (Rust compiled to WebAssembly, with a TypeScript fallback), then a 3D lander that follows the Mars 2020 entry, descent and landing timeline on real terrain.
- **Jezero planner.** On the 20 m CTX terrain model: drag from base to plan a round trip. A* with a slope limit, walking speed from Tobler's hiking function times a suit factor, suit battery, climb work, radio line of sight to the base mast with planetary curvature, sun position from Mars24, Earth light time and Earth above the horizon from JPL Horizons.
- **Verdict.** Slope, battery, EVA time, daylight, comms and data each get go, caution or no-go. The worst one sets GO, HOLD or NO GO.
- **Replan.** Change a limit or follow a suggested action (replan at the smallest slope limit that works, nearest reachable point, raise the mast) and the plan is recomputed.
- **Simulations.** Two astronauts walk the route with a chase camera, helmet view with a heads-up display, rover assist, base camp reach contours, lasso an area for slope share and geology.
- **Science at target.** Geologic unit (USGS SIM 3464), the nearest catalogued Perseverance science site, and the nearest Perseverance raw image as a view from the ground.
- **Report.** Mission planning report with inputs, route legs, every formula, go/no-go rules, sources, validation, assumptions and the agent trace. Export as PDF (browser print), Markdown, JSON and GeoJSON. Cuff checklist as SVG and text.

## Run it

Requires Node.js 22 or later.

```bash
npm i                         # .npmrc sets legacy-peer-deps
cp .env.example .env.local    # add OPENROUTER_API_KEY to enable free-text questions
npm run dev                   # http://localhost:3000
npm run build && npm start    # production build
npm test                      # Vitest unit tests
npm run e2e                   # Playwright, starts the dev server unless E2E_BASE_URL is set
```

Without a key the map, tools, checks, simulations and reports all work. Only free-text questions to the language model are off, and the app says so.

Environment variables (`.env.example`): `OPENROUTER_API_KEY` (server only), `AGENT_MODEL` (default `anthropic/claude-haiku-5.5`), `AGENT_FALLBACK_MODEL`, `AGENT_DAILY_CAP`, `AGENT_IP_CAPACITY`, `CLIENT_IP_HEADER`.

### Data scripts (optional)

The prepared data in `public/data/` and the WebAssembly build are committed, so a fresh clone runs without these. They regenerate everything from the NASA and USGS sources and write provenance to `data/`.

| Command | Writes |
| --- | --- |
| `node scripts/prepare-data.mjs` | Jezero 20 m DEM, CTX ortho, THEMIS, SIM 3464 geology, traverse, names; `data/source_manifest.json`, `data/validation.json` |
| `node scripts/prepare-global.mjs` | `public/data/global/` (MOLA, SIM 3292, GRS, TES, sites); `data/global_validation.json` |
| `node scripts/prepare-context.mjs` | MOLA 128 ppd and CTX mosaic context around the Jezero patch |
| `node scripts/fetch-horizons.mjs` | `public/data/earth_link.json` from JPL Horizons |
| `node scripts/prepare-ctx-tiles.mjs` | CTX 6 m detail tiles (needs `data/raw/` from prepare-data) |
| `node scripts/fetch-rover-cache.mjs` | Perseverance raw-image metadata cache, `public/data/rover_cache/` |
| `scripts/build-wasm.sh` | `public/wasm/scenario_bg.wasm` from `crates/scenario` (needs Rust and wasm-bindgen-cli 0.2.130) |
| `node scripts/qa-layout.mjs` | Layout QA: overlap, clipping, contrast and keyboard checks at 4 viewports; writes `deliverables/qa/<timestamp>/` |

## Architecture

```
 scripts/*.mjs (offline)  NASA / USGS / JPL Horizons downloads -> public/data/*, data/*.json (provenance, validation)
 crates/scenario (Rust)   landing Monte Carlo -> public/wasm/scenario_bg.wasm

 browser
   AppShell: top bar, tool rail, timeline, MarsAgent panel, map card at the cursor
   components/Planet   CesiumJS 1.147.0 (pinned on jsDelivr with SRI): Mars Trek terrain, Viking + CTX imagery,
                       global layers, 3D EDL lander
   components/Scene    three.js / React Three Fiber: Jezero 20 m terrain, routes, crew, rover, base camp, helmet view
   app/flow.ts         one MarsAgent turn per click, drag, rail tool or question: narration, steps, formulas, answer, card
   lib/terrain         Web Worker: Horn slope, 40 m grid, A*, resources
   lib/ops             Mars24 sun, line of sight, Earth link, go/no-go, cuff card
   lib/globalSci       global conditions, landing criteria
   lib/scenario        Monte Carlo (WASM or TypeScript)
   lib/report          report model and exports
   lib/agent           20 tools (Zod schemas), tool loop (8 rounds, 12 calls), number guard

 server: app/api/agent   holds the OpenRouter key, fixed model, prompt and tools, rate limits
         app/api/rover-images   proxy and cache for the NASA raw images API
         app/api/health
```

Rail tools, card buttons and maths follow-ups run fixed code with no model. Free-text questions go to the model, which only chooses tools. A number guard flags any number in the model's answer that no tool returned.

## Validation and tests

- Jezero terrain vs 708 Perseverance waypoints: median offset -1.06 m, mean -0.89 m, standard deviation 3.25 m, 95th percentile of the absolute offset 6.44 m (`data/validation.json`). Rover heights are a separate NASA product, so this is a cross-check, not ground truth.
- Global MOLA grid vs the 20 m CTX model at the Perseverance landing site: 11.3 m (`data/global_validation.json`).
- Mars24 sun and time code matches the NASA GISS worked examples (`tests/ops/mars24.test.ts`).
- 451 unit tests in 41 files pass (`npm test`, 15 Nov 2026). Playwright: 15 of 15 e2e tests passed on the last recorded run, including the GO path (drag, NO GO for a radio shadow, raise the mast to 20 m, GO).

Details: [docs/SCIENCE_AND_VALIDATION.md](docs/SCIENCE_AND_VALIDATION.md).

## Data credits

NASA/JPL Mars Trek (terrain, Viking MDIM 2.1, CTX mosaic, THEMIS, TES dust, traverse); NASA/JPL/MSSS/USGS (MRO CTX DEM and orthomosaic); NASA/JPL/ASU (Mars Odyssey THEMIS); NASA/GSFC MGS MOLA via the PDS Geosciences Node; Mars Odyssey GRS (Boynton et al. 2007) and MGS TES (Putzig and Mellon 2007; Ruff and Christensen 2002) via PDS and Mars Trek; USGS SIM 3292 (Tanaka et al. 2014) and SIM 3464 (Sun and Stack 2020); NASA/JPL-Caltech Perseverance waypoints and raw images; NASA JPL Horizons; NASA GISS Mars24; NASA/JPL Mars 2020 landing press kit; JPL MSL landing-site engineering guide. Full list with URLs: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

This project is not affiliated with or endorsed by NASA or USGS and uses no NASA logos or mission insignia.

## Limitations

- The 20 m Jezero model cannot see boulders or small scarps. Slopes are averaged over the cell.
- Outside Jezero the terrain is global: the MOLA grid is about 7.4 km per cell, so regional slope is a kilometre-scale value. The CTX global mosaic is uncontrolled imagery.
- Suit power, battery, walking-speed factor, crew mass, mast height and the comms rule are assumptions, not a NASA suit or EVA model.
- A planned EVA starts at the next 09:00 local solar time at the base by default (change it under Limits). Base camp reach applies battery, EVA time, slope and daylight, not comms.
- No live weather, dust, radiation or orbiter relay passes.
- Landing criteria are the MSL (Curiosity) constraints used as a reference, not the Mars 2020 requirements.
- The agent's prose can be wrong. The number guard checks numbers, not reasoning.

## AI disclosure

Built with AI coding assistants, and the app contains a runtime language-model agent. No AI-generated images are shown in the app. Details: [docs/AI_USE.md](docs/AI_USE.md).

## Documentation

[Submission draft](docs/SUBMISSION_DRAFT.md) | [Challenge alignment](docs/CHALLENGE_ALIGNMENT.md) | [Data sources](docs/DATA_SOURCES.md) | [Science and validation](docs/SCIENCE_AND_VALIDATION.md) | [AI use](docs/AI_USE.md) | [Demo video plan](docs/DEMO_30_SECONDS.md) | [Requirements checklist](docs/REQUIREMENTS_CHECKLIST.md) | [UI spec](docs/UI_SPEC.md)

## Licence

Code: MIT, see [LICENSE](LICENSE). Data and third-party libraries keep their own terms (see DATA_SOURCES and the references in SUBMISSION_DRAFT).
