import React from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT, FPS, TH, W, H, easeInOut, easeOut, sec, rgba, isClean, glow } from './theme';

const clampOpts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// word-by-word masked reveal (rise + de-blur) used on every headline so text *arrives* instead of popping.
export const Reveal: React.FC<{ text: string; start: number; size: number; weight?: number; color?: string; gradient?: boolean; stagger?: number; style?: React.CSSProperties }> =
  ({ text, start, size, weight = 800, color = C.text, gradient, stagger = 3, style }) => {
    const f = useCurrentFrame();
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `0 ${size * 0.26}px`, fontFamily: FONT, fontSize: size, fontWeight: isClean() ? Math.min(weight, 700) : weight, lineHeight: isClean() ? 1.04 : 1.08, letterSpacing: -size * (isClean() ? 0.032 : 0.025), ...style }}>
        {text.split(' ').map((w, i) => {
          const p = interpolate(f, [start + i * stagger, start + i * stagger + 26], [0, 1], { ...clampOpts, easing: easeOut });
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'visible', paddingBottom: size * 0.14, marginBottom: -size * 0.14, transform: `translateY(${(1 - p) * size * 0.55}px)`, opacity: p, filter: `blur(${(1 - p) * 12}px)`,
              ...(gradient && !isClean() ? { background: `linear-gradient(90deg, ${C.accentSoft}, ${C.text} 70%)`, WebkitBackgroundClip: 'text', color: 'transparent' } : { color: gradient ? (C.headline2 ?? C.muted) : color }) }}>{w}</span>
          );
        })}
      </div>
    );
  };

const exitFx = (f: number, dur: number, len = 0.8) => {
  const p = interpolate(f, [dur - sec(len), dur], [0, 1], { ...clampOpts, easing: easeInOut });
  return { p, style: { opacity: 1 - p, transform: `translateY(${-p * 34}px) scale(${1 + p * 0.03})`, filter: `blur(${p * 12}px)` } as React.CSSProperties };
};

export const LogoMark: React.FC<{ size: number; glow?: number; style?: React.CSSProperties }> = ({ size, glow = 0.5, style }) => (
  <Img src={staticFile(TH.assets.logo)} style={{ width: size, height: size, borderRadius: size * 0.225, boxShadow: isClean() ? `0 ${size * 0.08}px ${size * 0.3}px rgba(0,0,0,.5)` : `0 0 ${size * 0.7}px ${rgba(C.accent, glow)}, 0 ${size * 0.08}px ${size * 0.3}px rgba(0,0,0,.5)`, ...style }} />
);

export const TitleScene: React.FC<{ dur: number; eyebrow: string; line1: string; line2: string }> = ({ dur, eyebrow, line1, line2 }) => {
  const f = useCurrentFrame();
  const ex = exitFx(f, dur, 0.9);
  const logo = spring({ frame: f - sec(0.1), fps: FPS, config: { damping: 18, stiffness: 90, mass: 0.9 } });
  const ring = interpolate(f, [sec(0.2), sec(1.8)], [0, 1], { ...clampOpts, easing: easeOut });
  const pill = interpolate(f, [sec(0.6), sec(1.3)], [0, 1], { ...clampOpts, easing: easeOut });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', ...ex.style }}>
      <div style={{ position: 'relative', width: 150, height: 150, marginBottom: 36, transform: `scale(${0.6 + 0.4 * logo})`, opacity: logo }}>
        {!isClean() && <div style={{ position: 'absolute', inset: -34 * ring - 6, borderRadius: 54, border: `2px solid ${rgba(C.accentSoft, 0.5 * (1 - ring))}`, transform: `scale(${1 + ring * 0.35})` }} />}
        <LogoMark size={150} glow={0.7} />
      </div>
      <div style={{ opacity: pill, transform: `translateY(${(1 - pill) * 14}px)`, fontFamily: FONT, fontSize: 24, fontWeight: 600, letterSpacing: 5, ...(isClean() ? { color: C.muted, marginBottom: 44 } : { color: C.accentSoft, padding: '10px 26px', borderRadius: 99, border: `1px solid ${rgba(C.accentSoft, .28)}`, background: rgba(C.accent, .12), marginBottom: 44 }) }}>{eyebrow}</div>
      <Reveal text={line1} start={sec(0.9)} size={104} />
      <Reveal text={line2} start={sec(1.45)} size={104} gradient />
    </div>
  );
};

