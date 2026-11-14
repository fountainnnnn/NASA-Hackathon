# MarsWalk Copilot demo video (29.0 s, 1920x1080, silent)

## Phase B: two commands from this folder

```bash
node capture.mjs http://localhost:3000        # or the Railway URL. Records the app, cuts footage/c02..c06.mp4
npm run build:film && npm run render:final    # generate scenes, assemble index.html, render renders/marswalk-demo.mp4
```

Gate before upload (must print 30.0 or less, target 29.0):

```bash
npm run gate        # ffprobe duration of renders/marswalk-demo.mp4
```

Also run `npm run qa` (layout QA, must report 0 errors) and look at 2 or 3 frames per scene.
Chrome-based tools (qa, render, capture) need to run outside the Claude sandbox on macOS.

Set the real link: edit `"link"` in `film.config.json` (currently the placeholder `[link]`), then rerun `npm run build:film`.
Faster draft: `npx hyperframes render --fps 30 --quality draft --output renders/draft.mp4` (with the `.bin` PATH, see `render:final`).

## Timeline (29.0 s)

| Scene | Time | Content |
| --- | --- | --- |
| s01 | 0.0-2.5 | Title, name and team |
| s02 | 2.0-5.5 | Terrain footage (c02): "Mars maps show regions. Astronauts plan one walk." |
| s03 | 5.0-10.5 | Click and pin (c03): "Point at Mars. Ask. It plans." |
| s04 | 10.0-15.0 | Ask and route (c04): "The agent calls tools. The tools do the math." |
| s05 | 14.5-20.5 | Constraint and replan, Sources (c05): "Change a limit. It replans." plus the data credit line |
| s06 | 20.0-25.5 | Rover photos or terrain (c06): "Built for the first walks on Mars." |
| s07 | 25.0-29.0 | Link |

Joins are 0.5 s zoom transitions, so scene times overlap. Until `footage/cNN.mp4` exists, a scene shows a grey "CAPTURE PENDING" frame.

## What capture.mjs does (selectors, all from src/components/HUD)

1. Goto the URL, wait for the loading overlay (`role=progressbar`) to hide, then for the canvas (`aria-label` "3D terrain...").
2. A small orbit drag on the canvas, then a click at 30%, 55% of the canvas (override: `--click 0.30,0.55`). ASSUMPTION: that spot is on the western delta.
3. If an "Ask the copilot" opener button is visible, click it. Type into the input labelled "Question for the copilot" and press Enter.
4. Wait for the `/api/agent` response and an `img` named "Elevation profile".
5. Type the second prompt, wait again for the response and the profile.
6. Click a button named "Sources", hold 1.6 s, press Escape.
7. Look for the text "Rover photos near the destination"; if absent it only logs a warning and c06 shows whatever is on screen.

Other assumptions: the app shows a visible pointer is not needed, because capture draws a cursor overlay that follows real mouse events; WebGL runs headless through SwiftShader (slow, so waits are generous, the 120 s overload timeout covers terrain load); the hazard highlight appears on its own after the replan (not triggered by a click, capture does not press "Steepest stretch"); "AI-generated" tags for AI art (mascot) are not added by the video, check frames for the mascot and add a tag in `tools/gen-scenes.mjs` if it is visible.

Capture speeds idle waits up to 1.6x and holds a short window on its last frame (printed by `tools/cut-footage.mjs`). Check that line after every capture.
