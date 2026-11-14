'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LonLat } from '@/lib/contracts';
import { emitAsk, useCompanion } from '@/state/companion';
import { MapCard, stageRect, type BubbleApi, type VoiceControl } from './MapCard';
import { collectAvoid } from './avoid';
import { arcPoint, nudgeClear, parkAtEdge, springStep, type Vec } from './motion';
import { createSpeech, type SpeechController } from './speech';
import { formatReadout, type ReadoutSample } from './text';
import s from './Companion.module.css';

export interface ScoutProps {
  /** Screen position (CSS px, viewport coordinates) of a lon/lat for whichever canvas is active. `visible: false` = behind the planet. */
  projectToScreen: (p: LonLat) => { x: number; y: number; visible: boolean };
  /** Optional: what is under the pointer (screen px to lat/lon/elevation). Drives the micro-readout beside the pointer. Return null off the planet. */
  sampleAt?: (x: number, y: number) => ReadoutSample | null;
}

const SIZE = 40;
const OFFSET: Vec = { x: -28, y: -28 }; // Scout trails up and left of the cursor (design system)
const FLIGHT_MS = 420;                  // --dur-3
const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

/** The MarsAgent reticle is a survey reticle drawn in code: a thin circle, four cardinal ticks, a heading notch toward what it looks at, a centre dot. State is geometry only. */
function ScoutMark({ mood, look }: { mood: string; look: React.RefObject<SVGGElement | null> }) {
  const warn = mood === 'warning', listen = mood === 'listening', think = mood === 'thinking', draw = mood === 'drawing';
  const t0 = 9.5, t1 = listen ? 13.5 : 12.5;
  const ticks: [number, number, number, number][] = [[14, 14 - t0, 14, 14 - t1], [14 + t0, 14, 14 + t1, 14], [14, 14 + t0, 14, 14 + t1], [14 - t0, 14, 14 - t1, 14]];
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <circle cx="14" cy="14" r="7" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <g stroke="currentColor" strokeWidth="1.25" strokeDasharray={warn ? '1.6 1.6' : undefined}>
        {ticks.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />)}
      </g>
      {think && <path className={s.arc} d="M14 3 A11 11 0 0 1 25 14" fill="none" stroke="currentColor" strokeWidth="1.25" />}
      <g ref={look} style={{ transformOrigin: '14px 14px', transformBox: 'view-box' }}>
        <line x1="21" y1="14" x2={draw ? 26 : 23.5} y2="14" stroke="currentColor" strokeWidth="1.25" />
      </g>
      <circle cx="14" cy="14" r="1.5" fill={warn ? 'var(--caution, #f3d250)' : 'var(--data, #5cc8ff)'} />
    </svg>
  );
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f(); m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

function useVoice(): VoiceControl {
  const ctl = useRef<SpeechController | null>(null);
  const [hint, setHint] = useState('');
  const [supported, setSupported] = useState(true);
  const listening = useCompanion((c) => c.listening);

  useEffect(() => {
    const c = createSpeech({
      onInterim: (t) => useCompanion.getState().setInterim(t),
      onFinal: (t) => { const a = useCompanion.getState().anchor; emitAsk(t, { origin: 'map', at: a.kind === 'point' ? { lon: a.lon, lat: a.lat } : null }); },
      onState: (on) => useCompanion.getState().setListening(on),
      onError: setHint,
    });
    ctl.current = c; setSupported(c.supported);
    return () => { c.stop(); ctl.current = null; };
  }, []);

  const start = useCallback(() => { ctl.current?.start(); }, []);
  const stop = useCallback(() => ctl.current?.stop(), []);
  const toggle = useCallback(() => { if (ctl.current?.active()) ctl.current.stop(); else start(); }, [start]);

  // hold Space to talk, only when focus is not on a text input or another control
  useEffect(() => {
    if (!supported) return;
    const blocked = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (IGNORE_TAGS.has(el.tagName) || el.isContentEditable || el.getAttribute?.('role') === 'textbox');
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || blocked(e.target)) return;
      e.preventDefault(); start();
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && ctl.current?.active()) stop(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [supported, start, stop]);

  return { supported, listening, hint, start, stop, toggle };
}

