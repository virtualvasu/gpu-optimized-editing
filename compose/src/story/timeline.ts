// Generic episode timeline: storyboard.json + narration blocks + clip info -> scenes laid out in time. Pure (no React), so the
// composition (Story.tsx) and the node tools (tools/story.mjs: dry, srt) share it. The storyboard is data; see ../../README.md.
import { Blk, Phrase, Seg, schedule, wordTime } from '../fit';
import { C } from '../theme';

export type ClipInfo = { dur: number; marks: Record<string, number>; boxes?: Record<string, [number, number, number, number]> };
export type Storyboard = { labels: string[]; scenes: any[]; music?: number; thumb?: any; pacing?: 'voice' | 'picture' };
export type Timed = { id: string; type: string; start: number; len: number; phrases: Phrase[]; segs: Seg[] | null; [k: string]: any };

const OVERLAP = 0.7, GAP = 0.5;
// Pacing (storyboard `pacing`): 'voice' = a sentence is always spoken in one go (the picture is sped up or held to fit it); the
// NEXT sentence starts only when the picture has shown what the last one said, plus a short gap (0.55 s). 'picture' = the voice
// also waits inside a sentence for the screen (hiccups). Cue the picture at sentence starts only. 'voice' is what tutorials use.
const PACING: Record<string, any> = { calm: { pause: 99, endHold: 99, breathe: false, gap: 0.55, calm: true, maxRate: 3, maxStep: 18 }, voice: { pause: 99, endHold: 99, breathe: false, gap: 0.55 }, picture: { pause: 99, endHold: 99, breathe: true } };

/** A clip time in a storyboard is a number of seconds, or "mark:<label>[+/-seconds]" taken from the recorder's marks. */
export const rv = (x: any, info: ClipInfo, clip: string): number => {
  if (typeof x === 'number') return x;
  const m = /^mark:(.+?)(?:([+-]\d+(?:\.\d+)?))?$/.exec(String(x));
  if (!m || info.marks[m[1]] === undefined) throw new Error(`clip ${clip}: unknown time "${x}" (marks: ${Object.keys(info.marks).join(', ')})`);
  return info.marks[m[1]] + (m[2] ? parseFloat(m[2]) : 0);
};

// glue a lone punctuation token to the word before it (voice engines sometimes return "." on its own)
export const glueBlocks = (blocks: Record<string, any>): Record<string, Blk> => Object.fromEntries(Object.entries(blocks).map(([k, b]) => {
  const words: any[] = [];
  for (const w of b.words) {
    if (/^[.,;:!?]+$/.test(w.t) && words.length) { const p = words[words.length - 1]; p.t += w.t; p.e = Math.max(p.e, w.e); } else words.push({ ...w });
  }
  return [k, { ...b, words }];
}));

export const sceneTime = (segs: Seg[], v: number) => {
  let best = segs[0]?.at ?? 0;
  for (const s of segs) {
    if (s.hold && Math.abs(v - s.from) <= 0.01) return s.at;   // a still picture at v: the moment it first shows (calm pacing holds before it moves)
    const r = s.rate || 1, v0 = s.from, v1 = s.freeze ? s.from : s.from + s.dur * r;
    if (!s.freeze && v >= v0 - 0.01 && v <= v1 + 0.01) return s.at + (v - v0) / r;
    if (v >= v0) best = s.at + (s.freeze ? 0 : s.dur);
  }
  return best;
};

/** clip time (s) shown at scene time t (inverse of sceneTime) */
export const clipTime = (segs: Seg[], t: number) => {
  for (const s of segs) if (t >= s.at - 0.001 && t <= s.at + s.dur + 0.001) return s.freeze ? s.from : s.from + (t - s.at) * (s.rate || 1);
  return segs[segs.length - 1].from;
};

