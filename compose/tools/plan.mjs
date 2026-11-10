#!/usr/bin/env node
// plan.json -> cuts.json + storyboard.json   (run through `vep plan <ep>`)
//
// plan.json (in the episode folder) says, scene by scene, what the video shows and which narration block is spoken over it.
// A `screen` scene lists `shots`: { b: "<narration block>", raw: [from, to] | [[from, to], ...] } = the raw-recording time ranges
// (seconds) shown while that block is spoken; the ranges of all shots become ONE trimmed clip (the dead air is simply not listed),
// and a beat is written for every shot so the picture follows the voice. Every other scene is passed through to the storyboard
// untouched (title, project scenes such as problem / graph / stats, end ...).
//
//   { "source": "raw/recording.mp4", "crop": [x, y, w, h], "labels": [...], "pacing": "voice", "music": 0.3, "thumb": {...},
//     "scenes": [ { "type": "problem", "id": "problem", "blocks": ["n01"], ... },
//                 { "type": "screen", "id": "master", "chapter": 2, "shots": [ { "b": "n05", "raw": [94, 104] }, ... ], "hl": [], "overlays": [] } ] }
import fs from 'fs';
import path from 'path';

const dir = path.resolve(process.argv[2] || '.');
const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const plan = J('plan.json'), narr = J('narration.json');
const text = Object.fromEntries(narr.blocks.map((b) => [b.id, b.text]));
const firstWord = (id) => {
  if (text[id] == null) throw new Error(`plan: narration block "${id}" does not exist in narration.json`);
  const t = text[id].replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, '$1');
  const m = t.match(/[A-Za-z0-9_']+/); if (!m) throw new Error(`plan: block ${id} has no words`); return m[0];
};

const ranges = (r) => (typeof r[0] === 'number' ? [r] : r);
const clips = [], scenes = [];
let n = 0;
for (const sc of plan.scenes) {
  if (sc.type !== 'screen' || !sc.shots) { scenes.push(sc); continue; }
  n++;
  const name = `${String(n).padStart(2, '0')}-${sc.id}`, keep = [], beats = [];
  let off = 0;
  const pills = [];   // a shot's `label: { text, sub }` becomes a floating label pill when its sentence starts
  for (const shot of sc.shots) {
    const rs = ranges(shot.raw);
    if (shot.b && shot.label) pills.push({ kind: 'pill', b: shot.b, w: shot.w || firstWord(shot.b), off: 0.25, dur: shot.label.dur ?? 5.5, text: shot.label.text, ...(shot.label.sub ? { sub: shot.label.sub } : {}) });
    if (shot.b) beats.push({ b: shot.b, w: shot.w || firstWord(shot.b), v: +off.toFixed(2), ...(shot.rate ? { rate: shot.rate } : {}) });
    for (const [a, b] of rs) { if (!(b > a)) throw new Error(`plan: scene ${sc.id}: range ${a}-${b} is empty`); keep.push([a, b]); off += b - a; }
  }
  const { shots, ...rest } = sc;
  clips.push({ name, keep });
  scenes.push({ ...rest, overlays: [...(rest.overlays || []), ...pills], clip: name, beats, endV: +off.toFixed(2), endRate: sc.endRate ?? 1.5, lead: sc.lead ?? 0.5, tail: sc.tail ?? 1.0 });
}
fs.writeFileSync(path.join(dir, 'cuts.json'), JSON.stringify({ source: plan.source, crop: plan.crop, clips }, null, 1));
const { source, crop, scenes: _s, ...sb } = plan;
fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ pacing: 'voice', ...sb, scenes }, null, 1));
const total = clips.reduce((t, c) => t + c.keep.reduce((s, [a, b]) => s + b - a, 0), 0);
console.log(`plan: ${scenes.length} scenes, ${clips.length} clips cut from ${plan.source} (${total.toFixed(0)} s of footage kept)`);
