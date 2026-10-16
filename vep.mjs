#!/usr/bin/env node
// vep: the video editing pipeline's one command. Run it from anywhere inside a project folder (a folder with video.json):
// the project supplies the theme, voice settings and episodes (narration, storyboard, recorded clips in <episode>/clips/);
// everything the pipeline generates (voice, scaled clips, render jobs, videos) lands in this folder's artifacts/ and output/.
// `vep help` lists the commands; README.md explains the project contract.
// The heavy steps (prep, still, thumb, render) run worker.mjs: on a render machine (worker-server.mjs) when `worker=` is set in
// this folder's .env, else on this machine.
import { execFileSync, spawn, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname));
const COMPOSE = path.join(HERE, 'compose');

// .env next to this file: API keys for the voice, plus `worker=http://host:8787` and `worker_token=…` for the render machine
const ENV = Object.fromEntries((fs.existsSync(path.join(HERE, '.env')) ? fs.readFileSync(path.join(HERE, '.env'), 'utf8') : '').split('\n')
  .map((l) => l.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));

/** a fingerprint of the engine files that shape a render (the worker must run the same engine as the machine that packs the job) */
function engineRev(root) {
  const h = crypto.createHash('sha1'), files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else files.push(p); } };
  walk(path.join(root, 'compose', 'src'));
  for (const f of ['compose/package.json', 'compose/webpack-override.cjs', 'render-job.mjs', 'worker.mjs']) files.push(path.join(root, f));
  for (const f of files) { h.update(path.relative(root, f)); h.update(fs.readFileSync(f)); }
  return h.digest('hex').slice(0, 12);
}
const ARGV = process.argv.slice(2);
const takeFlag = (k, withValue) => { const i = ARGV.indexOf(k); if (i < 0) return undefined; return withValue ? ARGV.splice(i, 2)[1] : (ARGV.splice(i, 1), true); };
const LOCAL = takeFlag('--local'), ON = takeFlag('--on', true);
const WORKER = LOCAL ? null : (ON || process.env.VEP_WORKER || ENV.worker || null);
const WORKER_TOKEN = process.env.VEP_WORKER_TOKEN || ENV.worker_token;

const HELP = `vep <command> [episode] ...      (episode = its folder name or a prefix, e.g. ep39; inside an episode folder it can be left out)

  list                          episodes of this project and what each one has
  new <name>                    start an episode folder (SCRIPT.md, narration.json, storyboard.json, clips/)
  voice <ep> [block ...]        synthesize narration.json (cached per block; FORCE=1 to redo, REALIGN=1 to re-time only)
  check <ep>                    pack, then check: sentences never cut, gaps between sentences, picture speeds, captions inside the voice
  cues <ep>                     one picture cue per sentence + automatic picture speed (voice-first pacing; run after voice and prep)
  split <ep> <block> "<phrase>" ...  cut a narration block at the given words (from the paid audio, no new synthesis)
  prep <ep>                     scale the clips (<episode>/clips/*.mp4, from any recorder) to the theme's window size + read marks  (heavy)
  dry <ep>                      print the timeline (fast; catches bad words and marks before a render)
  still <ep> <frame> [...]      render single frames to artifacts/.../stills/  (heavy)
  thumb <ep>                    render the thumbnail to output/<project>/<ep>-thumb.png  (heavy)
  studio <ep>                   open Remotion Studio on the episode (always here)
  pack <ep>                     build the self-contained render job (artifacts/.../job/) without rendering
  render <ep>                   pack + render; writes output/<project>/<ep>-FINAL.mp4 + .srt  (heavy)
                                [--concurrency N] [--gl angle|angle-egl|egl|vulkan] [--frames A-B (a test slice)]
  worker                        check the render machine (worker= in .env): reachable, cores, GPU, free memory

  heavy steps run on the render machine when .env has worker=http://host:8787 (+ worker_token=…), else here (one at a time);
  --local forces this machine, --on <url> picks another worker`;

const die = (m) => { console.error('vep: ' + m); process.exit(1); };
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts }); if (r.status !== 0) die(`${cmd} ${args[0] ?? ''} failed`); };

