"""Normalise a storyboard to sentence cues: one picture cue per spoken sentence, with the picture speed set automatically.
usage: sentence_cues.py <storyboard.json> <voice/blocks.json> <scaled/clips.json>      (run through `vep cues <ep>`, after `vep voice` and `vep prep`)

Why: a narrator must never be interrupted or hurried inside a sentence. Cue words in the middle of a sentence make the voice and
the picture fight over timing (the voice stops, or the picture races). So for every screen scene:
  - only the FIRST beat of each sentence is kept (a sentence = text up to . ? !); its clip time is where that sentence starts on screen;
  - the picture speed for a sentence is the footage between its cue and the next cue divided by the sentence's spoken length,
    held between 1x and 2x (a scene may raise the cap with `maxSpeed`, never above 3x; keep option-heavy screens at 1.5x or less): slower footage is held on its last frame while the sentence finishes, faster footage runs at 5x and the
    NEXT sentence waits until the picture has shown it (pacing "voice": a short gap, then the next sentence);
  - callouts and highlights tied to a recorded mark (`focus`) appear when that mark is on screen, not on a word.
Needs `"pacing": "calm"` (or "voice") in the storyboard (this tool sets "calm": the sentence is spoken while the picture rests, then the step plays silently). Safe to run again."""
import json, re, sys

MAXR = 2.0   # relaxed pace (owner, 2026-10-20): the picture never runs faster than 2x by default, 3x at most (a scene's maxSpeed is capped at 3)
norm = lambda t: re.sub(r'[^a-z0-9_]', '', t.lower())

def main(sb_path, blocks_path, clips_path):
    sb = json.load(open(sb_path)); BLK = json.load(open(blocks_path)); CLIPS = json.load(open(clips_path))

    def widx(bid, needle, n=0):
        ws = [norm(w['t']) for w in BLK[bid]['words']]; toks = [norm(t) for t in needle.split() if norm(t)]
        hits = [i for i in range(len(ws) - len(toks) + 1) if all(ws[i + k].startswith(toks[k]) for k in range(len(toks)))]
        if not hits: raise SystemExit(f'"{needle}" not found in block {bid}')
        return hits[n] if n < len(hits) else hits[-1]

    def cut(bid, i):
        w = BLK[bid]['words']; return 0.0 if i <= 0 else (w[i - 1]['e'] + w[i]['s']) / 2

    def sentence(bid, i): return sum(1 for w in BLK[bid]['words'][:i] if re.search(r'[.?!]$', w['t']))

    def resolve(v, clip):
        if isinstance(v, (int, float)): return float(v)
        m = re.match(r'^mark:(.+?)(?:([+-]\d+(?:\.\d+)?))?$', v)
        if not m or m.group(1) not in CLIPS[clip]['marks']: raise SystemExit(f'clip {clip}: unknown time {v}')
        return CLIPS[clip]['marks'][m.group(1)] + (float(m.group(2)) if m.group(2) else 0.0)

    for sc in sb['scenes']:
        if sc.get('type') != 'screen': continue
        clip = sc['clip']; kept = []; seen = set()
        for bt in sc['beats']:
            i = widx(bt['b'], bt['w'], bt.get('n', 0)); key = (bt['b'], sentence(bt['b'], i))
            if key in seen: continue
            seen.add(key)
            j = i                                              # snap the cue to the FIRST word of its sentence
            while j > 0 and not re.search(r'[.?!]$', BLK[bt['b']]['words'][j - 1]['t']): j -= 1
            words = [w['t'] for w in BLK[bt['b']]['words']]
            for k in range(1, 8):                              # the shortest phrase from there that finds exactly that word
                phrase = ' '.join(words[j:j + k])
                try:
                    if widx(bt['b'], phrase, 0) == j: break
                except SystemExit: pass
            bt = {x: y for x, y in bt.items() if x not in ('n',)}; bt['w'] = phrase
            kept.append((bt, j))
        rates = {}
        for k, (bt, i) in enumerate(kept):
            nx = kept[k + 1] if k + 1 < len(kept) else None
            a0 = cut(bt['b'], i)
            a1 = cut(nx[0]['b'], nx[1]) if nx and nx[0]['b'] == bt['b'] else BLK[bt['b']]['duration']
            v0 = resolve(bt['v'], clip); v1 = resolve(nx[0]['v'], clip) if nx else resolve(sc['endV'], clip)
            r = round(max(1.0, min(min(sc.get('maxSpeed', MAXR), 3.0), (v1 - v0) / max(a1 - a0, 0.5))), 2)
            if nx: rates[k + 1] = r
            else: sc['endRate'] = r
        sc['beats'] = [{**{x: y for x, y in bt.items() if x != 'rate'}, **({'rate': rates[k]} if k in rates else {})} for k, (bt, _) in enumerate(kept)]
        for o in sc.get('overlays', []):
            if o.get('kind') == 'callout' and o.get('focus'):      # timed by its mark (what is on screen), not by a word
                o.pop('b', None); o.pop('w', None); o.pop('n', None)
                o['lines'] = [l['text'] if isinstance(l, dict) else l for l in o.get('lines', [])]
    sb['pacing'] = 'calm'   # sentence on a still picture, then the step silently (owner, 2026-10-20)
    json.dump(sb, open(sb_path, 'w'), indent=1)
    n = sum(len(sc['beats']) for sc in sb['scenes'] if sc.get('type') == 'screen')
    print(f'{n} sentence cues in {sum(1 for sc in sb["scenes"] if sc.get("type") == "screen")} screen scenes (pacing: voice)')

if __name__ == '__main__':
    if len(sys.argv) != 4: raise SystemExit(__doc__)
    main(*sys.argv[1:])
