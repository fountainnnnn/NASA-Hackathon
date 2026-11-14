'use client';
import { useEffect } from 'react';
import { Scout } from '@/components/Companion';
import type { LonLat } from '@/lib/contracts';
import { emitClickPoint, onAsk, onClickPoint, useCompanion } from '@/state/companion';
import type { ScoutMood } from '@/lib/globeContracts';

/** Demo harness: a flat stand-in for the globe. Every number below is sample text, not data. */
const project = (p: LonLat) => ({ x: ((p.lon + 180) / 360) * window.innerWidth, y: ((90 - p.lat) / 180) * window.innerHeight, visible: true });

const sample = (x: number, y: number) => {
  const lon = (x / window.innerWidth) * 360 - 180, lat = 90 - (y / window.innerHeight) * 180;
  return { lat, lon, elevM: -2540 + Math.round(x / 4), slopeDeg: 4.2, unit: 'Preview text' };
};

const SAMPLE = [
  'Preview text, not data.',
  'The ground here is about 4.2° steep and 2,540 m below the datum.',
  'The nearest flat area is roughly 12 km east.',
].join('\n');

const MOODS: ScoutMood[] = ['idle', 'listening', 'thinking', 'drawing', 'warning'];

export default function CompanionPreview() {
  const mode = useCompanion((c) => c.mode);

  useEffect(() => {
    const st = useCompanion.getState;
    const offPoint = onClickPoint((p) => {
      st().anchorToPoint(p);
      st().say({ text: SAMPLE, point: p, unverified: ['12 km'], sources: [{ title: 'Sample source', url: 'https://example.com' }, { title: 'Another sample' }] });
    });
    const offAsk = onAsk((text) => {
      st().setBusy(true, 'Checking landing criteria…');
      window.setTimeout(() => st().say({ text: `Preview text, not data.\nYou asked: ${text}` }), 1400);
    });
    return () => { offPoint(); offAsk(); };
  }, []);

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-companion],[data-controls]')) return;
    emitClickPoint({ lon: (e.clientX / window.innerWidth) * 360 - 180, lat: 90 - (e.clientY / window.innerHeight) * 180 });
  };

  return (
    <main onClick={onClick} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#060505', cursor: 'crosshair' }}>
      <div aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', width: 'min(86vh, 70vw)', aspectRatio: '1', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'radial-gradient(circle at 36% 32%, #9a5a34 0%, #6b3b22 50%, #2e170e 85%, #180c07 100%)' }} />
      <div data-controls style={{ position: 'absolute', left: 16, top: 16, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: '#a39c95', maxWidth: 'calc(100vw - 32px)' }}>
        <span>Companion preview. Move the mouse, click anywhere.</span>
        {MOODS.map((m) => <button key={m} onClick={() => useCompanion.getState().setMood(m)} style={btn}>{m}</button>)}
        <button onClick={() => useCompanion.getState().setMode(mode === 'globe' ? 'jezero' : 'globe')} style={btn}>chips: {mode}</button>
      </div>
      <Scout projectToScreen={project} sampleAt={sample} />
    </main>
  );
}

const btn: React.CSSProperties = { border: 0, background: 'none', color: '#ece7e1', cursor: 'pointer', fontSize: 12, padding: '2px 4px', textDecoration: 'underline', textDecorationColor: 'rgba(236,231,225,0.3)', textUnderlineOffset: 3 };
