// A screen recording inside a macOS-style window: traffic lights, a URL pill, a soft long shadow, eased zoom keyframes and focus
// highlights. Geometry and colours are the theme's `window`; recordings are pre-scaled to window.w x window.h (vep prep).
import React from 'react';
import { Audio, Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT, FPS, TH, clamp, easeInOut, easeOut, sec, rgba } from './theme';
import { Overlay, OverlaySpec } from './overlays';

const clampOpts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export type Seg = { at: number; from: number; dur: number; rate?: number; freeze?: boolean };
export type Zoom = { t: number; z: number; fx: number; fy: number };
// Focus highlight (owner rule 2026-10-12: do not zoom in; keep the whole section visible and highlight it). `box` is in clip pixels (1920x1080).
// Optional look (used when the theme's highlight.style is "ring"): `color` (a key of the theme colours or #RRGGBB) or `tone` (a name from highlight.tones,
// e.g. "customer" -> amber), `label` = a short pill beside the box, `side` = where the pill goes (right|left|top|bottom; default: the first that fits).
export type Highlight = { at: number; dur: number; box: [number, number, number, number]; color?: string; tone?: string; label?: string; side?: 'right' | 'left' | 'top' | 'bottom' };

const HL: React.FC<{ h: Highlight; t: number }> = ({ h, t }) => {
  const S = TH.window.w / 1920, HC = TH.highlight || {};
  const ring = HC.style === 'ring';
  const a = interpolate(t, [h.at, h.at + 0.4, h.at + h.dur - 0.45, h.at + h.dur], [0, 1, 1, 0], clampOpts);
  const tick = HC.sound && TH.assets.tick ? <Sequence from={sec(h.at)} durationInFrames={sec(0.6)}><Audio src={staticFile(TH.assets.tick)} volume={HC.soundVolume ?? 0.6} /></Sequence> : null;   // a soft ping as the box appears
  if (a <= 0.01) return tick;
  const pad = 12, [x, y, w, hh] = h.box;
  const pulse = 0.75 + 0.25 * Math.sin((t - h.at) * 5);
  const L = x * S - pad, T = y * S - pad, BW = w * S + pad * 2, BH = hh * S + pad * 2;
  if (!ring) return (
    <>{tick}<div style={{ position: 'absolute', left: L, top: T, width: BW, height: BH, borderRadius: 16, opacity: a, pointerEvents: 'none',
      border: `3px solid ${C.accentSoft}`, boxShadow: `0 0 0 4000px ${rgba(C.bgBot, 0.5 * a)}, 0 0 ${28 * pulse}px ${C.accent}, inset 0 0 ${18 * pulse}px ${rgba(C.accent, .25)}` }} /></>
  );
  // ring style: a coloured frame (the colour says what the box is: system = violet, customer = amber, problem = red, fixed = green) plus an optional label pill
  const named = h.tone ? HC.tones?.[h.tone] : h.color;
  const col = named ? (named[0] === '#' ? named : C[named] || C.accentSoft) : C.accentSoft;
  const dim = HC.dim ?? 0;
  const WW = TH.window.w, WH = TH.window.h, FS = 28, PH = 62, GAP = 22;
  const PW = h.label ? Math.min(WW - 40, h.label.length * FS * 0.58 + 78) : 0;
  let pill: React.CSSProperties | null = null;
  if (h.label) {
    const cy = clamp(T + BH / 2 - PH / 2, 12, WH - PH - 12), cx = clamp(L + BW / 2 - PW / 2, 12, WW - PW - 12);
    const fits: Record<string, React.CSSProperties | null> = {
      right: L + BW + GAP + PW <= WW - 12 ? { left: L + BW + GAP, top: cy } : null,
      left: L - GAP - PW >= 12 ? { left: L - GAP - PW, top: cy } : null,
      top: T - GAP - PH >= 12 ? { left: cx, top: T - GAP - PH } : null,
      bottom: T + BH + GAP + PH <= WH - 12 ? { left: cx, top: T + BH + GAP } : null,
    };
    const order = h.side ? [h.side, 'right', 'left', 'top', 'bottom'] : (x * S + w * S / 2 < WW / 2 ? ['right', 'top', 'bottom', 'left'] : ['left', 'top', 'bottom', 'right']);
    pill = order.map((s) => fits[s]).find(Boolean) || { left: clamp(L + 16, 12, WW - PW - 12), top: clamp(T + 16, 12, WH - PH - 12) };   // nothing fits (a huge box): inside its top-left corner
  }
  const slide = (1 - Math.min(1, (t - h.at) / 0.35)) * 10;
  return (
    <>{tick}
      {dim > 0 && <div style={{ position: 'absolute', left: L, top: T, width: BW, height: BH, borderRadius: 16, opacity: a, pointerEvents: 'none', boxShadow: `0 0 0 4000px ${rgba(C.bgBot, dim * a)}` }} />}
      <div style={{ position: 'absolute', left: L, top: T, width: BW, height: BH, borderRadius: 16, opacity: a, pointerEvents: 'none',
        border: `3px solid ${col}`, boxShadow: `0 0 ${24 * pulse}px ${rgba(col, .7)}, inset 0 0 ${16 * pulse}px ${rgba(col, .16)}` }} />
      {pill && h.label && (
        <div style={{ position: 'absolute', ...pill, height: PH, opacity: a, transform: `translateY(${slide}px)`, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px', borderRadius: 99,
          background: rgba(C.bgTop, .96), border: `1px solid ${rgba(col, .45)}`, boxShadow: `0 10px 36px rgba(0,0,0,.5), 0 0 28px ${rgba(col, .3)}`, fontFamily: FONT, fontSize: FS, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, background: col, boxShadow: `0 0 12px ${col}`, flex: 'none' }} />{h.label}
        </div>
      )}
    </>
  );
};

