#!/usr/bin/env node
// The render machine's side: worker.mjs's heavy functions behind a small HTTP API, so a laptop running `vep` can hand them off.
// Nothing about the videos stays here: each job lives in a temporary folder (RAM in /dev/shm when it fits) that is deleted as
// soon as its result is downloaded, when it fails or is cancelled, after RESULT_TTL if nobody collects it, and at start-up. Job
// logs are kept in memory only (for the status call) and never printed or written.
//
//   VEP_WORKER_TOKEN=<secret> node worker-server.mjs        (run it in tmux; README "Render machine")
//   env: VEP_WORKER_PORT (8787), VEP_WORKER_BIND (0.0.0.0), VEP_WORKER_TMP (/dev/shm, else the system temp folder)
//
//   GET    /health               { ok, busy, cpus, gpu, tmpFreeGB }
//   POST   /jobs?task=scale|render|frames&opts=<json>   body: a tar of the job's input folder  → 202 { id }   (409 when busy)
//   GET    /jobs/<id>?since=<n>  { state: running|done|failed, log: [lines after n], next, error }
//   GET    /jobs/<id>/result     a tar of the output folder; the job folder is deleted once it is sent
//   DELETE /jobs/<id>            cancel and delete
// Every call needs `Authorization: Bearer <token>`. One job at a time (the machine's cores all go to it).
import http from 'http';
import crypto from 'crypto';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname));
const TOKEN = process.env.VEP_WORKER_TOKEN;
const PORT = +(process.env.VEP_WORKER_PORT || 8787), BIND = process.env.VEP_WORKER_BIND || '0.0.0.0';
const RESULT_TTL = 60 * 60 * 1000;   // an uncollected result is deleted after an hour
const TASKS = ['scale', 'render', 'frames'];
if (!TOKEN || TOKEN.length < 16) { console.error('set VEP_WORKER_TOKEN (16+ characters; the same value goes in the laptop\'s .env as worker_token)'); process.exit(1); }

const freeBytes = (dir) => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return 0; } };
const RAM = process.env.VEP_WORKER_TMP || (fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir());
/** RAM when the job fits with room to spare (inputs + bundle copy + raw and final video), else the disk temp folder */
const baseFor = (size) => (freeBytes(RAM) > size * 3 + 3e9 ? RAM : os.tmpdir());
const PREFIX = 'vep-job-';

// deleting never throws: a folder that cannot go yet (a killed process still writing) is retried every minute until it does
const pending = new Set();
const wipe = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); pending.delete(dir); } catch { pending.add(dir); } };

// leftovers of a crash or a reboot that did not clear the temp folders
for (const base of new Set([RAM, os.tmpdir()])) for (const n of fs.readdirSync(base).filter((n) => n.startsWith(PREFIX))) wipe(path.join(base, n));

const jobs = new Map();   // id → { dir, state, log[], error, child, ended }
const drop = (id) => {
  const j = jobs.get(id); if (!j) return;
  jobs.delete(id);
  if (!j.child) return wipe(j.dir);
  j.child.once('close', () => wipe(j.dir));                               // once every process of the job has stopped
  try { process.kill(-j.child.pid, 'SIGKILL'); } catch { wipe(j.dir); }   // the whole group: the worker, its Chrome and ffmpeg
};
setInterval(() => {
  for (const [id, j] of jobs) if (j.ended && Date.now() - j.ended > RESULT_TTL) drop(id);
  for (const d of pending) wipe(d);
}, 60 * 1000).unref();

