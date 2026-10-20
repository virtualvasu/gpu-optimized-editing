// Picture-led pacing. A scene is a list of BEATS: "at clip time v, the narrator starts this sentence".
// The screen travels between beats at a comfortable speed (dead waits are fast-forwarded); if a sentence is longer than the
// screen action, the picture holds; if the screen action is longer than the sentence, silence lets the UI breathe.
export type Word = { t: string; s: number; e: number };
export type Blk = { id: string; duration: number; words: Word[] };
export type Seg = { at: number; from: number; dur: number; rate?: number; freeze?: boolean; hold?: boolean };
export type Beat = { b: string; w: string; n?: number; v: number; rate?: number; waits?: [number, number, number][] };
export type Phrase = { b: string; A: number; a0: number; a1: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '');
/** time (s) in the audio block of the first word of `needle` (space-separated phrase allowed), nth occurrence */
export const wordTime = (b: Blk, needle: string, nth = 0): number => {
  const toks = needle.split(/\s+/).map(norm).filter(Boolean);
  const ws = b.words.map((w) => norm(w.t));
  const hits: number[] = [];
  for (let i = 0; i + toks.length <= ws.length; i++) if (toks.every((t, k) => ws[i + k].startsWith(t))) hits.push(i);
  const i = hits[nth] ?? hits[hits.length - 1];
  if (i === undefined) throw new Error(`"${needle}" not found in block ${b.id}`);
  return b.words[i].s;
};

// Voice-first scheduling: narration is never paused inside a sentence: the picture is sped up or held
// to fit the voice instead. Cuts fall in the silence between two words, never on a word's first sound.
/** the cut point before `needle`: halfway through the silence that precedes it (0 for the block's first word) */
export const cutTime = (b: Blk, needle: string, nth = 0): number => {
  const s = wordTime(b, needle, nth), i = b.words.findIndex((w) => w.s === s);
  return i <= 0 ? 0 : (b.words[i - 1].e + s) / 2;
};
const endsSentence = (b: Blk, a1: number) => { const w = [...b.words].reverse().find((x) => x.s < a1); return !!w && /[.?!:]$/.test(w.t); };

export function schedule(beats: Beat[], blocks: Record<string, Blk>, lead: number, tail: number, clipDur: number, endV: number,
  endRate = 1.5, o: { pause?: number; endHold?: number; a1End?: number; endWaits?: [number, number, number][]; breathe?: boolean; gap?: number } = {}) {
  const MAXP = o.pause ?? 0.8, ENDH = o.endHold ?? 1.5, GAP = o.gap ?? 0;   // GAP: the least silence after a sentence / block
  const segs: Seg[] = [], phrases: Phrase[] = [];
  const ph = beats.map((bt, i) => {
    const blk = blocks[bt.b], nx = beats[i + 1];
    const a0 = cutTime(blk, bt.w, bt.n ?? 0);
    const a1 = nx && nx.b === bt.b ? cutTime(blk, nx.w, nx.n ?? 0) : (o.a1End ?? blk.duration);
    const kind = !nx || nx.b !== bt.b ? 'end' : endsSentence(blk, a1) ? 'sentence' : 'flow';
    return { b: bt.b, a0, a1, kind };
  });
  let A = lead;
  for (let i = 0; i < beats.length; i++) {
    const p = ph[i], nx = beats[i + 1];
    phrases.push({ b: p.b, a0: p.a0, a1: p.a1, A });
    const v0 = beats[i].v, v1 = Math.min(clipDur - 0.05, nx ? nx.v : endV), rate = (nx ? nx.rate : endRate) ?? 1.4, waits = (nx ? nx.waits : o.endWaits) ?? [];
    const cuts = [v0, v1, ...waits.flatMap(([a, b]) => [a, b])].filter((x) => x >= v0 && x <= v1).sort((x, y) => x - y);
    const pieces: { from: number; to: number; r: number }[] = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1]; if (b - a < 0.02) continue;
      const w = waits.find(([x, y]) => a >= x - 0.01 && b <= y + 0.01);
      pieces.push({ from: a, to: b, r: w ? w[2] : rate });
    }
    const N = pieces.reduce((s, q) => s + (q.to - q.from) / q.r, 0);
    const dur = p.a1 - p.a0;
    if (o.calm && p.kind !== 'flow') {
      // Calm pacing (owner, 2026-10-20: relaxed, one thing at a time): the sentence is spoken while the picture rests on the highlighted
      // element; THEN the step (click, typing, loading) plays with no narration, at a followable speed (at most maxRate, 3x). A very long
      // silent step (more than maxStep seconds) is sped up just enough, never more than 2x on top.
      const cap = o.maxRate ?? 3, ps = pieces.map((q) => ({ ...q, r: Math.min(q.r, cap) }));
      const Nc = ps.reduce((a, q) => a + (q.to - q.from) / q.r, 0), k = Nc > (o.maxStep ?? 14) ? Math.min(Nc / (o.maxStep ?? 14), 2) : 1;
      segs.push({ at: A, from: v0, dur, freeze: true, hold: true });   // hold: the sentence is spoken over this still picture
      let t = A + dur;
      for (const q of ps) { const d = (q.to - q.from) / (q.r * k); segs.push({ at: t, from: q.from, dur: d, rate: q.r * k }); t += d; }
      segs.push({ at: t, from: v1, dur: GAP, freeze: true });
      A = t + GAP;
      continue;
    }
    const D = p.kind === 'flow' ? (o.breathe ? Math.max(N, dur) : dur) : p.kind === 'sentence' ? Math.min(Math.max(N, dur + GAP), dur + MAXP) : Math.min(Math.max(N, dur + Math.max(GAP, 0.3)), dur + ENDH);
    const scale = N > 0 ? Math.min(D / N, 1.25) : 1;   // <1 speeds the picture up to fit the voice; >1 slows it gently, then holds
    let t = A;
    for (const q of pieces) { const d = ((q.to - q.from) / q.r) * scale; segs.push({ at: t, from: q.from, dur: d, rate: q.r / scale }); t += d; }
    if (A + D - t > 0.02) segs.push({ at: t, from: v1, dur: A + D - t, freeze: true });
    A += D;
  }
  const len = A + tail;
  segs.push({ at: A, from: Math.min(clipDur - 0.05, endV), dur: tail, freeze: true });
  if (lead > 0.02) segs.unshift({ at: 0, from: beats[0].v, dur: lead, freeze: true });
  const out: Seg[] = [];
  for (const s of segs) {
    const q = out[out.length - 1];
    if (q && q.freeze && s.freeze && !q.hold && !s.hold && Math.abs(q.from - s.from) < 0.05) { q.dur += s.dur; continue; }
    if (q && !q.freeze && !s.freeze && Math.abs((q.rate ?? 1) - (s.rate ?? 1)) / Math.max(q.rate ?? 1, s.rate ?? 1) < 0.15 && Math.abs(q.from + q.dur * (q.rate ?? 1) - s.from) < 0.3) {
      const dv = q.dur * (q.rate ?? 1) + s.dur * (s.rate ?? 1); q.dur += s.dur; q.rate = dv / q.dur; continue;
    }
    out.push({ ...s });
  }
  return { segs: out, phrases, len };
}
