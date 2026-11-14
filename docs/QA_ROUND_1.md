# HeyMars QA round 1 (15 Nov 2026)

Reviewed: all 24 states at 1440x810, samples at 1024x768 and 390x844, planet2 screens, report md/json/geojson, and the code behind each finding. The sample PDF could not be rendered here (no poppler), so PDF layout is unreviewed.

## A. Verdict

Not yet. The shell, panel and report are close to production quality, but one maths bug produces a wrong plan on screen, and the walk, helmet and reach views do not meet the "real land, real objects" bar.

## B. Fix list

Severity: P0 blocks submission, P1 clearly visible, P2 polish.

### 1. Numbers and verdicts

| # | Sev | Where | Wrong | Should be |
|---|---|---|---|---|
| 1.1 | P0 | `src/lib/terrain/astar.ts:141`, `src/lib/terrain/route.ts:70-95`; state route-nogo-card 1440 | A* checks cell slope only on the cell it enters, never on the start cell. A target on a steep cell fails outbound but succeeds on the return. `planRoute` keeps the one surviving leg and sums totals from it. The card then shows a one-way leg as "Round trip 2.34 km, 1 h 16 min, 84.2 %" (the step list itself says outbound 2.34 km and return 2.34 km), slope 12.4° under a 15° limit marked red, and the report prints "70° start, 54° end, lowest 60°". | In `solvePath`, return `no_path` when `slopeMaxDeg[start] > maxSlope`. In `planRoute`, if any leg fails set `legs = []` and zero the totals. Add a test: `solvePath(a,b).ok === solvePath(b,a).ok` over random pairs. |
| 1.2 | P0 | No-path card, panel answer, map | With no path the card still lists time, battery and daylight with green dots and offers Walk it, Helmet view, Cuff card and "Raise mast to 20 m". | No-path card: headline "No path under 15° reaches this point", rows Target slope (value / limit, red) and Smallest limit that works (25°). Actions only "Replan at 25°" and "Pick nearest reachable point" (snap to the nearest admissible cell within 100 m and say how far it moved). No route drawn, no mast action. |
| 1.3 | P1 | `src/app/flow.ts:305`, `Panel.tsx:127` | Mast action appears on the card and again as a chip. The chip shows whenever the reason text matches /shadow|comms/. | Offer it once, on the card, and only when comms is a blocker and slope is not. Remove the chip. |
| 1.4 | P1 | `flow.ts:206`, landing-sim states | "across a 3.85 by 3.3 km ellipse" quotes semi-axes as the size. Green lead "100% land under 15°" comes from 1/8° MOLA cells (about 7 km) that are larger than the ellipse. A "Not enough data" tag stays on the same spot. | "7.7 by 6.6 km ellipse (semi-axes 3.85 and 3.3 km)". Lead in neutral tone: "Coarse terrain only". Row "Terrain cell 7.4 km, wider than the ellipse". Clear the earlier tag when the simulation starts. At Jezero run the same simulation on the 20 m DEM. |
| 1.5 | P1 | `public/data/global/edl_mars2020.json` trn_radar 260 to 350 s, `descent.ts` phaseCaption | Caption "Terrain-Relative Navigation and radar" at 7.7 to 8.6 km. NASA window cited in the same file is 4.2 to 2.2 km. | Split the phase: "Radar acquires the ground" from 260 s, "Terrain-Relative Navigation" only while altitude is between 4.2 and 2.2 km. Drive the caption by altitude for this phase. |
| 1.6 | P1 | base-camp-reach, `flow.ts:571` (`maxRadiusM: 4000`) | "Home within 49.7 km²" is almost exactly a 4 km circle (50.3 km²). The result is the search cap, not the reserve. One contour labelled "240 min", outer ring unlabelled. | Either extend the search until reserve or EVA time binds, or say "Search stopped at 4 km; the crew still has N min of reserve there". Label every contour with minutes of reserve. |
| 1.7 | P1 | Top bar on the globe | Local solar time and sun elevation shown with no place selected. Mission time stays at T+00:14:57 after a simulation ends. | Label the cell with the place it refers to (base, or the clicked point). Reset mission time to T+00:00:00 when no simulation is loaded. |
| 1.8 | P2 | Report 3 and 4.3 | Leg ascents 33 + 19 = 52 m, formula uses 51 m. | Round legs from the same unrounded total, or print 51.3 m. |
| 1.9 | P2 | Route label "30 min" / "60 min" at the target | Meaning unclear (dwell is 30 min in both). | "Target, 30 min stop" or the arrival time "T+00:46". |

### 2. Simulation visuals

