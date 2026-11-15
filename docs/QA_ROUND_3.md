# HeyMars QA round 3 (15 Nov 2026, 09:25 SGT)

Evidence: `deliverables/qa/2026-11-15-01-14/qa/1440x810` (22 states; the run was still writing, so cuff, report, lasso, layers and the 1280, 1024 and 390 passes of this build are unreviewed), `deliverables/screens/r2-*`, video sheets and cuts, STORYBOARD, SUBMISSION_DRAFT, report sample md. Live site returns 200 and its bundle contains "fixed code" and "Crew in sight of each other", so the deploy is current. PDF not opened.

## A. Round-2 items

| Item | Status | Evidence |
|---|---|---|
| P0-1 sky crane and touchdown close-ups | Partly. Vehicle is large, arc and dots are gone up close. Sky crane has no ground in frame | landing-sky-crane, landing-touchdown-close |
| P0-2 helmet path | Fixed, tapered ground ribbon with chevrons | helmet-view |
| P0-3 GO state | Fixed | route-go-card, video 18.5 s |
| 4 reach vs verdicts | Fixed, daylight applied, comms disclosed | base-camp-reach |
| 5 walking-scale ground | Partly. HiRISE label added, ground still soft and banded | walk-playback, rover-assist |
| 6 surface photos | Partly. Still two near-identical frames | route-nearest-card |
| 7 storyboard numbers | Fixed | STORYBOARD s04, s07 |
| 8 dark disc and dashed line | Fixed | r2-touchdown-wide-1024 |
| 9 four-viewport rerun | Not in the newest folder at review time. 1024 legend collision fixed in r2 screens | r2-*-1024, r2-*-390 |
| 10 headline order | Fixed | route-nogo-card |
| 11, 12, 13, 15, 16, 17, 19, 20, 23 | Fixed | drag-preview (T+01:30), panel, landing-sky-crane caption, jezero-after-fall (Report link), walk-playback |
| 8.x "Slope , next 100 m" gap | Still broken | helmet-view |
| 14, 18, 21 | Unverified | none |

## B. Verdict

Yes for the shell, cards, panel, formulas, report and Jezero views. Conditional on C1 and C2: the form has open TODOs and the sky crane shot floats in an empty brown field, in the app and at 20.75 s of the video.

## C. Fix list

### P0

1. **Submission TODOs** (SUBMISSION_DRAFT lines 32, 126). Upload `heymars-demo.mp4` (29 s, 1080p60), paste the link, and answer the code-review TODO in one sentence. Count the summary against the form's word limit. 10 min.
2. **Sky crane has no ground** (landing-sky-crane, r2-sky-crane-late-390, video 20.75 s). At 16 m the frame is a flat brown gradient with the rover hanging in it. In `Planet/landing.ts` pitch the tracking camera down about 15° and raise it so the horizon sits at roughly 35 % of the height and the ground fills the lower half, as in landing-touchdown-close. 20 min.
3. **Touchdown close-up framing** (landing-touchdown-close). The rover sits on the bottom edge and its wheels touch the Cesium attribution strip. Aim the camera target 1.5 m above the rover so it lands at about 60 % height. 10 min, same file.

### P1

4. **Black globe after Start** (planet-idle, 1.5 s after Enter the stage is empty). Keep the intro up, or show "Loading Mars imagery" in the stage, until `__planet.stats().tilesLoaded`. 15 min.
5. **Helmet label** (`HelmetHud.tsx:178`): "Slope , next 100 m" still shows a gap before the comma. Use "Slope over next 100 m". 2 min.
6. **Walk view tick mark** (walk-playback): a 150 px orange bar crosses the crew's feet. Cap route ticks at 0.6 m world width, or hide ticks within 30 m of the chase camera. 10 min.
7. **Rover assist shows no rover** (rover-assist): two crew on foot, long route legs zigzag over featureless ground. Capture and default the camera to the riding half, and leave the parked rover with a "Rover, parked" tag at the dismount point. Fade route legs farther than 300 m to 30 % opacity in chase view. 25 min.
8. **Re-record video clip c08a** after fix 2 and re-render. Only if done by 11:00, otherwise ship the current cut. 25 min.
9. **Finish the four-viewport QA run** on this build and read the 390 and 1024 landing, helmet and report states before 12:00. 15 min.

### P2

10. `Panel.tsx:107`: tag reads "deterministic"; use "fixed code" like every other turn. 1 min.
11. Photos: when two frames share sol and camera, show one (route-nearest-card). 10 min.
12. Walking ground: legend claims HiRISE 1.3 m per pixel while the ground is a soft gradient. If the patch only covers the base area, print "Imagery: CTX 6 m per pixel" outside it (rover-assist already does). 5 min check.
13. Open `heymars-report-sample.pdf` once and check page breaks. 5 min.

Order if time is short: 1, 2, 3, 5, 10, 4, then the rest.
