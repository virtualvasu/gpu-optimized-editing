"""Royalty-free ambient bed + UI/transition SFX, synthesised locally (no samples, no licences).
usage: python synth_audio.py <seconds> <out dir>   -> <out dir>/{music-bed,whoosh,whoosh-soft,tick,sting}.mp3 (a theme's assets/)"""
import subprocess, sys, os
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
rng = np.random.default_rng(14)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def env_ar(n, a, r, sr=SR):
    e = np.ones(n); na, nr = int(a * sr), int(r * sr)
    if na: e[:na] = np.linspace(0, 1, na) ** 2
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e
def reverb(x, secs=2.4, wet=0.3):
    n = int(secs * SR); t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 3.2 / secs * 2.2)
        ir = signal.lfilter(*signal.butter(2, 5200 / (SR / 2)), ir); ir /= np.sqrt((ir ** 2).sum())
        out[:, ch] = signal.fftconvolve(x[:, ch], ir)[:len(x)]
    return x * (1 - wet) + out * wet
def lp(x, hz, order=2): return signal.sosfilt(signal.butter(order, hz / (SR / 2), 'low', output='sos'), x, axis=0)
def to_mp3(wav_path, mp3_path):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3_path], check=True)
    os.remove(wav_path)

def saw(f, n):
    t = np.arange(n) / SR
    return 2 * ((t * f) % 1) - 1