| # | Sev | Where | Wrong | Should be |
|---|---|---|---|---|
| 2.1 | P0 | walk-playback, rover-assist (all viewports), `Crew.tsx:136` | Crew about 20 px tall, one figure readable. Scale is `dist/70`, capped by a far camera. | Walk starts a chase camera 25 to 40 m behind the pair, 6 m up, at true scale, so each astronaut is at least 90 px tall at 810 px height. Wide view stays one click away. |
| 2.2 | P0 | walk, rover, helmet, phone walk | Huge white dashed strokes cross the frame (Perseverance traverse dashes sized in world units) and dominate the view. | Hide the traverse during Walk, Helmet and Reach. Elsewhere draw it as a 1 px solid bone line at 45 % opacity with screen-space width. |
| 2.3 | P0 | helmet-view 1440 and 1024 | A thick red vertical bar and an orange line run through the centre of the view (route seen end-on at 3 px with casing), plus a second dark line floating beside the route. The spec asks for an empty centre. | In helmet view draw the route as a 1.5 px ground-draped line that fades out within 3 m of the eye, no casing. No vertical marker. |
| 2.4 | P1 | walk, rover, helmet close-ups; planet2-jezero-15km-oblique; planet2-landing-t405 | Ground is soft upsampled imagery with no detail near the camera. | Near the route load the CTX 6 m ortho at native resolution, anisotropic filtering 16, no mip bias. Keep close cameras no lower than the height where one texel covers at most 3 screen px. Where only global data exists, show "Imagery here is 232 m per pixel" beside the legend. Do not add synthetic detail. |
| 2.5 | P1 | route line, walk | Whole route is a 3 px solid red line with a black casing. | 1.5 px ochre with 100 m ticks. Only the failing stretch is red and hatched, per the design system. |
| 2.6 | P1 | landing-sim-touchdown | Rover and stage sit at the top edge, half out of frame. Dots are green while the legend says blue. Dots are large and hide the ground. Legend is top-left here and bottom-left elsewhere. | Keep the vehicle in the middle third until 10 s after touchdown, then pull back. Legend colours match the dots. Dots 3 px. Legend always bottom-left. |
| 2.7 | P1 | base-camp-reach | Habitat reads as a dome with stray black slabs and lines. | Matte habitat with a visible airlock and mast, no floating parts; check from the default reach camera. |
| 2.8 | P1 | lasso | The lasso outline is gone once the answer shows. | Keep the polygon as a 1 px dashed bone outline until the card closes. |
| 2.9 | P1 | rover-assist | Rover and crew are about 200 px apart while the narration says the rover carries the crew. | Crew ride on the rover for the carried stretch, dismount at the hand-off point, rover parks there with a tag. |
| 2.10 | P1 | planet-idle | A lighter rectangle (imagery patch) is visible on the globe right of centre. | Feather or colour-match the patch edge, or only enable it below 500 km altitude. |

### 3. Layout, spacing, type

| # | Sev | Where | Wrong | Should be |
|---|---|---|---|---|
| 3.1 | P1 | 390 walk-playback | Crew tag is cut off at the right edge. | Clamp tags inside the stage; flip to the left of the figure near the edge. |
| 3.2 | P1 | 390 report | Toolbar overflows; Close is off-screen. | Close pinned right; exports collapse into one "Export" menu under 600 px. |
| 3.3 | P1 | 390 all states | 56 px rail takes 14 % of the width. | Under 600 px the rail becomes a 48 px bottom bar, or icon-only at 40 px. |
| 3.4 | P1 | 1024 route-nogo-card | Card sits on top of the route and base. | Place the card on the side of the stage away from the route bounding box. |
| 3.5 | P1 | Panel prose | `NUM` in `Companion/parts.tsx:70` styles "10,000 s" out of "10,000 simulated", splits "95th" and "90th", and turns the years 2006 and 2020 into bold data. | Add `(?![A-Za-z])` after the unit group, skip ordinals and four-digit years. |
| 3.6 | P2 | Report card | Five buttons wrap, leaving GeoJSON alone on a second row. The card repeats under every turn. | One row (Open, then PDF, MD, JSON, GeoJSON). Full card only on the latest turn with a plan; older turns show a one-line "Report" link. |
| 3.7 | P2 | Cards and panel tables | Grey dots on info rows carry no meaning. | Dot only for pass, caution, fail. |
| 3.8 | P2 | Helmet HUD, Limits | "66deg", "0.5 deg", "15 deg", "Slope , next 100 m". | "66°", "0.5°", "15°", "Slope, next 100 m". |
| 3.9 | P2 | cuff-card | Preview text is about 5 px and unreadable, on a navy panel. | Render at wrist width with 11 px mono, black on white as specified, scroll inside the sheet. |

### 4. Copy

