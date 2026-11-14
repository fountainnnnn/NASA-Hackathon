'use client';
/** Report actions used by the panel's report card and the viewer toolbar: open, print to PDF, and the file exports. */
import { gatherReportInput } from '@/app/reportInput';
import { buildReport } from '@/lib/report/build';
import { download, routeGeoJson, toJson, toMarkdown } from '@/lib/report/export';
import { useShell } from '@/state/shell';

export type ExportKind = 'pdf' | 'md' | 'json' | 'geojson';

export function openReport() { useShell.getState().setReport(true); }

/** PDF is the browser's print of the report alone (print stylesheet in globals.css); the others are generated files. */
export function exportReport(kind: ExportKind) {
  if (kind === 'pdf') {
    const wasOpen = useShell.getState().reportOpen;
    useShell.getState().setReport(true);
    window.setTimeout(() => {
      window.print();
      if (!wasOpen) window.setTimeout(() => useShell.getState().setReport(false), 300);
    }, wasOpen ? 0 : 450);
    return;
  }
  const input = gatherReportInput();
  const r = buildReport(input);
  const base = `heymars-report-${r.id}`;
  if (kind === 'md') download(`${base}.md`, toMarkdown(r), 'text/markdown');
  else if (kind === 'json') download(`${base}.json`, toJson(r, input), 'application/json');
  else download(`heymars-route-${input.route?.id ?? 'none'}.geojson`, routeGeoJson(input.route, input.ops), 'application/geo+json');
}
