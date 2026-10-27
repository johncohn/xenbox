# xenbox Quickstart

How to power on the appliance, watch it from a computer, and use the physical controls.

For the full architecture and signal chain, see [HEADLESS_APPLIANCE.md](HEADLESS_APPLIANCE.md) and [THRESHOLD_MATH.md](THRESHOLD_MATH.md). For credentials and connection details, see [LOGIN.md](LOGIN.md).

---

## 1. What needs to be powered on

| Item | Power / Connection | Notes |
|---|---|---|
| **Raspberry Pi 5** | USB-C power supply (5V/5A recommended) | The brain of the system. Everything else hangs off this. |
| **Bela GEM** | USB cable from the Pi | A single USB connection carries both MIDI and power — no separate Bela power supply needed. |
| **Muse 2 headset** | Its own battery — press the power button | LED on the headset blinks when on. Bluetooth pairing is already saved on the Pi's Chromium; you don't need to re-pair each session. |
| **Amp / speakers** | Connected to Bela's audio output | This is where the processed guitar/instrument signal comes out. |
| **Guitar / instrument** | Connected to Bela's audio input | Only needed if you're using "Live Input" (see below) — otherwise the Bela patch can use its built-in test tone. |
| **Display** (optional) | HDMI from the Pi | Only needed if you want to see the kiosk locally instead of remotely. Not required — you can monitor everything over the network (see §3). |

**Boot order doesn't matter much** — plug in the Bela and Muse whenever, and power on the Pi. Everything else (backend, frontend, kiosk browser, LED controller) starts itself.

---

## 2. What happens automatically on power-up

Once the Pi boots, systemd brings up three services and the kiosk browser with no manual steps:

1. `youquantified-backend` — Keystone API + serves the visualization blob, port 3001
2. `youquantified-frontend` — React app, port 3000
3. `yq-led-controller` — LED + encoder service, WebSocket on port 8765
4. `start-kiosk.sh` (via autostart) — waits for the compositor, backend, and frontend to all respond, then launches Chromium fullscreen pointed at the kiosk view

This normally takes well under a minute. If the Pi has no known WiFi network yet, it instead creates a `xenbox-setup-XXXX` WiFi hotspot — see the "WiFi Provisioning" section of [HEADLESS_APPLIANCE.md](HEADLESS_APPLIANCE.md) if that happens.

### How to tell it's ready — the 3 LEDs

| LED | Meaning |
|---|---|
| **LED 0** | **Green** = system ready. **Red** = bypass switch is engaged (signal path is dry, no effect). |
| **LED 1** | **Purple, solid** = Muse connected but not on a head. **Purple, slow pulse** = Muse streaming *and* worn. Off = Muse not connected. |
| **LED 2** | **Aqua**, brightness = current effect intensity (wet value). Off unless the headset is on and streaming. |

If LED 0 is green and LED 1 starts pulsing purple once you put the headset on, the whole chain — Muse → Pi → Bela — is working.

---

## 3. Bringing up a console to monitor it from a computer

You don't need to touch the Pi directly. From a Mac on the same network (or tunneled over SSH), pick whichever view you need:

### See the dashboard/UI itself
```bash
./xenbox-dashboard.sh
```
Tunnels ports 3000/3001/8765 and opens the kiosk dashboard in Chrome at `localhost:3000`. You'll see the live EEG plots, MIDI status, and effect selector — everything except Muse Bluetooth, which stays paired to the Pi's own Chromium (from a Mac browser you'll see a "Connect Muse" button but it won't activate).

### Mirror the Pi's actual screen (VNC)

**Normal way:** open RealVNC Viewer and connect directly to `xenbox.local` — no tunnel needed on the local network.

**Fallback (e.g. off the local network):** tunnel VNC over SSH instead:
```bash
ssh -L 5900:localhost:5900 -N xenbox@xenbox.local
```
Then connect a VNC client to `vnc://localhost:5900` (Mac: Finder → Go → Connect to Server).

Either way, this shows exactly what's on the kiosk display, including anything you interact with via mouse/touch.

### Read the browser's JavaScript console (for debugging signal values, MIDI sends, etc.)
```bash
ssh -L 9222:localhost:9222 xenbox@xenbox.local
```
Open Chrome on your Mac → `chrome://inspect` → click **inspect** under the kiosk page. **Important:** the EEG/audio code runs inside a `srcdoc` iframe, so in DevTools click the context-selector dropdown (top-left, shows "top") and switch to the `blob:` frame to see its console output.

### Watch the Bela's Pure Data console (MIDI traffic, CPU load)
```bash
./bela-ide.sh
```
Tunnels the Bela IDE's three ports through the Pi and opens `http://localhost:8080?port=8080` in Chrome. Shows the running PD patch, incoming MIDI CC values in real time, and CPU load.

> ⚠️ **Port conflict:** `xenbox-dashboard.sh` and `bela-ide.sh` both use port 3000 — you can't run both at once. Kill one tunnel before starting the other (each script kills its own conflicting tunnels on start, but if you're switching directly, see [LOGIN.md](LOGIN.md) for the manual `pkill` commands).

### Plain shell access / logs
```bash
ssh xenbox@xenbox.local

# then, e.g.:
sudo systemctl status youquantified-backend youquantified-frontend yq-led-controller
sudo journalctl -u yq-led-controller -f
```

---

## 4. Controlling the xenbox hardware

### The three knobs — turn and press

Each knob has two actions: **turn** (continuous control) and **press** (one-shot action). Labels in **(parens)** match the text printed on the panel.

| Knob | **Turn** | **Press** |
|---|---|---|
| **Knob 1 (VOL)** | Master gain / volume (CC5, default 100) | Cycle input source **(SRC)**: Live → Tone → Sample → Airport → Zone → Live |
| **Knob 2 (MIX)** | Effect character / depth (CC2, default 64) | Toggle Drift Fix on / off *(no panel label yet)* |
| **Knob 3 (THR)** | EEG activation threshold (default 64) | Cycle to next effect **(EFX)** — 7 effects total, wraps around |

**Knob 3 / threshold notes:** one full turn (~300°) sweeps the full range. The response is non-linear — finer resolution in the middle (where real thresholds cluster) and coarser near the rarely-used extremes. Noon = EEG baseline center.

**Effect order (Knob 3 press cycles through):** Chorus → Harmonics (Saturation) → Auto-Pan → Tremolo → Filter Sweep → Ring Mod → Bitcrush

**Auto-save:** settings write to disk automatically 5 seconds after the last knob turn, or immediately on any button press. A quick white flash on all three LEDs confirms a save.

### The bypass switch

A physical switch wired to GPIO17. When closed (grounded), the signal path goes fully dry and LED 0 **(BYP)** turns red. Open it to return to normal (LED 0 green). This is a hardware bypass, independent of software.

---

## Troubleshooting

If something's not coming up, check the relevant deep-dive doc:
- Muse won't connect / drops when worn → [PI5_STATUS.md](PI5_STATUS.md) (Bluetooth adapter troubleshooting)
- Effect isn't reacting to your EEG the way you expect → [THRESHOLD_MATH.md](THRESHOLD_MATH.md)
- Deploying code changes to the kiosk / LED controller / Bela → [HEADLESS_APPLIANCE.md](HEADLESS_APPLIANCE.md) ("Deployment" section)
- Access credentials, SSH, DB backup → [LOGIN.md](LOGIN.md)