const Lights: React.FC = () => (
  <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
    {TH.window.lights.map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 99, background: c, boxShadow: 'inset 0 0 0 .5px rgba(0,0,0,.25)' }} />)}
  </div>
);

export const MacScreen: React.FC<{ dur: number; src: string; segs: Seg[]; zooms?: Zoom[]; overlays?: OverlaySpec[]; highlights?: Highlight[]; url?: string; dissolve?: number }> =
  ({ dur, src, segs, zooms = [], overlays = [], highlights = [], url = TH.brand.url, dissolve = 0.28 }) => {
    const MAC = TH.window, S = MAC.w / 1920;
    const f = useCurrentFrame();
    const t = f / FPS;
    const inP = interpolate(f, [0, sec(1.0)], [0, 1], { ...clampOpts, easing: easeOut });
    const outP = interpolate(f, [dur - sec(0.85), dur], [0, 1], { ...clampOpts, easing: easeInOut });
    const scale = (1.07 - 0.07 * inP) * (1 - 0.1 * outP);
    const filmLook = TH.look === 'film';
    const wrap: React.CSSProperties = filmLook ? {
      // the dark film's window: rises from below with a little tilt, a soft purple glow under it, a hairline edge
      position: 'absolute', left: MAC.x, top: MAC.y, width: MAC.w, height: MAC.h + MAC.bar, borderRadius: MAC.radius, transformOrigin: '50% 100%',
      opacity: inP * (1 - outP), transform: `perspective(1800px) translateY(${(1 - inP) * 110 - outP * 20}px) rotateX(${(1 - inP) * 14}deg) scale(${(0.95 + 0.05 * inP) * (1 - 0.03 * outP)})`,
      filter: `${(1 - inP) * 6 + outP * 6 > 0.05 ? `blur(${(1 - inP) * 6 + outP * 6}px) ` : ''}${C.mode === 'light' ? 'drop-shadow(0 40px 80px rgba(30,24,60,.14)) drop-shadow(0 8px 20px rgba(30,24,60,.10))' : 'drop-shadow(0 30px 90px rgba(124,58,237,.36)) drop-shadow(0 18px 40px rgba(0,0,0,.55))'}`,
    } : {
      position: 'absolute', left: MAC.x, top: MAC.y, width: MAC.w, height: MAC.h + MAC.bar, borderRadius: MAC.radius,
      opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 26 - outP * 24}px) scale(${scale})`, filter: (1 - inP) * 14 + outP * 12 > 0.05 ? `blur(${(1 - inP) * 14 + outP * 12}px)` : 'none',
      boxShadow: `0 50px 120px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.12), 0 0 150px ${rgba(C.accent, .17)}`,
    };

    const keys = [{ t: 0, z: 1, fx: 960, fy: 540 }, ...zooms].sort((a, b) => a.t - b.t);
    let z = 1, fx = 960, fy = 540;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], n = keys[i + 1];
      if (!n) { z = k.z; fx = k.fx; fy = k.fy; break; }
      if (t >= k.t && t < n.t) { const p = easeInOut((t - k.t) / (n.t - k.t)); z = k.z + (n.z - k.z) * p; fx = k.fx + (n.fx - k.fx) * p; fy = k.fy + (n.fy - k.fy) * p; break; }
    }
    z *= 1 + 0.012 * (t / (dur / FPS));
    const cx = fx * S, cy = fy * S;
    const tx = clamp(MAC.w / 2 - cx * z, MAC.w - MAC.w * z, 0), ty = clamp(MAC.h / 2 - cy * z, MAC.h - MAC.h * z, 0);

    const sw = interpolate(f, [0, sec(1.25)], [-35, 135], { ...clampOpts, easing: easeInOut });
    const swOp = interpolate(f, [0, sec(0.3), sec(1.0), sec(1.25)], [0, 1, 1, 0], clampOpts);
    const seg0 = segs.map((s, i) => (i === 0 ? { ...s, d: 0 } : { ...s, d: dissolve }));

    return (
      <div style={wrap}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: MAC.radius, overflow: 'hidden', background: '#fff' }}>
          {/* title bar */}
          <div style={{ position: 'absolute', left: 0, top: 0, width: MAC.w, height: MAC.bar, background: `linear-gradient(180deg, ${MAC.titleBar[0]}, ${MAC.titleBar[1]})`, borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', paddingLeft: 20 }}>
            <Lights />
            <div style={{ position: 'absolute', left: '50%', top: 9, transform: 'translateX(-50%)', width: 520, height: 28, borderRadius: 14, background: MAC.urlPill, border: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: FONT, fontSize: 15, fontWeight: 500, color: C.muted }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>{url}
            </div>
          </div>
          {/* recording */}
          <div style={{ position: 'absolute', left: 0, top: MAC.bar, width: MAC.w, height: MAC.h, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: MAC.w, height: MAC.h, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>
              {seg0.map((s, i) => {
                const r = s.rate || 1, d = s.d, at = s.at - d, du = s.dur + d;
                const op = d ? interpolate(f - sec(at), [0, sec(d)], [0, 1], clampOpts) : 1;
                const vid = <OffthreadVideo src={staticFile(src)} muted transparent startFrom={Math.max(0, sec(s.from - d * r))} playbackRate={r} style={{ width: MAC.w, height: MAC.h, objectFit: 'cover' }} />;
                return (
                  <Sequence key={i} from={sec(at)} durationInFrames={Math.max(1, sec(du))} layout="none">
                    <div style={{ position: 'absolute', inset: 0, opacity: op }}>{s.freeze ? <Freeze frame={0}>{vid}</Freeze> : vid}</div>
                  </Sequence>
                );
              })}
            </div>
            <div style={{ position: 'absolute', top: -40, bottom: -40, left: `${sw}%`, width: '26%', transform: 'skewX(-16deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)', opacity: swOp, pointerEvents: 'none' }} />
            {highlights.map((h, i) => <HL key={'h' + i} h={h} t={t} />)}
            {overlays.map((o, i) => <Overlay key={i} o={o} t={t} />)}
          </div>
        </div>
      </div>
    );
  };
