// Shared tool for storyboard episodes (replaces the per-episode dry-*.mjs / srt-*.mjs / clip-scaling lines).
//   node tools/story.mjs prep <ep> <clips dir>     pre-scale the recorder's clips to 1600x900 into public/clips-<ep>/ and write clips.json
//                                                  (duration + the recorder's marks, which storyboards use as "mark:<label>")
//   node tools/story.mjs dry  <ep>                 print the timeline without rendering (a thrown error names a bad word/mark)
//   node tools/story.mjs srt  <ep> <out.srt>       captions from the same word timings the video uses
import { buildSync } from 'esbuild';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [cmd, ep, arg] = process.argv.slice(2);
if (!cmd || !ep) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 6).join('\n')); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = (...p) => path.join(root, 'public', ...p);

if (cmd === 'prep') {
  const src = path.resolve(arg), out = pub(`clips-${ep}`);
  fs.mkdirSync(out, { recursive: true });
  const info = {};
  for (const f of fs.readdirSync(src).filter((x) => /^\d.*\.mp4$/.test(x)).sort()) {
    const name = f.replace(/\.mp4$/, '');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(src, f), '-vf', 'scale=1600:900:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.35:5:5:0.0',
      '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, f)]);
    const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(out, f)]).toString());
    const am = path.join(src, name + '.actions.json');
    const marks = {}, boxes = {};
    if (fs.existsSync(am)) for (const a of JSON.parse(fs.readFileSync(am)).actions) { marks[a.label] = a.t; if (a.box) boxes[a.label] = a.box; }
    info[name] = { dur: +dur.toFixed(3), marks, boxes };
    console.log(name, dur.toFixed(2) + 's', Object.keys(marks).length + ' marks');
  }
  fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify(info, null, 1));
  process.exit(0);
}

const r = buildSync({ entryPoints: [path.join(root, 'src/story/timeline.ts')], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.json': 'json', '.tsx': 'tsx' }, external: ['react', 'react-dom', 'remotion', '@remotion/*'], logLevel: 'error' });
const tmp = path.join(root, `.story_${ep}.mjs`);
fs.writeFileSync(tmp, r.outputFiles[0].text);
try {
  const m = await import(tmp + '?x=' + Date.now());
  const sb = JSON.parse(fs.readFileSync(path.join(root, 'episodes', ep, 'storyboard.json')));
  const blocks = JSON.parse(fs.readFileSync(pub('audio', ep, 'blocks.json')));
  const clips = JSON.parse(fs.readFileSync(pub(`clips-${ep}`, 'clips.json')));
  const { BLOCKS, TIMELINE, TOTAL } = m.buildTimeline(sb, blocks, clips);
  if (cmd === 'dry') {
    console.log('TOTAL', TOTAL.toFixed(1), 's =', Math.floor(TOTAL / 60) + ':' + String(Math.round(TOTAL % 60)).padStart(2, '0'));
    for (const s of TIMELINE) console.log(s.id.padEnd(10), s.type.padEnd(10), String(+s.start.toFixed(2)).padStart(7), String(+s.len.toFixed(2)).padStart(7));
  } else if (cmd === 'srt') {
    const chunks = [];
    for (const sc of TIMELINE) for (const p of sc.phrases) {
      let cur = [];
      const flush = () => { if (cur.length) { chunks.push(cur); cur = []; } };
      for (const w of BLOCKS[p.b].words.filter((w) => w.s >= p.a0 - 0.06 && w.s < p.a1 + 0.06)) {
        cur.push({ t: w.t, s: w.s + sc.start + p.A - p.a0, e: w.e + sc.start + p.A - p.a0 });
        if (/[.?!:;]$/.test(w.t) || (/,$/.test(w.t) && cur.length >= 4) || cur.length >= 9) flush();
      }
      flush();
    }
    const ts = (x) => { const h = Math.floor(x / 3600), mi = Math.floor((x % 3600) / 60), s = Math.floor(x % 60), ms = Math.round((x % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
    fs.writeFileSync(arg, chunks.map((c, i) => `${i + 1}\n${ts(c[0].s)} --> ${ts(c[c.length - 1].e + 0.2)}\n${c.map((w) => w.t).join(' ')}\n`).join('\n'));
    console.log(chunks.length, 'caption lines ->', arg);
  } else throw new Error('unknown command ' + cmd);
} finally { fs.unlinkSync(tmp); }
