# Requirements checklist (DRAFT)

Boxes are unchecked until someone has verified them. "Where" says which file or feature should satisfy the rule. `TODO(verify)` means it depends on code, tests or deployment that was not available when this was written.

## Challenge statement (verified from the official page, 14 Nov 2026)

- [ ] Layered, integrated view of a location or route on Mars. Where: 3D scene with toggleable layers. TODO(verify)
- [ ] Data from multiple NASA science missions (MRO, Odyssey, Mars 2020, USGS/NASA mapping). Where: public/data layers, docs/DATA_SOURCES.md. TODO(verify)
- [ ] Helps a human explorer plan and carry out a Marswalk while doing science. Where: route planner, science objective picker (if shipped). TODO(verify)
- [ ] At least 3 kinds of data (optical, thermal, topographic, geologic, surface imagery). Where: CTX, THEMIS, DEM, SIM 3464, rover photos. TODO(verify)
- [ ] Safety considered. Where: slope limit, battery reserve, named infeasibility reason, turn-back point, "model, not certification" wording. TODO(verify)
- [ ] Route map avoiding obstacles with spacesuit mobility in mind. Where: A* with slope limit, Tobler speed times suit factor. TODO(verify)
- [ ] Rover point-of-view imagery. Where: Perseverance raw images near a point. TODO(verify)
- [ ] Hyperlocal rather than regional or global. Where: 20 m DEM, 40 m planning grid, one Jezero patch.

## Data rules

- [ ] At least one NASA dataset from the challenge Resources tab is used (Mars Trek, USGS-NASA PGM, Perseverance raw images are all on it). Where: docs/DATA_SOURCES.md.
- [ ] Coordinate frame documented (Mars 2000 sphere, east-positive, areoid heights). Where: DATA_SOURCES.md, src/lib/contracts.ts.
- [ ] data/source_manifest.json generated with file, URL, instrument, download date, processing, projection, resolution, credit, licence. TODO(verify)
- [ ] data/validation.json (DEM vs rover waypoint residuals) generated and numbers quoted in docs. TODO(verify)
- [ ] "No verified data" shown outside coverage instead of invented values. TODO(verify)
- [ ] Any simulated or stand-in layer carries a visible "Simulated, not NASA data" badge. TODO(verify): confirm none ships.
- [ ] Unit-test fixtures are labelled synthetic and never shown as NASA data. Where: tests/fixtures. TODO(verify)

## Demo and links (submission guide)

- [ ] Demo is a video of 30 s or less, or 7 slides or fewer. We make both. Over the limit means no Global Judging. Where: docs/DEMO_30_SECONDS.md. TODO(link)
- [ ] Video duration checked with ffprobe, 30.0 s or less. TODO(verify)
- [ ] Demo is in English (on-screen text in English). Where: DEMO_30_SECONDS.md.
- [ ] Slides include team name, member name, the challenge, a project image, the user experience and how NASA data enables it.
- [ ] Demo link is public, no login. Tested in a private window. TODO(link)
- [ ] Link to Final Project is public, no login, permission or registration. TODO(link)
- [ ] Links tested logged out on a different network if possible. TODO(verify)
- [ ] Optional: FortiGuard web filter classification requested for the live site (Company Name "N/A"). TODO(verify)

## Form fields

- [ ] Project Name. Where: SUBMISSION_DRAFT.md.
- [ ] High-Level Project Summary, about 120 to 180 words, with numbered inline citations and reference list. Where: SUBMISSION_DRAFT.md.
- [ ] Link to Project Demo. TODO(link)
- [ ] Link to Final Project. TODO(link)
- [ ] Detailed Project Description (what, how, benefits, goals, tools).
- [ ] Use of Super Intelligence (SI), honest and specific. Where: SUBMISSION_DRAFT.md, AI_USE.md.
- [ ] NASA Data, each dataset named, linked, with its use.
- [ ] Space Agency Partner Data and Other References. Every dataset, tool, code, text, image, font, library.
- [ ] Images uploaded to the form are JPG, PNG or GIF, 10 MB or less. No video or document uploads (link instead).

## AI rules

- [ ] AI was not used to come up with the idea or approach. Where: AI_USE.md states that the human participant's handoff defined it.
- [ ] AI-generated images carry a visible "AI-generated" watermark in the app. Where: public/art, credits panel. TODO(verify)
- [ ] AI-generated video: none, or watermarked. TODO(verify)
- [ ] AI-generated code acknowledged in text and metadata (README, AI_USE.md, package or repo metadata). TODO(verify): metadata
- [ ] AI-generated audio: none planned, or acknowledged in text and metadata (video file metadata too). TODO(verify)
- [ ] No NASA logos, flags or mission identifiers in AI content, and nothing that imitates them. TODO(verify): review every asset
- [ ] NASA imagery is never labelled AI-generated.
- [ ] public/art/CREDITS.json lists every AI asset with tool, prompt and review status. TODO(verify)

## Terms and licence

- [ ] Original work, released under an OSI licence. Where: LICENSE (MIT).
- [ ] Every external resource cited, open-source libraries included. Where: SUBMISSION_DRAFT.md References.
- [ ] Third-party materials are open. Fonts: Inter and IBM Plex under SIL OFL. TODO(verify): which fonts actually ship
- [ ] jszip is dual-licensed (MIT OR GPL-3.0-or-later). We use it under MIT.
- [ ] No commercial promotion in the app, repo or demo.
- [ ] No NASA endorsement claimed. No claim of certified astronaut safety.
- [ ] No image, video, audio or likeness of anyone under 18 in any media.
- [ ] Solo participant is registered at the Singapore Local Event (solo teams are eligible there). TODO(verify) with the participant.
- [ ] Terms and Conditions and Confirm All Work is Original boxes ticked, Submit for Judging clicked, success banner seen. Human only.
- [ ] Submitted before Sun 15 Nov 2026, 23:59 SGT. Internal cut-off 20:00.

## Security and operations

- [ ] API key only in `.env.local` and the host's environment variables, never in the repo or the client bundle. TODO(verify)
- [ ] `.env.example` has no secrets.
- [ ] Agent proxy rate-limited with a fixed model, prompt and tool list. TODO(verify)
- [ ] Health endpoint green on the deployed site. TODO(verify)
- [ ] Participant certificate downloaded after submitting (optional).

## Judging criteria self-check (each scored 1 to 5)

- [ ] Impact: why a hyperlocal planner matters. Where: SUBMISSION_DRAFT.md.
- [ ] Creativity: an agent that acts inside the 3D scene.
- [ ] Validity: scientifically grounded, feasible, usable. Where: SCIENCE_AND_VALIDATION.md. TODO(verify) results
- [ ] Relevance: fully addresses the challenge, NASA data integral. Where: CHALLENGE_ALIGNMENT.md.
- [ ] Presentation: demo and slides.
