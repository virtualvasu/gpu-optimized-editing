import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { C, FONT, FPS, TH, easeInOut, easeOut, sec, rgba } from './theme';

const clampO = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export type RecapItem = { at: number; title: string; sub: string };

// Non-screen scene: four takeaways arrive in time with the narration, each with a drawn check mark.
export const RecapScene: React.FC<{ dur: number; items: RecapItem[]; cta: { at: number; text: string } }> = ({ dur, items, cta }) => {
  const f = useCurrentFrame(), t = f / FPS;
  const enter = interpolate(f, [0, sec(0.9)], [0, 1], { ...clampO, easing: easeOut });
  const out = interpolate(f, [dur - sec(0.8), dur], [0, 1], { ...clampO, easing: easeInOut });
  const head = interpolate(t, [0.2, 0.9], [0, 1], { ...clampO, easing: easeOut });
  const c = interpolate(t, [cta.at - 0.1, cta.at + 0.7], [0, 1], { ...clampO, easing: easeOut });
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: enter * (1 - out), transform: `translateY(${-out * 30}px) scale(${1 + out * 0.03})`, filter: out > 0.02 ? `blur(${out * 12}px)` : 'none' }}>
      <div style={{ position: 'absolute', left: 190, top: 120, opacity: head, transform: `translateY(${(1 - head) * 14}px)`, fontFamily: FONT, fontSize: 24, fontWeight: 700, letterSpacing: 6, color: C.accentSoft }}>{TH.labels.recap}</div>
      <div style={{ position: 'absolute', left: 190, top: 200, display: 'flex', flexDirection: 'column', gap: 38 }}>
        {items.map((it, i) => {
          const p = interpolate(t, [it.at - 0.15, it.at + 0.7], [0, 1], { ...clampO, easing: easeOut });
          const chk = interpolate(t, [it.at + 0.35, it.at + 0.95], [0, 1], { ...clampO, easing: easeOut });
          const active = t >= it.at && (i === items.length - 1 || t < items[i + 1].at);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 36, opacity: 0.35 + 0.65 * p, transform: `translateX(${(1 - p) * -60}px)`, filter: `blur(${(1 - p) * 8}px)` }}>
              <div style={{ position: 'relative', width: 92, height: 92, borderRadius: 26, background: active ? `linear-gradient(135deg, ${C.accent}, ${C.accentDeep})` : rgba(C.accent, .16), border: `2px solid ${active ? C.accentSoft : rgba(C.accentSoft, .3)}`, boxShadow: active ? `0 0 44px ${C.accent}88` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="52" height="52" viewBox="0 0 52 52"><path d="M12 27 L22 37 L41 15" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset={60 * (1 - chk)} /></svg>
              </div>
              <div>
                <div style={{ fontFamily: FONT, fontSize: 78, fontWeight: 800, letterSpacing: -2, color: C.text, lineHeight: 1.05 }}>{it.title}</div>
                <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 500, color: C.muted, marginTop: 8 }}>{it.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 190, bottom: 130, opacity: c, transform: `translateY(${(1 - c) * 18}px)`, display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ width: 8, height: 54, borderRadius: 4, background: `linear-gradient(180deg, ${C.accentSoft}, ${C.accent})`, boxShadow: `0 0 20px ${C.accent}` }} />
        <div style={{ fontFamily: FONT, fontSize: 44, fontWeight: 700, color: C.text, maxWidth: 1400, lineHeight: 1.15 }}>{cta.text}</div>
      </div>
    </div>
  );
};
