# xenbox Cheat Sheet

Labels in **(parens)** match the physical text Mike printed on the panel.

---

## Knob 1 — (VOL)

| Action | What it does |
|--------|-------------|
| **Turn** | Adjust master gain / volume — (VOL) — range 0–127, default 100 |
| **Press** | Cycle input source — (SRC) — Live → Tone → Sample → Airport → Zone → Live |
| **LED below** | (BYP) Green = system ready · Red = bypass active (GPIO17 grounded) |

---

## Knob 2 — (MIX)

| Action | What it does |
|--------|-------------|
| **Turn** | Adjust active effect character / depth — (MIX) — range 0–127, default 64 |
| **Press** | Toggle Drift Fix on / off (default: on) |
| **LED below** | (MUS) Off = Muse not connected · Purple solid = Muse connected · Purple slow pulse = streaming + headband worn |

---

## Knob 3 — (THR)

| Action | What it does |
|--------|-------------|
| **Turn** | Adjust EEG activation threshold — (THR) — range 0–127, default 64. Finer resolution in the middle, coarser at extremes; noon = EEG baseline center |
| **Press** | Cycle to next effect — (EFX) — 7 effects, wraps around |
| **LED below** | (ACT) Aqua brightness = how much effect is active (0 = off, full = fully wet). Faint yellow pulse blended in = Drift Fix EMAs still warming up (<8 min from startup) |

**Effect order:** Chorus → Harmonics (Saturation) → Auto-Pan → Tremolo → Filter Sweep → Ring Mod → Bitcrush

---

## LED-only indicator

| Event | All 3 LEDs |
|-------|-----------|
| Knob settings saved to disk | White flash (500ms) |

---

## Knob feel

One full turn (~300°, ~20 detents) sweeps the full range — like a real pot with stops.
Settings save automatically 5 seconds after the last turn, or immediately on any button press.

---

## Special gestures

| Gesture | What it does |
|---------|-------------|
| Hold **any single button** for **3 s** | Encoder chip reset — fixes a frozen / stuck knob. LEDs flash white to confirm. |
| Hold **Knob 1 + Knob 2 buttons together** for **2 s**, with all three knobs at their physical low stop (~6 o'clock) | **Calibrate** — realigns software position to physical position after any drift (power loss, accidental bump, etc.) |

> The 2s calibration fires before the 3s recovery gesture. As a side effect it will toggle the input source and Drift Fix once — known quirk, harmless.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| A knob turns but the value doesn't move | Hold that knob's button 3s → encoder chip reset |
| Knob 2 (MIX) button doesn't respond | Restart the service: `sudo kill -9 $(pgrep -f led_status_controller)` then `sudo systemctl reset-failed yq-led-controller && sudo systemctl start yq-led-controller` |
| Knob position doesn't match its physical angle | Turn all three knobs to 6 o'clock, hold Knob 1 + Knob 2 buttons 2s to recalibrate |
| (ACT) LED shows aqua + faint yellow | Normal on startup — Drift Fix is warming up, clears after ~8 min |
