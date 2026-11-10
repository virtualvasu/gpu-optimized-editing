#!/usr/bin/env node
// The heavy work, as stateless functions: an input folder in, an output folder out. Nothing else is read or written; temporary
// files go under the output folder's sibling `tmp/` (or $TMPDIR), so deleting the job folder removes every trace. vep runs these
// on this laptop, or sends them to a render machine running worker-server.mjs.
//
//   node worker.mjs scale  <in> <out> '{"w":1600,"h":900}'      in: *.mp4 recordings      → out: same names at w×h + durations.json
//   node worker.mjs render <in> <out> '{"concurrency":8,"gl":"angle","frames":[0,299]}'
//                                                                in: a render job (vep pack) → out: video-FINAL.mp4 + video.srt
//   node worker.mjs frames <in> <out> '{"frames":[900,2400],"thumb":true}'
//                                                                in: a render job            → out: <frame>.png, thumb.png
//
// A render job is a folder: public/ (theme assets, scaled clips, voice), scenes/ (the project's index.tsx, optional), props.json,
// captions.srt. The Remotion bundle is built here (webpack cache off, so nothing is kept in node_modules).
import { createRequire } from 'module';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderJob } from './render-job.mjs';

const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname));
const COMPOSE = path.join(HERE, 'compose');
const require = createRequire(path.join(COMPOSE, 'package.json'));

/** recordings → clips at the theme window size (lanczos, light sharpen, CRF 12) + their durations */
export async function scale(inDir, outDir, { w, h, crf = 12, preset = 'medium' }, log = console.log) {
  fs.mkdirSync(outDir, { recursive: true });
  const durations = {};
  for (const f of fs.readdirSync(inDir).filter((x) => /^\d.*\.mp4$/.test(x)).sort()) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(inDir, f), '-vf', `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.35:5:5:0.0`,
      '-an', '-r', '30', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, f)], { stdio: ['ignore', 'ignore', 'inherit'] });
    durations[f.replace(/\.mp4$/, '')] = +parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(outDir, f)]).toString()).toFixed(3);
    log(`scaled ${f}`);
  }
  fs.writeFileSync(path.join(outDir, 'durations.json'), JSON.stringify(durations, null, 1));
}

/** the job's Remotion bundle, built into tmp (no webpack cache, so the engine folder keeps nothing of the episode) */
async function bundleJob(jobDir, tmp) {
  const { bundle } = require('@remotion/bundler');
  const scenes = path.join(jobDir, 'scenes', 'index.tsx');
  if (fs.existsSync(scenes)) process.env.VEP_SCENES = scenes; else delete process.env.VEP_SCENES;
  process.chdir(COMPOSE);   // webpack-override.cjs resolves the engine from the working folder
  return bundle({ entryPoint: path.join(COMPOSE, 'src/index.ts'), webpackOverride: require(path.join(COMPOSE, 'webpack-override.cjs')),
    publicDir: path.join(jobDir, 'public'), outDir: path.join(tmp, 'bundle'), enableCaching: false });
}

export async function render(jobDir, outDir, { concurrency, gl = null, frames = null, crf, imageFormat, x264Preset } = {}, tmp, log = console.log) {
  const serveUrl = await bundleJob(jobDir, tmp);
  await renderJob(jobDir, outDir, { serveUrl, name: 'video', concurrency: concurrency || os.cpus().length, gl, frames, log, ...(crf != null ? { crf } : {}), ...(imageFormat ? { imageFormat } : {}), ...(x264Preset ? { x264Preset } : {}) });
}

export async function stills(jobDir, outDir, { frames = [], thumb = false, gl = null } = {}, tmp, log = console.log) {
  const { openBrowser, selectComposition, renderStill } = require('@remotion/renderer');
  const serveUrl = await bundleJob(jobDir, tmp);
  const inputProps = JSON.parse(fs.readFileSync(path.join(jobDir, 'props.json'), 'utf8'));
  const chromiumOptions = gl ? { gl } : {};
  const browser = await openBrowser('chrome', { chromiumOptions });
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const shots = [...frames.map((f) => ['Episode', f, `${f}.png`]), ...(thumb ? [['Thumb', 0, 'thumb.png']] : [])];
    const comps = {};
    for (const [id, frame, file] of shots) {
      comps[id] ??= await selectComposition({ serveUrl, id, inputProps, chromiumOptions, puppeteerInstance: browser });
      await renderStill({ serveUrl, composition: comps[id], frame, inputProps, chromiumOptions, puppeteerInstance: browser, output: path.join(outDir, file), overwrite: true });
      log(`still ${file}`);
    }
  } finally { await browser.close({ silent: true }); }
}

// ---------------------------------------------------------------- raw recordings: analyse (ingest) and trim (cut)
const VIDEO = /\.(mp4|mov|mkv|webm)$/i;
const ff = (args) => new Promise((ok, no) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; if (err.length > 4e6) err = err.slice(-2e6); });
  p.on('close', (c) => (c === 0 ? ok(err) : no(new Error(`ffmpeg failed (${c}): ${err.slice(-500)}`))));
});
const probe = (f) => +parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()).toFixed(2);
const pairs = (text, a, b, end) => { const out = []; let s = null; for (const m of text.matchAll(new RegExp(`${a}:\\s*([\\d.]+)|${b}:\\s*([\\d.]+)`, 'g'))) { if (m[1] !== undefined) s = +m[1]; else if (s !== null) { out.push([+s.toFixed(2), +(+m[2]).toFixed(2)]); s = null; } } if (s !== null) out.push([+s.toFixed(2), end]); return out; };

