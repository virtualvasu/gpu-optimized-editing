# video-editing-pipeline

Turns recorded screen clips + a narration script + a storyboard into a finished, branded, voiced video, a caption file and a
thumbnail. It knows nothing about any topic: the look, the voice and the content come from a **project folder**. Two projects
use it today: `~/Desktop/phinite/50-video-series/` and `~/Desktop/phinite/pocs/video/`.

```
project folder (your details)             this engine (code + everything generated)
  video.json  theme/  RULES.md     ──►     vep voice / dry / studio / pack           (laptop)
  episodes/<ep>/                           vep prep / still / thumb / render       (heavy: render machine, stateless)
    narration.json  storyboard.json                 │
    clips/*.mp4  (+ *.actions.json)                 ▼
                                          artifacts/<project>/<ep>/   voice, scaled clips, render job, stills
                                          output/<project>/           <ep>-FINAL.mp4, <ep>.srt, <ep>-thumb.png
```

## Setup (once per machine)

```bash
cd ~/Desktop/phinite/video-editing-pipeline/compose && npm ci       # Remotion engine; also needs ffmpeg/ffprobe
ln -s ~/Desktop/phinite/video-editing-pipeline/vep.mjs ~/.local/bin/vep
```
API keys for the voice live in `.env` here (`deepgram=…`, `elevenlabs=…`, `elevenlabs2=…`; never printed), with the render
machine's address (`worker=…`, `worker_token=…`, below). `.env`, `artifacts/` and `output/` are never committed: the repository
(github.com/virtualvasu/gpu-optimized-editing, private) holds the engine only.

## Making an episode

Run every command from anywhere inside the project folder; inside an episode folder the episode name can be left out.