// ---------------------------------------------------------------- project, episode, theme
function findProject() {
  let d = process.env.VEP_PROJECT ? path.resolve(process.env.VEP_PROJECT) : process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(d, 'video.json'))) break;
    const up = path.dirname(d); if (up === d) die('no video.json here or in any parent folder (run vep inside a project folder)'); d = up;
  }
  const cfg = readJSON(path.join(d, 'video.json'));
  return { dir: d, cfg, name: cfg.name || path.basename(d), episodes: path.join(d, cfg.episodes || 'episodes') };
}

function findEpisode(P, arg) {
  if (!arg) {
    const rel = path.relative(P.episodes, process.cwd());
    if (rel && !rel.startsWith('..')) arg = rel.split(path.sep)[0];
    else die('which episode? (vep list)');
  }
  const all = fs.existsSync(P.episodes) ? fs.readdirSync(P.episodes).filter((n) => fs.statSync(path.join(P.episodes, n)).isDirectory()) : [];
  const hits = all.filter((n) => n === arg).length ? [arg] : all.filter((n) => n.startsWith(arg));
  if (hits.length !== 1) die(hits.length ? `"${arg}" matches ${hits.join(', ')}` : `no episode "${arg}" in ${P.episodes}`);
  const name = hits[0];
  return { name, dir: path.join(P.episodes, name), art: path.join(HERE, 'artifacts', P.name, name), out: path.join(HERE, 'output', P.name) };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const merge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };

/** theme.json with `extends` (a path to another theme.json) merged in; asset paths become absolute, relative to the file naming them */
function loadTheme(file) {
  const t = readJSON(file), base = t.extends ? loadTheme(path.resolve(path.dirname(file), t.extends)) : {};
  delete t.extends;
  if (t.assets) t.assets = Object.fromEntries(Object.entries(t.assets).map(([k, v]) => [k, path.resolve(path.dirname(file), v)]));
  return merge(base, t);
}
const projectTheme = (P) => loadTheme(path.resolve(P.dir, P.cfg.theme || 'theme/theme.json'));

/** a file in the render's public folder: a hard link (free, same disk; Remotion's file server does not follow symlinks), else a copy */
const place = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); } };

/** the render's public folder: theme assets + this episode's scaled clips and voice */
function buildPublic(E, theme, pub = path.join(E.art, 'public')) {
  fs.rmSync(pub, { recursive: true, force: true });
  const assets = {};
  for (const [k, abs] of Object.entries(theme.assets || {})) {
    if (!fs.existsSync(abs)) die(`theme asset "${k}" not found: ${abs}`);
    assets[k] = `theme/${k}${path.extname(abs)}`; place(abs, path.join(pub, assets[k]));
  }
  for (const [dir, src, keep] of [['clips', 'scaled', /\.mp4$/], ['voice', 'voice', /\.mp3$/]]) {
    const from = path.join(E.art, src);
    if (fs.existsSync(from)) for (const f of fs.readdirSync(from).filter((x) => keep.test(x))) place(path.join(from, f), path.join(pub, dir, f));
  }
  return { pub, theme: { ...theme, assets } };
}

function renderInputs(P, E) {
  const sb = path.join(E.dir, 'storyboard.json'), blocks = path.join(E.art, 'voice', 'blocks.json'), clips = path.join(E.art, 'scaled', 'clips.json');
  if (!fs.existsSync(sb)) die(`${E.name} has no storyboard.json`);
  if (!fs.existsSync(blocks)) die(`${E.name} has no voice yet (vep voice ${E.name})`);
  return { storyboard: readJSON(sb), blocks: readJSON(blocks), clips: fs.existsSync(clips) ? readJSON(clips) : {} };
}

const scenesDir = (P) => path.join(P.dir, P.cfg.scenes || 'scenes');
const scenesEnv = (P) => { const f = path.join(scenesDir(P), 'index.tsx'); return { ...process.env, ...(fs.existsSync(f) ? { VEP_SCENES: f } : {}) }; };

