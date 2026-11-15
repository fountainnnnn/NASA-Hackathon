# HeyMars QA round 4, final (15 Nov 2026, 17:20 SGT)

Evidence read: 14 desktop states in `deliverables/qa/final/qa/1440x810`, `r3-landing-mc-mid`, `zoom-proxy-cold-final`, video cut sheet, SUBMISSION_DRAFT, `src/app/flow.ts`. Live site returns 200 and its bundle contains "Objects shown", "Open report" and "Recenter". Not reviewed: phone (`deliverables/qa/final-phone` is empty), the NO GO card (`route-nogo-card.png` shows no card, driver error), the landing check card (`landing-check-card.png` is a byte copy of `map-click-card.png`), the PDF.

## A. Round-3 items

| Item | Status |
|---|---|
| 1 Submission TODOs | Open: video link (SUBMISSION_DRAFT:32, README:10). Code-review answer is in |
| 2 Sky crane ground | Fixed, horizon and ground in frame |
| 3 Touchdown framing | Replaced by the ellipse view with verdict card, good |
| 4 Black globe after Start | Not seen in planet-idle; loading note added |
| 5 Helmet label | Fixed ("Slope over next 100 m") |
| 6 Walk tick bar | Fixed, small tick only |
| 7 Rover assist | Fixed, crew on rover |
| 8 Video re-record | Not done, mp4 is from 08:35 |
| 9 Four-viewport run | Not done, desktop only |
| 10 to 13 | 12 fixed (legend names CTX or HiRISE). 11, 13 unverified |

## B. Verdict

Yes. Production quality for submission on desktop, after C1 and C2.

## C. Before 18:00

### P0

1. **Unrounded float on the landing completion card and panel** (landing-sim-touchdown): "0.2° / 0.2845880389213562 °". `src/app/flow.ts:1234`, wrap both values in `fmt(x, 1)`. 3 min plus deploy.
2. **Submission text now contradicts the app.** 5 min.
   - Line 59: "shown as 'no data', not guessed". The app now fills them and tags est. or mock. Say that, and add one Limitations line that mock values are placeholders and do not count as evidence.
   - Line 90: "at true scale". The legend says 3x and 4x true size.
   - Line 94: 435 tests in 40 files, 14 of 14. README says 451 in 41, 15 of 15.
3. **Video link TODO** in SUBMISSION_DRAFT and README. Upload, paste, open in a private window. 5 min.

### P1

4. **Night clock beside a daylight GO** (route-go-card): header shows 02:09 and sun -48° while the card passes daylight with 6 h 55 min margin. The walk starts at 09:00. Once a plan exists, show the plan start time in the header at T+00:00:00. 10 min. Skip if it risks the deploy.
5. **"eva" in lower case** in the Why GO line ("battery remaining at eva end"). Use "EVA". 2 min.
6. **Phone**: open the live site once on a real phone and run click, landing, Jezero drag. 5 min. No phone evidence exists for this build.

### Video

Do not re-record before submitting. The cut is coherent, its landing clip is the parachute shot (the old empty sky crane frame is not in the cut sheet), and it shows GO, NO GO, formulas, walk and report. The Monte Carlo playback and landing verdict would add about 3 s of new value for 40 min and a re-render risk. Judges who open the live app see them anyway. If there is spare time after submitting and the form allows edits before 23:59, swap clip c08 only.

## D.

Not yet "nothing left": items 1 to 3 are judge-visible and take about 15 min. After those, NOTHING LEFT TO IMPROVE for the 18:00 submission.
