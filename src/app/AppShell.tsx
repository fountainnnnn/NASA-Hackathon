'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef } from 'react';
import { Panel, Scout } from '@/components/Companion';
import { useRevealTicker, useReveal } from '@/components/Companion/reveal';
import { Intro, Rail, SourcesSheet, StatusLine, Timeline, TopBar, useIntro, useSimLoaded } from '@/components/HUD';
import { useMapLabelDeconflict } from '@/components/Ops/labelDeconflict';
import { BaseMark, CuffSheet, DragLabel, HelmetLayer, LassoOverlay, Legend } from '@/components/Ops/Overlays';
import { projectGlobe, projectJezero } from '@/components/Ops/projector';
import { projectPlanet } from '@/components/Planet/projection';
import { ReportViewer } from '@/components/Report/ReportViewer';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { useCompanion, emitAsk } from '@/state/companion';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { usePlayback, usePlaybackClock } from '@/state/playback';
import { callTool, startGlobalLoading, startLoading, useGlobal, useRuntime } from '@/state/services';
import { useSession } from '@/state/session';
import { useShell } from '@/state/shell';
import { useThread } from '@/state/thread';
import { useWorld } from '@/state/world';
import { clearPreview, commitPlan, lassoAnalyze, requestPreview, startFlow } from './flow';
import { gatherReportInput } from './reportInput';
import { sampleGlobe, sampleJezero } from './sampling';

// Cesium / three.js / R3F never run on the server. PlanetView (Cesium, real Mars Trek terrain) falls back to the three.js globe itself.
const PlanetView = dynamic(() => import('@/components/Planet/PlanetView'), { ssr: false });
const SceneCanvas = dynamic(() => import('@/components/Scene/SceneCanvas'), { ssr: false });
const GlobeLayer = dynamic(() => import('@/components/Ops/GlobeLayer'), { ssr: false });
const JezeroLayer = dynamic(() => import('@/components/Ops/JezeroLayer'), { ssr: false });

/**
 * HeyMars shell: top bar (40 px), tool rail (56 px), the map stage, the MarsAgent panel (336 px, collapsible) and the
 * timeline (46 px, only while a simulation is loaded). The map is everything else.
 */
export default function AppShell() {
  const mode = useGlobeStore((g) => g.mode);
  const dragging = useHud((h) => h.dragging);
  const rt = useRuntime((r) => r.rt);
  const helmet = useWalkUi((w) => w.helmet);
  const panelOpen = useShell((x) => x.panelOpen);
  const tool = useShell((x) => x.tool);
  const simOn = useSimLoaded();
  const cardOpen = useCompanion((c) => c.bubbleOpen);
  const stage = useRef<HTMLDivElement>(null);
  usePlaybackClock();
  useRevealTicker();
  useMapLabelDeconflict();

  useEffect(() => {
    useShell.getState().hydrate();
    // test hook for the e2e and QA scripts: ?qa=1 exposes the stores and the projectors
    if (new URLSearchParams(window.location.search).has('qa')) {
      (window as unknown as { __mw: unknown }).__mw = {
        projectJezero, projectGlobe, projectPlanet, hud: useHud, globe: useGlobeStore, world: useWorld, callTool, ask: emitAsk, playback: usePlayback,
        walkUi: useWalkUi, companion: useCompanion, intro: useIntro, thread: useThread, shell: useShell, session: useSession, reveal: useReveal, reportInput: gatherReportInput, global: useGlobal, runtime: useRuntime,
        /** true once the planet canvas is on the stage and the global science data has loaded */
        /** commit a round trip from the base to a lon/lat, as a drag would (QA and e2e use it for a known target) */
        plan: (to: { lon: number; lat: number }) => { const b = useWorld.getState().base; if (b) void commitPlan({ lon: b.lon, lat: b.lat }, to, { text: `Plan a round trip from base to ${to.lat.toFixed(2)}N ${to.lon.toFixed(2)}E`, origin: 'drag', at: to }); },
        ready: () => document.querySelector<HTMLElement>('[data-stage]')?.dataset.ready === 'true' && !!useGlobal.getState().gs,
      };
    }
    void startGlobalLoading();
    void startLoading();
    return startFlow();
  }, []);

  // readiness flag for QA and e2e: the planet (Cesium or the fallback globe) has a canvas on the stage
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const mark = () => { if (el.querySelector('canvas')) el.dataset.ready = 'true'; };
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  const planner = useMemo(() => ({
    onPlan: (from: { lon: number; lat: number }, to: { lon: number; lat: number }) => void commitPlan(from, to),
    onLasso: (poly: { lon: number; lat: number }[], area: number) => void lassoAnalyze(poly, area),
    preview: requestPreview, clearPreview,
  }), []);

  return (
    <main className="field app" data-mode={mode} data-drag={dragging} data-tool={tool ?? 'none'} data-panel={panelOpen} data-sim={simOn} data-card={cardOpen}
      style={{ '--log-w': '0px', '--inset': '0px' } as React.CSSProperties}>
      <TopBar />
      <Rail />
      <div ref={stage} className="stage" data-stage data-ready="false" aria-label="Map">
        <div style={{ position: 'absolute', inset: 0, visibility: mode === 'globe' ? 'visible' : 'hidden' }}>
          <PlanetView controls={false}><GlobeLayer /></PlanetView>
        </div>
        {mode === 'jezero' && rt && (
          <div style={{ position: 'absolute', inset: 0, animation: 'sceneIn 420ms var(--ease)' }}>
            <SceneCanvas><JezeroLayer {...planner} /></SceneCanvas>
          </div>
        )}
        {mode === 'jezero' && rt && !helmet && <BaseMark />}
        <HelmetLayer />
        {!helmet && <Legend />}
        <CuffSheet />
      </div>
      {simOn ? <Timeline /> : <StatusLine />}
      <Panel />
      <DragLabel />
      <LassoOverlay />
      {!helmet && <Scout projectToScreen={mode === 'globe' ? projectPlanet : projectJezero} sampleAt={mode === 'globe' ? sampleGlobe : sampleJezero} />}
      <SourcesSheet />
      <ReportViewer />
      <Intro />
      <style>{'@keyframes sceneIn { from { opacity: 0 } to { opacity: 1 } }'}</style>
    </main>
  );
}
