# HeyMars demo video, storyboard v3 (as captured from the live app, 15 Nov)

29.0 s, 1920x1080, 60 fps final (30 fps draft), 10 scenes, 0.4 s zoom joins, original music bed (synthesised in code,
`tools/music.py`), no voice. Team: Ng Yu Hang, team Ecliptical. Challenge: Interplanetary Survival Guide: Martian Map.

Message the film must leave behind: **Point at Mars. Ask. It plans.** Every answer is computed from NASA data, shown
step by step, with a GO / HOLD / NO GO verdict and its reason.

Look: near-black stage (`#060505`), bone text, colour only when it means something (verdict colours, Earth cyan,
Mars ochre). Schibsted Grotesk for captions, Martian Mono for numbers, Michroma only for the HEYMARS wordmark.
Footage scenes: the real app (captured at 1440x810, 2x) framed by a camera that pushes in on what matters; one caption
line per beat in a flat band at the bottom (56 px), the NASA data credit under it (30 px), callouts as a ring, a hairline
and a flat label (34 px). Safe margins 96 px left and right. No logos, no AI imagery, no glow, no em dashes, no "·".

## Beat table (absolute times include the 0.4 s overlaps)

| # | Scene | Start | Dur | Guide beat | Source |
|---|---|---|---|---|---|
| s01 | Name and team | 0.0 | 2.2 | 0:00 name + team | illustration |
| s02 | 11 light-minutes | 1.8 | 3.2 | 0:02 challenge and why | illustration |
| s03 | HEYMARS over the real planet | 4.6 | 3.0 | 0:05 title + tagline | footage c03 |
| s04 | Click and ask | 7.2 | 4.4 | 0:07 how it works | footage c04 |
| s05 | Click, MarsAgent, tools, verdict | 11.2 | 2.6 | how it works | illustration |
| s06 | Steps and formulas | 13.4 | 3.2 | how it works, NASA data | footage c06 |
| s07 | NO GO, replan, GO | 16.2 | 3.8 | how it works | footage c07 |
| s08 | Lander, then crew at 600x | 19.6 | 4.4 | how it works / impact | footage c08a, c08b |
| s09 | Report and validation | 23.6 | 3.4 | 0:20 impact | footage c09 |
| s10 | First walks on Mars, end card | 26.6 | 2.4 | 0:27 future + link | illustration |

End 29.0 s. Data credit line on every footage scene from 7.2 s to 27.0 s:
"NASA data: MRO CTX, Mars Odyssey, USGS, Perseverance, JPL Horizons" (s03 carries its own imagery credit, see below).

## Scenes

### s01 Name and team (0.0, 2.2 s)
On screen: "Ng Yu Hang, team Ecliptical" (76 px), under it "NASA Space Apps Challenge 2026, Martian Map" (44 px).
Builds word by word from frame 0, slow push.

### s02 The hook (1.8, 3.2 s)
Illustration: Earth (Lucide globe, cyan) and Mars (ochre ring) on a dashed rail; a dot of light travels Earth to Mars
(0.3 to 1.35 s), then back (1.6 to 2.7 s).
Label over the rail: "11 min one way", swapping to "22 min to ask and hear back". Under the rail: "Light time today,
JPL Horizons" (10.95 min one way on 15 Nov 2026, `public/data/earth_link.json`; the app's top bar shows 10.9 to 11.0 min).
Caption: "Earth is 11 light-minutes away." swapping at 1.65 s to "On Mars, nobody can plan your walk for you."

### s03 Title over the real planet (4.6, 3.0 s), footage c03
Footage: the whole planet from orbit (Cesium, JPL Mars Trek imagery and terrain), then the app's own camera flight
down to Jezero Crater. Camera: full width, slow 8% push.
Overlay 0.0 to 1.6 s: flat scrim, "HEYMARS" (Michroma 132 px), "Point at Mars. Ask. It plans." (60 px).
Caption from 1.65 s: "The whole real Mars, from orbit to the ground."
Credit: "NASA imagery and terrain via JPL Mars Trek" (verify the exact layers at capture).

### s04 Click and ask (7.2, 4.4 s), footage c04
Footage: in the 20 m Jezero scene the MarsAgent reticle trails the cursor to the fan target 18.47162N 77.49357E
(2.9 km ENE of the base), dwells (readout: lat, lon, elevation, slope), clicks; the compact MarsAgent card opens at the
cursor ("Partly too steep to walk", 18.4714N 77.4937E). On the card's ask line: "Walk here and back" (a fixed verb, no model call) or, with `--live`, "Can I walk here and
back from base?" (one MarsAgent call). EVA starts 09:00 local solar time (app default). The card turns NO GO:
"Radio shadow of 2.2 km with no line of sight to base from a 10 m mast"; round trip 6.16 km, 2 h 32 min incl. 30 min at
target, battery 68.3 % / 20 %, max slope 2° / 15° (QA path). AS CAPTURED (live site, the clicked point lands a few
metres from the QA target): "Radio shadow of 1.0 km with no line of sight to base from a 10 m mast", round trip 6.12 km,
2 h 32 min, battery 68.4 % / 20 %, max slope 3.5° / 15°, map label "Radio shadow 1.03 km". Captions follow the capture.
Camera: whole app, then at 1.2 s a 1.0 s push onto the card.
Caption: "Click any spot on Mars and ask."
Callout at 2.4 s on the card: "Answer at your cursor".