| Step | Command | Writes |
|---|---|---|
| Start | `vep new ep22-drive-sync` | `episodes/ep22-drive-sync/` with `SCRIPT.md`, `narration.json`, `storyboard.json`, `clips/` |
| Clips | record them by hand or with `~/Desktop/phinite/shared/portal-driver/recorder/` | `episodes/<ep>/clips/NN-name.mp4` (+ optional `NN-name.actions.json` marks) |
| Voice | `vep voice ep22` (prints characters per block; cached, so it is paid for once) | `artifacts/<p>/<ep>/voice/` |
| Prepare | `vep prep ep22` | `artifacts/<p>/<ep>/scaled/` (clips at the theme's window size) + `clips.json` (durations, marks) |
| Check | `vep dry ep22` (timeline in a second), `vep still ep22 900 2400`, `vep studio ep22` | `artifacts/<p>/<ep>/stills/` |
| Thumbnail | `vep thumb ep22` | `output/<p>/ep22-…-thumb.png` |
| Render | `vep render ep22` (on the render machine when one is set; `--local` for here) | `output/<p>/ep22-…-FINAL.mp4` + `.srt` |

`vep list` shows which of these each episode has.

## The heavy steps run on a render machine

`prep` (re-encoding the clips), `still`, `thumb` and `render` (about 20 to 25 minutes of full CPU for a 4-minute episode on a
laptop) are stateless functions in `worker.mjs`: **an input folder in, an output folder out**, nothing else read or written.
Everything else (voice, dry, studio, packing the job) stays on the machine that has the project; the voice API keys never leave it.

| Function | Input (sent) | Output (returned) |
|---|---|---|
| `scale` (`vep prep`) | the recordings `clips/NN-name.mp4` | the clips at the theme window size + their durations |
| `render` (`vep render`) | the job: `public/` (theme assets, scaled clips, voice), `scenes/`, `props.json`, `captions.srt` | `video-FINAL.mp4` + `video.srt` |
| `frames` (`vep still`, `vep thumb`) | the job without captions | `<frame>.png`, `thumb.png` |

The job (`vep pack`, `artifacts/<p>/<ep>/job/`) has no path back to the project and no project or episode name in it; vep
names the returned files. The Remotion bundle is built by the worker with the webpack cache off.

### Where they run

- **Render machine** (`worker=` in `.env`): vep uploads the input as a tar over HTTP, prints the worker's log while it works,
  downloads the result as a tar and puts it in place (`output/<p>/<ep>-FINAL.mp4`, `artifacts/…/stills/`, …). Ctrl+C cancels the
  job there too. `vep worker` checks the connection.
- **Here** (no `worker=`, or `--local`): the same functions as a child process; refuses while another render or ffmpeg job runs
  (one at a time on a laptop).
- `--on http://other:8787` picks another worker for one command. `--frames A-B` renders a test slice into `artifacts/…/test-slice/`,
  never over a FINAL.

```
# .env on the laptop (next to vep.mjs; never committed)
worker=http://<render machine>:8787
worker_token=<the same long random string as on the render machine>
worker_gl=angle-egl          # optional: Chrome's GPU backend on the worker (measure with --frames first)
```

### Setting up the render machine (once)

Needs node 18+, ffmpeg/ffprobe and network access to Google Fonts. Nothing about any project or episode is installed there.

```bash
git clone https://github.com/virtualvasu/gpu-optimized-editing.git ~/video-editing-pipeline
cd ~/video-editing-pipeline/compose && npm ci && npx remotion browser ensure
export VEP_WORKER_TOKEN=$(openssl rand -hex 24)    # keep it; the laptop's worker_token is the same value
tmux new -s vep 'cd ~/video-editing-pipeline && VEP_WORKER_TOKEN='"$VEP_WORKER_TOKEN"' node worker-server.mjs'
```
Update later with `git pull && (cd compose && npm ci)`, then restart the tmux session. Options: `VEP_WORKER_PORT` (8787),
`VEP_WORKER_BIND` (0.0.0.0; use the VPN/LAN address to keep it off other networks), `VEP_WORKER_TMP` (/dev/shm).

### What stays on the render machine: nothing about the videos

`worker-server.mjs` gives each job a temporary folder (in RAM under `/dev/shm` when it fits, else the system temp folder) with
`in/`, `out/` and `tmp/`; the worker's `$TMPDIR`, Chrome profile and caches all point inside it. The folder is deleted as soon as
the result is downloaded, when the job fails or is cancelled, an hour after it finished if nobody collects it, and at start-up
(leftovers of a crash). The job log lives in memory for the status call only; the console prints just `job <random id> render
started/done`. Job ids are random; no project or episode name is sent. One job at a time.

API (every call needs `Authorization: Bearer <token>`): `GET /health`; `POST /jobs?task=scale|render|frames&opts=<json>` with a
tar body → `{ id }` (409 when busy); `GET /jobs/<id>?since=<n>` → state + new log lines; `GET /jobs/<id>/result` → tar (then
deleted); `DELETE /jobs/<id>`. The token is the only protection: keep the port on the LAN or a VPN, not the open internet.

### Speed

Remotion draws frames in headless Chrome, so CPU cores matter most (`--concurrency` defaults to all of them). A GPU can take the
drawing (`--gl angle-egl` or `angle` on Linux with NVIDIA, or `worker_gl` in `.env`); test a `--frames 0-300` slice with and
without it. Encoding stays x264 (CRF 16) for identical output. `render-job.mjs` is the render step itself (bundle + props in,
FINAL out), used by `worker.mjs`.

## The project contract

A project is a folder with `video.json`:

```json
{
  "name": "50-video-series",          // artifacts/ and output/ are grouped by this
  "theme": "theme/theme.json",
  "rules": "RULES.md",                // the owner's standing instructions (read by people and by Claude; not by code)
  "episodes": "episodes",
  "scenes": "scenes",                 // optional: scenes/index.tsx with the project's own diagram scenes
  "voice": { "provider": "deepgram", "voice_id": "aura-2-atlas-en" },   // default voice; a narration.json may override
  "portal": { … }                     // used by the portal recorder, not by this engine
}
```

### theme.json

Every visual and audio choice; the engine has no defaults of its own. A theme may start with `"extends": "<path to another
theme.json>"` and override only some keys (objects merge, lists replace). Asset paths are relative to the theme file that names them.

| Key | What it controls |
|---|---|
| `brand.wordmark`, `brand.site`, `brand.url` | footer wordmark, the line under the end scene (when there is no end card), default URL in the window's address pill |
| `colors.*` | `bgTop`/`bgBot` ground gradient, `accent`/`accentSoft`/`accentDeep` brand purples, `text`, `muted`, `dim`, `red`/`green`/`amber` status colours. Always `#RRGGBB` |
| `fonts.sans`, `fonts.mono` | any Google Fonts family names (loaded at render time) |
| `assets.logo`, `assets.music`, `assets.sting`, `assets.whoosh`, `assets.whooshSoft` | logo image, music bed, opening sting, scene-change sounds (`compose/tools/synth_audio.py` makes royalty-free ones) |
| `endCard` | `tagline` + `accent` (gradient second line) + `url` button, shown when the storyboard's end scene has `"card": true` |
| `labels.recap` | the small heading over the recap scene |
| `window` | the macOS window around recordings: position `x`,`y`, content size `w`×`h` (clips are scaled to it), title `bar` height, `radius`, `titleBar` gradient, `urlPill` colour, traffic `lights` |
| `captions` | word-synced caption `size`, `top` (px from the top), `width` |
| `audio` | volumes: `music` bed, `duck` (how far music drops under the voice, 0 to 1), `sting`, `transition` (scene changes), `endTransition` |
| `backdrop.lines` | the faint scrolling log behind every scene: `[type, process, message, tone?]`, tone `red`/`green` (default: red for not_found/error, green for found) |

### narration.json

`{ "provider"?, "voice_id"?, "model"?, "settings"?, "blocks": [{ "id": "n01", "text": "…" }] }`. Providers: `deepgram` (Aura, word
times by speech-to-text) or ElevenLabs (exact character times; switches to the second key when the first runs out of credits).
`[[display|spoken]]` shows one thing in captions and says another: `[[emp_id|e m p underscore i d]]`. `FORCE=1 vep voice <ep> n03`
re-synthesizes one block; `REALIGN=1` keeps the audio and re-measures word times.

### storyboard.json

`{ "labels": [chapter names], "music"?: volume, "thumb"?: {…}, "scenes": [ … ] }`. Scenes play in order, overlapping by 0.7 s.
Clip times are seconds or `"mark:<label>[+/-s]"` (a recorder mark). A word `w` is matched by prefix (`"the trend"` works); `n` picks
its nth occurrence.

| `type` | Fields (all scenes: `id`, optional `blocks` spoken in order, `lead`, `tail`, or a fixed `len`) |
|---|---|
| `title` | `eyebrow`, `line1`, `line2` (gradient) |
| `section` | `chapter` (index into labels), `title`, `tagline`: big outlined number + progress bar |
| `screen` | `clip`, `chapter`, `url`?; `beats`: `[{ b, w, v, rate?, waits?: [[from, to, rate]] }]` = when word `w` of block `b` is heard, the clip shows time `v`; footage between beats plays at `rate`, dead waits faster; `endV`, `endRate`, `endWaits`; `hl`: `[{ focus: "<mark with a box>" | box: [x,y,w,h], v? \| b+w, dur }]` highlights (dim the rest, glow the box); `zv`: `[{ v, z, fx, fy }]` zoom keys; `overlays`: `[{ kind: "badge", text, color, v | b+w, dur, top? }]` (also `duo`, `chain`, `callout`, `steps`, below) |
| `recap` | `items: [{ b, w, title, sub }]` (each arrives on its word), `cta: { b, w, text }` |
| `end` | `line1`, `line2`, `cta`, `card`: `true` (the theme's end card) or `{ tagline, accent, url }` |
| anything else | a project scene from `scenes/index.tsx`; `cues: { propName: [block, word, nth?] }` become scene-time props |

Screen overlays for reading details without zooming (every time is `v` (clip time) or `b`+`w` (+`n`, `off`)):

- `callout`: `{ focus | box, side?: left|right|top|bottom, anchor?: [x,y], head?, value?, lines?: [text | { text, color?, v | b+w }], mono?, color?, width?, dur }`.
  A line is drawn from the box to a card beside it; `value` is one big figure, `lines` arrive one after another or on their own
  cue (`mono` lines type in). `anchor` (clip pixels) moves the card's end of the line; a `focus` callout defaults to its mark's time.
- `steps`: `{ items: [..], done?: n, ticks: [{ v | b+w }], dur }`: numbered steps in the window's top-right corner; each tick
  checks off the current step (split a procedure across scenes with `done`).

`thumb`: `{ eyebrow, line1, line2, sub, clip, v }`, each optional (defaults: the title scene's text and the first screen
scene's `endV` frame).

### Pacing: voice-first (no hiccups)

Set `"pacing": "voice"` in a storyboard. A narration sentence is then always spoken in one go: the picture is sped up (never
past about 5x) or held to fit it, and the NEXT sentence starts only after the picture has shown what the previous one said, plus a
0.55 s gap. Cue the picture at sentence starts only: `vep cues <ep>` keeps the first beat of each sentence, snaps it to the
sentence's first word and sets each sentence's picture speed from the footage it must show (callouts and highlights tied to a
recorded mark appear when the mark is on screen). `vep check <ep>` packs and verifies: no sentence cut, gaps between sentences,
time above 8x, every caption inside the voice. The old `"pacing": "picture"` (default, for POC storyboards) lets the voice wait
for the screen even inside a sentence. `vep split` cuts a block between two sentences (from the paid audio) when they must sit on
different scenes; never split mid-sentence.

### clips

`episodes/<ep>/clips/NN-name.mp4`, any resolution with a 16:9 picture (scaled to the theme window). Optional
`NN-name.actions.json` = `{ "actions": [{ "t": seconds, "label": "...", "box"?: [x,y,w,h] in 1920x1080 pixels }] }`: labels become
`mark:` times and boxes become `hl` focus targets. The portal recorder writes these; for a hand recording, add marks by hand or
use plain seconds.

## Engine layout

| Path | What |
|---|---|
| `vep.mjs` | the command: finds the project, resolves the theme, builds props and the public folder, runs each step |
| `render-job.mjs` | the stateless renderer (also importable: `renderJob(jobDir, outDir, opts)`) |
| `compose/src/story/` | `Story.tsx` (the one episode composition), `timeline.ts` (storyboard → timed scenes; shared with `vep dry`) |
| `compose/src/fit.ts` | the scheduler: picture-led pacing between beats, cuts in the silence between words |
| `compose/src/*.tsx` | `theme.ts` (live theme), `Backdrop`, `scenes` (title/section/end), `MacScreen`, `Recap`, `Captions`, `Chrome` (footer), `overlays`, `Thumb` |
| `compose/tools/` | `voice.py` + `deepgram_tts.py` + `eleven.py` (narration), `synth_audio.py` (music bed and effects) |
| `compose/webpack-override.cjs` | bundles a project's `scenes/index.tsx` as `@project-scenes`; project scenes import helpers from `@vep/theme` |

A project scene file imports React/Remotion as usual and the theme as `import { C, FONT, rgba, sec, easeOut } from '@vep/theme'`;
read `C`/`FONT` inside components (the theme is applied per render), never at module level.

## Pitfalls (each one cost a render)

- Remotion's dev server does not follow symlinks: the public folder uses hard links (vep handles it).
- Read theme values inside components, not in module-level constants: they are empty until the theme is applied.
- A Remotion render comes out near -24 LUFS; render-job normalises to -14 LUFS with the picture copied untouched.
- `vep dry` before every render: a bad word or mark throws in a second instead of after 20 minutes.
- Voice costs money (ElevenLabs credits are limited): synthesize once per approved line; the cache in `artifacts/` is the record.
