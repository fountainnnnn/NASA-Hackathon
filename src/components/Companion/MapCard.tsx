'use client';
import { Link2, Mic, X } from 'lucide-react';
import { useImperativeHandle, useRef, useState, type MutableRefObject } from 'react';
import { projectJezero } from '@/components/Ops/projector';
import { emitAsk, useCompanion } from '@/state/companion';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { useShell } from '@/state/shell';
import { lineTime, turnById, useThread } from '@/state/thread';
import { useWorld } from '@/state/world';
import { collectAvoid } from './avoid';
import { placeBubble, type Rect, type Vec } from './motion';
import { ActionIcon, Dot, LineIcon, Rich, ScienceBlock } from './parts';
import { useRevealed } from './reveal';
import s from './agent.module.css';

export interface BubbleApi {
  /** Called every frame by the reticle with its centre, size and the point to keep clear. Returns the card rect. */
  place: (scout: Vec, size: number, avoid?: Vec) => { left: number; top: number; width: number; height: number } | null;
  size: () => { w: number; h: number };
  rect: () => DOMRect | null;
}
export interface VoiceControl {
  supported: boolean; listening: boolean; hint: string;
  start: () => void; stop: () => void; toggle: () => void;
}

/** The map area the card must stay inside: the stage, not the panel, rail or bars. */
export function stageRect(): DOMRect {
  return document.querySelector('[data-stage]')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/**
 * Screen boxes around the drawn route (sampled vertices) and the base, so the card is placed on the side of the map away
 * from them instead of on top of them. Jezero only; empty when no route is on the map.
 */
function routeKeepClear(): Rect[] {
  if (useGlobeStore.getState().mode !== 'jezero') return [];
  const w = useWorld.getState();
  const out: Rect[] = [];
  const box = (p: { lon: number; lat: number }, r: number) => {
    const q = projectJezero(p);
    if (q.visible) out.push({ left: q.x - r, top: q.y - r, right: q.x + r, bottom: q.y + r });
  };
  const id = useHud.getState().activeRouteId;
  const route = id && w.visibleRouteIds.includes(id) ? w.routes[id] : null;
  if (route) {
    const pts = route.legs.flatMap((l) => l.path);
    const step = Math.max(1, Math.floor(pts.length / 48));
    for (let i = 0; i < pts.length; i += step) box(pts[i], 16);
  }
  if (w.base) box(w.base, 26);
  return out;
}

/**
 * MarsAgent on the map: a compact 300 px card at the reticle. Verdict word or place, coordinates, a short table with
 * status dots, action buttons and an ask line. Long content (the working, the formulas) lives in the panel.
 */
export function MapCard({ apiRef, sheet, voice }: { apiRef: MutableRefObject<BubbleApi | null>; sheet: boolean; voice: VoiceControl }) {
  const open = useCompanion((c) => c.bubbleOpen);
  const listening = useCompanion((c) => c.listening);
  const interim = useCompanion((c) => c.interim);
  const id = useThread((t) => t.cardTurnId);
  const turn = useThread((t) => (id ? t.turns.find((x) => x.id === id) ?? null : null));
  const panelOpen = useShell((x) => x.panelOpen);
  const r = useRevealed(turn);
  const box = useRef<HTMLElement>(null);
  const [text, setText] = useState('');

  useImperativeHandle(apiRef, () => ({
    size: () => { const el = box.current; return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 }; },
    rect: () => box.current?.getBoundingClientRect() ?? null,
    place: (scout, size, avoid) => {
      const el = box.current; if (!el) return null;
      const st = stageRect();
      // work in stage coordinates so the card never leaves the map area
      const rel = (v: Vec) => ({ x: v.x - st.left, y: v.y - st.top });
      const keep = collectAvoid().filter((q) => q.right > st.left && q.left < st.right && q.bottom > st.top && q.top < st.bottom)
        .concat(routeKeepClear())
        .map((q) => ({ left: q.left - st.left, right: q.right - st.left, top: q.top - st.top, bottom: q.bottom - st.top }));
      const p = placeBubble(rel(scout), size, el.offsetWidth, el.offsetHeight, st.width, st.height, avoid ? rel(avoid) : undefined, 10, 16, 0, keep);
      el.style.transform = `translate3d(${(p.left + st.left).toFixed(1)}px,${(p.top + st.top).toFixed(1)}px,0)`;
      el.dataset.placed = '1';
      return { left: p.left + st.left, top: p.top + st.top, width: p.width, height: p.height };
    },
  }), []);

  if (!open || !turn || (sheet && panelOpen)) return null;
  const c = turn.card;
  const working = !r?.complete;
  const send = (t: string) => { const v = t.trim(); if (!v) return; setText(''); emitAsk(v, { origin: 'map', at: turn.point ?? c?.point ?? null }); };
  const inPanel = () => { useShell.getState().setPanel(true); useThread.getState().focus(turn.id); };
  const title = working ? turn.ask.text : c?.title ?? turn.answer?.lead?.text ?? turn.ask.text;
  const sub = (!working && c?.sub) || (turn.point ? `${Math.abs(turn.point.lat).toFixed(4)}${turn.point.lat >= 0 ? 'N' : 'S'} ${Math.abs(turn.point.lon).toFixed(4)}${turn.point.lon >= 0 ? 'E' : 'W'}` : undefined);

  return (
    <section ref={box} className={`${s.card} ${sheet ? s.cardSheet : ''}`} role="dialog" aria-label="MarsAgent" data-companion>
      <div className={s.hd} data-verdict={!!c?.word && !working}>
        {c?.word && !working && <div className={s.word} data-tone={c.word.tone}>{c.word.text}</div>}
        <div className={s.why}>
          <h2>{title}</h2>
          {sub && <small>{sub}</small>}
        </div>
        <div className={s.hdBtns}>
          <button type="button" className={s.synced} onClick={inPanel} title="Show this answer with the full working in the MarsAgent panel"><Link2 size={11} strokeWidth={1.5} aria-hidden />in panel</button>
          <button type="button" className={s.iconBtn} aria-label="Close (Esc)" onClick={() => useCompanion.getState().closeBubble()}><X size={14} strokeWidth={1.5} aria-hidden /></button>
        </div>
      </div>
      <div className={s.body}>
        {working && r?.current && (
          <p className={s.doing} role="status"><LineIcon state={r.current.state} /><span>{r.current.text}</span>{r.current.state !== 'now' && lineTime(r.current.tMs) && <span className={s.t}>{lineTime(r.current.tMs)}</span>}</p>
        )}
        {!working && c && c.rows.length > 0 && (
          <table className={s.table}>
            <tbody>
              {c.rows.map((row) => (
                <tr key={row.label} title={row.src}>
                  <th scope="row">{row.label}</th>
                  <td className={s.v}>{row.value}</td>
                  <td className={s.s}><Dot tone={row.tone} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!working && c?.science && <ScienceBlock sci={c.science} compact />}
        {!working && !c && turn.answer && <p className={s.text}><Rich text={turn.answer.text} unverified={turn.answer.unverified} /></p>}
      </div>
      {!working && c && c.actions.length > 0 && (
        <div className={s.verbs}>
          {c.actions.map((a) => <button key={a.label} type="button" className={s.verb} onClick={() => send(a.verb)}><ActionIcon name={a.icon} />{a.label}</button>)}
        </div>
      )}
      <form className={s.ask} onSubmit={(e) => { e.preventDefault(); send(text); }} style={working || !c?.actions.length ? { marginTop: 10 } : undefined}>
        <button type="button" className={s.mic} aria-pressed={listening} aria-label={voice.supported ? (listening ? 'Stop listening' : 'Talk to MarsAgent (hold Space)') : 'Voice is not supported in this browser'} title="Hold Space to talk" onClick={() => voice.toggle()}>
          <Mic size={14} strokeWidth={1.5} aria-hidden />
        </button>
        <input id="marsagent-card-input" value={listening ? interim : text} readOnly={listening} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); useCompanion.getState().closeBubble(); } }}
          placeholder={listening ? 'Listening' : c?.askHint ?? 'Ask about this place'} aria-label="Ask MarsAgent about this place" autoComplete="off" enterKeyHint="send" />
        <span className={s.kbd} aria-hidden>hold Space</span>
      </form>
    </section>
  );
}

export { turnById };
