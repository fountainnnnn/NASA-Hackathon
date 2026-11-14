'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LonLat } from '@/lib/contracts';
import { emitAsk, useCompanion } from '@/state/companion';
import { Bubble, type BubbleApi, type VoiceControl } from './Bubble';
import { arcPoint, parkAtEdge, springStep, type Vec } from './motion';
import { monoScout } from './scoutArt';
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

const artCache = new Map<string, string>();
function ScoutArt({ mood }: { mood: string }) {
  const [svg, setSvg] = useState(artCache.get(mood) ?? '');
  useEffect(() => {
    const hit = artCache.get(mood);
    if (hit) { setSvg(hit); return; }
    let live = true;
    fetch(`/art/scout-${mood}.svg`).then((r) => r.text()).then((x) => { const m = monoScout(x); artCache.set(mood, m); if (live) setSvg(m); }).catch(() => {});
    return () => { live = false; };
  }, [mood]);
  return <span key={mood} className={s.art} dangerouslySetInnerHTML={{ __html: svg }} />;
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
      onFinal: (t) => { useCompanion.getState().openBubble(); emitAsk(t); },
      onState: (on) => useCompanion.getState().setListening(on),
      onError: setHint,
    });
    ctl.current = c; setSupported(c.supported);
    return () => { c.stop(); ctl.current = null; };
  }, []);

  const start = useCallback(() => { useCompanion.getState().openBubble(); ctl.current?.start(); }, []);
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
  const sheet = useMedia('(pointer: coarse), (max-width: 520px)');
  const voice = useVoice();

  const root = useRef<HTMLDivElement>(null);
  const lean = useRef<HTMLDivElement>(null);
  const eye = useRef<HTMLSpanElement>(null);
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
      const vw = window.innerWidth, vh = window.innerHeight;
      const bsize = api.current?.size() ?? { w: 0, h: 0 };

      let target: Vec; let parkAngle: number | null = null; let k: string; let avoid: Vec | undefined;
      if (isSheet) {
        k = 'dock';
        target = { x: vw - 16 - SIZE / 2, y: vh - 16 - SIZE / 2 - (open ? bsize.h + 12 : 0) };
      } else if (a.kind === 'point') {
        const p = proj.current({ lon: a.lon, lat: a.lat });
        const inView = p.visible && p.x >= 24 && p.x <= vw - 24 && p.y >= 24 && p.y <= vh - 24;
        if (inView) { k = `p${a.lon},${a.lat}`; target = { x: p.x + OFFSET.x, y: p.y + OFFSET.y }; avoid = { x: p.x, y: p.y }; }
        else { const e = parkAtEdge(p, vw, vh, SIZE / 2 + 12); k = `p${a.lon},${a.lat}`; target = { x: e.x, y: e.y }; parkAngle = e.angle; }
      } else {
        k = 'cursor';
        if (!open) { if (cursor.moved) { frozen.x = cursor.x + OFFSET.x; frozen.y = cursor.y + OFFSET.y; } else { frozen.x = vw - 80; frozen.y = vh - 80; } }
        target = { x: frozen.x, y: frozen.y };
        if (cursor.moved) avoid = { x: frozen.x - OFFSET.x, y: frozen.y - OFFSET.y };
      }
      target.x = Math.min(vw - SIZE / 2 - 4, Math.max(SIZE / 2 + 4, target.x));
      target.y = Math.min(vh - SIZE / 2 - 4, Math.max(SIZE / 2 + 4, target.y));

      const snap = reduced.matches;
      // a change of anchor (cursor to point, point to point, point to cursor) starts a flight; the rest is the spring
      if (k !== key) {
        if (key !== '' && !snap && !isSheet) { flight = { t0: now, from: { ...pos } }; vel.x = 0; vel.y = 0; }
        key = k;
      }

      const prev = { x: pos.x, y: pos.y };
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
      const vx = dt > 0 ? (pos.x - prev.x) / dt : 0;

      const r = root.current;
      if (r) r.style.transform = `translate3d(${(pos.x - SIZE / 2).toFixed(1)}px,${(pos.y - SIZE / 2).toFixed(1)}px,0)`;
      if (lean.current) lean.current.style.transform = `rotate(${snap ? 0 : Math.max(-6, Math.min(6, vx * 0.006)).toFixed(2)}deg)`;
      if (eye.current) {
        const dx = cursor.x - pos.x, dy = cursor.y - pos.y, n = Math.hypot(dx, dy) || 1;
        const m = snap ? 0 : Math.min(n, 220) / 220 * 1.6;
        eye.current.style.transform = `translate(${(dx / n * m).toFixed(2)}px,${(dy / n * m).toFixed(2)}px)`;
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
        const over = !cursor.moved || open || !!el?.closest('[data-companion],button,input,textarea,a,select');
        const info = !over && sample.current ? sample.current(cursor.x, cursor.y) : null;
        if (!info) { ro.style.opacity = '0'; dwellAt = now; }
        else {
          if (Math.hypot(cursor.x - dwellX, cursor.y - dwellY) > 3) { dwellAt = now; dwellX = cursor.x; dwellY = cursor.y; }
          const lines = formatReadout(info, now - dwellAt > 600);
          const txt = lines.join('\n');
          if (ro.dataset.t !== txt) { ro.dataset.t = txt; ro.textContent = txt; }
          ro.style.opacity = '1';
          ro.style.transform = `translate3d(${Math.min(cursor.x + 14, vw - 150)}px,${Math.min(cursor.y + 14, vh - 40)}px,0)`;
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
    requestAnimationFrame(() => document.getElementById('scout-input')?.focus());
  };

  return (
    <>
      <svg className={s.leaderSvg} aria-hidden><line ref={leader} className={s.leader} /></svg>
      <div ref={readout} className={s.readout} aria-hidden />
      <div ref={root} className={s.root} data-follow={following} data-still="1" data-companion>
        <span ref={arrow} className={s.arrow} aria-hidden />
        <div ref={lean} className={s.lean}>
          <button type="button" className={s.mascot} onClick={openAndFocus}
            title="Scout (AI-generated)" aria-label="Scout, AI-generated assistant. Open to ask a question." aria-expanded={bubbleOpen}>
            <span className={s.bob}><span className={s.look} ref={eye}><ScoutArt mood={shown} /></span></span>
          </button>
        </div>
      </div>
      <Bubble apiRef={api} sheet={sheet} voice={voice} />
    </>
  );
}
