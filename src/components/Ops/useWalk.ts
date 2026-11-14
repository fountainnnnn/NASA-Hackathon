'use client';
/** The scenario Timeline for the route Scout is talking about, built the same way inside and outside the canvas. */
import { useMemo } from 'react';
import { buildTimeline } from '@/components/Scenario/model';
import type { Timeline } from '@/components/Scenario/model';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { useHud } from '@/state/hud';
import { useRuntime } from '@/state/services';
import { useWorld } from '@/state/world';

export function useWalkTimeline(): Timeline | null {
  const id = useHud((s) => s.activeRouteId);
  const route = useWorld((s) => (id ? s.routes[id] : undefined));
  const rt = useRuntime((s) => s.rt);
  const rover = useWalkUi((s) => s.roverFraction);
  return useMemo(() => {
    if (!route || !rt || !route.legs.some((l) => l.path.length > 1)) return null;
    return buildTimeline(route, { toLocal: (lon, lat) => rt.geo.toLocal(rt.meta, lon, lat) }, { roverFraction: rover });
  }, [route, rt, rover]);
}
