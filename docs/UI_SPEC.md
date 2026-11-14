# HeyMars production UI spec (approved mockup v4, 15 Nov 2026)

Reference: `deliverables/mockup/index.html`. Match it; where the mockup is static, behaviour below wins. Design tokens and fonts: `docs/DESIGN_SYSTEM.md` (Schibsted Grotesk, Martian Mono, Michroma; near-black; no cartoon, no sci-fi glow).

## Principle
The map is the product. Chrome is small: top bar 40 px, left rail 56 px, bottom timeline 46 px, MarsAgent panel 336 px (collapsible to 0). Everything else is the 3D view.

## Names
App: **HeyMars** (wordmark `HEYMARS`, Michroma). The agent: **MarsAgent**, one agent shown in two synced places. No "Copilot", no "Scout" in UI text. Byline: "Ng Yu Hang, team Ecliptical".

## Layout
- **Top bar (40 px):**
  - Wordmark.
  - Breadcrumb (Mars > region > place, from the current view or selection).
  - Mission clock: four cells, mission time / local solar time (Mars24) / sun elevation / Earth light delay (JPL Horizons).
  - Byline.
  - MarsAgent toggle button (opens/closes the panel; state persisted). There is NO report button in the top bar.
- **Left rail (56 px):** Lucide icon plus an 8.5 px label for each tool.
  - Tools: Plan, Lasso, Landing, Walk, Helmet, Reach, then a divider, then Layers, Limits, Sources, Cuff card.
  - The active tool is highlighted, and each tool has a tooltip with a one-line description.
- **Stage:** Cesium planet view (orbit to ground) or the Jezero 20 m scene. Legend bottom-left, small.
- **Timeline (46 px):** play/pause, sun-arc scrubber with phase ticks, mission time, speed 1× / 10× / 60× / 600×. Shown only when a simulation is loaded; otherwise it collapses to a slim status line.

## MarsAgent on the map (cursor companion)
- **Reticle:** a 28 px ring with ticks, a heading notch and a cyan centre dot. It trails the cursor and shows a mono readout (lat, lon, elev, slope after a dwell).
- **Click or ask:** the reticle anchors to the point and a **compact card** (300 px) appears.
  - Verdict word or place name, and coordinates.
  - A data table of 4 to 6 rows with status dots.
  - Action buttons with icons.
  - An ask line (type, or hold Space to talk).
  - A link mark "in panel".
- **No duplication of long content:** details live in the panel.

## MarsAgent panel (right, collapsible)
- **One synced thread.** Questions asked on the map appear here, tagged "Asked on the map at <lat lon>". Questions typed here act on the map: the camera moves, routes are drawn.
- **Each agent turn:**
  1. **Live narration** while working: first-person, plain lines streamed one by one ("Planning a round trip from base with A*, slope limit 15°") with a check and elapsed time when each completes. A static loader icon on the current line; no pulsing.
  2. Optional **Narrate aloud** toggle (browser speech synthesis reading the narration lines; off by default; labelled synthetic voice).
  3. **How I worked it out**: collapsible step list (model / tool / calculation / verdict), with formula code blocks showing real substituted numbers, sources and timings. Each step can be expanded to raw JSON.
  4. The **answer**: a short paragraph plus a compact table.
  5. A **report card** at the end of the turn: "Mission planning report", with Open, PDF, Markdown, JSON and GeoJSON.
- **Composer:** context chips plus input ("Ask about the plan or the maths") plus a sync note. Follow-ups on maths recompute deterministically and show the recomputation.

## Report
- Opens as a viewer over the app.
  - Contents sidebar on the left.
  - A paper document in the centre that **scrolls inside its own container**.
  - The toolbar and sidebar stay fixed.
  - The page behind must not scroll (lock body scroll while open).
- Sections:
  1. Summary and verdict.
  2. Inputs and constraints, each tagged observed / computed / assumption.
  3. Route legs.
  4. Calculations (every formula with numbers).
  5. Go/no-go rules with sources.
  6. Data sources and validation (708 waypoints).
  7. Assumptions and limits.
  8. Agent trace.
- Exports work for real:
  - **PDF:** a print stylesheet plus `window.print()` of the report only, or a generated PDF.
  - **Markdown, JSON:** all inputs, tool calls, results and formulas.
  - **GeoJSON:** route legs with per-vertex elevation.
- Generated from the actual session state. Where data is missing, show a clearly marked "Mock" value rather than inventing silently.

## Simulations must place real 3D objects in the scene
- **Walk:** two 3D astronauts walk the route on the terrain at the model's speed, with suit tags; the rover drives in rover-assist mode; base camp shows a habitat model plus reach contours.
- **Landing:** a 3D lander descends along the EDL arc to the touchdown site on the real terrain, with phase captions from the cited NASA timeline (parachute, heat-shield separation, powered descent, sky crane) and touchdown points scattered on the ground. Camera: oblique, low, terrain and horizon visible.
- **Look:** realistic proportions, matte materials; no cartoon outlines.

## Quality gate (must pass before deploy)
- No overlap or clipping of any UI or label at 1440×810, 1280×720 and 1024×768; at 390×844 the panel becomes a bottom sheet.
- Text contrast ≥ 4.5:1.
- Every control is keyboard reachable.
- No console errors.
- The report scrolls internally.
- Every simulation visibly shows its 3D objects.
- `tsc`, vitest, build and Playwright e2e all green.
- I review screenshots of every state before shipping.