export function buildTimeline(sb: Storyboard, rawBlocks: Record<string, any>, clips: Record<string, ClipInfo>) {
  const BLOCKS = glueBlocks(rawBlocks);
  const out: Timed[] = [];
  let prevEnd = 0;
  sb.scenes.forEach((sc0, i) => {
    const sc = { ...sc0 };
    const start = i === 0 ? 0 : prevEnd - OVERLAP;
    let len = sc.len ?? 0, phrases: Phrase[] = [], segs: Seg[] | null = null;
    if (sc.type === 'screen') {
      const info = clips[sc.clip];
      if (!info) throw new Error(`scene ${sc.id}: no clip info for "${sc.clip}" (run: vep prep <episode>)`);
      const R = (x: any) => rv(x, info, sc.clip);
      const beats = sc.beats.map((b: any) => ({ ...b, v: R(b.v), waits: b.waits?.map(([a, z, r]: any) => [R(a), R(z), r]) }));
      const endWaits = sc.endWaits?.map(([a, z, r]: any) => [R(a), R(z), r]);
      const r = schedule(beats, BLOCKS, sc.lead ?? 0.6, sc.tail ?? 1.2, info.dur, R(sc.endV), sc.endRate ?? 1.2, { ...(PACING[sb.pacing ?? 'picture'] ?? PACING.picture), endWaits });
      len = r.len; segs = r.segs; phrases = r.phrases;
      sc.zv = sc.zv?.map((k: any) => ({ ...k, v: R(k.v) }));
      // overlays: v (clip time) or b+w (a spoken word); a callout may name a recorded `focus` box (its time defaults to that mark);
      // callout lines and step ticks take their own v or b+w
      const cue = (x: any) => (x.v != null ? { ...x, v: R(x.v) } : x);
      sc.overlays = sc.overlays?.map((o0: any) => {
        const o = cue(o0);
        if (o.kind === 'callout') {
          o.box = o.box ?? info.boxes?.[o.focus];
          if (!o.box) throw new Error(`scene ${sc.id}: callout "${o.focus}" has no box (record it with a focus step, or give "box")`);
          if (o.v == null) o.v = R(`mark:${o.focus}`);   // with a word (b + w) as well, it lands at the word but never before its mark is on screen
          o.lines = o.lines?.map((l: any) => cue(typeof l === 'string' ? { text: l } : l));
        }
        if (o.ticks) o.ticks = o.ticks.map(cue);
        return o;
      });
      // highlights: { focus: "<mark label with a recorded box>" } or { box: [x,y,w,h] }, plus v (clip time, default = the mark) or
      // b+w (a spoken word), and dur
      sc.hl = sc.hl?.map((h: any) => {
        const box = h.box ?? info.boxes?.[h.focus];
        if (!box) throw new Error(`scene ${sc.id}: highlight "${h.focus}" has no box (record it with a focus step, or give "box")`);
        // a box tied to a word (b + w [+ n]) lands when the narrator says that word; with a mark (focus or v) as well it is never
        // shown before the picture has reached that mark, so it cannot sit on an element that is not on screen yet
        if (h.b != null) return { b: h.b, w: h.w, n: h.n, off: h.off, dur: h.dur ?? 7, box, ...(h.focus != null || h.v != null ? { v: R(h.v ?? `mark:${h.focus}`) } : {}) };
        return { v: R(h.v ?? `mark:${h.focus}`), dur: h.dur ?? 3, box };
      });
    } else if (sc.blocks) {
      let cur = sc.lead ?? 0.7;
      for (const b of sc.blocks as string[]) {
        if (!BLOCKS[b]) throw new Error(`scene ${sc.id}: narration block "${b}" not found`);
        phrases.push({ b, A: cur, a0: 0, a1: BLOCKS[b].duration }); cur += BLOCKS[b].duration + GAP;
      }
      len = cur - GAP + (sc.tail ?? 1.0);
    }
    out.push({ ...sc, start, len, phrases, segs });
    prevEnd = start + len;
  });
  const last = out[out.length - 1];
  return { BLOCKS, TIMELINE: out, TOTAL: last.start + last.len };
}

/** scene-relative time (s) at which the nth occurrence of a word is heard in a block */
export const at = (BLOCKS: Record<string, Blk>, sc: Timed, b: string, w: string, n = 0) => {
  const ws = wordTime(BLOCKS[b], w, n);
  const ph = sc.phrases.find((p) => p.b === b && ws >= p.a0 - 0.06 && ws < p.a1 + 0.06) ?? sc.phrases.find((p) => p.b === b);
  if (!ph) throw new Error(`scene ${sc.id}: block ${b} is not spoken in this scene`);
  return ph.A + (ws - ph.a0);
};

/** scene-relative time (s) at which the sentence containing the nth occurrence of a word has been spoken */
export const sentenceEnd = (BLOCKS: Record<string, Blk>, sc: Timed, b: string, w: string, n = 0) => {
  const ws = wordTime(BLOCKS[b], w, n), words = BLOCKS[b].words;
  const ph = sc.phrases.find((p) => p.b === b && ws >= p.a0 - 0.06 && ws < p.a1 + 0.06) ?? sc.phrases.find((p) => p.b === b)!;
  let i = words.findIndex((x) => x.s === ws);
  while (i < words.length - 1 && !/[.?!:]$/.test(words[i].t)) i++;
  return ph.A + (Math.min(words[i].e, ph.a1) - ph.a0);
};

