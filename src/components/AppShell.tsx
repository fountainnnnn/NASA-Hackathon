'use client';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { HudRoot } from './HUD/HudRoot';
import { startLoading } from '@/state/services';

// three.js / R3F never run on the server
const SceneCanvas = dynamic(() => import('./Scene/SceneCanvas'), { ssr: false });

export default function AppShell() {
  useEffect(() => { void startLoading(); }, []);
  return (
    <main style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <SceneCanvas />
      <HudRoot />
    </main>
  );
}