/** Remotion Studio on this machine: props + a hard-linked public folder */
function remotion(P, E, args) {
  const { pub, theme } = buildPublic(E, projectTheme(P));
  const props = path.join(E.art, 'props.json');
  fs.writeFileSync(props, JSON.stringify({ theme, ...renderInputs(P, E) }));
  run('npx', ['remotion', ...args, `--props=${props}`, `--public-dir=${pub}`], { cwd: COMPOSE, env: scenesEnv(P) });
}

/** the render job: everything worker.mjs needs (public/, scenes/, props.json, captions.srt), with no path back to this project
 *  and no project or episode name in it; the Remotion bundle is built by the worker */
async function pack(P, E) {
  const job = path.join(E.art, 'job');
  fs.rmSync(job, { recursive: true, force: true });
  fs.mkdirSync(job, { recursive: true });
  const { theme } = buildPublic(E, projectTheme(P), path.join(job, 'public'));
  fs.writeFileSync(path.join(job, 'props.json'), JSON.stringify({ theme, ...renderInputs(P, E) }));
  fs.writeFileSync(path.join(job, 'captions.srt'), srt(await timeline(P, E)));
  if (fs.existsSync(path.join(scenesDir(P), 'index.tsx'))) fs.cpSync(scenesDir(P), path.join(job, 'scenes'), { recursive: true, filter: (s) => !s.includes('node_modules') });
  console.log('job:', job, `(${execFileSync('du', ['-shL', job]).toString().split('\t')[0]})`);
  return job;
}

// ---------------------------------------------------------------- heavy work: here, or on the render machine
const busy = () => { const r = spawnSync('pgrep', ['-af', 'remotion render|remotion still|worker.mjs|ffmpeg']); return r.stdout.toString().split('\n').filter((l) => l && !l.includes('pgrep')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** runs worker.mjs `task` on inDir's `files`, leaving its output in outDir (emptied first) */
async function heavy(task, inDir, files, outDir, opts) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (WORKER) return remote(task, inDir, files, outDir, opts);
  const others = busy();
  if (others.length) die('another render or ffmpeg job is running (one at a time):\n  ' + others.join('\n  '));
  // from compose/, so Remotion uses the engine's browser (compose/node_modules/.remotion)
  run('node', [path.join(HERE, 'worker.mjs'), task, inDir, outDir, JSON.stringify(opts)], { cwd: COMPOSE });
}

/** the same, on worker-server.mjs: upload a tar of the inputs, follow the log, download a tar of the outputs (the worker then
 *  deletes the job). Ctrl+C cancels the job there too. */
async function remote(task, inDir, files, outDir, opts) {
  if (!WORKER_TOKEN) die('worker_token is missing (.env next to vep.mjs, the same value as VEP_WORKER_TOKEN on the render machine)');
  const base = WORKER.replace(/\/+$/, ''), auth = { authorization: `Bearer ${WORKER_TOKEN}` };
  const call = async (p, init = {}, tries = 1) => {
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(base + p, { ...init, headers: { ...auth, ...(init.headers || {}) } });
        if (r.ok) return r;
        let e = r.statusText; try { e = (await r.json()).error; } catch {}
        die(`worker ${base}: ${e}`);
      } catch (e) { if (i >= tries) die(`worker ${base} unreachable: ${e.cause?.code || e.message} (network or VPN: is this machine on the network that reaches it?)`); await sleep(3000); }
    }
  };
  const health = await (await call('/health', {}, 3)).json(), mine = engineRev(HERE);
  if (health.rev !== mine) die(`the render machine runs a different engine (${health.rev || 'old version'}, here ${mine}).\n  On it: cd ~/video-editing-pipeline && git pull && (cd compose && npm ci), then restart worker-server.mjs (tmux attach -t vep, Ctrl+c, start it again).`);
  const size = +execFileSync('du', ['-sbcL', ...files], { cwd: inDir }).toString().trim().split('\n').pop().split('\t')[0];
  console.log(`${task}: sending ${(size / 1e6).toFixed(0)} MB to ${base}`);
  const tar = spawn('tar', ['-chf', '-', ...files], { cwd: inDir, stdio: ['ignore', 'pipe', 'inherit'] });
  const { id } = await (await call(`/jobs?task=${task}&opts=${encodeURIComponent(JSON.stringify(opts))}`,
    { method: 'POST', body: Readable.toWeb(tar.stdout), duplex: 'half', headers: { 'content-type': 'application/x-tar', 'x-vep-size': String(size) } })).json();
  const cancel = () => fetch(`${base}/jobs/${id}`, { method: 'DELETE', headers: auth }).catch(() => {});
  process.once('SIGINT', async () => { console.error('\ncancelling the job on the worker'); await cancel(); process.exit(130); });
  let since = 0, st;
  for (;;) {
    st = await (await call(`/jobs/${id}?since=${since}`, {}, 20)).json();   // rides out a minute of network trouble
    for (const l of st.log) console.log('  ' + l);
    since = st.next;
    if (st.state === 'done' || st.state === 'failed') break;
    await sleep(2000);
  }
  if (st.state === 'failed') { await cancel(); die(`worker: ${st.error}`); }
  const res = await call(`/jobs/${id}/result`);
  const untar = spawn('tar', ['-xf', '-', '-C', outDir], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((ok) => untar.on('close', ok));
  await pipeline(Readable.fromWeb(res.body), untar.stdin);
  if ((await closed) !== 0) die('could not unpack the result');
}

