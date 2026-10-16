"""Tiny ElevenLabs helper. Reads the keys from the engine .env (or $VEP_ENV) — never printed or logged.
Uses `elevenlabs` first; when that key is out of credits (quota error) it switches to `elevenlabs2` for the rest of the run."""
import base64, json, os, urllib.request, urllib.error

ENV = os.environ.get('VEP_ENV') or os.path.join(os.path.dirname(__file__), '..', '..', '.env')   # the engine's .env

KEYS = ['elevenlabs', 'elevenlabs2']
_active = [0]


def key(name=None):
    name = name or KEYS[_active[0]]
    for line in open(ENV):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit(f'{name} key not found in .env')


def _out_of_credits(code, body):
    return code in (401, 402, 429) and any(w in body.lower() for w in ('quota', 'credit', 'exceeds your', 'insufficient'))

def tts(text, voice_id, out_mp3, model='eleven_multilingual_v2', prev_text=None, next_text=None,
        settings=None, fmt='mp3_44100_128'):
    """Text -> mp3 + character alignment. Returns the alignment dict."""
    body = {'text': text, 'model_id': model,
            'voice_settings': settings or {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.15, 'use_speaker_boost': True}}
    if prev_text: body['previous_text'] = prev_text
    if next_text: body['next_text'] = next_text
    import time
    attempt = 0
    while True:
        req = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format={fmt}',
            data=json.dumps(body).encode(), method='POST',
            headers={'xi-api-key': key(), 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as f:
                data = json.load(f)
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if _out_of_credits(e.code, msg) and _active[0] + 1 < len(KEYS):
                _active[0] += 1
                print(f'{KEYS[_active[0] - 1]} is out of credits, switching to {KEYS[_active[0]]}')
                continue
            if e.code in (429, 500, 502, 503) and attempt < 3: attempt += 1; time.sleep(2 * attempt); continue
            raise SystemExit(f'ElevenLabs HTTP {e.code}: {msg}')
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if attempt == 3: raise
            attempt += 1
            time.sleep(2 * attempt)
    open(out_mp3, 'wb').write(base64.b64decode(data['audio_base64']))
    return data.get('alignment') or data.get('normalized_alignment')
