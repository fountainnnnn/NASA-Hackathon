# HeyMars QA round 2 (15 Nov 2026)

Evidence note: `test-results/qa-r2/` is not on disk (a later Playwright run cleared `test-results`). Reviewed instead: all 18 states in `test-results/qa-e2e/qa/1440x810`, all 14 `deliverables/screens/r1-*.png`, report md, docs, storyboard, and the code behind each finding. No 1280, 1024 or 390 captures exist, so those viewports are unverified. PDF still unreviewed (no poppler).

## A. Round-1 items

| Item | Status | Evidence |
|---|---|---|
| 1.1 half-route, 1.2 no-path card, 1.3 mast chip | Fixed | route-nopath-card, route-nearest-card, `flow.ts:346` |
| 1.4 ellipse wording, 1.5 TRN altitude | Fixed | landing-sim-descent, r1-landing-trn |
| 1.6 reach cap and contour labels | Fixed (new issue C3) | r1-base-camp-reach |
| 1.7 top bar, 1.8 ascent sum | Fixed | planet-idle, report md 3 and 4.3 |
| 1.9 "60 min" label | Still broken | route-nogo-card |
| 2.1 crew size, 2.2 traverse dashes, 2.5 route style, 2.8 lasso, 2.10 globe patch | Fixed | walk-playback, r1-lasso-persisted, planet-idle |
| 2.3 helmet centre | Partly: bar gone, dotted vertical line remains | helmet-view, r1-helmet |
| 2.4 soft ground | Partly: resolution note added, ground still blank | walk-playback, helmet-view, r1-sky-crane |
| 2.6 touchdown framing | Partly: legend and colours fixed, vehicle about 40 px | r1-touchdown, r1-sky-crane |
| 2.7 habitat | Unverified, a few px at the reach camera | r1-base-camp-reach |
| 2.9 rover | Riding fixed; no parked rover or tag in frame | r1-rover-assist, r1-rover-parked |
| 3.1 to 3.4 (390 and 1024) | Unverified, no captures | none |
| 3.5 NUM styling, 3.7 dots, 3.9 cuff card | Fixed | landing-sim-descent, cuff-card |
| 3.6 report card repeats on old turns | Still broken | jezero-after-fall |
| 3.8 units | Fixed, but "Slope , next 100 m" renders with a gap | helmet-view |
| 4.1, 4.3, 4.5, 4.6, 4.7 copy | Fixed | maths-followup, cuff-card, sources |
| 4.2 landing answer | Fixed in code only | `flow.ts:174` |
| 4.4 "no model" | Still broken | `Panel.tsx:76` |
| 5.1, 5.3, 5.4, 5.5 | Fixed | landing-sim-descent, route-nearest-card, report md |
| 5.2 streaming tense | Unverified: `landing-check-card.png` is byte-identical to `map-click-card.png` | qa-e2e |
| 6.2 clock | Fixed | planet-idle |
| 6.3 PDF | Unreviewed | none |

## B. Verdict

No. Shell, panel, cards, report and Jezero wide views are production quality. The close-range simulation views (helmet, sky crane, touchdown) are not, and no screenshot anywhere shows a GO verdict.

## C. Fix list

### P0

1. **Sky crane and touchdown close-ups** (r1-sky-crane, r1-touchdown, landing-sim-descent). Ground is banded blur, the vehicle is about 40 px, a dashed orange line drops from the sky and ends in an L-shaped stub, touchdown dots float on the horizon. Fix in `Planet/landing.ts`: hide the `faint` arc polyline below 2 km altitude; hide scatter points until the camera pulls back; frame the vehicle at 250 px or more; never go lower than the altitude where one texel covers 4 px (otherwise hold the wide oblique). Wait for imagery tiles before starting playback.
2. **Helmet view** (helmet-view). Blank beige ground plus a constant-width dotted line down the centre reads as a glitch. Draw the path in `Scene/Routes.tsx` as a ground ribbon with world width (0.4 m) so it tapers, or as ground chevrons every 10 m; no screen-space line in helmet mode.
3. **No GO state shown.** Every card in evidence is NO GO. Add a `route-go-card` state to `scripts/qa-layout.mjs` (after "Raise mast to 20 m" or a short target) and confirm the replan really reaches GO. The video scene s07 depends on it.

### P1

4. **Reach contradicts route verdicts.** `flow.ts` reach checks battery, EVA and slope only; it prints green "Home within 170.7 km²" up to 8.24 km out while a 3.9 km target is NO GO for comms and daylight. Apply daylight, or use a neutral lead and add "Time and battery only. Daylight and comms are not applied".
5. **Ground at walking scale** (walk-playback). Add a real HiRISE ortho patch (Mars 2020 basemap, 25 cm, downsampled to 1 m) for about 4 km around base. If it cannot ship, keep the chase camera at 60 m or more.
6. **Surface photos** (route-nearest-card): two near-identical frames of the rover's shadow. In `lib/science/rover.ts` drop frames within 60 s of each other and prefer Navcam landscape frames; show one.
7. **Storyboard and DEMO_30_SECONDS**: "1.1 km" and "Raise the mast to 10 m" are wrong (default mast is 10 m, button says 20 m, app shows 1.9 to 2.9 km). Recapture and take the app's numbers.
8. **Dark disc** floating above the ellipse plus the vertical dashed line in r1-touchdown-wide: remove both.
9. **Rerun the four-viewport QA** and keep the output outside `test-results`. Fix the known 1024 and 390 landing legend collisions. Add `landing-check-streaming` to the e2e list so `landing-check-card` captures the right card.
10. **Mixed headline**: card says the sun is the reason, the map label says "1. Radio shadow" (route-nogo-card). Number the blockers in the same order in both.

### P2

11. "60 min" route tag: use "T+01:00".
12. `Panel.tsx:76`: "no model" to "fixed code".
13. Caption reads "Powered descent" at 20 m with the rover on cords: switch to "Sky crane" by altitude (`edl_mars2020.json` gives it zero duration).
14. "0 min after sunset", "−0°" (report 4.5): print one decimal or "under 1 min".
15. Report: "no data (Mock)" to "no data at this scale".
16. Legend lists route styles when no route exists (route-nopath-card); landing legend lacks "Imagery 232 m per pixel".
17. Old turns: one-line "Report" link, full card on the latest plan only.
18. Lasso card subtitle wraps "km²" alone; drag-preview label covers the Base tag.
19. Both crew tags show the same time; keep name and suit percent.
20. `pairVisibility` in `lib/ops/viewshed.ts` is unused: add a "Crew in sight of each other" row or delete it.
21. First globe click after load is dropped: queue it until the picker is ready.
22. Scout and MarsWalk remain only in code identifiers and comments, not user-visible. Leave.
23. Deploy and push before submission; live site and GitHub are behind.