/** moves outDir/<from> to <to> (replacing it) */
const take = (outDir, from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(path.join(outDir, from), to); };

// ---------------------------------------------------------------- timeline (the same code the render uses)
async function timeline(P, E) {
  const esbuild = createRequire(path.join(COMPOSE, 'package.json'))('esbuild');
  const r = esbuild.buildSync({ entryPoints: [path.join(COMPOSE, 'src/story/timeline.ts')], bundle: true, write: false, format: 'esm', platform: 'node', external: ['react', 'react-dom', 'remotion', '@remotion/*'], logLevel: 'error' });
  const tmp = path.join(COMPOSE, `.timeline-${process.pid}.mjs`);
  fs.writeFileSync(tmp, r.outputFiles[0].text);
  try {
    const m = await import(tmp);
    const { storyboard, blocks, clips } = renderInputs(P, E);
    const r = m.buildTimeline(storyboard, blocks, clips);
    for (const sc of r.TIMELINE) if (sc.type === 'screen') m.prepScreen(r.BLOCKS, sc);   // a bad overlay cue throws here, not mid-render
    return r;
  } finally { fs.unlinkSync(tmp); }
}

function srt({ BLOCKS, TIMELINE }) {
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
  return chunks.map((c, i) => `${i + 1}\n${ts(c[0].s)} --> ${ts(c[c.length - 1].e + 0.2)}\n${c.map((w) => w.t).join(' ')}\n`).join('\n');
}