const color = (c: string) => ({ red: C.red, green: C.green, amber: C.amber, accent: C.accentSoft } as Record<string, string>)[c] ?? c;

/** zoom keys and overlays of a screen scene, in scene time */
export const prepScreen = (BLOCKS: Record<string, Blk>, sc: Timed) => {
  const T = (x: any) => (x.v != null ? sceneTime(sc.segs!, x.v) : at(BLOCKS, sc, x.b, x.w, x.n ?? 0)) + (x.off ?? 0);
  return {
    // A cued box (v) has its `dur` in recording time: a step played at 4x must not keep its box for dur *output* seconds, so the end is
    // sceneTime(v + dur). A box tied to a word (b + w) lands when the narrator says the word (not before its mark is on screen) and
    // goes when that sentence is finished (+0.5 s). A box never outlives the start of the next box of the scene (no stacked dimming).
    highlights: (() => {
      const hs = (sc.hl || []).map((h: any) => {
        const word = h.b != null ? at(BLOCKS, sc, h.b, h.w, h.n ?? 0) + (h.off ?? 0) : undefined;
        const mark = h.v != null ? sceneTime(sc.segs!, h.v) : undefined;
        return { h, word, mark, at: Math.max(word ?? 0, mark ?? 0) };
      });
      return hs.map(({ h, at: a, word, mark }: any) => {
        let end = h.v != null ? sceneTime(sc.segs!, h.v + h.dur) : a + h.dur;
        if (word !== undefined) end = Math.min(end, a + h.dur, sentenceEnd(BLOCKS, sc, h.b, h.w, h.n ?? 0) + 0.5);
        const next = hs.map((x: any) => x.at).filter((t: number) => t > a + 0.05).sort((x: number, y: number) => x - y)[0];
        if (next !== undefined) end = Math.min(end, next);
        // calm pacing: the sentence is spoken over a still picture; the box goes the moment that picture starts to move (the click, the page change),
        // so it never floats over a screen that has changed
        const hold = (sc.segs || []).find((q: any) => q.hold && a >= q.at - 0.01 && a < q.at + q.dur - 0.05);
        if (hold) end = Math.min(end, hold.at + hold.dur + 0.05);
        return { at: a, dur: Math.max(0.9, Math.min(h.dur, end - a)), box: h.box, lag: word !== undefined && mark !== undefined ? mark - word : 0, past: h.v != null ? clipTime(sc.segs!, a) - h.v : 0 };   // never longer than the storyboard's dur, only shorter
      });
    })(),
    zooms: (sc.zv || []).map((k: any) => ({ t: sceneTime(sc.segs!, k.v), z: k.z, fx: k.fx, fy: k.fy })),
    overlays: (sc.overlays || []).map((o: any) => {
      // explanatory callouts (owner, 2026-10-20): the card lands when the narrator reaches what it explains (b + w), each of its lines when
      // its own words are said, and it goes shortly after that sentence is finished; never before the mark (focus) is on screen
      const word = o.b != null ? at(BLOCKS, sc, o.b, o.w, o.n ?? 0) + (o.off ?? 0) : undefined;
      const oAt = word !== undefined && o.v != null ? Math.max(word, sceneTime(sc.segs!, o.v)) : T(o);
      const lineAts = (o.lines || []).filter((l: any) => l.v != null || l.b != null).map((l: any) => Math.max(T(l), oAt + 0.55));
      const dur = o.kind === 'callout' && word !== undefined
        ? Math.max(2.5, (lineAts.length ? Math.max(...lineAts) - oAt + 2.2 : 0), Math.min(o.dur ?? 4.5, sentenceEnd(BLOCKS, sc, o.b, o.w, o.n ?? 0) + 1.4 - oAt))   // reading time after the last line
        : o.dur;
      return {
      ...o, dur, color: color(o.color), at: oAt,
      ...(o.lines ? { lines: o.lines.map((l: any) => ({ ...l, color: l.color && color(l.color), at: l.v != null || l.b != null ? Math.max(T(l), oAt + 0.55) : undefined })) } : {}),
      ...(o.ticks ? { ticks: o.ticks.map(T) } : {}),
      };
    }),
  };
};

