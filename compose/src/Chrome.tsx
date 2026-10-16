import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { C, FONT, FPS, TH, W, rgba } from './theme';
import { LogoMark } from './scenes';

export type Interval = { from: number; to: number; label: string; idx: number };

// Persistent brand footer: logo + wordmark (left), chapter chip with progress pips (right). Fades with the screen scenes.
export const Chrome: React.FC<{ intervals: Interval[]; total: number; labels: string[] }> = ({ intervals, total, labels }) => {
  const t = useCurrentFrame() / FPS;
  let a = 0, cur: Interval | undefined;
  for (const iv of intervals) {
    const v = interpolate(t, [iv.from, iv.from + 0.5, iv.to - 0.5, iv.to], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    if (v > a) { a = v; cur = iv; }
  }
  if (a <= 0.01 || !cur) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: a, fontFamily: FONT }}>
      <div style={{ position: 'absolute', left: 128, top: 1008, display: 'flex', alignItems: 'center', gap: 14 }}>
        <LogoMark size={38} glow={0.35} />
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, color: C.text }}>{TH.brand.wordmark}</span>
      </div>
      <div style={{ position: 'absolute', right: 128, top: 1008, height: 38, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {labels.map((_, i) => <div key={i} style={{ width: i === cur!.idx ? 22 : 8, height: 5, borderRadius: 3, background: i === cur!.idx ? C.accent : i < cur!.idx ? rgba(C.accentSoft, .5) : 'rgba(255,255,255,.16)', boxShadow: i === cur!.idx ? `0 0 10px ${C.accent}` : 'none' }} />)}
        </div>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: 2.2, color: C.muted, textTransform: 'uppercase' }}>{cur.label}</span>
      </div>
    </div>
  );
};
