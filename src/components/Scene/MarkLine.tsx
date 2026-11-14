'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Line2 } from 'three-stdlib';
import { fadeLineMaterial, metresPerPx } from './lineFx';

type Pt = [number, number, number];
const noRaycast = () => null;

export interface MarkLineProps {
  points: Pt[];
  color: string;
  /** Screen width, px. */
  width?: number;
  opacity?: number;
  /** Dash and gap in screen pixels; omit for a solid line. */
  dashPx?: [number, number] | null;
  renderOrder?: number;
}

/** A thin draped mark: screen-space width, optional screen-constant dashes, fades out near the camera in helmet view. */
export function MarkLine({ points, color, width = 1.5, opacity = 1, dashPx = null, renderOrder = 11 }: MarkLineProps) {
  const ref = useRef<Line2>(null);
  const { camera, size } = useThree();
  const centre = useMemo(() => {
    const c = new THREE.Vector3();
    for (const p of points) c.add(new THREE.Vector3(p[0], p[1], p[2]));
    return c.multiplyScalar(1 / Math.max(1, points.length));
  }, [points]);
  const radius = useMemo(() => points.reduce((m, p) => Math.max(m, Math.hypot(p[0] - centre.x, p[2] - centre.z)), 0), [points, centre]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useLayoutEffect(() => { const l = ref.current; if (l) fadeLineMaterial(l.material as THREE.Material & { userData: Record<string, unknown> }); });
  useFrame(() => {
    const l = ref.current; if (!l || !dashPx) return;
    // representative distance: to the nearest point of the mark's bounding circle (the part the eye reads first)
    const d = Math.max(camera.position.distanceTo(tmp.copy(centre)) - radius * 0.7, 20);
    const mpp = metresPerPx(camera as THREE.PerspectiveCamera, d, size.height);
    (l.material as unknown as { dashScale: number }).dashScale = 1 / mpp;
  });
  return (
    <Line
      ref={ref as never} points={points} color={color} lineWidth={width} transparent opacity={opacity} depthWrite={false}
      renderOrder={renderOrder} raycast={noRaycast}
      {...(dashPx ? { dashed: true, dashSize: dashPx[0], gapSize: dashPx[1] } : {})}
    />
  );
}
