'use client';
/**
 * The ONLY file in Scenario/ that imports from the Jezero Scene. Mount the Scenario components inside the Scene
 * canvas with `const ground = useSceneGround()`; everything else takes a plain GroundApi so it also runs on any
 * other height field (the preview page uses a synthetic one).
 */
import { useMemo } from 'react';
import { useWorld } from '@/state/world';
import { renderedGroundAt, useScene } from '@/components/Scene/sceneCtx';
import type { GroundApi } from './model';

export function useSceneGround(): GroundApi {
  const v = useScene();
  const exag = useWorld((s) => s.exaggeration);
  return useMemo<GroundApi>(() => ({
    exag,
    toLocal: (lon, lat) => v.rt.geo.toLocal(v.rt.meta, lon, lat),
    // the rendered surface, so feet, wheels and footings touch what is drawn (the 20 m DEM between mesh vertices can sit
    // a few metres above or below the triangles; hAbs is accepted for other hosts but not used here)
    y: (x, z) => renderedGroundAt(v, x, z, exag),
  }), [v, exag]);
}

export { SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG } from '@/components/Scene/atmosphere';
export { fadeBasicMaterial } from '@/components/Scene/lineFx';
