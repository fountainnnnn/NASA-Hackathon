'use client';
import { History, LoaderCircle, Mic, X } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { emitAsk, useCompanion } from '@/state/companion';
import { placeBubble, type Vec } from './motion';
import { firstLine, splitAnswer, timeAgo, tokenizeAnswer } from './text';
import s from './Companion.module.css';

export interface BubbleApi {
  /** Called every frame by Scout with its centre, size and the point to keep clear (desktop only). Returns the bubble rect. */
  place: (scout: Vec, size: number, avoid?: Vec) => { left: number; top: number; width: number; height: number } | null;
  size: () => { w: number; h: number };
}

export interface VoiceControl {
  supported: boolean; listening: boolean; hint: string;
  start: () => void; stop: () => void; toggle: () => void;
}

export interface BubbleProps {
  apiRef: MutableRefObject<BubbleApi | null>;
  /** Bottom sheet instead of a floating bubble (touch / narrow screens). */
  sheet: boolean;
  voice: VoiceControl;
}

const ACTIONS = {
  globe: ['Could we land here?', "What's the ground like?", 'Take me to Jezero'],
  jezero: ['Walk here and back', 'Avoid steep ground', 'Show the risky part'],
} as const;

function Rich({ text, unverified }: { text: string; unverified: string[] }) {
  return (
    <>
      {tokenizeAnswer(text, unverified).map((t, j) =>
        t.kind === 'num' ? <span key={j} className={s.num}>{t.text}</span>
        : t.kind === 'unverified' ? <span key={j} className={`${s.num} ${s.unverified}`} tabIndex={0} title="not found in tool results" aria-label={`${t.text}, not found in tool results`}>{t.text}</span>
        : <span key={j}>{t.text}</span>)}
    </>
  );
}

export function Bubble({ apiRef, sheet, voice }: BubbleProps) {
  const open = useCompanion((c) => c.bubbleOpen);
  const mode = useCompanion((c) => c.mode);
  const current = useCompanion((c) => c.current);
  const trail = useCompanion((c) => c.trail);
  const busy = useCompanion((c) => c.busy);
  const doing = useCompanion((c) => c.doing);
  const interim = useCompanion((c) => c.interim);
  const listening = useCompanion((c) => c.listening);
  const [text, setText] = useState('');
  const [showTrail, setShowTrail] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(apiRef, () => ({
    size: () => { const el = box.current; return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 }; },
    place: (scout, size, avoid) => {
      const el = box.current; if (!el) return null;
      const p = placeBubble(scout, size, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, avoid);
      el.style.transform = `translate3d(${p.left.toFixed(1)}px,${p.top.toFixed(1)}px,0)`;
      el.dataset.placed = '1';
      return p;
    },
  }), []);

  useEffect(() => { if (!open) { setShowTrail(false); } }, [open]);
  useEffect(() => { if (voice.hint) setShowHint(true); }, [voice.hint]);
  // press T to toggle the trail when not typing
  useEffect(() => {
    if (!open) return;
    const k = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || el?.tagName === 'TEXTAREA' || el?.tagName === 'INPUT') return;
      setShowTrail((v) => !v);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  // grow the textarea to its content (max 3 lines)
  useEffect(() => {
    const a = area.current; if (!a) return;
    a.style.height = 'auto'; a.style.height = `${Math.min(a.scrollHeight, 66)}px`;
  }, [text, open]);

  if (!open) return null;

  const send = (t: string) => {
    const v = t.trim(); if (!v) return;
    setText(''); setShowTrail(false); emitAsk(v);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); }
    else if (e.key === 'Escape') { e.preventDefault(); useCompanion.getState().closeBubble(); }
  };
  const onMic = () => { if (!voice.supported) setShowHint(true); voice.toggle(); };
  const hint = !voice.supported ? 'Voice is not supported in this browser. Type instead.' : voice.hint;
  const ans = current ? splitAnswer(current.text) : null;

  return (
    <div ref={box} className={`${s.bubble} ${sheet ? s.sheet : ''}`} role="dialog" aria-label="Scout" data-companion>
      <div className={s.head}>
        <button type="button" className={s.iconBtn} aria-label="Earlier answers (T)" aria-expanded={showTrail} disabled={trail.length === 0} onClick={() => setShowTrail((v) => !v)}>
          <History size={15} strokeWidth={1.5} aria-hidden />
        </button>
        <button type="button" className={s.iconBtn} aria-label="Close Scout (Esc)" onClick={() => useCompanion.getState().closeBubble()}>
          <X size={15} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      <div className={s.scroll}>
        <div aria-live="polite">
          {ans
            ? <>
                <h2 className={s.headline}><Rich text={ans.headline} unverified={current!.unverified} /></h2>
                {ans.body.map((l, i) => <p key={i} className={s.line}><Rich text={l} unverified={current!.unverified} /></p>)}
              </>
            : <h2 className={s.headline}>Click the planet to ask about a place.</h2>}
        </div>
        {current && current.sources.length > 0 && (
          <p className={s.sources}>
            {current.sources.map((src, i) => (
              <span key={`${src.title}${i}`}>
                {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a> : src.title}
                {i < current.sources.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        )}
        {current && current.unverified.length > 0 && <p className={s.sources}>Underlined numbers were not found in tool results.</p>}
      </div>

      {busy && (
        <p className={s.doing} role="status">
          <LoaderCircle size={13} strokeWidth={1.5} className={s.spin} aria-hidden />
          <span>{doing ?? 'Working…'}</span>
        </p>
      )}

      {showTrail && trail.length > 0 && (
        <ul className={s.trail} aria-label="Earlier answers">
          {trail.slice(0, 8).map((u) => (
            <li key={u.id}>
              <button type="button" className={s.trailItem} onClick={() => { useCompanion.getState().showFromTrail(u.id); setShowTrail(false); }}>
                <span className={s.trailText}>{firstLine(u.text, 44)}</span>
                <span className={s.trailTime}>{timeAgo(u.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={s.actions}>
        {ACTIONS[mode].map((c) => <button key={c} type="button" className={s.action} disabled={busy} onClick={() => send(c)}>{c}</button>)}
      </div>

      <form className={s.form} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea
          id="scout-input" ref={area} className={s.input} rows={1} value={listening ? interim : text} readOnly={listening}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={listening ? 'Listening…' : 'Ask Scout…'} aria-label="Ask Scout" enterKeyHint="send"
        />
        <button type="button" className={s.iconBtn} data-on={listening} aria-label={listening ? 'Stop listening' : 'Talk to Scout (hold Space)'} aria-pressed={listening} title="Hold Space to talk" onClick={onMic}>
          <Mic size={15} strokeWidth={1.5} aria-hidden />
        </button>
      </form>
      <p className={s.footer}>{showHint && hint ? hint : 'AI-generated'}</p>
    </div>
  );
}
