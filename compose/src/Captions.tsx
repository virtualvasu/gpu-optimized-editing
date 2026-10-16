import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { C, FONT, FPS, TH, W } from './theme';

export type Word = { t: string; s: number; e: number };
export type Chunk = { words: Word[] };

export const buildChunks = (blocks: { start: number; words: Word[] }[]): Chunk[] => {
  const out: Chunk[] = [];
  for (const b of blocks) {
    let cur: Word[] = [];
    const flush = () => { if (cur.length) { out.push({ words: cur.map((w) => ({ ...w, s: w.s + b.start, e: w.e + b.start })) }); cur = []; } };
    b.words.forEach((w) => {
      cur.push(w);
      if (/[.?!:;]$/.test(w.t) || (/,$/.test(w.t) && cur.length >= 4) || cur.length >= 9) flush();
    });
    flush();
  }
  return out;
};

// Word-synced captions (timings come straight from the voice engine, so they're exact — no speech recognition).
export const Captions: React.FC<{ chunks: Chunk[]; hidden?: (t: number) => number }> = ({ chunks, hidden }) => {
  const t = useCurrentFrame() / FPS;
  const ch = chunks.find((c) => t >= c.words[0].s - 0.1 && t <= c.words[c.words.length - 1].e + 0.5);
  if (!ch) return null;
  const a0 = ch.words[0].s, a1 = ch.words[ch.words.length - 1].e;
  const o = interpolate(t, [a0 - 0.1, a0 + 0.12, a1 + 0.25, a1 + 0.5], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * (hidden ? hidden(t) : 1);
  if (o <= 0.01) return null;
  return (
    <div style={{ position: 'absolute', left: (W - TH.captions.width) / 2, width: TH.captions.width, top: TH.captions.top, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: o, transform: `translateY(${(1 - o) * 6}px)` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 12px', fontFamily: FONT, fontSize: TH.captions.size, fontWeight: 600, lineHeight: 1.25, textShadow: '0 2px 14px rgba(0,0,0,.7)' }}>
        {ch.words.map((w, i) => {
          const cur = t >= w.s && t <= w.e + 0.04, past = t > w.e + 0.04;
          return (
            <span key={i} style={{ color: cur ? C.accentSoft : past ? C.text : 'rgba(255,255,255,.42)', transform: cur ? 'translateY(-1px)' : 'none', textShadow: cur ? `0 0 18px ${C.accent}, 0 2px 14px rgba(0,0,0,.7)` : undefined }}>{w.t}</span>
          );
        })}
      </div>
    </div>
  );
};
