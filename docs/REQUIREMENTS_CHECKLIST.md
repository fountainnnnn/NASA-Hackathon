# Requirements checklist

A box is ticked only when it was checked against code, data, tests, screenshots or the live site on 15 Nov 2026. `TODO(verify)` means not yet checked. `TODO(link)` means the URL does not exist yet.

## Challenge statement

- [x] Layered, integrated view of a location or route on Mars. Global layers on the planet view, Jezero layers on the 20 m scene, routes and verdicts on the same terrain. Where: Layers tool; e2e; screenshots.
- [x] Data from multiple NASA science missions: MRO, MGS, Mars Odyssey, Viking, Mars 2020, plus USGS-NASA geologic maps and JPL Horizons. Where: docs/DATA_SOURCES.md, Sources sheet (e2e).
- [x] Helps a human explorer plan and carry out a Marswalk while doing science. Where: drag-to-plan round trip, verdict card, walk, helmet view, science at target (e2e, screenshots).
- [x] At least 3 kinds of data: topographic, optical, thermal, chemical, geologic, surface imagery.
- [x] Safety considered: slope, battery reserve, EVA time, daylight, comms line of sight, data coverage, each with a rule and source; "planning aid, not certification" wording.
- [x] Route map that avoids obstacles with spacesuit mobility in mind: A* with a slope limit on every edge and cell, Tobler speed times a suit factor (unit tests).
- [x] Rover point-of-view imagery: nearest Perseverance raw image on the card, panel and report (screenshots, sample report).
- [x] Hyperlocal: 20 m DEM, 40 m planning grid at Jezero.

## Data rules

- [x] At least one NASA dataset from the Resources tab: JPL Mars Trek, USGS-NASA Planetary Geologic Mapping, Perseverance raw images.
- [x] Coordinate frame documented (Mars 2000 sphere, east-positive, areoid heights). Where: DATA_SOURCES.md, src/lib/contracts.ts.
- [x] `data/source_manifest.json` has file, URL, mission, instrument, download date, checksum, processing, projection, resolution and credit for each Jezero, context and Horizons file. Global files: `public/data/global/manifest.json`.
- [x] `data/validation.json` (708 waypoints) and `data/global_validation.json` generated, and the numbers quoted in the docs match them.
- [x] "No data" shown where data is missing: landing criteria that need rover-scale data, the dust layer with no values, missing report values marked "Mock" (sample report).
- [x] No simulated layer ships. The Layers and Sources code shows a "simulated" flag if one ever does; the manifests have none.
- [x] Unit-test fixtures are synthetic and labelled (`src/components/Scenario/synthetic.ts`, `tests/fixtures`).

## Singapore Local Lead email (13 Nov 2026)

- [x] Every NASA dataset named, linked and tied to how it supports the solution. Where: NASA Data table in SUBMISSION_DRAFT.md; Sources sheet in the app.
- [ ] Same NASA credit line in the final video. TODO(verify) at final render.
- [x] Summary states problem, solution and impact. Where: SUBMISSION_DRAFT.md.
- [x] Details state approach, tools, technologies and datasets. Where: SUBMISSION_DRAFT.md.
- [ ] Submit early, target Sun 15 Nov 18:00 SGT. Human only.
- [ ] Optional: mentor Zoom Sun 15 Nov 17:00 SGT. Human only.

## Demo and links

- [ ] Demo is a video of 30 s or less. Over the limit means no Global Judging. Planned length 29.0 s. TODO(verify): ffprobe on the final 60 fps render (only a draft exists).
- [x] On-screen text in English, no voice. Where: STORYBOARD.md.
- [ ] Demo link public, no login, tested in a private window. TODO(link)
- [x] Live app responds with no login: `/api/health` returned ok on 15 Nov 2026, agent on, model `anthropic/claude-haiku-5.5`.
- [ ] Live app shows the current HeyMars build. TODO(verify): on 15 Nov the live page still served the build from before the rename (old page title). Redeploy after the last commit.
- [x] Repository https://github.com/fountainnnnn/NASA-Hackathon is public (HTTP 200 logged out).
- [ ] Repository has the latest commits. TODO(verify): local `main` was 4 commits ahead of `origin/main` on 15 Nov; push before submitting.
- [ ] Links tested logged out on a different network if possible. TODO(verify)
- [ ] Optional: FortiGuard web filter classification requested for the live site (Company Name "N/A"). TODO(verify)

