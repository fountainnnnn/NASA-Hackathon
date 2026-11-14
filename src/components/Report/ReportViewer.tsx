'use client';
import { Braces, ChevronDown, Download, FileCode, FileDown, Map as MapIcon, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gatherReportInput } from '@/app/reportInput';
import { buildReport, type Section, type Val } from '@/lib/report/build';
import { useShell } from '@/state/shell';
import { useThread } from '@/state/thread';
import { exportReport } from './actions';
import r from './report.module.css';

function CellView({ v }: { v: Val }) {
  if (typeof v === 'string') return <>{v}</>;
  return (
    <span className={v.status ? r.pf : undefined} data-s={v.status} data-kind={v.kind}>
      {v.mock ? <><span className={r.mock}>Mock</span> {v.text}</> : v.text}
    </span>
  );
}

function SectionView({ s }: { s: Section }) {
  return (
    <section id={`rep-${s.id}`} className={r.section} aria-labelledby={`rep-h-${s.id}`}>
      <h2 id={`rep-h-${s.id}`}><span>{s.n}</span>{s.title}</h2>
      {s.lead && <p className={r.lead}>{s.lead}</p>}
      {s.tables.map((t, i) => (
        <table key={i}>
          <thead><tr>{t.head.map((h, j) => <th key={j} className={t.num?.includes(j) ? r.n : undefined} scope="col">{h}</th>)}</tr></thead>
          <tbody>{t.rows.map((row, k) => <tr key={k}>{row.map((c, j) => <td key={j} className={t.num?.includes(j) ? r.n : undefined}><CellView v={c} /></td>)}</tr>)}</tbody>
        </table>
      ))}
      {s.calcs?.map((c) => (
        <div key={c.n} className={r.calc}>
          <p className={r.note}>{c.n} {c.title}{c.note === 'Mock' && <> <span className={r.mock}>Mock</span></>}</p>
          <pre className={r.eq}>{c.lines.join('\n')}</pre>
        </div>
      ))}
      {s.list && <ul className={r.list}>{s.list.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {s.notes?.map((n, i) => <p key={i} className={r.note}>{n}</p>)}
    </section>
  );
}

/**
 * Mission planning report over the app. The toolbar and the contents stay put; only the paper scrolls, inside its own
 * container, and the page behind is locked (inert, no scroll) until the viewer closes.
 */
export function ReportViewer() {
  const open = useShell((x) => x.reportOpen);
  const turns = useThread((x) => x.turns);
  const scroller = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState('summary');
  const report = useMemo(() => (open ? buildReport(gatherReportInput()) : null), [open, turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // lock the page behind: no scroll, no focus, no pointer
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement, body = document.body;
    const prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
    const app = document.querySelector<HTMLElement>('main.app');
    app?.setAttribute('inert', '');
    const before = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') useShell.getState().setReport(false); };
    window.addEventListener('keydown', k);
    return () => {
      html.style.overflow = prev[0]; body.style.overflow = prev[1];
      app?.removeAttribute('inert');
      window.removeEventListener('keydown', k);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // contents highlight follows the scroll position of the paper (not the page)
  useEffect(() => {
    const el = scroller.current; if (!el || !report) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 80;
      let cur = report.sections[0].id;
      for (const s of report.sections) { const h = el.querySelector(`#rep-${s.id}`); if (h && h.getBoundingClientRect().top <= top) cur = s.id; }
      setActive(cur);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [report]);

  if (!open || !report || typeof document === 'undefined') return null;
  const go = (id: string) => {
    setActive(id);
    const el = scroller.current, h = el?.querySelector<HTMLElement>(`#rep-${id}`);
    if (el && h) el.scrollTo({ top: h.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 24, behavior: 'smooth' });
  };
  const v = report.verdict;

  return createPortal(
    <div className={r.root} data-report-root role="dialog" aria-modal="true" aria-label="Mission planning report" data-modal>
      <div className={r.bar} data-report-chrome>
        <h3>Mission planning report<span>generated from this session and the MarsAgent thread</span></h3>
        <div className={r.exports}>
          <button type="button" className={r.btn} data-pri onClick={() => exportReport('pdf')}><FileDown size={14} strokeWidth={1.5} aria-hidden />PDF</button>
          <button type="button" className={r.btn} onClick={() => exportReport('md')}><FileCode size={14} strokeWidth={1.5} aria-hidden />Markdown</button>
          <button type="button" className={r.btn} onClick={() => exportReport('json')}><Braces size={14} strokeWidth={1.5} aria-hidden />JSON</button>
          <button type="button" className={r.btn} onClick={() => exportReport('geojson')}><MapIcon size={14} strokeWidth={1.5} aria-hidden />GeoJSON route</button>
          <button type="button" className={r.btn} onClick={() => window.print()}><Printer size={14} strokeWidth={1.5} aria-hidden />Print</button>
        </div>
        {/* under 600 px the five exports fold into one menu so Close always stays on screen */}
        <details className={r.exportMenu}>
          <summary className={r.btn}><Download size={14} strokeWidth={1.5} aria-hidden />Export<ChevronDown size={13} strokeWidth={1.5} aria-hidden /></summary>
          <div className={r.menu} role="group" aria-label="Export the report">
            <button type="button" onClick={() => exportReport('pdf')}>PDF</button>
            <button type="button" onClick={() => exportReport('md')}>Markdown</button>
            <button type="button" onClick={() => exportReport('json')}>JSON</button>
            <button type="button" onClick={() => exportReport('geojson')}>GeoJSON route</button>
            <button type="button" onClick={() => window.print()}>Print</button>
          </div>
        </details>
        <button ref={closeBtn} type="button" className={`${r.btn} ${r.close}`} onClick={() => useShell.getState().setReport(false)}><X size={14} strokeWidth={1.5} aria-hidden />Close</button>
      </div>
      <div className={r.body} data-report-body>
        <nav className={r.toc} aria-label="Contents" data-report-chrome>
          <b>Contents</b>
          {report.sections.map((s) => <button key={s.id} type="button" aria-current={active === s.id ? 'true' : undefined} onClick={() => go(s.id)}><span>{s.n}</span>{s.title}</button>)}
        </nav>
        <div ref={scroller} className={r.scroll} data-report-scroll tabIndex={0} aria-label="Report document">
          <article className={r.paper} data-report-paper>
            <div className={r.meta}><span>HeyMars mission planning report</span><span>Report {report.id}</span><span>Generated {report.generatedIso.slice(0, 16).replace('T', ' ')} UTC</span></div>
            <h1>{report.title}</h1>
            <p className={r.sub}>{report.subtitle}</p>
            {report.mocks.length > 0 && <div className={r.mockNote}>{report.mocks.map((m, i) => <p key={i}><span className={r.mock}>Mock</span> {m}</p>)}</div>}
            {v && (
              <div className={r.verdictbox} data-tone={v.tone}><b>{v.word}</b><div>{v.reason}</div></div>
            )}
            {report.sections.map((s) => <SectionView key={s.id} s={s} />)}
            <p className={r.byline}>{report.byline}</p>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}
