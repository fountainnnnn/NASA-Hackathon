/**
 * Pure SceneCommand reducer. No store, no DOM. Validates every command and rejects unknown
 * types / ids / out-of-bounds coordinates; valid commands are applied in order.
 */
import type { Annotation, LayerId, RouteResult, SceneCommand } from '../contracts';

export const LAYER_IDS: LayerId[] = ['ctx', 'themisDay', 'themisNight', 'geology', 'slope', 'traverse', 'ellipse'];
const PIN_KINDS = ['science', 'hazard', 'info', 'base'] as const;

export interface DemBounds { lonMin: number; lonMax: number; latMin: number; latMax: number }

export interface CameraRequest { lon: number; lat: number; distanceM?: number; nonce: number }

/** The slice of world state that commands may change. */
export interface SceneSlice {
  annotations: Annotation[];
  annSeq: number;
  layers: Record<LayerId, boolean>;
  routes: Record<string, RouteResult>;
  visibleRouteIds: string[];
  routeStyles: Record<string, 'primary' | 'alternate'>;
  profileRouteId: string | null;
  comparison: [string, string] | null;
  cameraRequest: CameraRequest | null;
  cameraTarget: { lon: number; lat: number } | null;
}

export interface CommandResult { state: SceneSlice; applied: number; errors: string[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inBounds = (b: DemBounds, lon: number, lat: number) =>
  lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;
const cleanLabel = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 120) : null;

function showRoute(s: SceneSlice, id: string, style?: 'primary' | 'alternate') {
  if (!s.visibleRouteIds.includes(id)) s.visibleRouteIds = [...s.visibleRouteIds, id];
  s.routeStyles = { ...s.routeStyles, [id]: style ?? s.routeStyles[id] ?? 'primary' };
}

export function reduceCommands(prev: SceneSlice, cmds: SceneCommand[], bounds: DemBounds): CommandResult {
  const s: SceneSlice = { ...prev };
  const errors: string[] = [];
  let applied = 0;

  cmds.forEach((raw, i) => {
    const c = raw as unknown as Record<string, unknown>;
    const fail = (msg: string) => { errors.push(`Command ${i} (${String(c?.type)}): ${msg}`); };
    if (!c || typeof c !== 'object') return fail('not an object');

    switch (c.type) {
      case 'add_pin': {
        if (!isNum(c.lon) || !isNum(c.lat)) return fail('lon/lat must be finite numbers');
        if (!inBounds(bounds, c.lon, c.lat)) return fail('coordinate is outside the loaded terrain');
        const label = cleanLabel(c.label);
        if (!label) return fail('label is required');
        if (!(PIN_KINDS as readonly unknown[]).includes(c.kind)) return fail(`unknown pin kind "${String(c.kind)}"`);
        if (c.id !== undefined && (typeof c.id !== 'string' || c.id.length === 0 || c.id.length > 64)) return fail('invalid id');
        const seq = s.annSeq + 1;
        const id = typeof c.id === 'string' ? c.id : `A${seq}`;
        const pin: Annotation = {
          id, kind: 'pin', lon: c.lon, lat: c.lat, label, pinKind: c.kind as Annotation['pinKind'], createdBy: 'agent',
        };
        s.annotations = [...s.annotations.filter((a) => a.id !== id), pin];
        s.annSeq = seq;
        break;
      }
      case 'draw_route': {
        if (typeof c.routeId !== 'string' || !s.routes[c.routeId]) return fail(`unknown routeId "${String(c.routeId)}"`);
        if (c.style !== undefined && c.style !== 'primary' && c.style !== 'alternate') return fail('style must be primary or alternate');
        showRoute(s, c.routeId, c.style as 'primary' | 'alternate' | undefined);
        break;
      }
      case 'highlight_segment': {
        const route = typeof c.routeId === 'string' ? s.routes[c.routeId] : undefined;
        if (!route) return fail(`unknown routeId "${String(c.routeId)}"`);
        if (!Number.isInteger(c.leg) || (c.leg as number) < 0 || (c.leg as number) >= route.legs.length) return fail('leg out of range');
        const path = route.legs[c.leg as number].path;
        const a = c.startIdx, b = c.endIdx;
        if (!Number.isInteger(a) || !Number.isInteger(b) || (a as number) < 0 || (b as number) >= path.length || (a as number) >= (b as number)) {
          return fail('startIdx/endIdx out of range or not increasing');
        }
        const label = cleanLabel(c.label);
        if (!label) return fail('label is required');
        const mid = path[((a as number) + (b as number)) >> 1];
        const seq = s.annSeq + 1;
        const ann: Annotation = {
          id: `A${seq}`, kind: 'highlight', lon: mid.lon, lat: mid.lat, label, createdBy: 'agent',
          highlight: { routeId: route.id, leg: c.leg as number, startIdx: a as number, endIdx: b as number },
        };
        s.annotations = [...s.annotations, ann];
        s.annSeq = seq;
        showRoute(s, route.id);
        break;
      }
      case 'show_elevation_profile': {
        if (typeof c.routeId !== 'string' || !s.routes[c.routeId]) return fail(`unknown routeId "${String(c.routeId)}"`);
        s.profileRouteId = c.routeId;
        showRoute(s, c.routeId);
        break;
      }
      case 'focus_camera': {
        if (!isNum(c.lon) || !isNum(c.lat)) return fail('lon/lat must be finite numbers');
        if (!inBounds(bounds, c.lon, c.lat)) return fail('coordinate is outside the loaded terrain');
        if (c.distanceM !== undefined && (!isNum(c.distanceM) || c.distanceM <= 0)) return fail('distanceM must be positive');
        s.cameraRequest = { lon: c.lon, lat: c.lat, distanceM: c.distanceM as number | undefined, nonce: (s.cameraRequest?.nonce ?? 0) + 1 };
        s.cameraTarget = { lon: c.lon, lat: c.lat };
        break;
      }
      case 'set_layer_visibility': {
        if (!LAYER_IDS.includes(c.layer as LayerId)) return fail(`unknown layer "${String(c.layer)}"`);
        if (typeof c.visible !== 'boolean') return fail('visible must be boolean');
        s.layers = { ...s.layers, [c.layer as LayerId]: c.visible };
        break;
      }
      case 'remove_annotation': {
        if (typeof c.id !== 'string' || !s.annotations.some((a) => a.id === c.id)) return fail(`unknown annotation id "${String(c.id)}"`);
        s.annotations = s.annotations.filter((a) => a.id !== c.id);
        break;
      }
      case 'show_comparison': {
        const ids = c.routeIds;
        if (!Array.isArray(ids) || ids.length !== 2 || typeof ids[0] !== 'string' || typeof ids[1] !== 'string') return fail('routeIds must be two ids');
        if (ids[0] === ids[1]) return fail('routeIds must be different');
        const missing = ids.find((id: string) => !s.routes[id]);
        if (missing) return fail(`unknown routeId "${missing}"`);
        s.comparison = [ids[0], ids[1]];
        showRoute(s, ids[0], 'primary');
        showRoute(s, ids[1], 'alternate');
        break;
      }
      case 'clear_annotations': {
        // Clears pins + highlights AND takes drawn routes / profile / comparison off the map.
        // Routes stay in memory (RouteResult map) so they can be drawn again.
        s.annotations = [];
        s.visibleRouteIds = [];
        s.profileRouteId = null;
        s.comparison = null;
        break;
      }
      default:
        return fail('unknown command type');
    }
    applied++;
  });

  return { state: s, applied, errors };
}
