# MarsWalk Copilot

> DRAFT. Items marked `TODO(verify)` depend on code and test results that were not available when this was written. `TODO(link)` marks URLs that do not exist yet.

A solo entry to the NASA Space Apps Challenge 2026 (Singapore Local Event), challenge **Interplanetary Survival Guide: Martian Map**.
Challenge page: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/

MarsWalk Copilot is a 3D map of a roughly 30 km patch of Jezero Crater built from NASA and USGS mission data. You click a point on the terrain, ask a question, and an AI agent calls deterministic tools (slope analysis, route planning, geology lookup, rover photo search). Each tool result is drawn on the terrain itself, and the agent explains it. Change a constraint and the route is recomputed.

- Demo (video, 30 s or less): TODO(link)
- Demo (slides, 7 or fewer): TODO(link)
- Live app: https://web-production-9b58e394.up.railway.app
- Repository: https://github.com/fountainnnnn/NASA-Hackathon

## Hero use case

1. Orbit the terrain and click a ridge or a crater edge. A pin drops with latitude, longitude and elevation read from the DEM.
2. Ask "What is this area, and can I get there and back from base?" The agent reads the selected point from scene state, looks up the geologic unit, plans a round trip and draws it with distance, ascent, maximum slope, time and battery use.
3. Say "Avoid slopes above 12 degrees and keep 25% battery." The route solver runs again with the new limits. You get a different path, or a named reason why none exists.
4. Ask "Show me the dangerous part." The steepest stretch is highlighted on the terrain.

The same tools sit behind the HUD buttons, so the planner works without the agent. TODO(verify): offline behaviour with no API key.

## Data layers

| Layer | Source |
| --- | --- |
| Elevation and slope | MRO CTX DEM, 20 m (USGS Astrogeology, via JPL Mars Trek) |
| Optical | MRO CTX orthomosaic, 6 m |
| Thermal | Mars Odyssey THEMIS day and night IR, 100 m |
| Geology | USGS SIM 3464 Jezero geologic map, 1:75,000 |
| Surface | Perseverance raw images, waypoints and traverse |

Validation: the terrain agrees with 708 Perseverance waypoints, median offset 1.1 m, mean bias −0.9 m (rover heights are a separate NASA product, so this is a cross-check, not ground truth). Details in `data/validation.json`.

Full list, links, processing and licence notes: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Run it

Requires Node.js 22 or later. TODO(verify): minimum Node version.

```bash
npm i
cp .env.example .env.local        # add OPENROUTER_API_KEY to enable the agent
node scripts/prepare-data.mjs     # downloads and crops the NASA/USGS data into public/data
npm run dev
npm test
```

TODO(verify): whether `prepare-data.mjs` is needed on a fresh clone or the prepared data is committed. TODO(verify): `npm run build` and Playwright e2e commands.

Environment variables (see `.env.example`): `OPENROUTER_API_KEY` (server only), `AGENT_MODEL` (default `anthropic/claude-haiku-5.5`), `AGENT_FALLBACK_MODEL` (default `openai/gpt-6-luna`), `AGENT_DAILY_CAP`.

## Architecture

```
 scripts/prepare-data.mjs  (offline, run once)
   |  Mars Trek / USGS / NASA MMGIS downloads -> crop, convert
   v
 public/data/*  dem.i16, ctx.jpg, themis*.jpg, geology.json, traverse.json, ...
   |                                   data/source_manifest.json, data/validation.json
   v
 +---------------------------- browser ----------------------------+
 |  components/Scene (React Three Fiber)  <--- state/world.ts (Zustand, only mutable state)
 |         ^                                        ^   |
 |         | render                                 |   | snapshot
 |  lib/scene/commands.ts (allowlisted reducer)     |   v
 |         ^                                 lib/agent (tool loop <= 8 rounds, number guard)
 |         | commands                               |  tool calls          ^ proxied chat
 |  HUD buttons ---- same tools ----> lib/terrain (Web Worker: slope, A*, resources)
 |                                    lib/science (geology, names, sites, rover images)
 +--------------------------------------------------|---------------+
                                                    v
                              app/api/agent  (server: key, fixed model, prompt, tools)
                                                    v
                                      OpenRouter (Claude Haiku 5.5, fallback GPT-6 Luna)
```

The model chooses tools. The tools produce every number and every coordinate. A number guard flags figures in the answer that do not appear in any tool result.

## Science, in brief

Horn slope on the 20 m DEM, a 40 m planning grid, 8-connected A* with a hard slope limit, Tobler hiking speed scaled by an assumed suit factor, and a linear battery model. All suit constants are labelled assumptions. This is not a NASA EVA or life-support model and gives no safety certification. Equations, assumptions and tests: [docs/SCIENCE_AND_VALIDATION.md](docs/SCIENCE_AND_VALIDATION.md).

## Limitations

- A 20 m DEM cannot resolve boulders or small scarps. Slopes are averaged over the baseline.
- Walking speed, suit factor, power draw and battery capacity are assumptions.
- No radiation, dust, weather, communications or live data.
- THEMIS brightness is qualitative. The geologic map is a 1:75,000 interpretation.
- One 30 km patch of Jezero only.

## AI disclosure

Built with AI assistance, and the app contains a runtime LLM agent. Details, including AI-generated art: [docs/AI_USE.md](docs/AI_USE.md).

## Documentation

[Requirements checklist](docs/REQUIREMENTS_CHECKLIST.md) | [Submission draft](docs/SUBMISSION_DRAFT.md) | [Challenge alignment](docs/CHALLENGE_ALIGNMENT.md) | [Data sources](docs/DATA_SOURCES.md) | [Science and validation](docs/SCIENCE_AND_VALIDATION.md) | [AI use](docs/AI_USE.md) | [Demo script](docs/DEMO_30_SECONDS.md)

## Licence and credits

Code: MIT, see [LICENSE](LICENSE). NASA and USGS data keep their own terms and credits (see DATA_SOURCES). This project is not endorsed by NASA or USGS. It does not use NASA logos or mission insignia.
