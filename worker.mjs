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
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderJob } from './render-job.mjs';

const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname));
const COMPOSE = path.join(HERE, 'compose');
const require = createRequire(path.join(COMPOSE, 'package.json'));

/** recordings → clips at the theme window size (lanczos, light sharpen, CRF 12) + their durations */
export async function scale(inDir, outDir, { w, h }, log = console.log) {
  fs.mkdirSync(outDir, { recursive: true });
  const durations = {};
  for (const f of fs.readdirSync(inDir).filter((x) => /^\d.*\.mp4$/.test(x)).sort()) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(inDir, f), '-vf', `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.35:5:5:0.0`,
      '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, f)], { stdio: ['ignore', 'ignore', 'inherit'] });
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

export async function render(jobDir, outDir, { concurrency, gl = null, frames = null } = {}, tmp, log = console.log) {
  const serveUrl = await bundleJob(jobDir, tmp);
  await renderJob(jobDir, outDir, { serveUrl, name: 'video', concurrency: concurrency || os.cpus().length, gl, frames, log });
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

export const TASKS = { scale: (i, o, opts, tmp, log) => scale(i, o, opts, log), render, frames: stills };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  const [task, inDir, outDir, opts = '{}'] = process.argv.slice(2);
  if (!TASKS[task] || !inDir || !outDir) { console.error('usage: node worker.mjs scale|render|frames <in dir> <out dir> [json options]'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vep-'));
  try { await TASKS[task](path.resolve(inDir), path.resolve(outDir), JSON.parse(opts), tmp); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
