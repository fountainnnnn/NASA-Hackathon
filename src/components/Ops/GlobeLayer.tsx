'use client';
/** In-canvas additions for the globe: Scout's projector and the landing playback. */
import { useMemo } from 'react';
import { reliefRadius } from '@/components/Globe/dem';
import { LandingPlayback } from '@/components/Scenario/LandingPlayback';
import { getScenario } from '@/lib/scenario';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { useGlobal } from '@/state/services';
import { GlobeProjector } from './projector';

export default function GlobeLayer() {
  const landing = useHud((h) => h.landing);
  const gs = useGlobal((g) => g.gs);
  const exag = useGlobeStore((g) => g.exaggeration);
  const phases = useMemo(() => gs?.edlPhases() ?? [], [gs]);
  const rec = landing ? getScenario(landing.scenarioId) : undefined;
  const radius = useMemo(() => (lon: number, lat: number) => reliefRadius(lon, lat, exag), [exag]);
  return (
    <>
      <GlobeProjector />
      {landing && rec && phases.length > 0 && (
        <LandingPlayback phases={phases} result={rec.result} site={landing.site} maxSlopeDeg={landing.maxSlopeDeg} ellipse={landing.ellipse} surfaceRadius={radius} />
      )}
    </>
  );
}
