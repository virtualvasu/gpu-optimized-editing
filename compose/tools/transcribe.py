"""Transcribe a recording's audio with Deepgram: word times + utterances.
usage: transcribe.py <audio.mp3> <out prefix>      (key in $DEEPGRAM_KEY; run through `vep ingest`)
writes <prefix>.transcript.json (utterances with start/end + words) and <prefix>.transcript.txt ([start-end] text, one per line)."""
import json, os, sys, urllib.request

def main(audio, prefix):
    key = os.environ.get('DEEPGRAM_KEY') or sys.exit('transcribe: DEEPGRAM_KEY missing (deepgram= in the pipeline .env)')
    req = urllib.request.Request('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true&punctuate=true',
                                 data=open(audio, 'rb').read(), headers={'Authorization': 'Token ' + key, 'Content-Type': 'audio/mpeg'})
    d = json.load(urllib.request.urlopen(req, timeout=600))
    u = d['results']['utterances']
    json.dump([{'start': x['start'], 'end': x['end'], 'text': x['transcript'], 'words': [{'t': w['punctuated_word'] if 'punctuated_word' in w else w['word'], 's': w['start'], 'e': w['end']} for w in x['words']]} for x in u],
              open(prefix + '.transcript.json', 'w'))
    with open(prefix + '.transcript.txt', 'w') as f:
        for x in u: f.write(f"[{x['start']:.1f}-{x['end']:.1f}] {x['transcript']}\n")
    print(f'transcript: {len(u)} utterances -> {prefix}.transcript.txt')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
