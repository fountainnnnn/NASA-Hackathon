# AI use

HeyMars was built with AI coding assistants and contains a runtime language-model agent, MarsAgent. The idea and approach were set by the human participant, Ng Yu Hang.

## Who decided what

The participant chose the challenge and wrote the brief: a map you point at and ask, Jezero Crater as the walking region, real NASA data only, every number from a tool, and the safety checks a crew needs. The participant approved the UI design (mockup v4, `docs/UI_SPEC.md`), reviewed the live build and screenshots, and directed each revision, including dropping an early robot mascot and moving to a real-terrain planet view. AI tools did not come up with the idea for solving the challenge. They helped build it.

## Tools

| Tool | Purpose | How it was used | Human check | Limits |
| --- | --- | --- | --- | --- |
| Claude Code with Claude Opus 5.5 (Anthropic) | Coding orchestrator and builder | Planned modules, wrote and integrated code, ran tests, browser QA and deploys | The participant reviewed the architecture, the science and maths modules and their outputs, the running app and screenshots, and approved each direction. Most UI code was checked through tests and browser QA rather than line by line | Can write plausible but wrong code. Claims in the docs are tied to a test, a data file or a screenshot, or marked TODO |
| Claude Sonnet subagents | Module implementation | Each owned separate files against shared interfaces (`src/lib/contracts.ts`, `src/lib/globeContracts.ts`) | Integrated and tested by the orchestrator | Same as above |
| Claude Fable 5.2 | QA reviewer | Reviewed screenshots, the live app and docs against the requirements | Findings fixed and re-tested | Review can miss problems |
| Codex CLI (OpenAI) | Early SVG art | Wrote 13 art files (12 SVG and a PNG favicon: a mascot, markers, wordmark) from text prompts, listed in `public/art/CREDITS.json` | Reviewed, then dropped from the UI | Not shown in the app now (see below) |
| Claude Haiku 5.5 via OpenRouter | Runtime agent for free-text questions | Chooses tools and writes the explanation from tool results | Tool allowlist, Zod validation, scene-command allowlist, round and call limits, number guard | Prose can be wrong. Numbers come only from tools |
| AI-assisted documentation | Docs | Drafted with AI, then checked against code, data files and test output | Participant to read before submitting | Unverified claims are marked TODO |

The server has a fallback model setting (`AGENT_FALLBACK_MODEL`) used only if the primary model fails.

## What the runtime agent can and cannot do

- Map actions, rail tools, card buttons and maths follow-ups run fixed code. No model is called for them, and the panel shows "no model" on those turns.
- For free-text questions the model can call 20 fixed tools and issue allowlisted scene commands (pins, routes, highlights, camera, layers, globe markers).
- It cannot run code, browse or change the app's state any other way.
- It does not produce distances, slopes, times, battery figures or coordinates. The tools do. A number guard flags any number in its answer that no tool returned.
- The API key stays on the server. The server fixes the model, system prompt and tools, and limits use per IP (100 rounds per 10 min by default) and per day (2,000 by default).
- With no key the server returns "agent offline" and the app says the language model is not configured. Everything else keeps working.

## Images, video and audio

- **App.** No AI-generated images are shown. The MarsAgent reticle and map symbols are drawn in code. Icons are Lucide. The lander, parachute, heat shield, back shell, rover and astronauts are simple 3D models built in code. The favicon is the Next.js default. Rover photos are NASA/JPL-Caltech raw images, shown unaltered with credit.
- **Leftover art.** `public/art/` still holds the 13 Codex art files and their prompts. The app does not reference them.
- **Video.** No AI-generated images or video. Footage is a real screen capture of the app. Illustrations are HTML, CSS and SVG with Lucide icons. The edit, captions and transitions are code written with AI assistance, so a small "Made with AI assistance" mark is visible bottom right for the whole video.
- **Audio.** The video's music bed is synthesised by a Python script (`deliverables/video/tools/music.py`, NumPy) written with AI assistance. No generative audio model was used, there is no voice, and nothing is sampled. The final MP4 carries this note in its comment metadata tag.
- **Narrate aloud.** Off by default. It uses the browser's built-in speech synthesis and is labelled "synthetic voice".

## Rules we follow

- AI-generated code is acknowledged here, in the README and in the submission form. TODO(verify): repository metadata, for example the GitHub repo description.
- NASA data and NASA rover photos are never labelled AI-generated, because they are not.
- No AI content uses or imitates NASA logos, flags, mission patches or identifiers. The 3D models carry no insignia.
- No image or likeness of anyone under 18.

## Not AI

The NASA and USGS data, the published methods in `docs/SCIENCE_AND_VALIDATION.md` (Tobler, Horn, A*, Mars24, MSL landing constraints), the choice of challenge and the product direction.
