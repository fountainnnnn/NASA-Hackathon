# Demo: 30-second video and 7-slide deck (DRAFT)

Rule: video of 30 s or less, or 7 slides or fewer. We make both. The video is the primary Demo link. The slides go in the description as a supplement. Target video length 29.0 s, checked with `ffprobe`. English on-screen text. No spoken AI voice planned. Footage is a real screen capture of the app, with idle waits trimmed and nothing staged. Do not show anyone under 18. No NASA logos.

Participant: Ng Yu Hang. Team: Ecliptical.

## Video shot list

| Time | Beat (from the guide) | Shot | On-screen caption |
| --- | --- | --- | --- |
| 0:00-0:02 | Name and team | Title card, plain background | Ng Yu Hang / Ecliptical / Singapore Local Event |
| 0:02-0:05 | Challenge and why | Slow orbit over real Jezero terrain | "Martian Map: an astronaut needs a map made for one walk, not a whole planet." |
| 0:05-0:10 | Title and tagline | Click a ridge, pin drops with coordinates | "MarsWalk Copilot. Point at Mars, ask, and it plans." |
| 0:10-0:20 | How it works, NASA data | Ask "Can I get there and back?". Tool trace shows, route draws, profile and metrics appear. Then "Avoid steep ground, keep 25% battery." Route redraws, steep stretch highlighted. | "The agent calls tools. The tools do the math." then "Change a limit, the route is recomputed." |
| 0:15-0:20 (overlay) | NASA data credit strip | Data credits over the footage | "MRO CTX, Mars Odyssey THEMIS, USGS geologic map, Perseverance" |
| 0:20-0:29 | The future | Rover photo near the destination, then wide terrain | "A planning companion for the first walks on Mars." Link: `TODO(link)` |
| Throughout | AI disclosure | Small corner tag wherever AI art appears | "AI-generated" |

Gate before upload: `ffprobe` duration 30.0 s or less; no overlaps or cut-off text; link visible and correct; AI art tagged; no NASA marks. TODO(verify) all of these.

Optional longer walkthrough (not a replacement for the 30 s demo): 2 to 3 minutes showing the multi-stop loop, geology answer and rover photos. TODO(link)

## Slide outline (7 slides)

Fonts readable, few words per slide. Every slide that shows the app uses real screenshots.

1. **Title.** MarsWalk Copilot. Team Ecliptical. Member Ng Yu Hang. Challenge: Interplanetary Survival Guide: Martian Map. NASA Space Apps 2026, Singapore Local Event. Image: the 3D terrain with a route.
2. **Problem.** A Marswalk needs a map of one walk. Mars Trek and the geologic map portals are regional or global. Caption: "Where can I go, can I get back, and what will I see?"
3. **What an astronaut sees.** Screenshot: click, pin, route, elevation profile, highlighted steep stretch, rover photo. Caption: "Click, ask, see the plan on the terrain." (user experience)
4. **How the copilot works.** Diagram: click, scene state, agent, tools (slope, A*, geology, rover images), allowlisted scene commands, render. Caption: "The model picks tools. Tools produce every number."
5. **NASA data.** Five rows: MRO CTX (terrain, optical), Mars Odyssey THEMIS (thermal), USGS-NASA geologic map, Mars 2020 Perseverance (waypoints, photos), JPL Mars Trek (access). Caption: "Each layer is credited and linked."
6. **Validation and limits.** Tests passed TODO(verify), DEM vs rover waypoint residual TODO(verify), plus plain limits: 20 m cannot see boulders; suit model is an assumption, not NASA's.
7. **Future.** HiRISE resolution, rock-abundance data, a validated suit model, other landing sites. Link: `TODO(link)`. Also AI disclosure line: built with Claude Code, runtime agent, AI art tagged.

## Caption style

Plain English, one idea per line, no jargon the first time it appears. No claim that is not shown on screen.
