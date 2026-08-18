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
```bash
ssh -L 5900:localhost:5900 -N xenbox@xenbox.local
```
Then connect a VNC client to `vnc://localhost:5900` (Mac: Finder → Go → Connect to Server). This shows exactly what's on the kiosk display, including anything you interact with via mouse/touch.

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

### The three knobs

The Adafruit encoder board has three rotary knobs, each mapped to a function:

| Knob | Controls | Notes |
|---|---|---|
| **Knob 1** | Master Gain (MIDI CC5) | Overall output level to the amp. |
| **Knob 2** | Depth (Chorus mode) or Drive (Harmonics mode) | Its function follows whichever effect is currently active. |
| **Knob 3** | EEG Threshold | How much alpha (relaxation) is needed before the effect starts kicking in. Low = effect is almost always at least a little active; high = you need a strong, sustained relaxed state to trigger it. |

Just turn a knob — the change applies immediately (no need to press anything). **Press any knob** to save the current gain/depth/threshold values to disk (`/home/xenbox/encoder_settings.json`), so they persist across reboots. A quick white flash on all three LEDs confirms the save.

### Switching effects (Chorus vs. Harmonics)

This is done from the on-screen UI (two checkboxes, radio-style — only one can be active), not from a knob. That means you need either a touchscreen/mouse on the Pi's display or the remote dashboard (§3) to change it. **Harmonics (saturation) is the default at power-up.**

### The bypass switch

A physical switch wired to GPIO17. When closed (grounded), the signal path goes fully dry — no chorus, no saturation — and LED 0 turns red. Open it to return to normal (LED 0 green). This is a hardware bypass, independent of anything happening in software.

### Live instrument input vs. test tone

There's also a "Live Input" checkbox on the dashboard — toggles the Bela patch between its internal test tone generator and your guitar/instrument's live input (MIDI CC9). Leave it off to just hear the test tone while checking that effects respond to your EEG; turn it on to actually process your instrument.

---

## Troubleshooting

If something's not coming up, check the relevant deep-dive doc:
- Muse won't connect / drops when worn → [PI5_STATUS.md](PI5_STATUS.md) (Bluetooth adapter troubleshooting)
- Effect isn't reacting to your EEG the way you expect → [THRESHOLD_MATH.md](THRESHOLD_MATH.md)
- Deploying code changes to the kiosk / LED controller / Bela → [HEADLESS_APPLIANCE.md](HEADLESS_APPLIANCE.md) ("Deployment" section)
- Access credentials, SSH, DB backup → [LOGIN.md](LOGIN.md)
