# Challenge alignment (DRAFT)

Challenge: Interplanetary Survival Guide: Martian Map. https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/

The left column paraphrases the official statement and its considerations. The right column names the feature that answers it. `TODO(verify)` means the feature depends on code that was not confirmed when this was written.

| Challenge asks for | MarsWalk Copilot | Status |
| --- | --- | --- |
| A layered, integrated view of a location or route on Mars | One 3D scene of the Jezero patch with toggleable and blendable layers: CTX optical, THEMIS day and night IR, USGS geology, slope, Perseverance traverse, landing ellipse. Routes and pins draw on the same terrain. | TODO(verify) |
| Data pulled from multiple NASA science missions | MRO (CTX DEM and ortho), Mars Odyssey (THEMIS), Mars 2020 (waypoints, traverse, raw images), USGS-NASA Planetary Geologic Mapping Program (SIM 3464). See DATA_SOURCES.md. | TODO(verify) |
| Help a human explorer plan and carry out a successful Marswalk | Round-trip planner from a base point, multi-stop loops, per-route time, battery, ascent and maximum slope, turn-back point. | TODO(verify) |
| While doing science | Science objective picker ranks candidate stops by mapped geologic unit and distance; "what's here" answers cite the map's own unit description; rover photos near each stop. | TODO(verify) |
| Suggested: at least 3 kinds of data (optical, thermal, spectral, topographic, ...) | Optical (CTX), thermal (THEMIS), topographic (DEM, slope), geologic (SIM 3464), surface imagery (Perseverance). Spectral is not used. | TODO(verify) |
| Safety | Hard slope limit in the planner, battery reserve, EVA time limit, named infeasibility reason, smallest feasible slope, turn-back point, wording that this is a model and not a certification. | TODO(verify) |
| Route map that avoids obstacles | A* over a 40 m grid where any edge or cell above the slope limit is blocked, and nodata cells are excluded. Boulders are not resolved at 20 m, stated in the app and docs. | TODO(verify) |
| Consider spacesuit mobility | Walking speed is the Tobler hiking function scaled by an assumed suit factor (default 0.6). Suit power, battery capacity and crew mass are editable assumptions. Not a NASA suit model. | TODO(verify) |
| Rover point-of-view imagery so they know what to expect | Perseverance raw images nearest a chosen point, with sol and camera, credited to NASA/JPL-Caltech. | TODO(verify) |
| Existing tools (Mars Trek, USGS-NASA PGM) are regional or global, not hyperlocal | 20 m terrain and 40 m planning grid for one roughly 30 km patch, with per-walk planning from a base point. The data itself comes from Mars Trek and the USGS-NASA program. | TODO(verify) |
| A view usable at a habitat or on a tablet (plan context, not a stated rule) | Planning-console layout intended to work at tablet width. | TODO(verify) |
| Resources tab: JPL Mars Trek | CTX DEM and ortho, THEMIS, traverse and nomenclature used. | |
| Resources tab: USGS-NASA Planetary Geologic Mapping Program | SIM 3464 Jezero map used for the geology layer. | |
| Resources tab: Perseverance raw images | Used for point-of-view photos. | TODO(verify) |
| Resources tab: Curiosity proposed path example | Not used as data. Used as a model of what a proposed traverse view looks like. | |
| Resources tab: NASA Worldview | Not used (Earth observation viewer). | |

## Where this goes beyond the brief (AI)

An agent that operates inside the scene: it reads the clicked point, calls deterministic tools, and draws persistent annotations. The agent is an interface to the tools. It does not produce numbers.

## What it does not address

Radiation, dust and weather, communications, rock hazards below 20 m, and real EVA consumables.
