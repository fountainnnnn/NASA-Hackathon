/** Ops checks (comms, daylight, go/no-go) per committed route, shared by the flow, the overlays and the report. */
import type { RouteOps } from '@/components/Ops/routeOps';

const opsByRoute = new Map<string, RouteOps>();
export const getOps = (id: string | null) => (id ? opsByRoute.get(id) ?? null : null);
export const setOps = (id: string, ops: RouteOps) => { opsByRoute.set(id, ops); };
