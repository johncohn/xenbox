# EEG Threshold & Effect Control — Math Reference

This document describes how raw EEG data from the Muse headband is processed into the audio effect wet/dry mix value.

---

## Signal Chain Overview

```
Muse EEG bands
    │
    ▼
1. Relative alpha        alpha_rel = alpha / (alpha + lowBeta + highBeta + theta + gamma)
    │
    ▼
2. Tracked value (A/B)   smoothedAlphaLegacy  or  smoothedAlphaDrift   (0–127)
    │
    ▼
3. Threshold gate        chorus_wetVal  0–1, drives audio mix and LED 2
```

---

## Step 1 — Relative Alpha

Alpha power is normalised against total band power so the value is
person-independent and session-independent:

```
alpha_rel = alpha / (alpha + lowBeta + highBeta + theta + gamma)
```

Range: 0–1 (e.g. 0.4 means alpha is 40% of total signal).

---

## Step 2 — Tracked Value: Legacy vs. Drift Fix

Two tracked values are computed **every frame, in parallel**, regardless of
which one is actually driving the effect. This lets the on-screen plot show
both traces for comparison (toggle: **Drift Fix** checkbox / depth-knob
button). `driftFixEnabled` selects which one drives the effect:

```
smoothedAlpha = driftFixEnabled ? smoothedAlphaDrift : smoothedAlphaLegacy
```

### "A" — Legacy (lifetime running mean)

A running mean of `alpha_rel` (Welford's online algorithm), deviation from
which is squashed through a sigmoid and EMA-smoothed:

```
alphaN    += 1
alphaMean += (alpha_rel - alphaMean) / alphaN

deviationLegacy = alpha_rel - alphaMean
mixLegacy       = 1 / (1 + exp(-10 × deviationLegacy))        # 0-1
smoothedAlphaLegacy += smoothK × (mixLegacy × 127 - smoothedAlphaLegacy)
```

`smoothK = 0.008` (~2s time constant at ~60fps). `alphaMean` resets to 0 on
Muse disconnect.

**Known problem**: this mean's effective memory window grows without bound
as the session runs — the longer you've been wearing the headband, the less
responsive `alphaMean` is to real baseline drift. This is the root cause of
the effect "getting stuck" fully on or off over a long session — not a bug
in the threshold gate itself.

### "B" — Drift Fix (per Greg Appelbaum's suggestion)

Instead of moving the threshold to compensate for drift (the old
"Autotrack" approach, since removed), this keeps the threshold **fixed**
and removes the drift from the signal before it reaches the comparator.
Two bounded EMAs track `alpha_rel` at different speeds; their difference is
the tracked value:

```
kFast = 1 / (fastSeconds × 60)     # fastSeconds = 7.5
kSlow = 1 / (slowSeconds × 60)     # slowSeconds = 240 (4 min)

fastEMA_alpha += kFast × (alpha_rel - fastEMA_alpha)
slowEMA_alpha += kSlow × (alpha_rel - slowEMA_alpha)

deviationDrift = fastEMA_alpha - slowEMA_alpha
mixDrift       = 1 / (1 + exp(-10 × deviationDrift))          # 0-1
smoothedAlphaDrift += smoothK × (mixDrift × 127 - smoothedAlphaDrift)
```

Both EMAs are seeded to the first real sample (not 0) and never stop
adapting (unlike the lifetime mean above). Slow, genuine baseline drift
moves both EMAs together and cancels out in the subtraction; a state
change fast enough to separate the two registers as a real deviation.

**Effective range**: because this is the difference of two low-pass
filters, it behaves like a band-pass — it only cancels movement much
slower than `slowSeconds` (very roughly, longer than ~10× slowSeconds,
i.e. tens of minutes). Movement on a timescale *between* `fastSeconds` and
`slowSeconds` (here, roughly 1–4 minutes) passes through largely
uncancelled. **Open question, not yet resolved**: a live multi-minute
trace (2026-09-12) showed persistent minute-scale wander in
`smoothedAlphaDrift` even with a long `slowSeconds`/`readySeconds`. It's
unknown whether that wander is genuine alpha/relaxation-state signal (which
arguably *should* pass through) or artifact that ought to be filtered —
no amount of retuning `fastSeconds`/`slowSeconds` alone resolves this until
that's answered.

**Readiness gate**: `driftReady` is true once `readySeconds` (480s / 8 min)
have passed since the EMAs were first seeded. Sent to the LED controller
(`alpha_score` message, `ready` field) so LED 2 shows a slow yellow pulse
("still training, don't set the threshold yet") instead of the aqua
wet-value display until then. This is a fixed-wall-clock heuristic
(`2 × slowSeconds`), not something that adapts to how settled the signal
actually is.

---

## Step 3 — Threshold Gate (Knob 3), with Hysteresis

The **threshold encoder (knob 3)** sets `encoderThreshold` (0–127, default
64) and is now always fixed — no automatic repositioning (the old
"Autotrack" mechanism was removed in favor of Drift Fix, which corrects the
signal instead of the threshold).

A deadband creates separate ON/OFF trip points around the threshold so the
effect doesn't flicker right at the boundary:

```
onThresh  = min(127, encoderThreshold + deadband / 2)   # deadband = 8
offThresh = max(0,   encoderThreshold - deadband / 2)

if !effectOnState and smoothedAlpha > onThresh:  effectOnState = true
if  effectOnState and smoothedAlpha < offThresh: effectOnState = false

chorus_wetVal = effectOnState
    ? min(1, max(0, (smoothedAlpha - offThresh) / (127 - offThresh)))
    : 0
```

### Threshold behaviour

| Knob 3 value | Effect activates when… |
|---|---|
| **0** | Always somewhat active (smoothedAlpha always > 0) |
| **64** (default) | Personal baseline must be clearly exceeded |
| **127** | Needs maximum alpha activity to activate |

---

## Master Gate

Even if `chorus_wetVal > 0`, the effect and LED 2 are zeroed unless:

```
effectActive = hasEEGData AND isWorn
```

- `hasEEGData` — Muse is streaming fresh band power data
- `isWorn` — PPG infrared channel confirms headset is on head

---

## Knob Summary

| Knob | Turn | Button press |
|---|---|---|
| 1 (gain) | Master gain (CC5) | Cycle input source: Live → Tone → Sample → Airport → Zone → Live |
| 2 (depth) | Active effect's character param | Toggle **Drift Fix** on/off (default ON) |
| 3 (threshold) | EEG activation threshold (fixed — no auto-repositioning) | Cycle to next effect |

See `effects-and-controls.md` (project memory) for the full effect chain
and input-source list — this doc covers only the alpha → threshold math.