## Form fields

- [x] Project Name: HeyMars.
- [x] High-Level Project Summary, about 150 words, numbered citations [1] to [8] with a reference list.
- [ ] Link to Project Demo: the video. TODO(link)
- [x] Link to Final Project: live app and repository.
- [x] Detailed Project Description: what, how, benefits, goals, tools, limitations.
- [ ] Use of Super Intelligence (SI). Drafted. TODO(verify): the participant confirms the human-review sentence.
- [x] NASA Data: each dataset named, linked, with its use and Resources tab status.
- [x] Space Agency Partner Data and Other References: data, papers, libraries with licences, fonts, video tools, services.
- [ ] Images uploaded to the form are JPG, PNG or GIF, 10 MB or less. The four README screenshots are PNG under 1 MB each.

## AI rules

- [x] AI was not used to come up with the idea or approach. Where: AI_USE.md.
- [x] No AI-generated images are shown in the app (no `public/art` reference in `src/`; reticle, symbols and 3D models are built in code).
- [x] No AI-generated images in the video (CREDITS.md). TODO(verify) again on the final render.
- [x] AI-generated code acknowledged in text: README, AI_USE.md, SUBMISSION_DRAFT.md.
- [ ] AI-generated code acknowledged in metadata. TODO(verify): GitHub repo description or package metadata.
- [ ] Music bed (code written with AI assistance) acknowledged in the video file metadata. TODO(verify) at final render.
- [x] No NASA logos, flags or mission identifiers in AI content, and nothing that imitates them.
- [x] NASA imagery is never labelled AI-generated.
- [x] `public/art/CREDITS.json` lists all 13 leftover Codex files with tool and prompt.

## Terms and licence

- [x] Original work under an OSI licence: MIT, LICENSE (Ng Yu Hang, team Ecliptical).
- [x] Every external resource cited, open-source libraries included. Where: SUBMISSION_DRAFT.md references.
- [x] Fonts are open: Schibsted Grotesk, Martian Mono, Michroma, SIL Open Font License 1.1.
- [x] jszip is dual-licensed (MIT OR GPL-3.0-or-later); used under MIT, dev only.
- [x] No commercial promotion in the app, repo or demo.
- [x] No NASA endorsement claimed ("Not affiliated with NASA" in the app). No claim of certified safety.
- [x] No image, video, audio or likeness of anyone under 18.
- [ ] Solo participant registered at the Singapore Local Event. TODO(verify) with the participant.
- [ ] Terms and Conditions and Confirm All Work is Original ticked, Submit for Judging clicked, success banner seen. Human only.
- [ ] Submitted before Sun 15 Nov 2026, 23:59 SGT. Target 18:00.

## Build, tests and operations

- [x] `npx tsc --noEmit` clean (15 Nov 2026).
- [x] `npm test`: 435 of 435 passed in 40 files (15 Nov 2026).
- [x] `npm run e2e`: 14 of 14 passed on the last recorded run (`test-results/e2e-report.json`).
- [ ] Layout QA at all four viewports (`scripts/qa-layout.mjs`). TODO(verify): last full-matrix result. The 1440x810 run inside e2e passed.
- [ ] `npm run build` passes on the final commit. TODO(verify)
- [x] API key only in `.env.local` (gitignored) and the host's variables. `.env.example` has no secrets.
- [x] Agent proxy has a fixed model, prompt and tool list, per-IP and daily limits (`src/lib/agent/server.ts`).
- [x] Health endpoint green on the deployed site.
- [ ] Participant certificate downloaded after submitting (optional).

## Judging criteria self-check (each scored 1 to 5)

- [x] Impact: a crew 11 light-minutes from Earth needs to plan on Mars. Where: summary.
- [x] Creativity: an agent that works inside a 3D map and shows every step with real numbers.
- [x] Validity: published methods, labelled assumptions, 708-waypoint check, 435 unit tests. Where: SCIENCE_AND_VALIDATION.md.
- [x] Relevance: covers the challenge statement, NASA data is integral. Where: CHALLENGE_ALIGNMENT.md.
- [ ] Presentation: the 30-second video and the live app. TODO(link)
