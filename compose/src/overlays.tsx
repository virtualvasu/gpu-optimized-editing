import React from 'react';
import { interpolate, spring } from 'remotion';
import { C, FONT, MONO, FPS, TH, clamp, easeOut, rgba } from './theme';

// Explainer overlays that sit on the card (screen-space, not zoomed): comparison boxes, hand-off chains, badges, callouts
// (a detail read out large next to the box it comes from) and a step tracker.
export type Card = { head: string; body?: string; color: string; mono?: boolean };
export type CalloutLine = { text: string; color?: string; at?: number };
export type OverlaySpec =
  | { kind: 'duo'; title?: string; left: Card; right: Card; mid: string; midColor?: string; at: number; dur: number; top?: number }
  | { kind: 'chain'; steps: { text: string; color: string; at: number }[]; dur: number; top?: number }
  | { kind: 'badge'; text: string; color: string; at: number; dur: number; top?: number }
  | { kind: 'callout'; box: [number, number, number, number]; side?: 'left' | 'right' | 'top' | 'bottom'; anchor?: [number, number]; head?: string; value?: string;
      lines?: CalloutLine[]; mono?: boolean; color?: string; width?: number; at: number; dur: number }
  | { kind: 'steps'; items: string[]; done?: number; ticks?: number[]; at: number; dur: number };

const clampO = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const glass = (): React.CSSProperties => ({ background: 'rgba(8,6,16,.9)', border: `1px solid ${rgba(C.accentSoft, .28)}`, backdropFilter: 'blur(8px)', boxShadow: '0 18px 60px rgba(0,0,0,.55)' });

