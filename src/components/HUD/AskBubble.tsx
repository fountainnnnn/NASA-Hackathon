'use client';
import { MessageCircle, Send, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fmtElev, fmtLat, fmtLon, splitUnverified } from '@/lib/scene/format';
import { askCopilot, ensureDefaultSelection, whatsHere } from '@/state/services';
import { getAnchor, subscribeAnchor } from '@/state/ui';
import type { Anchor } from '@/state/ui';
import { useWorld } from '@/state/world';
import { AgentTrace } from './AgentTrace';
import { MascotSlot } from './MascotSlot';
import s from './hud.module.css';

const QUICK = [
  'Round trip to the delta',
  "What's here?",
  'Round trip from base',
  'Avoid steep ground, keep 25% battery',
  'Why not the shorter route?',
  'Plan a delta science loop',
];

function Message({ role, text, unverified }: { role: string; text: string; unverified?: string[] }) {
  if (role === 'user') return <div className={`${s.msg} ${s.msgUser}`}>{text}</div>;
  const parts = splitUnverified(text, unverified ?? []);
  return (
    <div className={`${s.msg} ${s.msgBot}`}>
      {parts.map((p, i) => p.flagged
        ? <span key={i} className={s.unverified} tabIndex={0} title="not found in tool results" aria-label={`${p.text}, not found in tool results`}>{p.text}</span>
        : <span key={i}>{p.text}</span>)}
      {(unverified?.length ?? 0) > 0 && <p className={s.note} style={{ marginTop: 6 }}>Underlined numbers were not found in tool results. Treat them as unverified.</p>}
    </div>
  );
}

/** `embedded` = rendered inside the phone bottom sheet (no floating position). */
export function AskBubble({ embedded = false }: { embedded?: boolean }) {
  const open = useWorld((st) => st.askOpen);
  const drawerOpen = useWorld((st) => st.drawerOpen);
  const selected = useWorld((st) => st.selected);
  const messages = useWorld((st) => st.messages);
  const trace = useWorld((st) => st.trace);
  const busy = useWorld((st) => st.busy);
  const offline = useWorld((st) => st.offline);
  const [text, setText] = useState('');
  const box = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [anchored, setAnchored] = useState(false);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, trace]);

  // follow the selected pin on screen without re-rendering React every frame
  useEffect(() => {
    if (embedded || !open) return;
    const place = (a: Anchor) => {
      const el = box.current;
      if (!el) return;
      const ok = !!selected && a.visible;
      setAnchored((p) => (p === ok ? p : ok));
      if (!ok) { el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = ''; return; }
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = a.x + 26;
      if (left + w > window.innerWidth - 12) left = a.x - 26 - w;
      left = Math.max(12, left);
      const top = Math.min(Math.max(a.y - 48, 72), window.innerHeight - h - 12);
      el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.right = 'auto'; el.style.bottom = 'auto';
    };
    place(getAnchor());
    return subscribeAnchor(place);
  }, [embedded, open, selected]);

  const send = (t: string) => {
    if (!t.trim()) return;
    setText('');
    void (async () => {
      // chips work in one click: with nothing selected, start from the Skinner Ridge delta site
      if (QUICK.includes(t)) await ensureDefaultSelection();
      if (t === "What's here?") await whatsHere(); // deterministic, works offline
      else await askCopilot(t === 'Round trip to the delta' ? 'Plan a round trip from base to the selected point on the western delta.' : t.trim());
    })();
  };

  if (!open && !embedded) {
    return (
      <button className={`${s.btn} ${s.btnPrimary} ${s.askOpener} ${drawerOpen ? s.askOpenerShift : ''}`}
        onClick={() => useWorld.getState().patch({ askOpen: true })}>
        <MessageCircle size={16} aria-hidden /> Ask the copilot
      </button>
    );
  }

  const mascot = busy ? 'thinking' : offline ? 'offline' : messages.length ? 'answered' : 'idle';
  return (
    <section
      ref={box} aria-label="Ask the copilot"
      className={embedded ? undefined : `${s.panel} ${s.ask} ${anchored ? '' : s.askFallback} ${!anchored && drawerOpen ? s.askShift : ''}`}
    >
      <div className={s.askHead}>
        <MascotSlot state={mascot} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Ask the copilot</h2>
          <div className={s.where}>
            {selected ? `${fmtLat(selected.lat)}, ${fmtLon(selected.lon)}, ${fmtElev(selected.elevationM)}` : 'Click the terrain to pick a point'}
          </div>
        </div>
        {!embedded && <button className={`${s.btn} ${s.iconBtn}`} aria-label="Close ask panel" onClick={() => useWorld.getState().patch({ askOpen: false })}><X size={16} aria-hidden /></button>}
      </div>

      <div className={s.msgs} ref={list} aria-live="polite">
        {messages.length === 0 && <p className={s.note}>Ask about the ground you picked, or have the copilot plan and draw a route. Every number comes from deterministic tools.</p>}
        {messages.map((m) => <Message key={m.id} role={m.role} text={m.text} unverified={m.unverified} />)}
        {busy && trace.length === 0 && <p className={s.note}>Thinking…</p>}
      </div>
      <AgentTrace steps={trace} />
      {offline && <p className={s.offline}><WifiOff size={15} aria-hidden /> Copilot unavailable right now. The buttons still work.</p>}

      <div className={s.quick}>
        {QUICK.map((q) => <button key={q} className={s.chip} disabled={busy} onClick={() => send(q)}>{q}</button>)}
      </div>
      <form className={s.askForm} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this spot or a route…" aria-label="Question for the copilot" disabled={busy} />
        <button className={`${s.btn} ${s.btnPrimary} ${s.iconBtn}`} type="submit" disabled={busy || !text.trim()} aria-label="Send"><Send size={16} aria-hidden /></button>
      </form>
    </section>
  );
}
