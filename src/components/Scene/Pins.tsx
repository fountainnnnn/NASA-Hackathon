'use client';
import { Html } from '@react-three/drei';
import { useEffect, useRef, type ComponentType, type RefObject } from 'react';
import type * as THREE from 'three';
import { blockedByHud } from '@/components/HUD/blocks';
import { useWorld } from '@/state/world';
import { groundAt, useScene } from './sceneCtx';
import styles from './scene.module.css';

type Kind = 'base' | 'selected' | 'science' | 'hazard' | 'info';
const STROKE: Record<Kind, string> = { base: '#ece7e1', selected: '#ece7e1', science: '#58c98a', hazard: '#d9423b', info: '#a39c95' };

/** Plain operations-map symbology, thin lines, no fill: base = square with a centre dot, science stop = diamond, hazard = triangle, selected = ring. */
function Symbol({ kind }: { kind: Kind }) {
  const c = STROKE[kind];
  const keyline = { stroke: '#060505', strokeOpacity: 0.7, strokeWidth: 3.2, fill: 'none' } as const;
  const line = { stroke: c, strokeWidth: 1.5, fill: 'none' } as const;
  const shape = (p: object) => kind === 'base' ? <rect x="3" y="3" width="10" height="10" {...p} />
    : kind === 'science' ? <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" {...p} />
    : kind === 'hazard' ? <path d="M8 2 14.5 13.5H1.5Z" {...p} />
    : <circle cx="8" cy="8" r="6" {...p} />;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {shape(keyline)}{shape(line)}
      {kind === 'base' && <circle cx="8" cy="8" r="1.2" fill={c} />}
    </svg>
  );
}

/** Label sides around the ring, in order of preference (scene.module.css places each one). */
const FLIPS = ['right', 'left', 'up', 'down', 'upleft', 'downleft'] as const;
/** Route time ticks hide themselves under a pin label, so a pin label never moves for them. */
const PIN_IGNORES = '[class*="tick"]';

/**
 * Place a pin's label on the first side of its ring that stays on the map and clear of HUD blocks and other map labels
 * (the Base tag, other pins, the legend, the card); hide it only when every side is blocked. Ten times a second.
 */
function useEdgeFlip(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const id = window.setInterval(() => {
      const pin = ref.current; if (!pin) return;
      const label = pin.querySelector<HTMLElement>('[data-flip-label]'); if (!label) return;
      const st = pin.closest('[data-stage]')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      label.style.visibility = 'visible';
      const fits = (r: DOMRect) => r.left >= st.left + 4 && r.right <= st.right - 4 && r.top >= st.top + 4 && r.bottom <= st.bottom - 4;
      const keep = pin.dataset.flip;
      let chosen: string | null = null, onMap: string | null = null;
      // the current side first, so a label that is clear stays put instead of hopping
      for (const f of [...(keep ? [keep] : []), ...FLIPS.filter((x) => x !== keep)]) {
        pin.dataset.flip = f;
        const r = label.getBoundingClientRect();
        if (!fits(r)) continue;
        onMap ??= f;
        if (!blockedByHud(r, pin, PIN_IGNORES)) { chosen = f; break; }
      }
      pin.dataset.flip = chosen ?? onMap ?? 'right';
      // every side blocked by a HUD block or another label: step out of the way (the ring stays)
      if (!chosen) label.style.visibility = 'hidden';
      const dot = pin.querySelector<HTMLElement>('[class*="pinDot"]');
      pin.style.visibility = dot && blockedByHud(dot.getBoundingClientRect(), pin, PIN_IGNORES) ? 'hidden' : 'visible';
    }, 100);
    return () => window.clearInterval(id);
  }, [ref]);
}

export function Marker({ pos, kind, label, tone, occlude = true }: { pos: [number, number, number]; kind: Kind; label?: string; tone?: 'num'; occlude?: boolean }) {
  const { meshRef } = useScene();
  const pinRef = useRef<HTMLDivElement>(null);
  useEdgeFlip(pinRef);
  return (
    <Html position={pos} center occlude={occlude ? [meshRef as RefObject<THREE.Object3D>] : undefined} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={pinRef} className={`${styles.pin} ${styles[kind]}`} data-tone={tone}>
        <span className={styles.pinDot} data-avoid><Symbol kind={kind} /></span>
        {label && <span className={styles.pinLabel} data-avoid data-flip-label>{label}</span>}
      </div>
    </Html>
  );
}

export function Pins() {
  const v = useScene();
  const exag = useWorld((s) => s.exaggeration);
  const selected = useWorld((s) => s.selected);
  const annotations = useWorld((s) => s.annotations);
  const at = (lon: number, lat: number): [number, number, number] => {
    const { x, z } = v.rt.geo.toLocal(v.rt.meta, lon, lat);
    return [x, groundAt(v, x, z, exag) + 8 * exag, z];
  };
  return (
    <>
      {selected && <Marker pos={at(selected.lon, selected.lat)} kind="selected" label="Selected" />}
      {annotations.filter((a) => a.kind === 'pin').map((a) => (
        <Marker key={a.id} pos={at(a.lon, a.lat)} kind={a.pinKind === 'base' ? 'info' : a.pinKind ?? 'info'} label={a.label} />
      ))}
    </>
  );
}