/** raw recordings → what is in them: silences, frozen-picture spans (waiting), scene changes, contact sheets, an audio file for
 *  transcription. Runs on the render machine (decoding a 10-minute recording five ways is the heavy part). */
export async function ingest(inDir, outDir, { every = 10, silenceDb = -35, silenceMin = 0.6, freezeMin = 1.5 } = {}, tmp, log = console.log) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(inDir).filter((x) => VIDEO.test(x)).sort()) {
    const src = path.join(inDir, f), base = f.replace(/\.[^.]+$/, ''), duration = probe(src);
    log(`ingest ${f} (${duration}s)`);
    const label = `drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`;
    const [sil, frz, scn] = await Promise.all([
      ff(['-i', src, '-vn', '-af', `silencedetect=n=${silenceDb}dB:d=${silenceMin}`, '-f', 'null', '-']),
      ff(['-i', src, '-an', '-vf', `fps=10,scale=480:-2,freezedetect=n=0.003:d=${freezeMin}`, '-f', 'null', '-']),
      ff(['-i', src, '-an', '-vf', `fps=4,scale=480:-2,select='gt(scene,0.06)',showinfo`, '-f', 'null', '-']),
      ff(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', path.join(outDir, `${base}.audio.mp3`)]),
      ff(['-i', src, '-an', '-vf', `fps=1/${every},scale=384:216,${label},tile=6x8`, path.join(outDir, `${base}.sheet-%02d.png`)]),
    ]);
    const info = {
      name: base, duration, sheetEvery: every,
      silences: pairs(sil, 'silence_start', 'silence_end', duration),
      freezes: pairs(frz, 'freeze_start', 'freeze_end', duration),
      scenes: [...scn.matchAll(/pts_time:([\d.]+)/g)].map((m) => +(+m[1]).toFixed(2)),
      sheets: fs.readdirSync(outDir).filter((x) => x.startsWith(`${base}.sheet-`)).sort(),
    };
    fs.writeFileSync(path.join(outDir, `${base}.ingest.json`), JSON.stringify(info, null, 1));
    log(`  ${info.freezes.length} frozen spans, ${info.silences.length} silences, ${info.scenes.length} scene changes, ${info.sheets.length} sheets`);
  }
}

/** a cut list → clips: for each clip the kept ranges of the raw recording, cropped to the app window, joined (dead air gone).
 *  Each range is its own seek + encode (fast, constant memory), then the parts are joined without re-encoding. NVENC when the machine has it. */
export async function cut(inDir, outDir, { fps = 30 } = {}, tmp, log = console.log) {
  fs.mkdirSync(outDir, { recursive: true });
  const spec = JSON.parse(fs.readFileSync(path.join(inDir, 'cuts.json'), 'utf8'));
  const nv = /h264_nvenc/.test(execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString());
  const enc = (useNv) => (useNv ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '14', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '12']);
  let useNv = nv;
  const work = path.join(tmp, 'parts');
  fs.mkdirSync(work, { recursive: true });
  for (const c of spec.clips) {
    const src = path.join(inDir, c.src || spec.src), [x, y, w, h] = c.crop || spec.crop || [0, 0, 0, 0];
    const vf = [...(w ? [`crop=${w}:${h}:${x}:${y}`] : []), `fps=${fps}`, 'format=yuv420p'].join(',');
    const parts = [];
    for (const [i, [a, b]] of c.keep.entries()) {
      const part = path.join(work, `${c.name}.${String(i).padStart(3, '0')}.mp4`);
      const args = ['-ss', String(a), '-i', src, '-t', String(+(b - a).toFixed(3)), '-an', '-vf', vf];
      try { await ff([...args, ...enc(useNv), '-movflags', '+faststart', part]); }
      catch (e) { if (!useNv) throw e; log('  NVENC failed, using x264: ' + String(e.message).split('\n')[0]); useNv = false; await ff([...args, ...enc(false), '-movflags', '+faststart', part]); }
      parts.push(part);
    }
    const list = path.join(work, `${c.name}.txt`);
    fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
    await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(outDir, `${c.name}.mp4`)]);
    for (const p of parts) fs.unlinkSync(p);
    log(`cut ${c.name}.mp4 ${probe(path.join(outDir, `${c.name}.mp4`))}s from ${c.keep.length} range(s)${useNv ? ' (nvenc)' : ''}`);
  }
}

export const TASKS = { scale: (i, o, opts, tmp, log) => scale(i, o, opts, log), render, frames: stills, ingest, cut };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  const [task, inDir, outDir, opts = '{}'] = process.argv.slice(2);
  if (!TASKS[task] || !inDir || !outDir) { console.error('usage: node worker.mjs scale|render|frames|ingest|cut <in dir> <out dir> [json options]'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vep-'));
  try { await TASKS[task](path.resolve(inDir), path.resolve(outDir), JSON.parse(opts), tmp); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