const ffmpeg = ['ffmpeg', 'ffprobe'].every((b) => { try { execFileSync(b, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
const gpu = (() => { try { return execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']).toString().trim(); } catch { return null; } })();
const authorized = (req) => { const a = Buffer.from(req.headers.authorization || ''), b = Buffer.from('Bearer ' + TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

function start(task, opts, req, res) {
  if ([...jobs.values()].some((j) => j.state === 'running')) return json(res, 409, { error: 'busy: another job is running (one at a time)' });
  const id = crypto.randomBytes(8).toString('hex');
  const dir = fs.mkdtempSync(path.join(baseFor(+req.headers['x-vep-size'] || 0), PREFIX));
  for (const d of ['in', 'out', 'tmp']) fs.mkdirSync(path.join(dir, d));
  const job = { dir, state: 'receiving', log: [], error: null, child: null, ended: null };
  jobs.set(id, job);
  const say = (chunk) => { for (const l of chunk.toString().split(/\r?\n|\r/)) if (l.trim()) job.log.push(l); if (job.log.length > 2000) job.log.splice(0, job.log.length - 2000); };
  const untar = spawn('tar', ['-xf', '-', '-C', path.join(dir, 'in')], { stdio: ['pipe', 'ignore', 'pipe'] });
  untar.stderr.on('data', say);
  req.pipe(untar.stdin);
  req.on('aborted', () => { untar.kill(); drop(id); });
  untar.on('close', (code) => {
    if (!jobs.has(id)) return;
    if (code !== 0) { drop(id); return json(res, 400, { error: 'could not unpack the upload' }); }
    // the work itself runs in a child: its temp files ($TMPDIR, Chrome's profile, caches) all land inside the job folder
    const tmp = path.join(dir, 'tmp');
    job.state = 'running';
    job.child = spawn(process.execPath, [path.join(HERE, 'worker.mjs'), task, path.join(dir, 'in'), path.join(dir, 'out'), JSON.stringify(opts)], {
      cwd: path.join(HERE, 'compose'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, VEP_WORKER_TOKEN: '', TMPDIR: tmp, XDG_CACHE_HOME: path.join(tmp, 'cache'), XDG_CONFIG_HOME: path.join(tmp, 'config') },
    });
    job.child.stdout.on('data', say); job.child.stderr.on('data', say);
    job.child.on('close', (c) => {
      job.child = null; job.ended = Date.now();
      job.state = c === 0 ? 'done' : 'failed';
      if (c !== 0) { job.error = `worker exited with ${c}`; wipe(path.join(dir, 'in')); }
      wipe(tmp);
      console.log(`${new Date().toISOString()} job ${id} ${task} ${job.state}`);
    });
    console.log(`${new Date().toISOString()} job ${id} ${task} started`);
    json(res, 202, { id });
  });
}

function result(id, j, res) {
  if (j.state !== 'done') return json(res, 409, { error: `job is ${j.state}` });
  res.writeHead(200, { 'content-type': 'application/x-tar' });
  const tar = spawn('tar', ['-cf', '-', '-C', path.join(j.dir, 'out'), '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
  tar.stdout.pipe(res);
  // deleted once sent; if the download breaks, the job is deleted too (the laptop renders again)
  res.on('close', () => { tar.kill(); drop(id); });
}

http.createServer((req, res) => {
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://x'), [, root, id, sub] = url.pathname.split('/');
  if (req.method === 'GET' && root === 'health') return json(res, 200, { ok: true, busy: [...jobs.values()].some((j) => j.state === 'running'), cpus: os.cpus().length, gpu, ffmpeg, tmpFreeGB: +(freeBytes(RAM) / 1e9).toFixed(1) });
  if (root !== 'jobs') return json(res, 404, { error: 'not found' });
  if (req.method === 'POST' && !id) {
    const task = url.searchParams.get('task');
    if (!TASKS.includes(task)) return json(res, 400, { error: `task must be one of ${TASKS.join(', ')}` });
    let opts; try { opts = JSON.parse(url.searchParams.get('opts') || '{}'); } catch { return json(res, 400, { error: 'opts is not JSON' }); }
    return start(task, opts, req, res);
  }
  const j = jobs.get(id);
  if (!j) return json(res, 404, { error: 'no such job (finished jobs are deleted once collected)' });
  if (req.method === 'GET' && !sub) { const since = +(url.searchParams.get('since') || 0); return json(res, 200, { state: j.state, log: j.log.slice(since), next: j.log.length, error: j.error }); }
  if (req.method === 'GET' && sub === 'result') return result(id, j, res);
  if (req.method === 'DELETE' && !sub) { drop(id); return json(res, 200, { ok: true }); }
  json(res, 404, { error: 'not found' });
}).listen(PORT, BIND, () => console.log(`vep worker on ${BIND}:${PORT}, ${os.cpus().length} cpus${gpu ? ', ' + gpu : ''}, jobs in ${RAM} (deleted after collection)${ffmpeg ? '' : '\nffmpeg/ffprobe missing: sudo apt install ffmpeg'}`));

// stopping the server (Ctrl+C in tmux) stops and deletes every job; anything left is cleared at the next start
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  const dirs = [...jobs.values()].map((j) => j.dir);
  for (const id of [...jobs.keys()]) drop(id);
  setTimeout(() => { for (const d of dirs) wipe(d); process.exit(0); }, 1500);
});
