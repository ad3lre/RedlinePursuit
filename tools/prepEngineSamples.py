#!/usr/bin/env python3
"""Build seamless engine-loop samples from CC BY 3.0 Wikimedia Commons recordings.

For each playable car, steady-RPM windows are cut from a real recording of the same (or a closely matching)
engine, the firing fundamental is measured (harmonic product spectrum), and a short loop is written with an
equal-power crossfade so it repeats without a click. At runtime (src/engineSamples.js) the loops are
pitch-shifted (playbackRate = rpm / sampleRpm) and crossfaded by RPM — classic granular-free "RPM bank" playback.

Usage: python3 tools/prepEngineSamples.py   (needs ffmpeg + numpy; writes assets/audio/engine/*.wav + bank.json)
Credits: assets/CREDITS.md
"""
import json, os, subprocess, time, urllib.request
import numpy as np

SR = 22050
LOOP = 0.5   # seconds of loop body
XF = 0.1     # crossfade seconds
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio', 'engine')
CACHE = '/tmp/eng'
UA = {'User-Agent': 'RedlinePursuitBot/1.0 (founder@rxnd.de)'}
C = 'https://upload.wikimedia.org/wikipedia/commons/'
SRC = {
    'viper':   C + 'c/ce/Dodge_Viper_GTS_-_engine_and_exhaust_sound_%28YouTube_tfZiZqQQBOE%29.opus',
    'viper2':  C + 'e/ee/Dodge_Viper_GTS_-_engine_and_exhaust_sound_%28YouTube_Kcy6fjTiun8%29.opus',
    'kaiser':  C + '8/87/BMW_M2_Competition_with_Remus_exhaust_-_engine_and_exhaust_sound_%28YouTube_51_uOnGip4w%29.opus',
    'bruiser': C + 'b/be/Ford_Mustang_GT_%28S550%29_-_engine_and_exhaust_sound_%28YouTube_2ceiDjGgpI8%29.opus',
    'gt3rs2':  C + '9/9e/Porsche_911_GT3_RS_%28991%29_-_engine_and_exhaust_sound_%28YouTube_otznJ2rBoks%29.opus',
    'mini':    C + '8/8f/Volkswagen_Golf_GTI_-_engine_and_exhaust_sound_%28YouTube_NrA1GgbjFRg%29.opus',
    'vito':    C + '0/0c/Volkswagen_Passat_B5_1.9_TDI_%28remapped%2C_185_hp%29_-_engine_and_exhaust_sound_%28YouTube_12P7SQ_48k4%29.opus',
}
# car -> cylinders, [(source, start s)] ordered low -> high RPM (steady windows found with a pitch tracker)
PICKS = {
    'viper':   (10, [('viper', 2.0), ('viper2', 46.9), ('viper2', 70.9)]),
    'kaiser':  (6,  [('kaiser', 48.4), ('kaiser', 545.2), ('kaiser', 532.1), ('kaiser', 18.8)]),
    'bruiser': (8,  [('bruiser', 67.4), ('bruiser', 121.6), ('bruiser', 107.9)]),
    'gt3rs':   (6,  [('gt3rs2', 113.0), ('gt3rs2', 110.3), ('gt3rs2', 34.4), ('gt3rs2', 98.9)]),
    'mini':    (4,  [('mini', 2.8), ('mini', 270.3), ('mini', 291.4), ('mini', 217.6)]),
    'vito':    (4,  [('vito', 17.9), ('vito', 56.5), ('vito', 76.1)]),
}


def load(name):
    os.makedirs(CACHE, exist_ok=True)
    raw = os.path.join(CACHE, name + '.raw')
    if not os.path.exists(raw):
        op = os.path.join(CACHE, name + '.opus')
        if not os.path.exists(op):
            with urllib.request.urlopen(urllib.request.Request(SRC[name], headers=UA), timeout=60) as r, open(op, 'wb') as f:
                f.write(r.read())
            time.sleep(2)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', op, '-ac', '1', '-ar', str(SR), '-f', 's16le', raw], check=True)
    return np.fromfile(raw, dtype=np.int16).astype(np.float32) / 32768


def f0(seg):
    n = len(seg)
    S = np.abs(np.fft.rfft(seg * np.hanning(n), 4 * n)); fr = np.fft.rfftfreq(4 * n, 1 / SR); P = S.copy()
    for h in (2, 3, 4):
        P[: len(S) // h] *= S[::h][: len(S) // h]
    m = (fr > 18) & (fr < 600)
    return float(fr[np.argmax(P * m)])


def main():
    os.makedirs(OUT, exist_ok=True)
    bank = {}
    for car, (cyl, picks) in PICKS.items():
        bank[car] = []
        for i, (src, t) in enumerate(picks):
            x = load(src)
            L, X, a = int(SR * LOOP), int(SR * XF), int(t * SR)
            seg = x[a:a + L + X].astype(np.float64)
            win = int(SR * 0.2)
            fs = [f0(seg[k:k + win]) for k in range(0, len(seg) - win, int(SR * 0.05))]
            fd = float(np.median(fs))
            w = np.linspace(0, 1, X)
            body = seg[:L].copy()
            body[:X] = seg[:X] * np.sqrt(w) + seg[L:L + X] * np.sqrt(1 - w)   # tail flows into head
            body -= body.mean()
            body /= np.sqrt((body ** 2).mean()) + 1e-9
            body = np.clip(body * 0.2, -0.98, 0.98)
            fn = f'{car}_{i}.wav'
            pcm = os.path.join(CACHE, fn + '.pcm')
            (body * 32767).astype(np.int16).tofile(pcm)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', pcm,
                            os.path.join(OUT, fn)], check=True)
            bank[car].append({'file': fn, 'rpm': round(fd * 120 / cyl), 'f0': round(fd, 1)})
        bank[car].sort(key=lambda s: s['rpm'])
    with open(os.path.join(OUT, 'bank.json'), 'w') as f:
        json.dump(bank, f, indent=1)
    print(json.dumps(bank))


if __name__ == '__main__':
    main()