export const SectionScene: React.FC<{ dur: number; num: string; title: string; tagline: string; index: number; labels: string[] }> = ({ dur, num, title, tagline, index, labels }) => {
  const f = useCurrentFrame();
  const ex = exitFx(f, dur, 0.75);
  const enter = interpolate(f, [sec(0.3), sec(1.5)], [0, 1], { ...clampOpts, easing: easeOut });
  const line = interpolate(f, [sec(0.6), sec(1.5)], [0, 1], { ...clampOpts, easing: easeOut });
  const tag = interpolate(f, [sec(1.0), sec(1.7)], [0, 1], { ...clampOpts, easing: easeOut });
  return (
    <div style={{ position: 'absolute', inset: 0, ...ex.style }}>
      {isClean()
        ? <div style={{ position: 'absolute', left: 190, top: 380, fontFamily: FONT, fontSize: 30, fontWeight: 600, letterSpacing: 6, color: C.muted, textTransform: 'uppercase', opacity: enter, transform: `translateY(${(1 - enter) * 12}px)` }}>{num}</div>
        : <div style={{ position: 'absolute', left: 96 - (1 - enter) * 140, top: 120, fontFamily: FONT, fontSize: 520, fontWeight: 800, lineHeight: 1, letterSpacing: -20, color: 'transparent', WebkitTextStroke: `3px ${C.accent}`, opacity: 0.55 * enter, filter: `blur(${(1 - enter) * 14}px) drop-shadow(0 0 34px ${rgba(C.accent, .5)})` }}>{num}</div>}
      <div style={{ position: 'absolute', left: 190, top: 500 }}>
        {!isClean() && <div style={{ width: 150 * line, height: 5, borderRadius: 4, background: `linear-gradient(90deg, ${C.accent}, ${C.accentSoft})`, boxShadow: `0 0 18px ${C.accent}`, marginBottom: 34 }} />}
        <Reveal text={title} start={sec(0.55)} size={112} />
        <div style={{ marginTop: 30, fontFamily: FONT, fontSize: 40, fontWeight: 500, color: C.muted, maxWidth: 1250, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)`, filter: `blur(${(1 - tag) * 6}px)` }}>{tagline}</div>
      </div>
      <div style={{ position: 'absolute', left: 190, bottom: 96, display: 'flex', gap: 12, alignItems: 'center', opacity: enter }}>
        {labels.map((l, i) => (
          <div key={i} style={{ width: i === index ? 92 : 46, height: 5, borderRadius: 4, background: i < index ? (isClean() ? 'rgba(255,255,255,.5)' : rgba(C.accentSoft, .55)) : i === index ? (isClean() ? C.text : C.accent) : 'rgba(255,255,255,.14)', boxShadow: i === index ? glow(C.accent, 14) : 'none' }} />
        ))}
        <div style={{ marginLeft: 18, fontFamily: FONT, fontSize: 20, fontWeight: 600, letterSpacing: 3, color: C.dim, textTransform: 'uppercase' }}>{String(index + 1).padStart(2, '0')} / {String(labels.length).padStart(2, '0')}</div>
      </div>
    </div>
  );
};

// Optional call-to-action card: a closing tagline plus a link (the theme's `endCard`), shown instead of the bare site line.
export type EndCard = { tagline: string; accent: string; url: string };


// Clean-look outro (2026-11-12): scattered boxes ("rebuilding") glide into one tidy agent graph under the logo ("orchestrating"); lines draw in,
// small pulses travel along them, the headline swaps from the grey "Stop rebuilding." to the white "Start orchestrating.", then the docs pill.
const OUT_W = 132, OUT_H = 70;
const OUT_NODES: { x: number; y: number; parent: number }[] = [
  { x: 960, y: 230, parent: -1 },
  { x: 560, y: 430, parent: 0 }, { x: 960, y: 430, parent: 0 }, { x: 1360, y: 430, parent: 0 },
  { x: 460, y: 620, parent: 1 }, { x: 660, y: 620, parent: 1 },
  { x: 860, y: 620, parent: 2 }, { x: 1060, y: 620, parent: 2 },
  { x: 1260, y: 620, parent: 3 }, { x: 1460, y: 620, parent: 3 },
];
const frac = (v: number) => v - Math.floor(v);
const CleanOutro: React.FC<{ dur: number; card: EndCard }> = ({ dur, card }) => {
  const f = useCurrentFrame(), t = f / FPS;
  const fadeOut = interpolate(f, [dur - sec(0.9), dur], [1, 0], { ...clampOpts, easing: easeInOut });
  const fadeIn = interpolate(f, [0, sec(0.7)], [0, 1], { ...clampOpts, easing: easeOut });
  const pos = OUT_NODES.map((n, i) => {
    const sx = 240 + frac(Math.sin(i * 12.9898) * 43758.5453) * 1440, sy = 170 + frac(Math.sin(i * 78.233) * 12345.6789) * 500;
    const rot = (frac(Math.sin(i * 39.346) * 24634.6345) - 0.5) * 26;
    const p = interpolate(t, [2.0 + 0.07 * i, 3.3 + 0.07 * i], [0, 1], { ...clampOpts, easing: easeInOut });
    const wob = 1 - p;
    return { x: sx + (n.x - sx) * p + Math.sin(t * 1.3 + i) * 9 * wob, y: sy + (n.y - sy) * p + Math.cos(t * 1.1 + i * 2) * 7 * wob, rot: (rot + Math.sin(t * 1.7 + i) * 3) * wob, p };
  });
  const edge = (i: number) => interpolate(t, [3.2 + 0.1 * i, 3.8 + 0.1 * i], [0, 1], { ...clampOpts, easing: easeOut });
  const d1 = interpolate(t, [1.8, 2.5], [0, 1], { ...clampOpts, easing: easeInOut });
  const pill = spring({ frame: f - sec(4.1), fps: FPS, config: { damping: 22, stiffness: 90 } });
  const size = 78;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: fadeOut * fadeIn }}>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {OUT_NODES.map((n, i) => {
          if (n.parent < 0) return null;
          const P = OUT_NODES[n.parent], x1 = P.x, y1 = P.y + (n.parent === 0 ? 56 : OUT_H / 2), x2 = n.x, y2 = n.y - OUT_H / 2, my = (y1 + y2) / 2, e = edge(i);
          const u = (((t - 4.0 - 0.14 * i) % 1.7) + 1.7) % 1.7 / 1.7, k = 1 - u;
          const bx = k * k * k * x1 + 3 * k * k * u * x1 + 3 * k * u * u * x2 + u * u * u * x2, by = k * k * k * y1 + 3 * k * k * u * my + 3 * k * u * u * my + u * u * u * y2;
          return (
            <g key={i}>
              <path d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - e} fill="none" stroke="rgba(255,255,255,.38)" strokeWidth={2} strokeLinecap="round" />
              {t > 4.0 + 0.14 * i && e >= 1 && <circle cx={bx} cy={by} r={5} fill={C.accent} opacity={Math.sin(u * Math.PI)} />}
            </g>
          );
        })}
      </svg>
      {OUT_NODES.map((n, i) => {
        const q = pos[i], on = n.parent < 0 ? q.p : edge(i);
        const appear = interpolate(t, [0.1 + 0.08 * i, 0.7 + 0.08 * i], [0, 1], { ...clampOpts, easing: easeOut });
        const base: React.CSSProperties = { position: 'absolute', left: q.x, top: q.y, opacity: appear, transform: `translate(-50%, -50%) rotate(${q.rot}deg)` };
        if (n.parent < 0) return <div key={i} style={base}><LogoMark size={100} glow={0} /></div>;
        return (
          <div key={i} style={{ ...base, width: OUT_W, height: OUT_H, borderRadius: 16, background: `rgba(255,255,255,${0.05 + 0.04 * on})`, border: `1.5px solid rgba(255,255,255,${0.22 + 0.5 * on})`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 9, padding: '0 20px' }}>
            <div style={{ height: 7, width: '70%', borderRadius: 4, background: `rgba(255,255,255,${0.3 + 0.4 * on})` }} />
            <div style={{ height: 7, width: '46%', borderRadius: 4, background: 'rgba(255,255,255,.16)' }} />
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 745, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Reveal text={card.tagline} start={sec(0.5)} size={size} color={mix(C.text, C.dim, d1)} style={{ justifyContent: 'center' }} />
        <Reveal text={card.accent} start={sec(2.1)} size={size} color={C.text} style={{ justifyContent: 'center' }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 960, display: 'flex', justifyContent: 'center', opacity: pill, transform: `translateY(${(1 - pill) * 24}px)` }}>
        <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 600, color: C.bgBot, background: C.text, padding: '14px 34px', borderRadius: 99, whiteSpace: 'nowrap' }}>{card.url} →</div>
      </div>
    </div>
  );
};
const mix = (a: string, b: string, p: number) => {
  const h = (x: string, i: number) => parseInt(x.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(h(a, i) + (h(b, i) - h(a, i)) * p)).join(',')})`;
};

export const EndScene: React.FC<{ dur: number; line1: string; line2: string; cta: string; card?: EndCard }> = ({ dur, line1, line2, cta, card }) => {
  if (isClean() && card) return <CleanOutro dur={dur} card={card} />;
  const f = useCurrentFrame();
  const fadeOut = interpolate(f, [dur - sec(1.2), dur], [1, 0], { ...clampOpts, easing: easeInOut });
  const a = interpolate(f, [sec(0.4), sec(1.4)], [0, 1], { ...clampOpts, easing: easeOut });
  const logo = spring({ frame: f - sec(0.3), fps: FPS, config: { damping: 20, stiffness: 80 } });
  const cardP = spring({ frame: f - sec(2.0), fps: FPS, config: { damping: 22, stiffness: 90 } });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: fadeOut }}>
      <div style={{ transform: `scale(${(0.7 + 0.3 * logo) * (card ? 0.8 : 1)})`, opacity: logo, marginBottom: card ? 24 : 40 }}><LogoMark size={128} glow={0.65} /></div>
      <Reveal text={line1} start={sec(0.7)} size={card ? 68 : 76} style={{ justifyContent: 'center' }} />
      <Reveal text={line2} start={sec(1.1)} size={card ? 68 : 76} gradient style={{ justifyContent: 'center' }} />
      <div style={{ marginTop: card ? 28 : 44, fontFamily: FONT, fontSize: card ? 28 : 32, fontWeight: 500, color: C.muted, opacity: a, maxWidth: 1100, textAlign: 'center', lineHeight: 1.4 }}>{cta}</div>
      {card ? (
        <div style={{ marginTop: 36, opacity: cardP, transform: `translateY(${(1 - cardP) * 28}px) scale(${0.96 + 0.04 * cardP})`, display: 'flex', alignItems: 'center', gap: 36, padding: '24px 40px', borderRadius: 24, ...(isClean() ? { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 30px 80px rgba(0,0,0,.5)' } : { background: `linear-gradient(135deg, ${rgba(C.accent, .22)}, rgba(20,16,40,.7))`, border: `1px solid ${rgba(C.accentSoft, .38)}`, boxShadow: `0 30px 80px rgba(0,0,0,.55), 0 0 90px ${rgba(C.accent, .28)}` }) }}>
          <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, letterSpacing: -1, lineHeight: 1.15, color: C.text }}>
            {card.tagline}<br /><span style={isClean() ? { color: C.headline2 ?? C.muted } : { background: `linear-gradient(90deg, ${C.accentSoft}, ${C.text} 80%)`, WebkitBackgroundClip: 'text', color: 'transparent' }}>{card.accent}</span>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: isClean() ? 'rgba(255,255,255,.14)' : rgba(C.accentSoft, .3) }} />
          <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 700, color: C.text, padding: '16px 28px', borderRadius: 99, ...(isClean() ? { background: C.text, color: C.bgBot } : { background: C.accent, boxShadow: `0 0 40px ${rgba(C.accent, .55)}` }), whiteSpace: 'nowrap' }}>{card.url} →</div>
        </div>
      ) : (
        <div style={{ marginTop: 40, opacity: a, fontFamily: FONT, fontSize: 28, fontWeight: 700, letterSpacing: 6, color: isClean() ? C.muted : C.accentSoft }}>{TH.brand.site}</div>
      )}
    </div>
  );
};
