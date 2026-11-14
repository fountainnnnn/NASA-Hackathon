# MarsWalk Copilot design system

## Direction: Survey Reticle

The screen is a survey instrument pointed at Mars, and the planet is the only surface. Everything the tool says is drawn on the terrain in thin instrument marks (rings, ticks, hairlines, mono numbers) or sits within 200 px of the pointer. The planet supplies the warmth, the interface is near-black and bone, and a hue appears only when it means something. Position, verdict and time each keep one fixed place.

## Tokens

Paste over `:root` in `src/app/globals.css` and alias the old names until call sites move.

```css
:root {
  --bg-0: #060505;
  --bg-1: #0d0b0b;
  --bg-2: #161313;
  --text-1: #ece7e1;
  --text-2: #a39c95;
  --text-3: #8a837d; /* 5.2:1 on bg-1; the first value (#6a645f) failed 4.5:1 */
  --chip: rgba(6, 5, 5, 0.88); /* flat scrim behind any text that sits on the planet */
  --accent: #e0884a; /* route, primary action */
  --accent-ink: #160c06;
  --data: #5cc8ff;   /* measured values, focus */
  --go: #58c98a;      /* solid line */
  --caution: #f3d250; /* lightest, dashed */
  --nogo: #d9423b;    /* darkest, hatched */
  --line: rgba(236, 231, 225, 0.10);
  --line-strong: rgba(236, 231, 225, 0.22);
  --stroke: 1.5px;
  --r-1: 2px; --r-2: 6px; --r-3: 10px;
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 40px;
  --shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  --font-sans: "Schibsted Grotesk", system-ui, sans-serif;
  --font-mono: "Martian Mono", ui-monospace, monospace;
  --font-display: "Michroma", "Schibsted Grotesk", sans-serif; /* wordmark + GO / HOLD / NO GO only */
  --t-micro: 11px; --t-small: 12px; --t-body: 13px; --t-head: 15px; --t-verdict: 28px;
  --dur-1: 90ms; --dur-2: 180ms; --dur-3: 420ms; --dur-fly: 1400ms;
  --ease: cubic-bezier(0.2, 0.7, 0.1, 1);
}
```

Fonts (Google Fonts): Schibsted Grotesk 400/600 for UI text, Martian Mono 400/500 (width 87–100) for every number and readout, Michroma only for the wordmark and verdict words. Numbers are mono with `tabular-nums`. No backdrop blur. Scout's spring: stiffness 170, damping 22.

## Pointer grammar

| State | Cursor | Scout |
|---|---|---|
| Over terrain | 20 px crosshair, 4 px centre gap. Readout 14 px right and below: `18.44N 77.45E -2540 m`, mono 11 px | Trails 28 px up and left. Silent |
| Dwell 600 ms | Readout adds slope and geologic unit | Lens turns toward the point. Silent |
| Click | Leaves a 1.5 px ring | Flies to the ring, opens the bubble |
| Drag (Jezero) | 6 px dot. Live A* line, distance and time at the cursor | Drawing pose on the line head. One verdict line on release |
| Shift drag | Dashed lasso, area at the cursor | Speaks once on close |
| Over a control | System arrow | Parks |

Scout speaks only when clicked, asked, or when a safety rule trips (reserve, slope limit, comms shadow, pair out of sight). Then it interrupts and points at the place.

Bubble: 280 px wide, `--bg-1`, `--r-3`, a hairline leader to the ring. Fixed order:
1. Headline, 15 px 600, the finding ("Too steep to land", never "Landing check").
2. Body, up to 3 lines, 13 px, numbers in mono.
3. Source, 11 px `--text-3`, one linked dataset.
4. Input, a bare caret line with no button. Enter sends, hold Space to talk.

A follow-up replaces the content in place and the old answer drops into the trail (T). Actions are up to three plain verbs under the body ("Land here", "Walk from here", "Compare"), text only, and Scout carries them out on the map. Esc closes.

## Signature details

1. Routes are a 1.5 px ochre line, ticked every 100 m, with a longer tick every 10 minutes of walk time, so distance and time read off the ground like a ruler.
2. Risky stretches change line style as well as colour (solid, dashed, hatched), so they survive glare and colour deficiency.
3. A verdict is one 28 px word (GO, HOLD, NO GO) with its single limiting reason beneath, because a crew needs the constraint, not a score.
4. Time is a sun arc on the bottom edge: drag the sun for Mars24 local time and shadows and comms shade follow, with speed ticks (1, 10, 60, 600) on the same arc, so lighting and playback are one control.
5. Globe to Jezero is one camera fall with the crosshair locked on target while the graticule subdivides to the 20 m grid, so nobody loses their place.
6. EVA reach rings are contours labelled in minutes of reserve at turn-back, which answers "can we get home".
7. The helmet HUD reuses the same marks: heading tape on top, route as a ground line, three numbers lower left (distance to stop, slope ahead, reserve) and an empty centre, so the ground stays visible.
8. The cuff checklist exports black on white mono at wrist width with a time per step and a turn-back line, legible on paper through a visor.

## Never

- Chat panel, sidebar, top bar, docked drawer, modal over the map
- Small uppercase labels above titles, "·" separators, em dashes
- Badges, pills, chips, status dots, pulsing or glowing anything
- Gradients, glass blur, neon
- Titles that name the widget instead of the finding
- Colour as the only signal, or ochre used for decoration
- Scout greeting, narrating or joking
- Hand-rolled icons (use Lucide)
- Numbers without a source

## Scout restyle

Keep the five SVGs, convert to monochrome line art at 32 px:
- Group stroke becomes `currentColor` (`--text-1`). The existing width 6 on a 160 viewBox lands at 1.2 px.
- Body and fin fills (`#E0884A`, `#B96A32`) become `--bg-1`.
- Delete the ground-shadow ellipse and the `#F2A66E` highlight stroke.
- The lens is the only colour: `--data`, or `--caution` in `scout-warning`. Pupil becomes `--bg-0`.
- Antenna dot, arcs and thinking dots go to `--text-2`.
- Moods crossfade in `--dur-1`.
