'use client';
import {
  ArrowUp, Braces, Calculator, ChevronRight, Crosshair, FileSearch, FileText, Lasso, Link2, ListTree,
  MessageSquare, MousePointer2, PanelRightClose, Volume2, VolumeX, Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { llStr } from '@/lib/agent/explain';
import { prettyJson } from './json';
import { exportReport, openReport } from '@/components/Report/actions';
import { emitAsk } from '@/state/companion';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { useShell } from '@/state/shell';
import { fmtElapsed, lineTime, useThread, type Turn, type WorkStep } from '@/state/thread';
import { Code, Dot, LineIcon, Mark, ORIGIN_TEXT, Rich, ScienceBlock } from './parts';
import { useReveal, useRevealed } from './reveal';
import s from './agent.module.css';

const ll = (p: { lat: number; lon: number }) => llStr(p, 4);
const ORIGIN_ICON = { map: Crosshair, panel: MessageSquare, drag: MousePointer2, lasso: Lasso, tool: Wrench } as const;
const KIND_LABEL: Record<WorkStep['kind'], string | null> = { input: null, model: 'model', tool: 'tool', calculation: 'calculation', verdict: null };

function Step({ st }: { st: WorkStep }) {
  const [raw, setRaw] = useState(false);
  return (
    <li className={s.step} data-kind={st.kind} data-tone={st.tone}>
      <span className={s.pin} aria-hidden />
      <div className={s.stepT}>
        <b>{st.title}</b>
        {KIND_LABEL[st.kind] && <span className={s.k}>{KIND_LABEL[st.kind]}</span>}
        {st.meta && <span className={s.ms}>{st.meta}</span>}
      </div>
      {st.text && <p className={`${s.stepText} ${s.num}`}>{st.text}</p>}
      {st.code && st.code.length > 0 && <Code lines={st.code} label={`${st.title} formula`} />}
      {st.sources && st.sources.length > 0 && (
        <p className={s.src}>{st.sources.map((x, i) => <span key={i}>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title}</a> : x.title}{i < st.sources!.length - 1 ? '; ' : ''}</span>)}</p>
      )}
      {st.raw != null && (
        <>
          <button type="button" className={s.rawBtn} aria-expanded={raw} onClick={() => setRaw((v) => !v)}><Braces size={11} strokeWidth={1.5} aria-hidden />{raw ? 'Hide raw JSON' : 'Raw JSON'}</button>
          {raw && <pre className={s.raw} tabIndex={0} aria-label={`${st.title} raw JSON`}>{prettyJson(st.raw)}</pre>}
        </>
      )}
    </li>
  );
}

/** The full report card: one row of actions (Open, then the four exports). Shown on the latest turn that changed the plan. */
export function ReportCard() {
  return (
    <div className={s.rep}>
      <div className={s.repTop}>
        <FileText size={18} strokeWidth={1.5} aria-hidden />
        <div><b>Mission planning report</b><small>8 sections, every formula, inputs, sources and the full agent trace</small></div>
      </div>
      <div className={s.acts}>
        <button type="button" className={s.act} data-pri onClick={() => openReport()}><FileSearch size={12} strokeWidth={1.75} aria-hidden />Open</button>
        <button type="button" className={s.act} title="Print the report to PDF" onClick={() => exportReport('pdf')}>PDF</button>
        <button type="button" className={s.act} title="Download the report as Markdown" onClick={() => exportReport('md')}>MD</button>
        <button type="button" className={s.act} title="Download every input, tool call and formula as JSON" onClick={() => exportReport('json')}>JSON</button>
        <button type="button" className={s.act} title="Download the route legs with per-vertex elevation" onClick={() => exportReport('geojson')}>GeoJSON</button>
      </div>
    </div>
  );
}

/** Older turns that changed the plan keep a one-line link; the report always reflects the whole session. */
function ReportLink() {
  return <button type="button" className={s.repLink} onClick={() => openReport()} title="Open the mission planning report (it covers the whole session)"><FileText size={12} strokeWidth={1.5} aria-hidden />Report</button>;
}

