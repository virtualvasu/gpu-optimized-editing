"""Cut one narration block into several at chosen words, from the audio that was already paid for (no new synthesis).
usage: split_block.py <narration.json> <voice dir> <block id> "<phrase that starts part 2>" ["<phrase that starts part 3>" ...]
(run through `vep split <ep> <block> "<phrase>" ...`)

The block <id> becomes <id>a, <id>b, ...: each part gets its slice of the mp3 (cut in the silence just before the phrase), its
own word timings and its share of the text; narration.json lists the parts instead of the block, and blocks.json is rebuilt.
The whole-block files are kept in <voice dir>/_whole/ (the paid record). Use it when one sentence group has to span two scenes."""
import json, os, re, shutil, subprocess, sys

def norm(s): return re.sub(r'[^a-z0-9_]', '', s.lower())

def find(words, phrase):
    toks = [norm(t) for t in phrase.split() if norm(t)]
    ws = [norm(w['t']) for w in words]
    for i in range(len(ws) - len(toks) + 1):
        if all(ws[i + k].startswith(toks[k]) for k in range(len(toks))): return i
    raise SystemExit(f'"{phrase}" not found in the block')

def main(narration, voice, bid, phrases):
    n = json.load(open(narration))
    idx = next((i for i, b in enumerate(n['blocks']) if b['id'] == bid), None)
    if idx is None: raise SystemExit(f'block {bid} is not in {narration}')
    d = json.load(open(os.path.join(voice, bid + '.json')))
    words = d['words']
    cuts = sorted(find(words, p) for p in phrases)
    if len(set(cuts)) != len(cuts) or cuts[0] == 0: raise SystemExit('each phrase must start a new part (not the first word)')
    edges = [0] + cuts + [len(words)]
    # cut point = middle of the silence before the first word of each later part
    times = [0.0] + [(words[c - 1]['e'] + words[c]['s']) / 2 for c in cuts] + [d['duration']]
    whole = os.path.join(voice, '_whole'); os.makedirs(whole, exist_ok=True)
    src = os.path.join(voice, bid + '.mp3')
    shutil.copy(src, os.path.join(whole, bid + '.mp3')); shutil.copy(os.path.join(voice, bid + '.json'), os.path.join(whole, bid + '.json'))
    parts = []
    for k in range(len(edges) - 1):
        pid = bid + 'abcdefgh'[k]; s, e = times[k], times[k + 1]
        out = os.path.join(voice, pid + '.mp3')
        subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ss', f'{s:.3f}', '-to', f'{e:.3f}', '-c:a', 'libmp3lame', '-q:a', '2', out])
        w = [{'t': x['t'], 's': round(x['s'] - s, 3), 'e': round(x['e'] - s, 3)} for x in words[edges[k]:edges[k + 1]]]
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).decode())
        json.dump({'id': pid, 'duration': round(dur, 3), 'words': w}, open(os.path.join(voice, pid + '.json'), 'w'))
        parts.append({'id': pid, 'text': ' '.join(x['t'] for x in w)})
        print(f'{pid}: {dur:.2f}s  {parts[-1]["text"]}')
    for f in (bid + '.mp3', bid + '.json'): os.remove(os.path.join(voice, f))
    n['blocks'][idx:idx + 1] = parts
    json.dump(n, open(narration, 'w'), indent=1)
    allb = {b['id']: json.load(open(os.path.join(voice, b['id'] + '.json'))) for b in n['blocks'] if os.path.exists(os.path.join(voice, b['id'] + '.json'))}
    json.dump(allb, open(os.path.join(voice, 'blocks.json'), 'w'))

if __name__ == '__main__':
    if len(sys.argv) < 5: raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
