import React from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT, FPS, TH, W, H, easeInOut, easeOut, sec, rgba } from './theme';

const clampOpts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// word-by-word masked reveal (rise + de-blur) used on every headline so text *arrives* instead of popping.
export const Reveal: React.FC<{ text: string; start: number; size: number; weight?: number; color?: string; gradient?: boolean; stagger?: number; style?: React.CSSProperties }> =
  ({ text, start, size, weight = 800, color = C.text, gradient, stagger = 3, style }) => {
    const f = useCurrentFrame();
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `0 ${size * 0.26}px`, fontFamily: FONT, fontSize: size, fontWeight: weight, lineHeight: 1.08, letterSpacing: -size * 0.025, ...style }}>
        {text.split(' ').map((w, i) => {
          const p = interpolate(f, [start + i * stagger, start + i * stagger + 26], [0, 1], { ...clampOpts, easing: easeOut });
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'visible', paddingBottom: size * 0.14, marginBottom: -size * 0.14, transform: `translateY(${(1 - p) * size * 0.55}px)`, opacity: p, filter: `blur(${(1 - p) * 12}px)`,
              ...(gradient ? { background: `linear-gradient(90deg, ${C.accentSoft}, ${C.text} 70%)`, WebkitBackgroundClip: 'text', color: 'transparent' } : { color }) }}>{w}</span>
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
  <Img src={staticFile(TH.assets.logo)} style={{ width: size, height: size, borderRadius: size * 0.225, boxShadow: `0 0 ${size * 0.7}px ${rgba(C.accent, glow)}, 0 ${size * 0.08}px ${size * 0.3}px rgba(0,0,0,.5)`, ...style }} />
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
        <div style={{ position: 'absolute', inset: -34 * ring - 6, borderRadius: 54, border: `2px solid ${rgba(C.accentSoft, 0.5 * (1 - ring))}`, transform: `scale(${1 + ring * 0.35})` }} />
        <LogoMark size={150} glow={0.7} />
      </div>
      <div style={{ opacity: pill, transform: `translateY(${(1 - pill) * 14}px)`, fontFamily: FONT, fontSize: 24, fontWeight: 600, letterSpacing: 5, color: C.accentSoft, padding: '10px 26px', borderRadius: 99, border: `1px solid ${rgba(C.accentSoft, .28)}`, background: rgba(C.accent, .12), marginBottom: 44 }}>{eyebrow}</div>
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
      <div style={{ position: 'absolute', left: 96 - (1 - enter) * 140, top: 120, fontFamily: FONT, fontSize: 520, fontWeight: 800, lineHeight: 1, letterSpacing: -20, color: 'transparent', WebkitTextStroke: `3px ${C.accent}`, opacity: 0.55 * enter, filter: `blur(${(1 - enter) * 14}px) drop-shadow(0 0 34px ${rgba(C.accent, .5)})` }}>{num}</div>
      <div style={{ position: 'absolute', left: 190, top: 500 }}>
        <div style={{ width: 150 * line, height: 5, borderRadius: 4, background: `linear-gradient(90deg, ${C.accent}, ${C.accentSoft})`, boxShadow: `0 0 18px ${C.accent}`, marginBottom: 34 }} />
        <Reveal text={title} start={sec(0.55)} size={112} />
        <div style={{ marginTop: 30, fontFamily: FONT, fontSize: 40, fontWeight: 500, color: C.muted, maxWidth: 1250, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)`, filter: `blur(${(1 - tag) * 6}px)` }}>{tagline}</div>
      </div>
      <div style={{ position: 'absolute', left: 190, bottom: 96, display: 'flex', gap: 12, alignItems: 'center', opacity: enter }}>
        {labels.map((l, i) => (
          <div key={i} style={{ width: i === index ? 92 : 46, height: 5, borderRadius: 4, background: i < index ? rgba(C.accentSoft, .55) : i === index ? C.accent : 'rgba(255,255,255,.14)', boxShadow: i === index ? `0 0 14px ${C.accent}` : 'none' }} />
        ))}
        <div style={{ marginLeft: 18, fontFamily: FONT, fontSize: 20, fontWeight: 600, letterSpacing: 3, color: C.dim, textTransform: 'uppercase' }}>{String(index + 1).padStart(2, '0')} / {String(labels.length).padStart(2, '0')}</div>
      </div>
    </div>
  );
};

// Optional call-to-action card: a closing tagline plus a link (the theme's `endCard`), shown instead of the bare site line.
export type EndCard = { tagline: string; accent: string; url: string };

export const EndScene: React.FC<{ dur: number; line1: string; line2: string; cta: string; card?: EndCard }> = ({ dur, line1, line2, cta, card }) => {
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
        <div style={{ marginTop: 36, opacity: cardP, transform: `translateY(${(1 - cardP) * 28}px) scale(${0.96 + 0.04 * cardP})`, display: 'flex', alignItems: 'center', gap: 36, padding: '24px 40px', borderRadius: 24, background: `linear-gradient(135deg, ${rgba(C.accent, .22)}, rgba(20,16,40,.7))`, border: `1px solid ${rgba(C.accentSoft, .38)}`, boxShadow: `0 30px 80px rgba(0,0,0,.55), 0 0 90px ${rgba(C.accent, .28)}` }}>
          <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, letterSpacing: -1, lineHeight: 1.15, color: C.text }}>
            {card.tagline}<br /><span style={{ background: `linear-gradient(90deg, ${C.accentSoft}, ${C.text} 80%)`, WebkitBackgroundClip: 'text', color: 'transparent' }}>{card.accent}</span>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: rgba(C.accentSoft, .3) }} />
          <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 700, color: C.text, padding: '16px 28px', borderRadius: 16, background: C.accent, boxShadow: `0 0 40px ${rgba(C.accent, .55)}`, whiteSpace: 'nowrap' }}>{card.url} →</div>
        </div>
      ) : (
        <div style={{ marginTop: 40, opacity: a, fontFamily: FONT, fontSize: 28, fontWeight: 700, letterSpacing: 6, color: C.accentSoft }}>{TH.brand.site}</div>
      )}
    </div>
  );
};
