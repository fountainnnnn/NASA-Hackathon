# HeyMars demo video, storyboard v4 (re-cut 15 Nov, footage from heymars.ngyuhang.com)

29.6 s, 1920x1080, 60 fps, 8 scenes, 0.4 s zoom joins, original music bed (synthesised in code, `tools/music.py`,
drop at 4.0 s on the canyon reveal), no voice. A small "Made with AI assistance" mark sits bottom right for the whole
film (Space Apps SI disclosure rule). Team: Ng Yu Hang, team Ecliptical (end card).

v4 changes: the name card and the MarsAgent diagram are cut; the film opens on the hook; new footage of the Tilt
side view over Coprates Chasma (relief drawn 2.5x, said in the credit line) and of the 10,000 test landings; the walk
joins the replan scene; footage of the 3D view is cropped to the stage so the terrain fills the frame; UI scenes push
in so card text is readable.

## Beat table (absolute times include the 0.4 s overlaps)

| # | Scene | Start | Dur | Content |
|---|---|---|---|---|
| s02 | 11 light-minutes | 0.0 | 2.8 | hook: Earth to Mars light time, "nobody can plan your walk for you" |
| s03 | HEYMARS, orbit, tilt | 2.4 | 4.8 | wordmark over the orbit flight, then Tilt (T) down to the canyon walls |
| s04 | Click and ask | 6.8 | 4.4 | reticle, click, the MarsAgent card at the cursor |
| s06 | Every step shown | 10.8 | 3.0 | narration, then a formula with real numbers |
| s07 | NO GO, GO, walk | 13.4 | 5.6 | NO GO card (radio shadow), raise the mast, GO; two crew walk at 600x |
| s08 | Landing | 18.6 | 5.2 | EDL steps to the sky crane on real terrain; 10,000 test landings, 100 % within the slope limit |
| s09 | Report | 23.4 | 3.2 | the report, then section 6 and the 708-waypoint check |
| s10 | End card | 26.2 | 3.4 | "Built for the first walks on Mars.", HEYMARS, heymars.ngyuhang.com, byline |

The scene notes below are from v3; s01 and s05 are no longer in the film.

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