// ---------------------------------------------------------------- commands
const commands = {
  list(P) {
    const has = (p) => (fs.existsSync(p) ? '✓' : '·');
    console.log(`${P.name}  (${P.dir})\n`);
    console.log('episode'.padEnd(28), 'script narration voice clips scaled storyboard final');
    for (const n of fs.readdirSync(P.episodes).filter((n) => fs.statSync(path.join(P.episodes, n)).isDirectory()).sort()) {
      const d = path.join(P.episodes, n), a = path.join(HERE, 'artifacts', P.name, n), o = path.join(HERE, 'output', P.name, `${n}-FINAL.mp4`);
      console.log(n.padEnd(28), [has(path.join(d, 'SCRIPT.md')), has(path.join(d, 'narration.json')), has(path.join(a, 'voice/blocks.json')), has(path.join(d, 'clips')), has(path.join(a, 'scaled/clips.json')), has(path.join(d, 'storyboard.json')), has(o)].map((x, i) => x.padEnd([6, 9, 5, 5, 6, 10, 5][i])).join(' '));
    }
  },
  new(P, name) {
    if (!name) die('vep new <name>   e.g. vep new ep22-drive-sync');
    const d = path.join(P.episodes, name);
    if (fs.existsSync(d)) die(`${d} already exists`);
    fs.mkdirSync(path.join(d, 'clips'), { recursive: true });
    fs.writeFileSync(path.join(d, 'SCRIPT.md'), `# ${name}\n\n## Problem (1 to 2 sentences)\n\n## How the product solves it\n\n## Shot list\n\n## Narration\n\n## Open questions\n`);
    fs.writeFileSync(path.join(d, 'narration.json'), JSON.stringify({ blocks: [{ id: 'n01', text: '' }] }, null, 2) + '\n');
    fs.writeFileSync(path.join(d, 'storyboard.json'), JSON.stringify({ labels: [], scenes: [{ type: 'title', id: 'title', blocks: ['n01'], eyebrow: '', line1: '', line2: '' }, { type: 'end', id: 'end', len: 6, line1: '', line2: '', cta: '', card: true }] }, null, 2) + '\n');
    console.log(`created ${d}`);
  },
  voice(P, ep, ...only) {
    const E = findEpisode(P, ep);
    run('python3', [path.join(COMPOSE, 'tools/voice.py'), path.join(E.dir, 'narration.json'), path.join(E.art, 'voice'), ...only], { env: { ...process.env, VEP_VOICE: JSON.stringify(P.cfg.voice || {}) } });
  },
  async check(P, ep) {
    const job = await pack(P, findEpisode(P, ep));
    const r = spawnSync('node', [path.join(COMPOSE, 'tools/check_timeline.mjs'), job], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },
  cues(P, ep) {
    const E = findEpisode(P, ep);
    run('python3', [path.join(COMPOSE, 'tools/sentence_cues.py'), path.join(E.dir, 'storyboard.json'), path.join(E.art, 'voice', 'blocks.json'), path.join(E.art, 'scaled', 'clips.json')]);
  },
  split(P, ep, block, ...phrases) {
    const E = findEpisode(P, ep);
    if (!block || !phrases.length) die('vep split <ep> <block> "<phrase that starts part 2>" [...]');
    run('python3', [path.join(COMPOSE, 'tools/split_block.py'), path.join(E.dir, 'narration.json'), path.join(E.art, 'voice'), block, ...phrases]);
  },
  async prep(P, ep) {
    const E = findEpisode(P, ep), win = projectTheme(P).window, src = path.join(E.dir, 'clips'), out = path.join(E.art, 'scaled');
    const clips = fs.existsSync(src) ? fs.readdirSync(src).filter((x) => /^\d.*\.mp4$/.test(x)).sort() : [];
    if (!clips.length) die(`no clips in ${src} (NN-name.mp4, optional NN-name.actions.json marks)`);
    const tmp = path.join(E.art, '.scale');
    await heavy('scale', src, clips, tmp, { w: win.w, h: win.h, ...(P.cfg.scale || {}) });   // the old scaled clips stay until the new ones are all back
    const durations = readJSON(path.join(tmp, 'durations.json')), info = {};
    fs.unlinkSync(path.join(tmp, 'durations.json'));
    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(tmp, out);
    for (const [name, dur] of Object.entries(durations)) {
      const am = path.join(src, name + '.actions.json'), marks = {}, boxes = {};
      if (fs.existsSync(am)) for (const a of readJSON(am).actions) { marks[a.label] = a.t; if (a.box) boxes[a.label] = a.box; }
      info[name] = { dur, marks, boxes };
      console.log(name, dur.toFixed(2) + 's', Object.keys(marks).length + ' marks');
    }
    fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify(info, null, 1));
  },
  async dry(P, ep) {
    const { TIMELINE, TOTAL } = await timeline(P, findEpisode(P, ep));
    console.log('TOTAL', TOTAL.toFixed(1), 's =', Math.floor(TOTAL / 60) + ':' + String(Math.round(TOTAL % 60)).padStart(2, '0'), ` (${Math.round(TOTAL * 30)} frames)`);
    for (const s of TIMELINE) console.log(s.id.padEnd(10), s.type.padEnd(10), String(+s.start.toFixed(2)).padStart(7), String(+s.len.toFixed(2)).padStart(7));
  },
  async still(P, ep, ...frames) {
    const E = findEpisode(P, ep), tmp = path.join(E.art, '.frames');
    if (!frames.length) die('vep still <ep> <frame> [...]');
    await heavy('frames', await pack(P, E), ['public', 'props.json', ...(fs.existsSync(path.join(E.art, 'job', 'scenes')) ? ['scenes'] : [])], tmp, { frames: frames.map(Number), gl: ENV.worker_gl || null });
    for (const f of frames) { take(tmp, `${f}.png`, path.join(E.art, 'stills', `${f}.png`)); console.log(path.join(E.art, 'stills', `${f}.png`)); }
    fs.rmSync(tmp, { recursive: true, force: true });
  },
  async thumb(P, ep) {
    const E = findEpisode(P, ep), tmp = path.join(E.art, '.frames'), to = path.join(E.out, `${E.name}-thumb.png`);
    await heavy('frames', await pack(P, E), ['public', 'props.json', ...(fs.existsSync(path.join(E.art, 'job', 'scenes')) ? ['scenes'] : [])], tmp, { thumb: true, gl: ENV.worker_gl || null });
    take(tmp, 'thumb.png', to);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(to);
  },
  studio(P, ep) { remotion(P, findEpisode(P, ep), ['studio', 'src/index.ts']); },
  async pack(P, ep) { await pack(P, findEpisode(P, ep)); },
  async render(P, ep, ...opts) {
    const E = findEpisode(P, ep), opt = (k) => { const i = opts.indexOf(k); return i >= 0 ? opts[i + 1] : undefined; };
    const frames = opt('--frames'), gl = opt('--gl') || (WORKER && ENV.worker_gl) || null;
    const job = await pack(P, E), tmp = path.join(E.art, '.render');
    const files = ['public', 'props.json', 'captions.srt', ...(fs.existsSync(path.join(job, 'scenes')) ? ['scenes'] : [])];
    await heavy('render', job, files, tmp, { ...(P.cfg.render || {}), concurrency: opt('--concurrency') ? +opt('--concurrency') : undefined, gl, frames: frames ? frames.split('-').map(Number) : null });
    const out = frames ? path.join(E.art, 'test-slice') : E.out;   // a slice never replaces a FINAL
    take(tmp, 'video-FINAL.mp4', path.join(out, `${E.name}-FINAL.mp4`));
    take(tmp, 'video.srt', path.join(out, `${E.name}.srt`));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('done:', path.join(out, `${E.name}-FINAL.mp4`));
  },
  async worker() {
    if (!WORKER) die('no render machine set: add worker=http://<host>:8787 and worker_token=… to ' + path.join(HERE, '.env'));
    const r = await fetch(WORKER.replace(/\/+$/, '') + '/health', { headers: { authorization: `Bearer ${WORKER_TOKEN}` } }).catch((e) => die(`${WORKER} unreachable: ${e.cause?.code || e.message} (network or VPN: is this machine on the network that reaches it?)`));
    if (!r.ok) die(`${WORKER}: ${r.status} ${r.statusText}`);
    const h = await r.json();
    console.log(`${WORKER}: ${h.busy ? 'busy' : 'idle'}, ${h.cpus} cpus, ${h.gpu || 'no GPU found'}, ${h.tmpFreeGB} GB free for jobs in memory, engine ${h.rev || 'old'} (here ${engineRev(HERE)}${h.rev === engineRev(HERE) ? ', same' : ': UPDATE IT'})`);
    if (h.ffmpeg === false) console.log('  ffmpeg/ffprobe are missing there: sudo apt install ffmpeg, then restart the worker');
  },
};

const [cmd, ...args] = ARGV;
if (!cmd || cmd === 'help' || !commands[cmd]) { console.log(HELP); process.exit(cmd && cmd !== 'help' ? 1 : 0); }
await commands[cmd](cmd === 'worker' ? null : findProject(), ...args);