// A detail from the recording, read out large: a line is drawn from the box (clip pixels, 1920x1080) to a card beside it, and
// the card's lines type in (each at its own cue, or one after another). The recording stays whole; only the reading gets easier.
const Callout: React.FC<{ o: Extract<OverlaySpec, { kind: 'callout' }>; t: number }> = ({ o, t }) => {
  const dur = o.dur ?? 4.5;
  const a = interpolate(t, [o.at - 0.05, o.at + 0.35, o.at + dur - 0.45, o.at + dur], [0, 1, 1, 0], clampO);
  if (a <= 0.01) return null;
  const S = TH.window.w / 1920, WW = TH.window.w, WH = TH.window.h, col = o.color || C.accentSoft, GAP = 58;
  const [x, y, w, h] = o.box.map((v) => v * S);
  const side = o.side ?? (x + w / 2 < WW / 2 ? 'right' : 'left');
  const horiz = side === 'left' || side === 'right';
  const p0: [number, number] = side === 'right' ? [x + w + 6, y + h / 2] : side === 'left' ? [x - 6, y + h / 2] : side === 'top' ? [x + w / 2, y - 6] : [x + w / 2, y + h + 6];
  let p1: [number, number] = o.anchor ? [o.anchor[0] * S, o.anchor[1] * S]
    : side === 'right' ? [x + w + GAP, p0[1]] : side === 'left' ? [x - GAP, p0[1]] : side === 'top' ? [p0[0], y - GAP] : [p0[0], y + h + GAP];
  const lines = o.lines || [];
  // the card's size, estimated, so it can be kept inside the window (its real size depends on the text)
  const estH = 40 + (o.head ? 26 : 0) + (o.value ? 72 : 0) + lines.length * (o.mono ? 36 : 40);
  const estW = clamp(Math.max((o.head?.length ?? 0) * 14, (o.value?.length ?? 0) * 34, ...lines.map((l) => l.text.length * (o.mono ? 15.5 : 16))) + 56, 220, o.width ?? 640);
  const cardTop = horiz ? clamp(p1[1] - 34, 14, Math.max(14, WH - estH - 14)) : 0;
  if (horiz) p1 = [p1[0], clamp(p1[1], cardTop + 22, cardTop + 60)];
  const cx = clamp(p1[0], estW / 2 + 14, WW - estW / 2 - 14);
  if (!horiz) p1 = [cx, p1[1]];
  const pos: React.CSSProperties = side === 'right' ? { left: p1[0], top: cardTop } : side === 'left' ? { right: WW - p1[0], top: cardTop }
    : side === 'top' ? { left: cx, bottom: WH - p1[1] } : { left: cx, top: Math.min(p1[1], WH - estH - 14) };
  const draw = interpolate(t, [o.at, o.at + 0.45], [0, 1], { ...clampO, easing: easeOut });
  const card = interpolate(t, [o.at + 0.2, o.at + 0.65], [0, 1], { ...clampO, easing: easeOut });
  const first = o.at + 0.55;
  const lineAt = (i: number) => lines[i].at ?? first + (o.value ? 0.35 : 0) + i * 0.5;
  const val = interpolate(t, [first, first + 0.5], [0, 1], { ...clampO, easing: easeOut });
  const slide = (1 - card) * 18, shift = side === 'right' ? `translateX(${-slide}px)` : side === 'left' ? `translateX(${slide}px)` : `translateX(-50%) translateY(${side === 'top' ? slide : -slide}px)`;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: a, pointerEvents: 'none' }}>
      <svg width={WW} height={WH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <circle cx={p0[0]} cy={p0[1]} r={7 * draw} fill={col} style={{ filter: `drop-shadow(0 0 8px ${col})` }} />
        <line x1={p0[0]} y1={p0[1]} x2={p0[0] + (p1[0] - p0[0]) * draw} y2={p0[1] + (p1[1] - p0[1]) * draw} stroke={col} strokeWidth={3} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
      </svg>
      <div style={{ position: 'absolute', ...pos, opacity: card, transform: `${shift} scale(${0.96 + 0.04 * card})` }}>
        <div style={{ ...glass(), maxWidth: o.width ?? 640, padding: '18px 26px 20px', borderRadius: 18, border: `2px solid ${col}`, boxShadow: `0 18px 60px rgba(0,0,0,.55), 0 0 36px ${rgba(C.accent, .35)}` }}>
          {o.head && <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, letterSpacing: 4, color: col, textTransform: 'uppercase', marginBottom: o.value || lines.length ? 10 : 0 }}>{o.head}</div>}
          {o.value && <div style={{ fontFamily: FONT, fontSize: 60, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1, color: C.text, opacity: val, transform: `translateY(${(1 - val) * 10}px)`, marginBottom: lines.length ? 12 : 0 }}>{o.value}</div>}
          {lines.map((l, i) => {
            const s = lineAt(i), n = Math.round(clamp((t - s) * 46, 0, l.text.length)), on = t >= s - 0.02;
            const p = interpolate(t, [s - 0.05, s + 0.3], [0, 1], { ...clampO, easing: easeOut });
            return (
              <div key={i} style={{ fontFamily: o.mono ? MONO : FONT, fontSize: o.mono ? 25 : 28, fontWeight: o.mono ? 500 : 600, lineHeight: 1.4, color: l.color || C.text, whiteSpace: 'pre', minHeight: o.mono ? 35 : 39,
                opacity: o.mono ? (on ? 1 : 0) : p, transform: o.mono ? 'none' : `translateY(${(1 - p) * 8}px)` }}>
                {o.mono ? l.text.slice(0, n) : l.text}
                {o.mono && on && n < l.text.length && <span style={{ display: 'inline-block', width: 12, height: 26, marginLeft: 2, verticalAlign: -4, background: col }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// A short procedure shown as numbered steps at the top of the window (in the app header's empty middle); each tick completes the current step.
const Steps: React.FC<{ o: Extract<OverlaySpec, { kind: 'steps' }>; t: number }> = ({ o, t }) => {
  const a = interpolate(t, [o.at - 0.05, o.at + 0.45, o.at + o.dur - 0.45, o.at + o.dur], [0, 1, 1, 0], clampO);
  if (a <= 0.01) return null;
  const done0 = o.done ?? 0, ticks = o.ticks ?? [];
  const doneAt = (i: number) => (i < done0 ? -1e9 : ticks[i - done0] ?? 1e9);
  return (
    <div style={{ position: 'absolute', top: 8, left: '50%', opacity: a, transform: `translateX(-50%) translateY(${(1 - a) * -12}px)` }}>
      <div style={{ ...glass(), display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px 10px 12px', borderRadius: 99 }}>
        {o.items.map((it, i) => {
          const d = interpolate(t, [doneAt(i), doneAt(i) + 0.4], [0, 1], { ...clampO, easing: easeOut });
          const act = (i === 0 ? 1 : interpolate(t, [doneAt(i - 1), doneAt(i - 1) + 0.4], [0, 1], { ...clampO, easing: easeOut })) * (1 - d);
          const col = d > 0.5 ? C.green : act > 0.5 ? C.accentSoft : C.dim;
          return (
            <React.Fragment key={i}>
              {i > 0 && <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, color: C.dim }}>›</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: d > 0.5 ? rgba(C.green, .2) : act > 0.5 ? C.accent : 'rgba(255,255,255,.06)',
                  border: `2px solid ${col}`, boxShadow: act > 0.5 ? `0 0 ${18 * act}px ${C.accent}` : d > 0.5 ? `0 0 14px ${rgba(C.green, .5)}` : 'none', fontFamily: FONT, fontSize: 17, fontWeight: 800, color: C.text }}>
                  {d > 0.5 ? <svg width="18" height="18" viewBox="0 0 52 52"><path d="M12 27 L22 37 L41 15" fill="none" stroke={C.green} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset={60 * (1 - d)} /></svg> : i + 1}
                </div>
                <div style={{ fontFamily: FONT, fontSize: 21, fontWeight: act > 0.5 ? 800 : 600, color: act > 0.5 || d > 0.5 ? C.text : C.muted, whiteSpace: 'nowrap' }}>{it}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const CardView: React.FC<{ c: Card; p: number }> = ({ c, p }) => (
  <div style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px) scale(${0.94 + 0.06 * p})`, minWidth: 250, padding: '16px 28px', borderRadius: 16, background: rgba(C.bgTop, .97), border: `2px solid ${c.color}`, boxShadow: `0 0 34px ${c.color}55` }}>
    <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, letterSpacing: 3, color: c.color, marginBottom: c.body ? 8 : 0 }}>{c.head}</div>
    {c.body && <div style={{ fontFamily: c.mono ? MONO : FONT, fontSize: c.mono ? 34 : 30, fontWeight: c.mono ? 500 : 600, color: C.text, whiteSpace: 'nowrap' }}>{c.body}</div>}
  </div>
);

export const Overlay: React.FC<{ o: OverlaySpec; t: number }> = ({ o, t }) => {
  if (o.kind === 'callout') return <Callout o={o} t={t} />;
  if (o.kind === 'steps') return <Steps o={o} t={t} />;
  const top = ('top' in o && o.top) || 96;
  if (o.kind === 'badge') {
    const a = interpolate(t, [o.at, o.at + 0.45, o.at + o.dur - 0.4, o.at + o.dur], [0, 1, 1, 0], clampO);
    if (a <= 0.01) return null;
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', opacity: a, transform: `translateY(${(1 - a) * -16}px)` }}>
        <div style={{ ...glass(), display: 'flex', alignItems: 'center', gap: 16, padding: '16px 36px', borderRadius: 99, border: `2px solid ${o.color}`, boxShadow: `0 0 40px ${o.color}55`, fontFamily: FONT, fontSize: 36, fontWeight: 800, letterSpacing: 0.5, color: C.text }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, background: o.color, boxShadow: `0 0 14px ${o.color}` }} />{o.text}
        </div>
      </div>
    );
  }
  if (o.kind === 'chain') {
    const end = Math.max(...o.steps.map((s) => s.at)) + o.dur;
    const a = interpolate(t, [o.steps[0].at - 0.1, o.steps[0].at + 0.4, end - 0.5, end], [0, 1, 1, 0], clampO);
    if (a <= 0.01) return null;
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', opacity: a }}>
        <div style={{ ...glass(), display: 'flex', alignItems: 'center', gap: 18, padding: '18px 30px', borderRadius: 22 }}>
          {o.steps.map((s, i) => {
            const p = interpolate(t, [s.at, s.at + 0.5], [0, 1], { ...clampO, easing: easeOut });
            return (
              <React.Fragment key={i}>
                {i > 0 && <div style={{ fontSize: 36, fontWeight: 800, color: C.accentSoft, opacity: p }}>→</div>}
                <div style={{ opacity: p, transform: `translateX(${(1 - p) * -18}px) scale(${0.9 + 0.1 * p})`, fontFamily: FONT, fontSize: 28, fontWeight: 700, color: C.text, padding: '12px 24px', borderRadius: 14, background: rgba(C.bgTop, .97), border: `2px solid ${s.color}`, boxShadow: `0 0 26px ${s.color}55`, whiteSpace: 'nowrap' }}>{s.text}</div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }
  const a = interpolate(t, [o.at - 0.1, o.at + 0.5, o.at + o.dur - 0.5, o.at + o.dur], [0, 1, 1, 0], clampO);
  if (a <= 0.01) return null;
  const pl = interpolate(t, [o.at, o.at + 0.55], [0, 1], { ...clampO, easing: easeOut }), pr = interpolate(t, [o.at + 0.35, o.at + 0.9], [0, 1], { ...clampO, easing: easeOut });
  const pm = interpolate(t, [o.at + 0.75, o.at + 1.15], [0, 1], { ...clampO, easing: easeOut });
  const mc = o.midColor || C.red;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', opacity: a }}>
      <div style={{ ...glass(), padding: '18px 34px 22px', borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {o.title && <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, letterSpacing: 4, color: C.muted, textTransform: 'uppercase' }}>{o.title}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <CardView c={o.left} p={pl} />
          <div style={{ fontFamily: FONT, fontSize: o.mid.length > 2 ? 30 : 58, fontWeight: 800, color: mc, textShadow: `0 0 26px ${mc}`, opacity: pm, transform: `scale(${0.6 + 0.45 * pm})` }}>{o.mid}</div>
          <CardView c={o.right} p={pr} />
        </div>
      </div>
    </div>
  );
};