def music(seconds, bpm=76):
    n = int(seconds * SR); L = np.zeros((n, 2))
    beat = 60 / bpm; bar = beat * 4
    chords = [  # (root midi, pad notes, arp notes)
        (33, [57, 64, 67, 71, 72], [57, 64, 67, 71, 72, 76]),   # Am9
        (29, [53, 60, 64, 69],     [53, 60, 64, 69, 72, 76]),   # Fmaj7
        (36, [55, 60, 64, 67, 71], [55, 60, 64, 67, 71, 72]),   # Cmaj7
        (31, [55, 62, 67, 69],     [55, 62, 67, 69, 74, 76]),   # G6
    ]
    cdur = bar * 2
    ci = 0; t0 = 0.0
    while t0 < seconds:
        root, pad, arp = chords[ci % 4]
        i0 = int(t0 * SR); ln = int((cdur + 1.6) * SR); i1 = min(n, i0 + ln); m = i1 - i0
        if m <= 0: break
        t = np.arange(m) / SR
        # pad: three detuned saws per note, filtered, slow swell
        padmix = np.zeros((m, 2))
        for k, nt in enumerate(pad):
            f = midi(nt)
            for cents, pan in ((-7, 0.25), (0, 0.5), (7, 0.75)):
                ff = f * 2 ** (cents / 1200)
                s = 2 * ((t * ff + k * 0.13) % 1) - 1
                padmix[:, 0] += s * (1 - pan); padmix[:, 1] += s * pan
        padmix = lp(padmix, 900) * 0.045
        padmix *= env_ar(m, 1.8, 1.8)[:, None]
        # sub
        sub = np.sin(2 * np.pi * midi(root) * t) * 0.22 * env_ar(m, 0.9, 1.4)
        L[i0:i1] += padmix; L[i0:i1, 0] += sub; L[i0:i1, 1] += sub
        ci += 1; t0 += cdur
    # arpeggio plucks (enter after 2 bars, drop out for the last 4s)
    step = beat / 2; k = 0; tt = bar * 2
    pattern = [0, 2, 4, 2, 1, 3, 5, 3]
    while tt < seconds - 3:
        chord = chords[int(tt // cdur) % 4][2]
        nt = chord[pattern[k % 8] % len(chord)] + (12 if (k // 8) % 3 == 2 else 0)
        vel = 0.55 + 0.25 * rng.random() if k % 2 == 0 else 0.35 + 0.2 * rng.random()
        dl = int(0.9 * SR); i0 = int(tt * SR); m = min(dl, n - i0)
        t = np.arange(m) / SR; f = midi(nt)
        p = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 12)) * np.exp(-t * 5.5)
        p *= vel * 0.075 * min(1.0, (tt - bar * 2) / (bar * 2) + 0.15)
        pan = 0.35 + 0.3 * ((k % 4) / 3)
        L[i0:i0 + m, 0] += p * (1 - pan) * 1.4; L[i0:i0 + m, 1] += p * pan * 1.4
        k += 1; tt += step
    # ping-pong dotted-8th delay on everything above the sub register
    d = int(beat * 0.75 * SR); fb = 0.38
    wet = np.zeros_like(L); hp = signal.sosfilt(signal.butter(2, 250 / (SR / 2), 'high', output='sos'), L, axis=0)
    for r in range(1, 5):
        sh = d * r
        if sh >= n: break
        g = fb ** r
        wet[sh:, 0 if r % 2 else 1] += hp[:n - sh, 1 if r % 2 else 0] * g * 0.7
    L += wet
    L = reverb(L, 2.8, 0.34)
    L *= np.minimum(1, np.minimum(np.arange(n) / (2.5 * SR), (n - np.arange(n)) / (4 * SR)))[:, None]
    L = L / np.abs(L).max() * 0.7
    p = os.path.join(OUT, 'music-bed.wav'); wavfile.write(p, SR, (L * 32767).astype(np.int16)); to_mp3(p, p[:-4] + '.mp3')

def whoosh(name, dur, f0, f1, level):
    n = int(dur * SR); chans = []
    for c in range(2):
        x = rng.standard_normal(n)
        f, tt, Z = signal.stft(x, SR, nperseg=2048)
        centre = np.geomspace(f0, f1, Z.shape[1])
        for j in range(Z.shape[1]):
            Z[:, j] *= np.exp(-0.5 * ((np.log(f + 1) - np.log(centre[j])) / 0.55) ** 2)
        _, y = signal.istft(Z, SR, nperseg=2048)
        chans.append(np.pad(y, (0, max(0, n - len(y))))[:n])
    y = np.stack(chans, 1)
    y *= (np.sin(np.pi * np.linspace(0, 1, n)) ** 1.6)[:, None]
    y = reverb(y, 1.2, 0.25); y = y / np.abs(y).max() * level
    p = os.path.join(OUT, name + '.wav'); wavfile.write(p, SR, (y * 32767).astype(np.int16)); to_mp3(p, p[:-4] + '.mp3')

def tick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * 1760 * t) * np.exp(-t * 28) + 0.4 * np.sin(2 * np.pi * 2637 * t) * np.exp(-t * 40)) * 0.5
    y = np.stack([s, s], 1); y = reverb(y, 0.8, 0.22); y = y / np.abs(y).max() * 0.55
    p = os.path.join(OUT, 'tick.wav'); wavfile.write(p, SR, (y * 32767).astype(np.int16)); to_mp3(p, p[:-4] + '.mp3')

def sting():
    n = int(3.2 * SR); t = np.arange(n) / SR
    fall = 95 * np.exp(-t * 0.9) + 42
    sub = np.sin(2 * np.pi * np.cumsum(fall) / SR) * np.exp(-t * 1.1) * 0.8
    sh = sum(np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t * (1.1 + i * 0.25)) * (0.16 / (i + 1))
             for i, f in enumerate([880, 1318.5, 1760, 2637, 3520])) * np.minimum(1, t / 0.25)
    y = np.stack([sub + sh * 0.9, sub + sh * 1.1], 1)
    y = reverb(y, 2.6, 0.38); y = y / np.abs(y).max() * 0.8
    p = os.path.join(OUT, 'sting.wav'); wavfile.write(p, SR, (y * 32767).astype(np.int16)); to_mp3(p, p[:-4] + '.mp3')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 100
    whoosh('whoosh', 1.3, 250, 4200, 0.9); whoosh('whoosh-soft', 1.1, 180, 1800, 0.6); tick(); sting(); music(secs)
    print('synth done')
