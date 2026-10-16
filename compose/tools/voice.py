"""narration.json -> <out dir>/<block>.mp3 + <block>.json (duration + word timings) + blocks.json (all blocks, read by the render).
usage: voice.py <narration.json> <out dir> [block ids]   (run through `vep voice`; $VEP_VOICE = the project's voice defaults as JSON)
Markup: [[display|spoken]]  e.g. [[emp_id|e m p underscore i d]]  (captions show 'emp_id', the voice says the spoken form)."""
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from eleven import tts
import deepgram_tts

def parse(text):
    spoken, units = '', []          # units: (display, spoken_start, spoken_end)
    for part in re.split(r'(\[\[[^\]]+\]\])', text):
        if not part: continue
        m = re.match(r'\[\[([^|]+)\|([^\]]+)\]\]', part)
        if m:
            s = len(spoken); spoken += m.group(2); units.append((m.group(1), s, len(spoken)))
        else:
            for w in re.finditer(r'\S+', part):
                s = len(spoken) + w.start(); units.append((w.group(), s, len(spoken) + w.end()))
            spoken += part
    return spoken, units

def main(narration, out, only=None):
    n = {**json.loads(os.environ.get('VEP_VOICE') or '{}'), **json.load(open(narration))}; os.makedirs(out, exist_ok=True)
    blocks = n['blocks']
    for i, b in enumerate(blocks):
        if only and b['id'] not in only: continue
        mp3 = os.path.join(out, b['id'] + '.mp3'); js = os.path.join(out, b['id'] + '.json')
        if os.path.exists(js) and not os.environ.get('FORCE') and not os.environ.get('REALIGN'): print('skip', b['id']); continue
        spoken, units = parse(b['text'])
        if os.environ.get('REALIGN') and os.path.exists(mp3):      # keep the audio, re-measure the word times only
            dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).decode())
            json.dump({'id': b['id'], 'duration': round(dur, 3), 'words': deepgram_tts.align_words(units, spoken, mp3, dur)}, open(js, 'w'))
            print(f"{b['id']}: realigned"); continue
        prev = parse(blocks[i-1]['text'])[0][-300:] if i else None
        nxt = parse(blocks[i+1]['text'])[0][:300] if i + 1 < len(blocks) else None
        if n.get('provider') == 'deepgram':
            deepgram_tts.tts(spoken, n['voice_id'], mp3)
            dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).decode())
            try:
                words = deepgram_tts.align_words(units, spoken, mp3, dur)
            except Exception as e:   # speech-to-text unavailable: fall back to estimated timings
                print('  word timing estimated (', e, ')'); words = deepgram_tts.estimate_words(units, len(spoken), mp3, dur)
        else:
            al = tts(spoken, n['voice_id'], mp3, model=n.get('model', 'eleven_multilingual_v2'), prev_text=prev, next_text=nxt, settings=n.get('settings'))
            st, en = al['character_start_times_seconds'], al['character_end_times_seconds']
            words = [{'t': d, 's': round(st[min(a, len(st)-1)], 3), 'e': round(en[min(z-1, len(en)-1)], 3)} for d, a, z in units]
            dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).decode())
        json.dump({'id': b['id'], 'duration': round(dur, 3), 'words': words}, open(js, 'w'))
        print(f"{b['id']}: {dur:.2f}s, {len(spoken)} chars")
    # one file with every block's duration + word timings: the render reads this
    allb = {b['id']: json.load(open(os.path.join(out, b['id'] + '.json'))) for b in blocks if os.path.exists(os.path.join(out, b['id'] + '.json'))}
    json.dump(allb, open(os.path.join(out, 'blocks.json'), 'w'))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