/** "1.24 s, 10 steps, fixed code"; "instant, fixed code" for a turn with no steps that took under 5 ms. */
export function turnMeta(t: Pick<Turn, 'startedAt' | 'endedAt' | 'steps' | 'engine'>): string {
  const took = t.endedAt != null ? t.endedAt - t.startedAt : null;
  if (took == null) return 'working';
  const engine = t.engine === 'deterministic' ? 'fixed code' : t.engine;
  const n = t.steps.length;
  return [took < 5 ? 'instant' : fmtElapsed(took), n ? `${n} step${n === 1 ? '' : 's'}` : null, engine].filter(Boolean).join(', ');
}

function TurnView({ t, flash, fullReport }: { t: Turn; flash: boolean; fullReport: boolean }) {
  const r = useRevealed(t)!;
  const narrate = useShell((x) => x.narrateAloud);
  const Icon = ORIGIN_ICON[t.ask.origin] ?? MessageSquare;
  const meta = r.complete ? turnMeta(t) : 'working';
  return (
    <article className={s.turn} id={`turn-${t.id}`} data-flash={flash} aria-label={`Turn ${t.seq}`}>
      <div className={s.msgU}>
        <div className={s.from}><Icon size={11} strokeWidth={1.5} aria-hidden />{ORIGIN_TEXT(t.ask.origin, t.ask.at, ll)}</div>
        {t.ask.text}
      </div>
      <div className={s.msgA}>
        <div className={s.who}><Mark />MarsAgent <span className={`${s.meta} ${s.num}`}>{meta}</span>{narrate && !r.complete && <span className={s.speaking}>reading aloud, synthetic voice</span>}</div>
        {r.lines.length > 0 && (
          <ol className={s.narr} aria-label="What MarsAgent is doing">
            {r.lines.map((l) => <li key={l.id} data-state={l.state}><LineIcon state={l.state} /><span>{l.text}</span>{l.state !== 'now' && lineTime(l.tMs) && <span className={s.t}>{lineTime(l.tMs)}</span>}</li>)}
          </ol>
        )}
        {r.complete && t.steps.length > 0 && (
          <details className={s.box}>
            <summary><ListTree size={13} strokeWidth={1.5} aria-hidden />How I worked it out<span className={s.n}>{t.steps.length} step{t.steps.length === 1 ? '' : 's'}</span><ChevronRight className={s.chev} size={12} strokeWidth={1.5} aria-hidden /></summary>
            <ol className={s.steps}>{t.steps.map((st) => <Step key={st.id} st={st} />)}</ol>
          </details>
        )}
        {r.complete && t.recompute && (
          <div className={s.recompute}>
            <h4><Calculator size={13} strokeWidth={1.5} aria-hidden />{t.recompute.title}<span className={s.n}>deterministic</span></h4>
            <Code lines={t.recompute.code} label={t.recompute.title} />
          </div>
        )}
        {r.complete && t.answer && (
          <p className={s.answer}>
            {t.answer.lead && <span className={s.lead} data-tone={t.answer.lead.tone}>{t.answer.lead.text}</span>}
            <Rich text={t.answer.text} unverified={t.answer.unverified} />
          </p>
        )}
        {r.complete && t.answer?.unverified && t.answer.unverified.length > 0 && <p className={s.src}>Underlined numbers were not found in any tool result.</p>}
        {r.complete && t.answer?.rows && t.answer.rows.length > 0 && (
          <div className={s.mini} role="table" aria-label="Key numbers">
            {t.answer.rows.map((row) => [
              <div key={`${row.label}k`} role="cell">{row.label}</div>,
              <div key={`${row.label}v`} role="cell">{row.value}<Dot tone={row.tone} /></div>,
            ])}
          </div>
        )}
        {r.complete && t.answer?.science && <ScienceBlock sci={t.answer.science} />}
        {r.complete && t.report && (fullReport ? <ReportCard /> : <ReportLink />)}
      </div>
    </article>
  );
}

function useChips(): string[] {
  const mode = useGlobeStore((g) => g.mode);
  const route = useHud((h) => h.activeRouteId);
  return useMemo(() => {
    // the mast is offered once, on the map card, and only when comms is what blocks the walk
    if (mode === 'jezero' && route) return ['Explain the slope check', 'Show the A* settings', 'What if the suit draws 300 W?'];
    if (mode === 'jezero') return ['Walk here and back', 'Base camp reach', 'How far is Earth?'];
    return ['Take me to Jezero', 'How far is Earth?'];
  }, [mode, route]);
}

