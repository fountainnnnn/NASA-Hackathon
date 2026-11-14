# AI use (DRAFT)

This project used AI tools for coding, art and a runtime agent. The idea and approach were set by a human.

## Who decided what

The human participant wrote the project brief: the challenge choice, the hero use case, the Jezero region, the data approach, the route and resource model, and the architecture. AI tools did not come up with the idea for solving the challenge. They helped build it.

## Tools

| Tool | Purpose | How it was used | Human validation | Limitations |
| --- | --- | --- | --- | --- |
| Claude Code (Anthropic) | Coding assistant and orchestrator | Planned modules, wrote and edited code, ran tests | The participant supervised, ran and reviewed results. TODO(verify): extent of line-by-line review | Can write plausible but wrong code; every claim in docs is tied to a test or marked TODO |
| Claude Sonnet sub-agents | Module implementation | Each owned separate files against a shared interface (`src/lib/contracts.ts`) | Outputs reviewed and wired by the orchestrating session and tested | Same as above |
| Codex CLI (OpenAI) | Mascot and map-marker art | Generated original images or SVGs from prompts | Every asset viewed before use; rejected assets regenerated once or replaced with a plain icon. TODO(verify) | Can introduce text errors or look like real insignia; checked for NASA-like marks |
| Claude Haiku 5.5 via OpenRouter (fallback GPT-6 Luna) | Runtime agent in the app | Chooses tools and writes explanations from tool results | Tool allowlist, Zod validation, scene-command allowlist, step limit, number guard. TODO(verify): live tool-selection test | Prose can be wrong. Numbers come only from tools. The guard flags unmatched numbers, not wrong claims |
| AI-assisted documentation | Drafting docs | Drafts written with AI, then checked against code and test output | TODO(verify) | Claims without a verified source are marked TODO |

## What the runtime agent can and cannot do

- It can call a fixed list of tools and issue allowlisted scene commands (pins, route drawing, highlights, camera, layer visibility).
- It cannot run code, browse, or change the world state any other way.
- It does not produce distances, slopes, times or coordinates. The tools do.
- The API key stays on the server. The server fixes the model, prompt and tools, and caps usage.
- With no key or on error, the app says the agent is offline. It does not pretend. TODO(verify)

## AI-generated art

Listed in `public/art/CREDITS.json` (tool, prompt, date, review result). TODO(verify): file exists and matches this list.

| Asset | Tool | Watermark / label in app | Reviewed |
| --- | --- | --- | --- |
| Agent mascot, 5 states | Codex CLI | "AI-generated" tag, TODO(verify) | TODO(verify) |
| Astronaut marker | Codex CLI | TODO(verify) | TODO(verify) |
| Base marker | Codex CLI | TODO(verify) | TODO(verify) |
| Science-stop flag | Codex CLI | TODO(verify) | TODO(verify) |
| Hazard marker | Codex CLI | TODO(verify) | TODO(verify) |
| Rover marker | Codex CLI | TODO(verify) | TODO(verify) |
| Wordmark and favicon | Codex CLI | TODO(verify) | TODO(verify) |

UI control icons are Lucide (not AI-generated).

## Rules we follow

- AI images carry a visible "AI-generated" mark. TODO(verify)
- AI code and any AI-assisted data are acknowledged here, in the README and in the submission form. TODO(verify): repository metadata
- NASA data layers and NASA rover photos are never labelled AI-generated, because they are not.
- No AI media uses or imitates NASA logos, flags, mission patches or identifiers.
- No AI audio is planned. If a music bed is added to the video, it will be acknowledged in the description and file metadata. TODO(verify)
- No image or likeness of anyone under 18.

## Not AI

The data, the algorithms in `docs/SCIENCE_AND_VALIDATION.md` (from cited literature), the choice of challenge and the product design.
