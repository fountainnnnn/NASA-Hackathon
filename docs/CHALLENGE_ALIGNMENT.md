# Challenge alignment

Challenge: Interplanetary Survival Guide: Martian Map. https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/

The left column paraphrases the official statement and its considerations. The right column names the HeyMars feature that answers it. "Verified" means it is covered by a unit or e2e test, or seen in the 15 Nov screenshots in `deliverables/screens/`.

| Challenge asks for | HeyMars | Status |
| --- | --- | --- |
| A layered, integrated view of a location or route on Mars | One map from the whole planet down to the 20 m Jezero model. Global layers: MOLA elevation and slope, SIM 3292 geology, GRS hydrogen, TES thermal inertia, TES dust. Jezero layers: CTX imagery, THEMIS day and night, SIM 3464 geology, slope limit, Perseverance traverse, landing ellipse. Routes, verdicts and simulations draw on the same terrain. | Verified (e2e, screenshots) |
| Data from multiple NASA science missions | MRO (CTX DEM, ortho, global mosaic), MGS (MOLA, TES), Mars Odyssey (THEMIS, GRS), Viking (MDIM 2.1), Mars 2020 (waypoints, traverse, raw images, EDL timeline), USGS-NASA geologic mapping (SIM 3292, SIM 3464), JPL Horizons. See DATA_SOURCES.md. | Verified (`data/source_manifest.json`, Sources sheet e2e) |
| Help a human explorer plan and carry out a Marswalk | Drag from base to plan a round trip. The card gives distance, time, battery at return, maximum slope, comms shadow and daylight margin, with a GO, HOLD or NO GO verdict. Walk playback, helmet view, rover assist, base camp reach contours and a cuff checklist support carrying it out. | Verified (e2e, screenshots) |
| While doing science | Science at target: geologic unit (SIM 3464), the nearest catalogued Perseverance science site, and the nearest Perseverance raw image. Lasso reports slope share and geology for an area. | Verified (screenshots r1-route, r1-walk-chase) |
| Suggested: at least 3 kinds of data | Topographic (CTX DEM, MOLA), optical (CTX, Viking), thermal (THEMIS, TES thermal inertia), chemical (GRS hydrogen), geologic (SIM 3292, SIM 3464), surface imagery (Perseverance), ephemeris (Horizons). | Verified |
| Safety | Slope limit on every edge and cell, battery reserve, EVA time limit, daylight at return, radio line of sight to the base mast, terrain coverage. Each gets go, caution or no-go with its rule and source. No-path answers give the reason, the smallest slope limit that works and the nearest reachable point. Wording says the plan is feasible under a model, not certified. | Verified (unit tests, e2e) |
| Route map that avoids obstacles | A* on a 40 m grid where an edge is blocked if its grade or either cell's slope exceeds the limit. Nodata cells are excluded. Boulders below 20 m are not resolved, and the app and docs say so. | Verified (unit tests) |
| Consider spacesuit mobility | Walking speed is Tobler's hiking function times a suit factor of 0.6. Suit power, battery, crew mass and dwell are labelled assumptions and can be changed under Limits. Not a NASA suit model. | Verified |
| Rover point-of-view imagery | The nearest Perseverance raw image (Mastcam-Z, Navcam or Hazcam) to the target, with sol, camera, distance and credit, on the card, in the panel and in the report. | Verified (screenshots, sample report) |
| Existing tools are regional or global, not hyperlocal | Walking-scale planning on the 20 m CTX model and a 40 m planning grid at Jezero, from a base point. The data comes from Mars Trek and the USGS-NASA program. | Verified |
| Usable at a habitat or on a tablet (plan context, not a stated rule) | Layouts for 1440x810, 1280x720, 1024x768, and 390x844 with the panel as a bottom sheet. Cuff checklist exports at wrist width. | TODO(verify): last full four-viewport layout QA result |
| Resources tab: JPL Mars Trek | Global terrain, Viking and CTX mosaics, CTX DEM and ortho, THEMIS, TES dust, traverse, nomenclature. | Used |
| Resources tab: USGS-NASA Planetary Geologic Mapping | SIM 3292 (global) and SIM 3464 (Jezero). | Used |
| Resources tab: Perseverance raw images | View from the ground at a target. | Used |
| Resources tab: Curiosity proposed path example | Not used as data. | |
| Resources tab: NASA Worldview | Not used (Earth observation viewer). | |

## Singapore Local Lead requirements (email, 13 Nov 2026)

| Requirement | Where it is met | Status |
| --- | --- | --- |
| Name every NASA dataset, link it, and say how it supports the solution | NASA Data table in SUBMISSION_DRAFT.md: dataset, mission and instrument, exact URL, what it lets the astronaut decide. The app's Sources sheet lists the same sources with links. The video carries a NASA data credit line. | Done in text and app. TODO(verify): credit line in the final video render |
| Summary covers solution, problem and impact | High-Level Project Summary: problem (Earth light delay), solution, evidence, impact. | Done in text |
| Details cover approach, tools, technologies and NASA datasets | Detailed Project Description: what it does, how it works, tools and languages, NASA Data. | Done in text |
| Evidence for validity | 708 Perseverance waypoints (median offset -1.06 m), MOLA vs CTX at the landing site (11.3 m), Mars24 tested against NASA GISS, 435 unit tests. | Done in text |
| Submit early | Target Sun 15 Nov 18:00 SGT. Official deadline 23:59. | Open, human action |
| Optional mentor Zoom | Sun 15 Nov 17:00 SGT. | Open, human action |

## Where this goes beyond the brief

- An agent that works inside the map: it reads the clicked point, runs deterministic tools, draws the result and shows every step with real numbers. The model never produces a number.
- Landing as well as walking: published landing criteria, a Monte Carlo touchdown scatter and a 3D lander on the Mars 2020 timeline.
- Earth link: the light delay and whether Earth is above the horizon, from JPL Horizons, which is why the planning has to happen on Mars.

## What it does not address

Radiation, live weather and dust, orbiter relay passes, hazards smaller than 20 m, and real EVA consumables.
