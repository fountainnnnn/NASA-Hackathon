/** Gathers the live session into the pure report builder's input. */
import validation from '../../data/validation.json';
import { earthRangeAu, lightTimeMin } from '@/lib/ops/earthLink';
import type { ReportInput } from '@/lib/report/build';
import { useGlobal } from '@/state/services';
import { useHud } from '@/state/hud';
import { useSession } from '@/state/session';
import { useThread } from '@/state/thread';
import { useWorld } from '@/state/world';
import { getOps } from './opsCache';

export function gatherReportInput(now = Date.now()): ReportInput {
  const h = useHud.getState(), w = useWorld.getState(), s = useSession.getState();
  const route = h.activeRouteId ? w.routes[h.activeRouteId] ?? null : null;
  const ops = getOps(route?.id ?? null);
  const earthData = useGlobal.getState().earth;
  let earth: ReportInput['earth'] = null;
  if (earthData) {
    try { earth = { rangeAu: earthRangeAu(now, earthData), minutes: lightTimeMin(now, earthData) }; } catch { earth = null; }
  }
  const v = validation as { count: number; medianResidualM: number; meanResidualM: number; p95AbsResidualM: number };
  return {
    generatedAt: now, route, ops, constraints: route?.constraintsUsed ?? w.constraints,
    base: w.base ? { lon: w.base.lon, lat: w.base.lat, elevationM: w.base.elevationM, label: 'Octavia E. Butler landing site' } : null,
    targetName: s.targetName, earth, landing: s.landing, scenario: s.scenario, science: s.science,
    validation: { count: v.count, medianResidualM: v.medianResidualM, meanResidualM: v.meanResidualM, p95AbsResidualM: v.p95AbsResidualM },
    turns: useThread.getState().turns.map((t) => ({
      seq: t.seq, question: t.ask.text, origin: t.ask.origin, engine: t.engine, startedAt: t.startedAt, endedAt: t.endedAt,
      steps: t.steps.map((st) => ({ kind: st.kind, title: st.title, meta: st.meta, durMs: st.durMs, text: st.text, code: st.code, raw: st.raw })),
      narration: t.narration.map((n) => ({ text: n.text, tMs: n.tMs })),
    })),
  };
}
