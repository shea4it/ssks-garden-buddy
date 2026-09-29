#!/usr/bin/env python3
"""Voice audit (v0.50.2): measures Piper clips before and after the panel's
voice processing (processVoice in control.html, mirrored here exactly).

Usage:
    python3 tests/voice-audit.py <folder of .wav clips> [presence_db] [air_db]

For each clip, prints where the speech starts, peaks after processing, and
how much energy sits above 7 kHz (the synthesis "fizz" small speakers turn
into distortion). See tests/README.md, "Voice audit", for how the v0.50.2
numbers were made (all built-in lines x every voice, Praat and Whisper).
Needs numpy, scipy, soundfile.
"""
import glob
import sys
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

FS = 48000
VOICE_TARGET = 0.195
VOICE_PEAK = 0.84


def biquad(kind, f0, fs, q, gain_db=0.0):
    """The same RBJ formulas as biquad() in control.html."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / fs
    cs, al = np.cos(w), np.sin(w) / (2 * q)
    if kind == 'highpass':
        b = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2]
        a = [1 + al, -2 * cs, 1 - al]
    elif kind == 'peaking':
        b = [1 + al * A, -2 * cs, 1 - al * A]
        a = [1 + al / A, -2 * cs, 1 - al / A]
    else:  # highshelf
        s = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * cs + s), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - s)]
        a = [(A + 1) - (A - 1) * cs + s, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - s]
    return np.array(b) / a[0], np.array(a) / a[0]


def process_voice(x, fs, presence=2.0, air=0.0):
    """processVoice(): tone, then level, then 6 ms / 15 ms fades."""
    y = x.astype(float).copy()
    filters = [('highpass', 90, 0.7, 0), ('peaking', 320, 1, -2), ('peaking', 3000, 0.9, presence)]
    if air:
        filters.append(('highshelf', 7000, 0.707, air))
    for kind, f0, q, g in filters:
        b, a = biquad(kind, f0, fs, q, g)
        y = lfilter(b, a, y)
    act = np.abs(y) > 0.01
    if not act.any():
        return y
    gain = min(VOICE_TARGET / np.sqrt(np.mean(y[act] ** 2)), VOICE_PEAK / np.max(np.abs(y)), 8)
    env = np.full(len(y), gain)
    fi, fo = int(fs * 0.006), int(fs * 0.015)
    env[:fi] *= np.arange(fi) / fi
    env[len(y) - fo:] *= (fo - 1 - np.arange(fo)) / fo
    return y * env


def hf_share(x, fs):
    """Energy above 7 kHz as a share of all, over the loud parts, in dB."""
    n = int(fs * 0.01)
    F = x[: len(x) // n * n].reshape(-1, n)
    X = np.abs(np.fft.rfft(F * np.hanning(n), axis=1)) ** 2
    fr = np.fft.rfftfreq(n, 1 / fs)
    e = 10 * np.log10(np.mean(F ** 2, axis=1) + 1e-10)
    loud = e > e.max() - 30
    return 10 * np.log10(X[loud][:, fr > 7000].sum() / X[loud].sum() + 1e-12)


def audit(path, presence, air):
    x, sr = sf.read(path)
    if x.ndim > 1:
        x = x[:, 0]
    fr = Fraction(FS, sr)
    up = resample_poly(x, fr.numerator, fr.denominator)   # what decodeAudioData hands the panel
    y = process_voice(up, FS, presence, air)
    return {
        'startMs': round(np.argmax(np.abs(x) > 0.02) / sr * 1000, 1),
        'firstSample': round(float(abs(y[0])), 4),
        'peakDb': round(float(20 * np.log10(np.max(np.abs(y)))), 2),
        'hfRaw': round(float(hf_share(up, FS)), 1),
        'hf': round(float(hf_share(y, FS)), 1),
    }


if __name__ == '__main__':
    folder = sys.argv[1]
    presence = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    air = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    rows = [audit(p, presence, air) for p in sorted(glob.glob(folder + '/*.wav'))]
    print(f'{len(rows)} clips | presence {presence:+} dB, air {air:+} dB')
    print(f"  starts within 10 ms: {sum(r['startMs'] < 10 for r in rows)}")
    print(f"  max peak after processing: {max(r['peakDb'] for r in rows)} dBFS (the voice skips the limiter; -1.5 is the cap)")
    print(f"  max first sample after the fade: {max(r['firstSample'] for r in rows)}")
    print(f"  energy above 7 kHz: raw {np.mean([r['hfRaw'] for r in rows]):.1f} dB -> processed {np.mean([r['hf'] for r in rows]):.1f} dB")