function Composer() {
  const [text, setText] = useState('');
  const chips = useChips();
  const send = (t: string) => { const v = t.trim(); if (!v) return; setText(''); emitAsk(v, { origin: 'panel' }); };
  return (
    <div className={s.composer}>
      <div className={s.chips} aria-label="Suggestions">{chips.map((c) => <button key={c} type="button" className={s.chip} onClick={() => send(c)}>{c}</button>)}</div>
      <form className={s.inbox} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <MessageSquare size={15} strokeWidth={1.5} aria-hidden />
        <input id="marsagent-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about the plan or the maths" aria-label="Ask MarsAgent about the plan or the maths" autoComplete="off" enterKeyHint="send" />
        <button type="submit" className={s.send} aria-label="Send" disabled={!text.trim()}><ArrowUp size={14} strokeWidth={1.75} aria-hidden /></button>
      </form>
      <p className={s.sync}><Link2 size={12} strokeWidth={1.5} aria-hidden />Questions asked on the map appear here, and answers here act on the map.</p>
    </div>
  );
}

/** The MarsAgent panel: one thread for everything asked on the map or here, each turn with live narration, the working and the answer. */
export function Panel() {
  const open = useShell((x) => x.panelOpen);
  const narrate = useShell((x) => x.narrateAloud);
  const turns = useThread((x) => x.turns);
  const focusId = useThread((x) => x.focusTurnId);
  const focusSeq = useThread((x) => x.focusSeq);
  const list = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const lastLen = useRef(0);
  const shown = useReveal((r) => Object.values(r.shown).reduce((a, b) => a + b, 0));
  // the full report card sits on one turn only: the latest finished turn with a report, while it is a route plan (a card
  // with a verdict word, kept through follow-ups) or the newest turn; every other report turn gets the one-line link
  const lastReport = useMemo(() => {
    const done = turns.filter((t) => t.status !== 'working');
    const t = [...done].reverse().find((x) => x.report);
    return t && (t.card?.word || t.id === done.at(-1)?.id) ? t.id : null;
  }, [turns]);
  const narrLen = turns.reduce((n, t) => n + t.narration.length + (t.status === 'working' ? 0 : 1), 0) * 1000 + shown;

  // follow the conversation: keep the newest turn in view while it streams (only scroll the thread, never the page)
  useEffect(() => {
    const el = list.current; if (!el) return;
    const grew = narrLen !== lastLen.current; lastLen.current = narrLen;
    if (grew && !focusId) el.scrollTop = el.scrollHeight;
  });
  // "in panel" on the map card: scroll to that turn and mark it
  useEffect(() => {
    if (!focusId || !list.current) return;
    const el = list.current.querySelector<HTMLElement>(`#turn-${focusId}`);
    if (el) list.current.scrollTop = Math.max(0, el.offsetTop - list.current.offsetTop - 8);
    setFlash(focusId);
    const id = setTimeout(() => { setFlash(null); useThread.setState({ focusTurnId: null }); }, 1600);
    return () => clearTimeout(id);
  }, [focusId, focusSeq]);

  return (
    <aside id="marsagent-panel" className={s.panel} aria-label="MarsAgent" hidden={!open} data-log data-avoid>
      <div className={s.head}>
        <h2>MarsAgent</h2>
        <button type="button" className={s.voice} role="switch" aria-checked={narrate} onClick={() => useShell.getState().setNarrate(!narrate)} title="Reads each narration line with your browser's speech synthesis">
          {narrate ? <Volume2 size={14} strokeWidth={1.5} aria-hidden /> : <VolumeX size={14} strokeWidth={1.5} aria-hidden />}
          <span>Narrate aloud<small>synthetic voice</small></span>
        </button>
        <button type="button" className={s.iconBtn} aria-label="Collapse the MarsAgent panel" onClick={() => useShell.getState().setPanel(false)}><PanelRightClose size={15} strokeWidth={1.5} aria-hidden /></button>
      </div>
      <div ref={list} className={s.thread} role="log" aria-live="polite" aria-label="MarsAgent thread" tabIndex={0}>
        {turns.length === 0
          ? <p className={s.empty}><b>Nothing asked yet.</b>Click anywhere on Mars, or ask below. Every answer lists what I did and the maths behind it, with sources.</p>
          : turns.map((t) => <TurnView key={t.id} t={t} flash={flash === t.id} fullReport={t.id === lastReport} />)}
      </div>
      <Composer />
    </aside>
  );
}