### s05 How MarsAgent works (11.2, 2.6 s)
Diagram, left to right: "Your click" -> "MarsAgent" -> four tools (Terrain, Sun, Comms, Battery) -> "GO HOLD NO GO"
on a map pin. Lucide icons (ISC licence). Builds in data order; the three verdict words light up last.
Caption: "MarsAgent runs real tools. The tools do the maths."

### s06 Every step shown (13.4, 3.2 s), footage c06
Footage: the MarsAgent panel on the same turn: the live narration lines with checks and times, then "How I worked it out"
opens and the thread scrolls to a formula block with the real substituted numbers.
Camera: on the narration, then at 1.5 s down to the formula block.
Caption: "Every answer is computed, and every step is shown."
Callout at 2.35 s on the formula: "Formula with real numbers".

### s07 NO GO, then GO (16.2, 3.8 s), footage c07
Footage: the planned route on the terrain with the radio-shadow stretch, the NO GO card; a click on the card's
"Raise mast to 20 m"; the route is re-evaluated and the card turns GO, "Every limit holds" (panel: "GO. Every limit holds.
6.16 km round trip in 2 h 32 min, back with 68.3 % battery.").
Captions (as captured): "NO GO: 1.0 km of the walk is out of radio contact." then at 2.0 s "Raise the mast to 20 m.
It replans: GO." The app shows GO "Every limit holds", 6.12 km, 68.4 % at return.
Callout 0.6 to 1.3 s on the card headline: "The limiting reason". (The map already labels the shadow "Radio shadow
1.03 km", so the film does not repeat it.)

### s08 Real simulations (19.6, 4.4 s), footage c08a then c08b
0.0 to 2.2 s, c08a: the landing simulation on the real terrain (Cesium). Played at 60x until the back shell separates,
then 10x: the ground-level tracking camera watches the sky crane lower the lander on 7.6 m cords (app captions by
altitude, "Sky crane"). Over it, the film's EDL rail (NASA/JPL Mars 2020 landing press kit,
`public/data/global/edl_mars2020.json`): Entry 0 s, Parachute 240 s, Heat shield off 260 s, Powered descent 350 s,
Sky crane 420 s; it fills across the clip's own stretch of the landing clock (334 to 420 s). The clip is two pieces of the 10x
playback: the parachute (334 to 350 s) and, after a jump cut, the sky crane lowering the rover to touchdown (408 to 420 s).
The landing site is on the plains east of the crater rim (78.0E 18.4N): inside the 20 m Jezero patch the app draws the
landing result in the 20 m scene instead of flying its own cameras.
2.2 to 4.4 s, c08b: "Walk it", playback at 600x; the chase camera follows the two astronauts on the route (HiRISE 1.3 m
imagery near the base). The helmet view (ground ribbon path) is recorded too, as a spare.
Captions: "Perseverance's landing steps, down to the sky crane." then at 2.3 s "Two crew walk the route at 600× speed."
Callout at 2.7 s on the speed control: "600× playback".

### s09 The report (23.6, 3.4 s), footage c09
Footage: the report card at the end of the turn ("Mission planning report", Open, PDF, MD, JSON, GeoJSON); Open brings
up the report viewer (8 sections, contents on the left, paper scrolling inside its own container); the contents' Data
sources entry jumps to section 6, Data sources and validation.
Camera: the paper, then at 1.5 s a push onto the validation line.
Captions: "A full report mission planners can check and export." then at 1.75 s "Terrain agrees with 708 Perseverance
waypoints, median 1.1 m."
Callout at 2.3 s: an ochre underline under the validation sentence.

### s10 Future and end card (26.6, 2.4 s)
"Built for the first walks on Mars." (72 px), then the "HEYMARS" wordmark (120 px), the link (Martian Mono, 48 px,
from `film.config.json` "link": the live app, heymars.ngyuhang.com) and "Ng Yu Hang, team Ecliptical". The bed's last chord
rings out from 27.8 s.

## Lines (measured in Schibsted Grotesk 500, all fit inside 1728 px)

| Line | px |
|---|---|
| Earth is 11 light-minutes away. (64) | 841 |
| On Mars, nobody can plan your walk for you. (64) | 1289 |
| The whole real Mars, from orbit to the ground. (56) | 1167 |
| Click any spot on Mars and ask. (56) | 805 |
| MarsAgent runs real tools. The tools do the maths. (64) | 1448 |
| Every answer is computed, and every step is shown. (56) | 1333 |
| NO GO: 1.0 km of the walk is out of radio contact. (56) | about 1240 |
| Raise the mast to 20 m. It replans: GO. (56) | 970 |
| Perseverance's landing steps, down to the sky crane. (56) | 1341 |
| Two crew walk the route at 600× speed. (56) | 1025 |
| A full report mission planners can check and export. (56) | 1330 |
| Terrain agrees with 708 Perseverance waypoints, median 1.1 m. (56) | 1594 |
| Built for the first walks on Mars. (72) | about 1020 |

## Music
Kept subtle (bed at -13.5 dBFS RMS, mixed at volume 0.3). Not listened to by the builder. `tools/music.py`, 120 BPM: soft pad and shaker from s02, the groove eases in at 5.0 s (HEYMARS), the last chord rings
from 27.8 s (end card). Original, generated by code in this folder; nothing to license. To ship silent instead, delete
`music` from `scenes.json` and rebuild.
