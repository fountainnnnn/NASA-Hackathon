'use client';
import { useState } from 'react';
import s from './hud.module.css';

export type MascotState = 'idle' | 'thinking' | 'answered' | 'offline';

const FILE: Record<MascotState, string> = {
  idle: 'scout-idle.svg', thinking: 'scout-thinking.svg', answered: 'scout-drawing.svg', offline: 'scout-warning.svg',
};

/** Scout, the AI-generated mascot (public/art). Always rendered with its "AI-generated" tag; nothing if the art is missing. */
export function MascotSlot({ state }: { state: MascotState }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <span className={s.mascotWrap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={s.mascot} src={`/art/${FILE[state]}`} alt="Scout, the copilot mascot" onError={() => setBroken(true)} />
      <span className={s.aiTag}>AI-generated</span>
    </span>
  );
}