| # | Sev | Where | Wrong | Should be |
|---|---|---|---|---|
| 4.1 | P1 | `flow.ts:668` | "(assumption, src/lib/ops/assumptions.ts)" shown to users. | "(HeyMars planning assumption, not a NASA rule)". |
| 4.2 | P1 | landing-check answer | Long defensive paragraph: "could not be verified from a NASA page that was fetched and read", "NOT" in capitals. | "Not enough data to judge. 3 of 8 criteria pass and 5 need terrain finer than the global model. Limits are the Curiosity landing-site constraints (JPL, 2006), used as a reference, not the Mars 2020 requirements." Detail goes into How I worked it out. |
| 4.3 | P1 | `cuffCard.ts:216`, `agent/server.ts:119` | "MARSWALK CUFF CARD", "MarsWalk Copilot". | "HEYMARS CUFF CARD", "HeyMars". A cuff card for a NO GO route carries "NO GO, planning only" on its first line. |
| 4.4 | P2 | Panel meta | "0 steps, no model". | Hide the step count when it is 0; "fixed code" reads better than "no model". |
| 4.5 | P2 | Panel answers | "The route is fine on time (1 h 16 min), battery (84.2 % left), but..."; "0% is over the 15° limit." | "Time and battery pass. ..."; "None of the area is over 15°." |
| 4.6 | P2 | Sources | Raw filename as a title (JEZ_ctx_B_soc_008_DTM...). | "Jezero CTX terrain model, 20 m (MRO)", filename in the detail line. |
| 4.7 | P2 | Drag preview | "no path under the limit" in lower case. | Sentence case, same wording as the card. |

### 5. Agent experience

| # | Sev | Where | Wrong | Should be |
|---|---|---|---|---|
| 5.1 | P1 | Narration times | Every line in a turn shows the same time (0.49 s x6, 1.22 s x3, 1 ms x3). It is cumulative time at the end, replayed, so it reads as staged. | Show each line's own measured duration; omit it under 5 ms. Lines for slow work (A*, reach, Monte Carlo) must appear while the work runs. |
| 5.2 | P1 | landing-check-streaming | The line with the spinner is past tense ("Checked 8 landing criteria") and the map already shows the verdict tag. | Present tense while running, past when done. Verdict tag appears only when the turn completes. |
| 5.3 | P1 | Landing narration order | "Ran 10,000 touchdowns" is listed before "Loading the Mars 2020 EDL timeline". | Order as executed. |
| 5.4 | P1 | Challenge coverage | No state shows surface imagery from the crew's point of view, although the report lists "Perseverance raw images, photos". The route card has no science row. | At a click or stop within 150 m of the traverse show the nearest Perseverance Navcam or Mastcam-Z frame with sol and credit, on the card and in the report. Add a card row "Science at target" (geologic unit and nearest catalogued stop). If photos cannot ship, remove them from the sources table. |
| 5.5 | P2 | Report | Landing check and landing simulation are absent from the sample (null). Trace rows 5 to 10 have blank time cells. | Include landing sections when run in the session; print the measured ms or "under 1 ms". |

### 6. Performance and robustness

| # | Sev | Where | Wrong | Should be |
|---|---|---|---|---|
| 6.1 | P1 | Tests | The QA harness shipped screenshots of the half-route state without failing. | e2e assertion: a card with verdict NO GO never shows a red row whose value is inside its limit, and round trip length equals the sum of two legs. |
| 6.2 | P2 | Mission clock | Clock keeps the last simulation time when the timeline collapses. | Covered by 1.7; add a test. |
| 6.3 | P2 | PDF | Not reviewed here. | Orchestrator to check page breaks inside tables and code blocks. |

## C. Good, do not break

- Shell proportions: 40 px bar, 56 px rail, 336 px panel, map as hero. Typography and tokens are consistent and calm.
- Map card and panel sync: "Asked on the map at ..." tags, "in panel" link, same numbers in both places.
- How I worked it out: Tobler, battery, curvature, Mars24 and light-time formulas with substituted numbers. I rechecked them (Tobler 3.19 km/h, light time 657.5 s, Ls 22°, MSD 54,343, sun 70° at 13:11, daylight margin in Earth minutes) and they are right for a complete route.
- Deterministic recompute for "what if the suit draws 300 W", and the plain statement that the 0.5 km comms limit is an assumption.
- Report viewer: fixed toolbar and contents, paper scrolls inside, observed/computed/assumption tags, 708-waypoint validation, GeoJSON with per-vertex elevation.
- Parachute and sky crane models at true scale; Jezero wide view on CTX terrain.
- Sources sheet with full citations; "Not affiliated with NASA" line; intro screen.
