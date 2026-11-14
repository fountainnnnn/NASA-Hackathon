'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { Scout } from '@/components/Companion';
import { Credit, Hint, Intro, SourcesSheet, Toasts, TopLeft, TopRight } from '@/components/HUD';
import { CuffSheet, DragLabel, LassoOverlay, ReachProgress, ScenarioBar, VerdictWord } from '@/components/Ops/Overlays';
import { projectGlobe, projectJezero } from '@/components/Ops/projector';
import hud from '@/components/HUD/hud.module.css';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { useWorld } from '@/state/world';
import { usePlaybackClock } from '@/state/playback';
import { callTool, startGlobalLoading, startLoading, useRuntime } from '@/state/services';
import { clearPreview, commitPlan, lassoAnalyze, requestPreview, startFlow } from './flow';
import { sampleGlobe, sampleJezero } from './sampling';

// three.js / R3F never run on the server
const GlobeCanvas = dynamic(() => import('@/components/Globe/GlobeCanvas'), { ssr: false });
const SceneCanvas = dynamic(() => import('@/components/Scene/SceneCanvas'), { ssr: false });
const GlobeLayer = dynamic(() => import('@/components/Ops/GlobeLayer'), { ssr: false });
const JezeroLayer = dynamic(() => import('@/components/Ops/JezeroLayer'), { ssr: false });

export default function AppShell() {
  const mode = useGlobeStore((g) => g.mode);
  const dragging = useHud((h) => h.dragging);
  const rt = useRuntime((r) => r.rt);
  const helmet = useWalkUi((w) => w.helmet);
  usePlaybackClock();

  useEffect(() => {
    // test hook for the e2e and QA scripts: ?qa=1 exposes the stores and Scout's projectors
    if (new URLSearchParams(window.location.search).has('qa')) (window as unknown as { __mw: unknown }).__mw = { projectJezero, projectGlobe, hud: useHud, globe: useGlobeStore, world: useWorld, callTool };
    void startGlobalLoading();
    void startLoading();
    return startFlow();
  }, []);

  const planner = useMemo(() => ({
    onPlan: (from: { lon: number; lat: number }, to: { lon: number; lat: number }) => void commitPlan(from, to),
    onLasso: (poly: { lon: number; lat: number }[], area: number) => void lassoAnalyze(poly, area),
    preview: requestPreview, clearPreview,
  }), []);

  return (
    <main className="field" data-mode={mode} data-drag={dragging} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--bg-0)' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <GlobeCanvas controls={false}><GlobeLayer /></GlobeCanvas>
      </div>
      {mode === 'jezero' && rt && (
        <div style={{ position: 'absolute', inset: 0, animation: 'sceneIn 420ms var(--ease)' }}>
          <SceneCanvas><JezeroLayer {...planner} /></SceneCanvas>
        </div>
      )}
      <div className={hud.layer}>
        <TopLeft />
        <TopRight />
        {!helmet && <VerdictWord />}
        <ScenarioBar />
        <CuffSheet />
        <ReachProgress />
        <Hint />
        {!helmet && <Credit />}
        <Toasts />
        <SourcesSheet />
      </div>
      <DragLabel />
      <LassoOverlay />
      {!helmet && <Scout projectToScreen={mode === 'globe' ? projectGlobe : projectJezero} sampleAt={mode === 'globe' ? sampleGlobe : sampleJezero} />}
      <Intro />
      <style>{'@keyframes sceneIn { from { opacity: 0 } to { opacity: 1 } }'}</style>
    </main>
  );
}
