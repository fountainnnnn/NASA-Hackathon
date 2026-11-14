# Demo: 30-second video

The demo is a video of 30 s or less. Source of truth for scenes and timings: `deliverables/video/STORYBOARD.md` (storyboard v1). Build and render steps: `deliverables/video/README.md`. Credits: `deliverables/video/CREDITS.md`.

- Length 29.0 s, 1920x1080, 60 fps final. Hard limit 30.0 s, checked with ffprobe (`npm run gate` in `deliverables/video`).
- 10 scenes joined by 0.4 s zoom transitions.
- English on-screen captions, one line per beat. No voice.
- Footage is a real screen capture of the app at 1440x810 (device scale 2). Idle waits are cut; nothing is composited into the app's picture.
- Original music bed synthesised in code (`tools/music.py`). No AI images, no NASA logos, no one under 18.
- Byline: Ng Yu Hang, team Ecliptical.

## Shot list

| Time (s) | Guide beat | Scene | Caption |
| --- | --- | --- | --- |
| 0.0 to 2.2 | Name and team | s01 title card | "Ng Yu Hang, team Ecliptical" / "NASA Space Apps Challenge 2026, Martian Map" |
| 1.8 to 5.0 | Challenge and why | s02 Earth to Mars light-time diagram (JPL Horizons, 10.95 min one way on 15 Nov 2026) | "Earth is 11 light-minutes away." then "On Mars, nobody can plan your walk for you." |
| 4.6 to 7.6 | Title and tagline | s03 the whole planet from orbit, then the app's camera flight down to Jezero (footage) | "HEYMARS" / "Point at Mars. Ask. It plans." then "The whole real Mars, from orbit to the ground." |
| 7.2 to 11.6 | How it works | s04 reticle over Jezero, click, card opens at the cursor, ask "Walk here and back" (footage) | "Click any spot on Mars and ask." Callout: "Answer at your cursor" |
| 11.2 to 13.8 | How it works | s05 diagram: your click, MarsAgent, four tools (Terrain, Sun, Comms, Battery), GO HOLD NO GO | "MarsAgent runs real tools. The tools do the maths." |
| 13.4 to 16.6 | How it works, NASA data | s06 panel narration ticks off, "How I worked it out" opens on a formula with real numbers (footage) | "Every answer is computed, and every step is shown." Callout: "Formula with real numbers" |
| 16.2 to 20.0 | How it works | s07 route with the comms-shadow stretch, NO GO card, raise the mast, replan to GO (footage) | "NO GO: 1.1 km of the walk is out of radio contact." then "Raise the mast to 10 m. It replans: GO." |
| 19.6 to 24.0 | How it works, impact | s08 3D lander on real terrain with the Mars 2020 EDL rail, then two crew walking at 600x (footage) | "The lander follows Perseverance's real landing timeline." then "Two crew walk the route at 600× speed." |
| 23.6 to 27.0 | Impact | s09 mission planning report, then section 6, data sources and validation (footage) | "A full report mission planners can check and export." then "Terrain agrees with 708 Perseverance waypoints, median 1.1 m." |
| 26.6 to 29.0 | The future | s10 end card: wordmark, link, byline | "Built for the first walks on Mars." Link: TODO(link) |

NASA data credit line on every footage scene from 7.2 s to 27.0 s: "NASA data: MRO CTX, Mars Odyssey, USGS, Perseverance, JPL Horizons". s03 carries its own imagery credit for JPL Mars Trek.

## Before upload

- [ ] TODO(verify): s07 numbers. The storyboard caption says a 1.1 km shadow and a 10 m mast, but 10 m is already the app's default mast and the 15 Nov route screenshot (`deliverables/screens/r1-route.png`) shows a 1.9 km shadow with the action "Raise mast to 20 m". The captions must use the numbers the captured app shows, and the second caption must say what the replan really gives.
- [ ] TODO(verify): s03 credit names the exact Mars Trek layers seen in the capture (terrain, Viking MDIM 2.1, CTX mosaic).
- [ ] TODO(link): set `link` in `deliverables/video/film.config.json` to the final URL (now `[link]`).
- [ ] Final render at 60 fps; ffprobe duration 30.0 s or less. TODO(verify): only a 30 fps draft exists now (`renders/heymars-draft.mp4`).
- [ ] Layout QA of the film (`npm run qa`) shows 0 errors; no overlaps or cut-off text in the contact sheets.
- [ ] No "CAPTURE PENDING" slates left.
- [ ] Uploaded to a public host, opens in a private window with no login. TODO(link)
