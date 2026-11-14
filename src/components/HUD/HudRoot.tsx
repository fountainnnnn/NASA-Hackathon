'use client';
import { Layers, MessageCircle, Route as RouteIcon, SlidersHorizontal } from 'lucide-react';
import { useWorld } from '@/state/world';
import type { SheetTab } from '@/state/world';
import { AskBubble } from './AskBubble';
import { LayerDock } from './LayerDock';
import { MissionPanel } from './MissionPanel';
import { CreditStrip, LoadingScreen, HoverReadout, PlaceholderBanner, Toasts } from './Overlays';
import { DrawerContent, RouteDrawer } from './RouteDrawer';
import { SourcesPanel } from './SourcesPanel';
import { TopBar } from './TopBar';
import { useMedia } from './ui';
import s from './hud.module.css';

function PhoneSheet() {
  const tab = useWorld((st) => st.sheetTab);
  const routes = useWorld((st) => st.routes);
  const visible = useWorld((st) => st.visibleRouteIds);
  const profileId = useWorld((st) => st.profileRouteId);
  const comparison = useWorld((st) => st.comparison);
  const id = profileId ?? visible[visible.length - 1];
  const route = id ? routes[id] : undefined;
  const cmp = comparison && routes[comparison[0]] && routes[comparison[1]] ? [routes[comparison[0]], routes[comparison[1]]] : null;
  const tabs: { id: SheetTab; label: string; Icon: typeof Layers }[] = [
    { id: 'layers', label: 'Layers', Icon: Layers }, { id: 'mission', label: 'Mission', Icon: SlidersHorizontal },
    { id: 'route', label: 'Route', Icon: RouteIcon }, { id: 'ask', label: 'Ask', Icon: MessageCircle },
  ];
  return (
    <div className={`${s.panel} ${s.sheet}`}>
      <div className={s.tabs} role="tablist" aria-label="Panels">
        {tabs.map(({ id: t, label, Icon }) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => useWorld.getState().patch({ sheetTab: t })}>
            <Icon size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div className={s.sheetBody} role="tabpanel">
        {tab === 'layers' && <LayerDock />}
        {tab === 'mission' && <MissionPanel />}
        {tab === 'route' && (route ? <DrawerContent route={route} cmp={cmp} /> : <p className={s.note} style={{ padding: 16 }}>No route yet. Select a point on the terrain, then plan a round trip in Mission.</p>)}
        {tab === 'ask' && <AskBubble embedded />}
      </div>
    </div>
  );
}

export function HudRoot() {
  const phone = useMedia('(max-width: 700px)');
  return (
    <>
      <LoadingScreen />
      <div className={s.hud}>
        <TopBar />
        <PlaceholderBanner />
        {phone ? (
          <PhoneSheet />
        ) : (
          <>
            <div className={s.left}><LayerDock /><MissionPanel /></div>
            <RouteDrawer />
            <AskBubble />
            <HoverReadout />
          </>
        )}
        <CreditStrip />
        <Toasts />
      </div>
      <SourcesPanel />
    </>
  );
}
