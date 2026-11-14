# HeyMars demo video (29.0 s, 1920x1080, 60 fps)

Story, captions and timings: `STORYBOARD.md`. Everything is driven by `film.config.json`.

## Phase 2: capture, cut, render (from this folder)

```bash
# the app must be running: npx next build && npx next start -p 3990 (repo root), or use the Railway URL
node capture.mjs http://localhost:3990            # records the shots, writes footage/marks.json, cuts footage/c*.mp4
node capture.mjs http://localhost:3990 --live     # same, but c04 asks a free question: ONE paid MarsAgent call
node capture.mjs <url> --only click,replan --headed   # redo some shots in a visible window
npm run build:film                                # scenes from config + real boxes, index.html, music
npm run qa                                        # layout QA, must be 0 errors
npm run render:final && npm run gate              # renders/heymars-demo.mp4; gate prints the duration (<= 30.0)
node tools/film-check.mjs renders/heymars-demo.mp4   # contact sheets in .film/, read them
```
Chrome-based tools (qa, render, capture, stills) need to run outside the Claude sandbox on macOS.

## How a footage scene works

- Capture: the app at 1440x810 CSS px, device scale 2, recorded with the DevTools screencast (2880x1620 JPEG frames
  with timestamps) only while a shot runs. `capture.mjs` also stores the boxes (CSS px) of the elements the film frames
  and points at, per state (`clicked`, `click`, `steps`, `route`, `replan`, `walk`, `report`, `report2`); the drive logic follows `scripts/qa-layout.mjs`.
- Cut: `tools/cut-footage.mjs` turns each shot into a clip of exactly its slot length using `film.config.json` "cuts"
  (mark windows, idle waits skipped as jump cuts, at most 1.5x faster by default, last frame held if short).
- Scene: `tools/gen-scenes.mjs` places the clip in a camera that frames boxes ("card@click"), draws callouts at boxes,
  and adds the caption band. Things drawn on the WebGL canvas (the comms-shadow stretch) have no DOM box: read their
  position off the footage and put it in `film.config.json` "boxes", e.g. `"route": { "shadow": [x, y, w, h] }`.
- Until a clip exists the scene shows a still of the approved mockup (`tools/pending-stills.mjs`) or a slate, both
  labelled CAPTURE PENDING.

## What capture.mjs drives by code (all real app behaviour)

- c03 orbit: the app's own camera flight (`window.__planet.view`, `?qa=1`) from orbit to Jezero, for a smooth move.
- "Take me to Jezero" and "Back to Mars" are sent through the app's ask channel (`window.__mw.ask`), the same path a
  typed verb takes.
- Target points come from the app's projector (`__mw.projectJezero`), then the real mouse glides there and clicks.
- Without `--live` no model is called: the ask line gets the fixed verb "Walk here and back".
Selectors are written against `docs/UI_SPEC.md` and `tests/e2e/selectors.ts`; every miss is printed as a WARN and the
shot goes on. Check the WARN lines and `footage/marks.json` boxes after each capture.

## Set before the final render
- `film.config.json` "link": the real URL (now `[link]`).
- Captions with numbers (s07 2.2 km and 20 m, s09 708 and 1.1 m) must match what the captured app shows.
- Music: `scenes.json` "music" (original bed from `tools/music.py`); remove it for a silent film.
