import type { RouteResult } from '@/lib/contracts';
import { buildCuffCard, fmtT } from '@/lib/ops/cuffCard';
import type { CommsResult } from '@/lib/opsContracts';
import type { CuffView } from '@/state/hud';

export function makeCuff(route: RouteResult, comms: CommsResult | null, startUtcMs: number): CuffView {
  const card = buildCuffCard({ route, comms, startUtc: startUtcMs });
  const tb = card.turnBack ? `Turn back at ${fmtT(card.turnBack.tMin)}, limited by ${card.turnBack.limitedBy === 'eva-time' ? 'EVA time' : card.turnBack.limitedBy}.` : null;
  return { routeId: route.id, svg: card.svg, text: card.text, filenameBase: `marswalk-cuff-${route.id}`, turnBack: tb };
}

function save(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Download the wrist card as SVG and as plain text. */
export function downloadCuff(v: CuffView) {
  save(`${v.filenameBase}.svg`, v.svg, 'image/svg+xml');
  setTimeout(() => save(`${v.filenameBase}.txt`, v.text, 'text/plain'), 250);
}

/** Open the SVG in a new tab (blob URL) for printing. */
export function openCuff(v: CuffView) {
  const url = URL.createObjectURL(new Blob([v.svg], { type: 'image/svg+xml' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
