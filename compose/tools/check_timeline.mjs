// Timeline QA for a packed episode: node check_timeline.mjs <job dir>   (run through `vep check <ep>`, which packs first)
//  1. every voice phrase is a whole sentence (starts where a sentence starts, ends where one ends): the narrator is never cut off
//  2. the gaps between sentences (min / max, and the longest ones)
//  3. picture speed: how long each scene spends above 3x
//  4. captions: every caption lies inside a voice phrase (the captions and the voice use the same timeline)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname)), COMPOSE = path.resolve(HERE, '..');
const require = createRequire(path.join(COMPOSE, 'package.json'));
const job = path.resolve(process.argv[2] || '.');
const r = require('esbuild').buildSync({ entryPoints: [path.join(COMPOSE, 'src/story/timeline.ts')], bundle: true, write: false, format: 'esm', platform: 'node', external: ['react', 'react-dom', 'remotion', '@remotion/*'], logLevel: 'error' });
const tmp = path.join(COMPOSE, `.check-${process.pid}.mjs`); fs.writeFileSync(tmp, r.outputFiles[0].text);
const m = await import(tmp); fs.unlinkSync(tmp);
const P = JSON.parse(fs.readFileSync(path.join(job, 'props.json'), 'utf8'));
const t = m.buildTimeline(P.storyboard, P.blocks, P.clips), B = m.glueBlocks(P.blocks);

const ends = (w) => /[.?!]$/.test(w.t);
let bad = 0; const all = [];
for (const sc of t.TIMELINE) for (const p of sc.phrases) {
  const ws = B[p.b].words, first = ws.findIndex((w) => w.s >= p.a0 - 0.06), last = ws.length - 1 - [...ws].reverse().findIndex((w) => w.s < p.a1 + 0.06 && w.s >= p.a0 - 0.06);
  const startsSentence = first <= 0 || ends(ws[first - 1]), endsSentence = last >= ws.length - 1 || ends(ws[last]);
  all.push({ sc: sc.id, b: p.b, s: sc.start + p.A, e: sc.start + p.A + (p.a1 - p.a0), cutAfter: !endsSentence, first: ws[first]?.t, last: ws[last]?.t });
}
all.sort((x, y) => x.s - y.s);
// A phrase boundary inside a sentence is fine when the next phrase starts right where this one ends (the picture is cued to a word, the
// voice runs on without a pause); it is a CUT SENTENCE only when the voice stops there (a gap of more than 0.06 s).
for (let i = 0; i < all.length; i++) {
  const p = all[i], q = all[i + 1];
  if (p.cutAfter && !(q && q.b === p.b && q.s - p.e <= 0.06)) { bad++; console.log(`CUT SENTENCE  scene ${p.sc} block ${p.b}: "${p.first} … ${p.last}"`); }
}
// phrases that run on without a pause are one stretch of voice for the caption check
for (let i = all.length - 1; i > 0; i--) if (all[i].b === all[i - 1].b && all[i].s - all[i - 1].e <= 0.06) { all[i - 1].e = all[i].e; all.splice(i, 1); }
const gaps = [];
for (let i = 1; i < all.length; i++) gaps.push([`${all[i - 1].b}→${all[i].b}`, all[i].s - all[i - 1].e]);
console.log(`sentences cut: ${bad}  |  phrases: ${all.length}`);
if (gaps.length) console.log(`gaps between sentences: min ${Math.min(...gaps.map((g) => g[1])).toFixed(2)}s, max ${Math.max(...gaps.map((g) => g[1])).toFixed(2)}s; longest: ` + [...gaps].sort((a, b) => b[1] - a[1]).slice(0, 5).map((g) => `${g[0]} ${g[1].toFixed(1)}s`).join(', '));
for (const sc of t.TIMELINE) if (sc.segs) {
  const fast = sc.segs.filter((s) => !s.freeze && (s.rate || 1) > 3), ft = fast.reduce((a, s) => a + s.dur, 0);
  if (fast.length) console.log(`FAST ${sc.id}: ${ft.toFixed(1)}s of ${sc.len.toFixed(1)}s above 3x (max ${Math.max(...fast.map((s) => s.rate)).toFixed(1)}x)  [clip s: ${fast.map((s) => `${s.from.toFixed(1)}-${(s.from + s.dur * s.rate).toFixed(1)} at ${s.rate.toFixed(0)}x`).join(', ')}]`);
}
const srt = fs.existsSync(path.join(job, 'captions.srt')) ? fs.readFileSync(path.join(job, 'captions.srt'), 'utf8') : '';
const tsec = (x) => { const [h, mi, s] = x.split(':'); return +h * 3600 + +mi * 60 + +s.replace(',', '.'); };
let off = 0, n = 0;
for (const mm of srt.matchAll(/(\d\d:\d\d:\d\d,\d+) --> (\d\d:\d\d:\d\d,\d+)/g)) {
  n++; const a = tsec(mm[1]), b = tsec(mm[2]);
  if (!all.some((p) => a >= p.s - 0.2 && b <= p.e + 0.45)) { off++; console.log(`CAPTION outside the voice: ${mm[1]} → ${mm[2]}`); }
}
console.log(`captions: ${n}, outside the voice: ${off}  |  total ${t.TOTAL.toFixed(1)}s = ${Math.floor(t.TOTAL / 60)}:${String(Math.round(t.TOTAL % 60)).padStart(2, '0')}`);
process.exit(bad || off ? 1 : 0);
