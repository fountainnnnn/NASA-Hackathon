'use client';
import { Html } from '@react-three/drei';
import { Crosshair, FlaskConical, House, Info, TriangleAlert } from 'lucide-react';
import type { ComponentType, RefObject } from 'react';
import type * as THREE from 'three';
import { useWorld } from '@/state/world';
import { groundAt, useScene } from './sceneCtx';
import styles from './scene.module.css';

type Kind = 'base' | 'selected' | 'science' | 'hazard' | 'info';
const ICONS: Record<Kind, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  base: House, selected: Crosshair, science: FlaskConical, hazard: TriangleAlert, info: Info,
};

export function Marker({ pos, kind, label, tone }: { pos: [number, number, number]; kind: Kind; label?: string; tone?: 'num'; }) {
  const { meshRef } = useScene();
  const Icon = ICONS[kind];
  return (
    <Html position={pos} center occlude={[meshRef as RefObject<THREE.Object3D>]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`${styles.pin} ${styles[kind]}`} data-tone={tone}>
        <span className={styles.pinDot}><Icon size={13} aria-hidden /></span>
        {label && <span className={styles.pinLabel}>{label}</span>}
      </div>
    </Html>
  );
}

export function Pins() {
  const v = useScene();
  const exag = useWorld((s) => s.exaggeration);
  const base = useWorld((s) => s.base);
  const selected = useWorld((s) => s.selected);
  const annotations = useWorld((s) => s.annotations);
  const at = (lon: number, lat: number): [number, number, number] => {
    const { x, z } = v.rt.geo.toLocal(v.rt.meta, lon, lat);
    return [x, groundAt(v, x, z, exag) + 8 * exag, z];
  };
  return (
    <>
      {base && <Marker pos={at(base.lon, base.lat)} kind="base" label="Base" />}
      {selected && <Marker pos={at(selected.lon, selected.lat)} kind="selected" label="Selected" />}
      {annotations.filter((a) => a.kind === 'pin').map((a) => (
        <Marker key={a.id} pos={at(a.lon, a.lat)} kind={a.pinKind === 'base' ? 'info' : a.pinKind ?? 'info'} label={a.label} />
      ))}
    </>
  );
}
