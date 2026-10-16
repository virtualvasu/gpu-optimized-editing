#!/usr/bin/env node
// The render itself, as a stateless function: a Remotion bundle + props + captions in, <name>-FINAL.mp4 + <name>.srt out (x264
// CRF 16, loudness to -14 LUFS). worker.mjs calls it after building the bundle; vep runs worker.mjs here or on a render machine.
//
//   node render-job.mjs <job dir with bundle/ and job.json> <out dir> [--concurrency N] [--gl angle|egl|vulkan|swangle] [--frames 0-299]
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname));
const require = createRequire(path.join(HERE, 'compose', 'package.json'));

/** renders job/ into outDir; returns the paths it wrote */
export async function renderJob(jobDir, outDir, { concurrency = os.cpus().length, gl = null, frames = null, log = console.log, serveUrl = path.join(jobDir, 'bundle'), name = null } = {}) {
  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const job = { name: name ?? JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8')).name };
  const inputProps = JSON.parse(fs.readFileSync(path.join(jobDir, 'props.json'), 'utf8'));
  const chromiumOptions = gl ? { gl } : {};
  fs.mkdirSync(outDir, { recursive: true });
  const raw = path.join(outDir, `${job.name}-raw.mp4`), final = path.join(outDir, `${job.name}-FINAL.mp4`), srt = path.join(outDir, `${job.name}.srt`);

  const composition = await selectComposition({ serveUrl, id: 'Episode', inputProps, chromiumOptions });
  log(`${job.name}: ${composition.durationInFrames} frames, concurrency ${concurrency}${gl ? ', gl ' + gl : ''}`);
  let last = -1;
  await renderMedia({
    serveUrl, composition, inputProps, chromiumOptions, concurrency, outputLocation: raw, overwrite: true,
    frameRange: frames, codec: 'h264', crf: 16, pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 95,
    onProgress: ({ progress }) => { const p = Math.floor(progress * 20); if (p !== last) { last = p; log(`  ${p * 5}%`); } },
  });
  // loudness to -14 LUFS for YouTube/LinkedIn; the picture is copied untouched
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=8', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', final], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(r.error?.code === 'ENOENT' ? 'ffmpeg is not installed on this machine (sudo apt install ffmpeg)' : 'ffmpeg loudnorm failed');
  fs.unlinkSync(raw);
  fs.copyFileSync(path.join(jobDir, 'captions.srt'), srt);
  return { final, srt };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const concurrency = opt('--concurrency'), gl = opt('--gl'), frames = opt('--frames');
  if (a.length !== 2) { console.error('usage: node render-job.mjs <job dir> <out dir> [--concurrency N] [--gl angle|egl|vulkan|swangle] [--frames A-B]'); process.exit(1); }
  const out = await renderJob(path.resolve(a[0]), path.resolve(a[1]), { concurrency: concurrency ? +concurrency : undefined, gl, frames: frames ? frames.split('-').map(Number) : null });
  console.log('done:', out.final);
}
