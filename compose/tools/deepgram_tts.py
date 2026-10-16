"""Tiny Deepgram Aura text-to-speech helper. Reads the `deepgram` key from the engine .env (or $VEP_ENV), never printed or logged.
Deepgram returns audio only (no alignment), so word timings are estimated from the clip's real duration."""
import json, os, re, subprocess, time, urllib.error, urllib.request

ENV = os.environ.get('VEP_ENV') or os.path.join(os.path.dirname(__file__), '..', '..', '.env')   # the engine's .env
MAX_CHARS = 2000   # Deepgram's per-request limit


def key(name='deepgram'):
    for line in open(ENV):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit(f'{name} key not found in .env')


def tts(text, model, out_mp3):
    """Text -> mp3 (48 kbps, the highest bit rate Deepgram allows for mp3)."""
    if len(text) > MAX_CHARS:
        raise SystemExit(f'Deepgram limit is {MAX_CHARS} characters per block, got {len(text)}')
    attempt = 0
    while True:
        req = urllib.request.Request(
            f'https://api.deepgram.com/v1/speak?model={model}&encoding=mp3&bit_rate=48000',
            data=json.dumps({'text': text}).encode(), method='POST',
            headers={'Authorization': 'Token ' + key(), 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as f:
                audio = f.read()
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code in (429, 500, 502, 503) and attempt < 3: attempt += 1; time.sleep(2 * attempt); continue
            raise SystemExit(f'Deepgram HTTP {e.code}: {msg}')
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if attempt == 3: raise
            attempt += 1; time.sleep(2 * attempt)
    open(out_mp3, 'wb').write(audio)


def speech_span(mp3, dur):
    """(start, end) of the audible part, from ffmpeg silencedetect."""
    r = subprocess.run(['ffmpeg', '-i', mp3, '-af', 'silencedetect=noise=-38dB:d=0.15', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', r)]
    s, e = 0.0, dur
    if starts and starts[0] < 0.05 and ends: s = ends[0]
    if starts and (len(starts) > len(ends) or ends[-1] >= dur - 0.05): e = starts[-1]
    return (s, e) if e - s > 0.3 else (0.0, dur)


def estimate_words(units, spoken_len, mp3, dur):
    """units: (display, spoken_start, spoken_end) -> [{'t','s','e'}], spread over the audible span by character
    count, with extra weight after commas and sentence ends so the captions pause where the voice does."""
    s0, s1 = speech_span(mp3, dur)
    w = []
    for d, a, z in units:
        pause = 6 if d[-1:] in '.?!' else 3 if d[-1:] in ',;:' else 0
        w.append((z - a) + pause)
    total = sum(w) or 1
    t, out = s0, []
    for (d, a, z), wi in zip(units, w):
        span = (s1 - s0) * wi / total
        pause = (6 if d[-1:] in '.?!' else 3 if d[-1:] in ',;:' else 0) / total * (s1 - s0)
        out.append({'t': d, 's': round(t, 3), 'e': round(t + span - pause, 3)})
        t += span
    return out


# ── real word timings: Deepgram speech-to-text on the synthesized clip (cents per hour of audio), aligned to our display words
NUM = {'0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten'}
_norm = lambda t: NUM.get(re.sub(r'[^a-z0-9]', '', t.lower()), re.sub(r'[^a-z0-9]', '', t.lower()))


def transcribe_words(mp3):
    """[(word, start, end)] heard in the clip."""
    req = urllib.request.Request('https://api.deepgram.com/v1/listen?model=nova-3&punctuate=false&smart_format=false',
                                 data=open(mp3, 'rb').read(), method='POST',
                                 headers={'Authorization': 'Token ' + key(), 'Content-Type': 'audio/mpeg'})
    with urllib.request.urlopen(req, timeout=120) as f:
        d = json.load(f)
    return [(w['word'], w['start'], w['end']) for w in d['results']['channels'][0]['alternatives'][0]['words']]


def align_words(units, spoken, mp3, dur):
    """Display words with measured times. Our spoken tokens are matched to the heard words in order (difflib); words that did
    not match (numbers, spelled-out letters) are interpolated between their neighbours."""
    import difflib
    heard = transcribe_words(mp3)
    ours, owner = [], []                       # spoken tokens of every display unit, and which unit they belong to
    for ui, (d, a, z) in enumerate(units):
        for tok in spoken[a:z].split():
            ours.append(_norm(tok)); owner.append(ui)
    sm = difflib.SequenceMatcher(None, ours, [_norm(w) for w, _, _ in heard], autojunk=False)
    start, end = {}, {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            ui = owner[blk.a + k]; w = heard[blk.b + k]
            start[ui] = min(start.get(ui, 9e9), w[1]); end[ui] = max(end.get(ui, 0), w[2])
    out = [None] * len(units)
    known = sorted(start)
    for ui, (d, a, z) in enumerate(units):
        if ui in start:
            out[ui] = [start[ui], end[ui]]; continue
        prev = max([k for k in known if k < ui], default=None); nxt = min([k for k in known if k > ui], default=None)
        t0 = end[prev] if prev is not None else 0.0
        t1 = start[nxt] if nxt is not None else dur
        gap = [k for k in range(ui, len(units)) if k not in start and (nxt is None or k < nxt)]
        i = gap.index(ui); n = len(gap)
        out[ui] = [t0 + (t1 - t0) * i / n, t0 + (t1 - t0) * (i + 1) / n]
    return [{'t': d, 's': round(s_, 3), 'e': round(e_, 3)} for (d, a, z), (s_, e_) in zip(units, out)]
