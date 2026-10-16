import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, TH, W, H, rgba } from './theme';

// A continuous "trace tape" — faint, endlessly scrolling log lines — runs behind every scene so the video never
// cuts to a different background: scenes flow over one living surface. Transitions briefly boost its speed + glow.
// The lines are the theme's `backdrop.lines`: [type, process, message, tone?] (tone red|green; default from the message).
const ROW = 30, N = 64, BLOCK = ROW * N;

function lines(pool: string[][]) {
  let seed = 14, t = 23 * 3600 + 24 * 60;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return Array.from({ length: N }, (_, i) => {
    t += 1 + Math.floor(rnd() * 5);
    const [type, proc, msg, tone0] = pool[Math.floor(rnd() * pool.length)];
    const hh = String(Math.floor(t / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(t / 60) % 60).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
    const tone = tone0 ?? (/not_found|error/.test(msg) ? 'red' : /found/.test(msg) ? 'green' : 'base');
    return { i, ts: `${hh}:${mm}:${ss}`, type, proc, msg, tone };
  });
}

export const Backdrop: React.FC<{ boosts: number[]; total: number }> = ({ boosts, total }) => {
  const frame = useCurrentFrame();
  const L = useMemo(() => lines(TH.backdrop.lines), []);
  // integrate scroll speed so boosts accelerate smoothly instead of jumping
  const pos = useMemo(() => {
    const a = new Float32Array(total + 2); let p = 0;
    for (let f = 0; f <= total; f++) {
      let b = 0; for (const c of boosts) b += Math.exp(-(((f - c) / 20) ** 2));
      p += 0.5 + 7 * Math.min(1, b); a[f] = p;
    }
    return a;
  }, [boosts, total]);
  const glow = (() => { let b = 0; for (const c of boosts) b += Math.exp(-(((frame - c) / 26) ** 2)); return Math.min(1, b); })();
  const y = -(pos[Math.min(frame, total)] % BLOCK);
  const drift = Math.sin(frame / 140), drift2 = Math.cos(frame / 190);
  const col = (tone: string) => (tone === 'red' ? C.red : tone === 'green' ? C.green : C.muted);
  const op = (tone: string) => (tone === 'base' ? 0.06 : 0.14);
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBot} 100%)`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, WebkitMaskImage: 'radial-gradient(ellipse 95% 90% at 50% 50%, rgba(0,0,0,.28) 0%, rgba(0,0,0,.85) 55%, transparent 100%)', maskImage: 'radial-gradient(ellipse 95% 90% at 50% 50%, rgba(0,0,0,.28) 0%, rgba(0,0,0,.85) 55%, transparent 100%)' }}>
        {[0, 1].map((k) => (
          <div key={k} style={{ position: 'absolute', left: 70, top: 0, transform: `translateY(${y + k * BLOCK}px)`, fontFamily: MONO, fontSize: 17, whiteSpace: 'nowrap' }}>
            {L.map((l) => (
              <div key={l.i} style={{ height: ROW, lineHeight: `${ROW}px`, opacity: op(l.tone), color: col(l.tone) }}>
                <span style={{ display: 'inline-block', width: 110 }}>{l.ts}</span>
                <span style={{ display: 'inline-block', width: 130 }}>{l.type}</span>
                <span style={{ display: 'inline-block', width: 250 }}>{l.proc}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: W * 0.2 + drift * 120, top: H * 0.05 + drift2 * 70, width: 1100, height: 1100, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(C.accent, 0.2 + 0.2 * glow)} 0%, transparent 62%)`, filter: 'blur(30px)' }} />
      <div style={{ position: 'absolute', left: W * 0.52 - drift2 * 110, top: H * 0.38 + drift * 80, width: 900, height: 900, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(C.accentDeep, 0.22 + 0.16 * glow)} 0%, transparent 60%)`, filter: 'blur(40px)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
    </div>
  );
};