export function Scout({ projectToScreen, sampleAt }: ScoutProps) {
  const mood = useCompanion((c) => c.mood);
  const busy = useCompanion((c) => c.busy);
  const listening = useCompanion((c) => c.listening);
  const anchor = useCompanion((c) => c.anchor);
  const bubbleOpen = useCompanion((c) => c.bubbleOpen);
  const sheet = useMedia('(max-width: 640px)');
  const voice = useVoice();

  const root = useRef<HTMLDivElement>(null);
  const lean = useRef<HTMLDivElement>(null);
  const eye = useRef<SVGGElement>(null);
  const leader = useRef<SVGLineElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const sample = useRef(sampleAt);
  useEffect(() => { sample.current = sampleAt; }, [sampleAt]);
  const arrow = useRef<HTMLSpanElement>(null);
  const api = useRef<BubbleApi | null>(null);
  const proj = useRef(projectToScreen);
  useEffect(() => { proj.current = projectToScreen; }, [projectToScreen]);
  const live = useRef({ anchor, bubbleOpen, sheet });
  useEffect(() => { live.current = { anchor, bubbleOpen, sheet }; }, [anchor, bubbleOpen, sheet]);

  const shown = listening ? 'listening' : busy && mood === 'idle' ? 'thinking' : mood;
  const following = anchor.kind === 'cursor' && !bubbleOpen && !sheet;

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const qaMode = new URLSearchParams(window.location.search).has('qa'); // test hook: no spring, so screenshots are deterministic
    const cursor = { x: window.innerWidth - 120, y: window.innerHeight - 120, moved: false };
    const frozen = { x: cursor.x + OFFSET.x, y: cursor.y + OFFSET.y };
    const pos: Vec = { x: frozen.x, y: frozen.y };
    const vel: Vec = { x: 0, y: 0 };
    let key = '';
    let flight: { t0: number; from: Vec } | null = null;
    let last = performance.now();
    let raf = 0;
    let dwellAt = 0, dwellX = 0, dwellY = 0;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      cursor.x = e.clientX; cursor.y = e.clientY; cursor.moved = true;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { anchor: a, bubbleOpen: open, sheet: isSheet } = live.current;
      const st = stageRect();
      const vw = st.right, vh = st.bottom, x0 = st.left, y0 = st.top; // the reticle lives on the map, never on the chrome

      let target: Vec; let parkAngle: number | null = null; let k: string; let avoid: Vec | undefined;
      if (isSheet) {
        k = 'dock';
        const br = open ? api.current?.rect() : null;
        target = { x: vw - 16 - SIZE / 2, y: br ? br.top - 14 - SIZE / 2 : vh - 16 - SIZE / 2 };
      } else if (a.kind === 'point') {
        const p = proj.current({ lon: a.lon, lat: a.lat });
        const inView = p.visible && p.x >= x0 + 24 && p.x <= vw - 24 && p.y >= y0 + 24 && p.y <= vh - 24;
        if (inView) { k = `p${a.lon},${a.lat}`; target = { x: p.x + OFFSET.x, y: p.y + OFFSET.y }; avoid = { x: p.x, y: p.y }; }
        else { const e = parkAtEdge({ x: p.x - x0, y: p.y - y0 }, vw - x0, vh - y0, SIZE / 2 + 12); k = `p${a.lon},${a.lat}`; target = { x: e.x + x0, y: e.y + y0 }; parkAngle = e.angle; }
      } else {
        k = 'cursor';
        const onStage = cursor.x > x0 && cursor.x < vw && cursor.y > y0 && cursor.y < vh;
        if (!open) { if (cursor.moved && onStage) { frozen.x = cursor.x + OFFSET.x; frozen.y = cursor.y + OFFSET.y; } else if (!cursor.moved) { frozen.x = vw - 80; frozen.y = vh - 80; } }
        target = { x: frozen.x, y: frozen.y };
        if (cursor.moved) avoid = { x: frozen.x - OFFSET.x, y: frozen.y - OFFSET.y };
      }
      target.x = Math.min(vw - SIZE / 2 - 4, Math.max(x0 + SIZE / 2 + 4, target.x));
      target.y = Math.min(vh - SIZE / 2 - 4, Math.max(y0 + SIZE / 2 + 4, target.y));
      { // keep clear of the HUD (wordmark, verdict, icons, playback bar), scene labels and the bubble: Scout stands beside them, never on them
        const rects = collectAvoid().filter((q) => q.right > x0 && q.left < vw && q.bottom > y0 && q.top < vh)
          .map((q) => ({ left: q.left - x0, right: q.right - x0, top: q.top - y0, bottom: q.bottom - y0 }));
        const br = open ? api.current?.rect() : null;
        if (br) rects.push({ left: br.left - x0, top: br.top - y0, right: br.right - x0, bottom: br.bottom - y0 });
        const n2 = nudgeClear({ x: target.x - x0, y: target.y - y0 }, SIZE, rects, 4, vw - x0, vh - y0);
        target.x = n2.x + x0; target.y = n2.y + y0;
      }

      const snap = reduced.matches || qaMode;
      // a change of anchor (cursor to point, point to point, point to cursor) starts a flight; the rest is the spring
      if (k !== key) {
        if (key !== '' && !snap && !isSheet) { flight = { t0: now, from: { ...pos } }; vel.x = 0; vel.y = 0; }
        key = k;
      }


      if (snap) { pos.x = target.x; pos.y = target.y; vel.x = 0; vel.y = 0; flight = null; }
      else if (flight) {
        const t = (now - flight.t0) / FLIGHT_MS;
        const p = arcPoint(flight.from, target, t, 40);
        pos.x = p.x; pos.y = p.y;
        if (t >= 1) { flight = null; vel.x = 0; vel.y = 0; }
      } else {
        const omega = 13;
        const sx = springStep(pos.x, vel.x, target.x, omega, dt);
        const sy = springStep(pos.y, vel.y, target.y, omega, dt);
        pos.x = sx.pos; pos.y = sy.pos; vel.x = sx.vel; vel.y = sy.vel;
      }

      const r = root.current;
      if (r) r.style.transform = `translate3d(${(pos.x - SIZE / 2).toFixed(1)}px,${(pos.y - SIZE / 2).toFixed(1)}px,0)`;
            if (eye.current) {
        const tx = avoid ? avoid.x : cursor.x, ty = avoid ? avoid.y : cursor.y;
        eye.current.style.transform = `rotate(${(Math.atan2(ty - pos.y, tx - pos.x) * 180 / Math.PI).toFixed(1)}deg)`;
      }
      if (arrow.current) {
        arrow.current.style.opacity = parkAngle === null ? '0' : '1';
        if (parkAngle !== null) arrow.current.style.transform = `rotate(${parkAngle}rad) translateX(${SIZE / 2 + 2}px)`;
      }
      const speed = Math.hypot(vel.x, vel.y) + (flight ? 999 : 0);
      const still = speed < 6 ? '1' : '0';
      if (r && r.dataset.still !== still) r.dataset.still = still;
      const ln = leader.current;
      if (open && !isSheet) {
        const b = api.current?.place(pos, SIZE, avoid);
        if (ln && b) {
          const ex = Math.max(b.left, Math.min(pos.x, b.left + b.width)), ey = Math.max(b.top, Math.min(pos.y, b.top + b.height));
          const d = Math.hypot(ex - pos.x, ey - pos.y) || 1, k0 = SIZE / 2 / d;
          ln.setAttribute('x1', String(pos.x + (ex - pos.x) * Math.min(1, k0))); ln.setAttribute('y1', String(pos.y + (ey - pos.y) * Math.min(1, k0)));
          ln.setAttribute('x2', String(ex)); ln.setAttribute('y2', String(ey)); ln.style.opacity = d > SIZE / 2 + 4 ? '1' : '0';
        }
      } else if (ln) ln.style.opacity = '0';
      const ro = readout.current;
      if (ro) {
        const el = document.elementFromPoint(cursor.x, cursor.y);
        const inside = cursor.x > x0 && cursor.x < vw && cursor.y > y0 && cursor.y < vh;
        const over = !cursor.moved || open || !inside || !!el?.closest('[data-companion],[data-log],[data-avoid],button,input,textarea,a,select');
        const info = !over && sample.current ? sample.current(cursor.x, cursor.y) : null;
        if (!info) { ro.style.opacity = '0'; dwellAt = now; }
        else {
          if (Math.hypot(cursor.x - dwellX, cursor.y - dwellY) > 3) { dwellAt = now; dwellX = cursor.x; dwellY = cursor.y; }
          const lines = formatReadout(info, now - dwellAt > 600);
          const txt = lines.join('\n');
          if (ro.dataset.t !== txt) { ro.dataset.t = txt; ro.textContent = txt; }
          const rw = ro.offsetWidth, rh = ro.offsetHeight;
          const blocks = collectAvoid();
          const spots: [number, number][] = [[cursor.x + 14, cursor.y + 14], [cursor.x - 14 - rw, cursor.y + 14], [cursor.x + 14, cursor.y - 14 - rh], [cursor.x - 14 - rw, cursor.y - 14 - rh]];
          const fits = (l: number, t: number) => l >= x0 + 4 && t >= y0 + 4 && l + rw <= vw - 4 && t + rh <= vh - 4 && blocks.every((b) => l + rw <= b.left - 2 || l >= b.right + 2 || t + rh <= b.top - 2 || t >= b.bottom + 2);
          const spot = spots.find(([l, t]) => fits(l, t));
          if (spot) { ro.style.opacity = '1'; ro.style.transform = `translate3d(${spot[0]}px,${spot[1]}px,0)`; }
          else ro.style.opacity = '0'; // nowhere clear beside the cursor: say nothing rather than print over something
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); };
  }, []);

  // Escape closes the bubble from anywhere
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && useCompanion.getState().bubbleOpen) useCompanion.getState().closeBubble(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const openAndFocus = () => {
    useCompanion.getState().openBubble();
    requestAnimationFrame(() => document.getElementById('marsagent-card-input')?.focus());
  };

  return (
    <>
      <svg className={s.leaderSvg} aria-hidden><line ref={leader} className={s.leader} /></svg>
      <div ref={readout} className={s.readout} aria-hidden />
      <div ref={root} className={s.root} data-follow={following} data-still="1" data-companion style={sheet && bubbleOpen ? { display: 'none' } : undefined}>
        <span ref={arrow} className={s.arrow} aria-hidden />
        <div ref={lean} className={s.lean}>
          <button type="button" className={s.mascot} onClick={openAndFocus}
            title="MarsAgent" aria-label="MarsAgent. Open to ask a question." aria-expanded={bubbleOpen}>
            <ScoutMark mood={shown} look={eye} />
          </button>
        </div>
      </div>
      <MapCard apiRef={api} sheet={sheet} voice={voice} />
    </>
  );
}
