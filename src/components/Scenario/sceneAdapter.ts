'use client';
/**
 * The ONLY file in Scenario/ that imports from the Jezero Scene. Mount the Scenario components inside the Scene
 * canvas with `const ground = useSceneGround()`; everything else takes a plain GroundApi so it also runs on any
 * other height field (the preview page uses a synthetic one).
 */
import { useMemo } from 'react';
import { useWorld } from '@/state/world';
import { groundAt, useScene } from '@/components/Scene/sceneCtx';
import type { GroundApi } from './model';

export function useSceneGround(): GroundApi {
  const v = useScene();
  const exag = useWorld((s) => s.exaggeration);
  return useMemo<GroundApi>(() => ({
    exag,
    toLocal: (lon, lat) => v.rt.geo.toLocal(v.rt.meta, lon, lat),
    y: (x, z, hAbs) => {
      const mesh = groundAt(v, x, z, exag);
      return hAbs == null ? mesh : Math.max((hAbs - v.rt.meta.hRef) * exag, mesh);
    },
  }), [v, exag]);
}
