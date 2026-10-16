// Thumbnail (one 1920x1080 frame): logo, eyebrow pill, a big two-line headline (second line in the accent gradient), a subtitle,
// and one frame of a screen recording in a tilted Mac window. Text and frame come from the storyboard's optional `thumb`
// ({ eyebrow, line1, line2, sub, clip, v }); anything left out falls back to the title scene and the first screen scene.
import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { Backdrop } from './Backdrop';
import { LogoMark } from './scenes';
import { C, FONT, TH, applyTheme, clamp, rgba, sec } from './theme';
import { rv } from './story/timeline';
import type { StoryProps } from './story/Story';

export const Thumb: React.FC<StoryProps> = ({ theme, storyboard: sb, clips }) => {
  applyTheme(theme);
  const title = sb.scenes.find((s) => s.type === 'title') ?? {};
  const screen = sb.scenes.find((s) => s.type === 'screen');
  const th = { eyebrow: title.eyebrow, line1: title.line1 ?? '', line2: title.line2 ?? '', sub: '', clip: screen?.clip, v: screen?.endV ?? 0, ...sb.thumb };
  const info = th.clip ? clips[th.clip] : undefined;
  const size = clamp(840 / (0.55 * Math.max(th.line1.length, th.line2.length, 1)), 56, 190);   // each line fits on one row
  const win = TH.window, ww = 860, wh = (ww * 9) / 16;
  return (
    <AbsoluteFill>
      <Backdrop boosts={[]} total={10} />
      <div style={{ position: 'absolute', left: 96, top: 90, display: 'flex', alignItems: 'center', gap: 28 }}>
        <LogoMark size={92} glow={0.6} />
        {th.eyebrow && <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 600, letterSpacing: 5, color: C.accentSoft, padding: '10px 26px', borderRadius: 99, border: `1px solid ${rgba(C.accentSoft, 0.28)}`, background: rgba(C.accent, 0.12) }}>{th.eyebrow}</div>}
      </div>
      <div style={{ position: 'absolute', left: 90, top: 250, width: info ? 860 : 1700, whiteSpace: 'nowrap', fontFamily: FONT, fontSize: size, fontWeight: 800, letterSpacing: -size * 0.035, lineHeight: 1.0, color: C.text }}>
        {th.line1}<br /><span style={{ background: `linear-gradient(90deg, ${C.accentSoft}, ${C.text})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>{th.line2}</span>
      </div>
      {th.sub && <div style={{ position: 'absolute', left: 96, top: 860, fontFamily: FONT, fontSize: 40, fontWeight: 600, color: C.muted, letterSpacing: 1 }}>{th.sub}</div>}
      {info && (
        <div style={{ position: 'absolute', left: 990, top: 300, width: ww, height: wh + win.bar * 0.6, transform: 'rotate(-4deg)', transformOrigin: 'left top', borderRadius: win.radius, overflow: 'hidden', background: '#fff', boxShadow: `0 40px 110px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.12), 0 0 130px ${rgba(C.accent, 0.3)}` }}>
          <div style={{ height: win.bar * 0.6, background: `linear-gradient(180deg, ${win.titleBar[0]}, ${win.titleBar[1]})`, display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 14 }}>
            {win.lights.map((c) => <div key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c }} />)}
          </div>
          <OffthreadVideo src={staticFile(`clips/${th.clip}.mp4`)} muted startFrom={sec(rv(th.v, info, th.clip))} style={{ width: ww, height: wh, objectFit: 'cover' }} />
        </div>
      )}
    </AbsoluteFill>
  );
};
