/**
 * xenbox - EEG-Controlled Audio Visualization
 *
 * REQUIRED PARAMETERS (configure in YouQuantified):
 * [
 *   {"name": "Alpha", "suggested": ["Alpha"]},
 *   {"name": "Low Beta", "suggested": ["Low beta"]},
 *   {"name": "High Beta", "suggested": ["High beta"]},
 *   {"name": "Theta", "suggested": ["Theta"]},
 *   {"name": "Gamma", "suggested": ["Gamma"]}
 * ]
 *
 * =============================================================================
 * HOW IT WORKS: EEG DATA FLOW TO AUDIO EFFECTS
 * =============================================================================
 *
 * STEP 1: RECEIVE RAW EEG DATA
 * - Muse sends 5 frequency bands at ~10-12 Hz
 * - Values arrive already multiplied by YouQuantified slider positions
 * - Example: If slider is 0.5 and Muse outputs 0.8, you receive 0.4
 *
 * STEP 2: CALCULATE WEIGHTED SUM
 * - weighted = alpha + lowBeta + highBeta + theta + gamma
 * - Shows total combined signal strength across all bands
 *
 * STEP 3: NORMALIZE TO RELATIVE VALUES
 * - alpha_rel = alpha / weighted
 * - Each band becomes a fraction of total (always sums to 1.0)
 * - Example: If alpha is 40% of total signal, alpha_rel = 0.4
 * - This removes absolute amplitude and focuses on proportional mix
 *
 * STEP 4: ADAPTIVE THRESHOLD LEARNING
 * - Calculates running average of Alpha and Gamma over the session
 * - If your typical Alpha is 0.25, that becomes your personal baseline
 * - Adapts to individual brain wave patterns
 *
 * STEP 5: SIGMOID THRESHOLDING
 * - Converts continuous EEG values into effect intensities (0 to 1)
 * - Sigmoid function: 1 / (1 + exp(-steepness * (value - threshold)))
 * - When value < threshold: Output approaches 0 (effect off)
 * - When value = threshold: Output = 0.5 (effect at half)
 * - When value > threshold: Output approaches 1 (effect fully on)
 * - High steepness (60) creates sharp, binary-like transitions
 *
 * STEP 6: APPLY TO AUDIO EFFECTS
 * - Each effect's "wet" value (0-1) controls dry/wet mix
 * - wet = 0: Pure dry signal (no effect)
 * - wet = 1: Full effect applied
 *
 * =============================================================================
 * EFFECT MAPPINGS AND THRESHOLDS
 * =============================================================================
 *
 * | EEG Band      | Effect     | Threshold Type | Threshold Value      | Notes                    |
 * |---------------|------------|----------------|----------------------|--------------------------|
 * | Alpha         | Chorus     | Adaptive       | alphaMean × 1.25     | Personalized baseline    |
 * | Low Beta      | Flanger    | Fixed          | 0.3 (30% of signal)  | Same for all users       |
 * | High Beta     | Reverb     | Fixed          | 0.3 (30% of signal)  | Same for all users       |
 * | Theta         | Delay      | Fixed          | 0.3 (30% of signal)  | Same for all users       |
 * | Gamma         | Distortion | Adaptive       | gammaMean × 1.25     | Inverted: low = high     |
 *
 * FIXED THRESHOLDS:
 * - Use default midpoint (0.3) for all users
 * - Effect activates when band is >30% of total signal
 *
 * ADAPTIVE THRESHOLDS:
 * - Learn your personal baseline over the session
 * - Threshold = personal_average × 1.25 (25% above baseline)
 * - Better for individual differences in Alpha/Gamma
 *
 * INVERTED (Gamma/Distortion):
 * - Output = 1 - sigmoid(gamma)
 * - Low gamma → high distortion
 * - High gamma → low distortion
 *
 * =============================================================================
 * EEG FREQUENCY BANDS (from Muse)
 * =============================================================================
 * - Alpha (8-12 Hz): Relaxed, calm, awake but eyes closed
 * - Low Beta (12-15 Hz): Relaxed focus, light concentration
 * - High Beta (15-30 Hz): Active thinking, problem solving
 * - Theta (4-8 Hz): Deep relaxation, meditation, drowsiness
 * - Gamma (30+ Hz): High-level cognition, peak focus
 */

// =============================================================================
// CONFIGURATION - EDIT THESE VALUES TO TUNE BEHAVIOR
// =============================================================================

const CONFIG = {
  // Sigmoid parameters for threshold activation
  sigmoid: {
    steepness: 4,       // Lower = smoother transition (was 10, now 4 for more responsiveness)
    fixedMidpoint: 0.3  // Fixed threshold for non-adaptive effects (try 0.2-0.4)
  },

  // Adaptive thresholding multiplier
  adaptive: {
    multiplier: 0.5     // Threshold = baseline × this (was 0.9, now 0.5 for easier activation)
  },

  // EEG band to audio effect mappings
  // Change these to remap which band controls which effect
  mappings: {
    "Alpha": {
      effect: "Chorus",
      adaptive: true,   // Use personalized threshold
      invert: false     // Normal behavior (high input = high output)
    },
    "Low Beta": {
      effect: "Flanger",
      adaptive: false,  // Use fixed threshold
      invert: false
    },
    "High Beta": {
      effect: "Reverb",
      adaptive: false,
      invert: false
    },
    "Theta": {
      effect: "Delay",
      adaptive: false,
      invert: false
    },
    "Gamma": {
      effect: "Distortion",
      adaptive: true,
      invert: true      // Low gamma = high distortion
    }
  }
};

// Legacy constants for backward compatibility (derived from CONFIG)
const STEEP = CONFIG.sigmoid.steepness;
const midpoint = CONFIG.sigmoid.fixedMidpoint;
const threshold = CONFIG.adaptive.multiplier;

// =============================================================================
// MIDI OUTPUT CONFIGURATION - Bela GEM Chorus Control
// =============================================================================
const MIDI_CONFIG = {
  enabled: true,           // Set to false to disable MIDI output
  outputName: "Bela",      // Partial match for MIDI output device name
  channel: 0,              // MIDI channel (0-15)

  // CC mappings matching Bela chorus patch
  cc: {
    rate: 1,               // CC1: LFO rate (0.1-8 Hz)
    depth: 2,              // CC2: Modulation depth (0-1)
    feedback: 3,           // CC3: Feedback (0-0.8)
    mix: 4,                // CC4: Chorus wet/dry mix (0-1) - controlled by Alpha
    gain: 5,               // CC5: Master gain (0-1)
    sweep: 6,              // CC6: Auto-sweep toggle (0=off, 127=on)
    satMix: 7,             // CC7: Saturation wet/dry mix (0-1) - controlled by Alpha
    satDrive: 8,           // CC8: Saturation drive amount (maps to 1-10 in PD)
    inputSelect: 9,        // CC9: Input source (0=Tone, 1=Live, 2=Sample/mikebass, 3=Airport, 4=Zone)
    autopanMix: 10,        // CC10: Auto-Pan wet/dry mix (0-1) - controlled by Alpha
    autopanRate: 11,       // CC11: Auto-Pan LFO rate
    tremoloMix: 12,        // CC12: Tremolo wet/dry mix (0-1) - controlled by Alpha
    tremoloRate: 13,       // CC13: Tremolo LFO rate
    filterMix: 14,         // CC14: Filter Sweep wet/dry mix (0-1) - controlled by Alpha
    filterRange: 15,       // CC15: Filter Sweep min-frequency (sweep range)
    ringmodMix: 16,        // CC16: Ring Mod wet/dry mix (0-1) - controlled by Alpha
    ringmodPitch: 17,      // CC17: Ring Mod carrier frequency
    bitcrushMix: 18,       // CC18: Bitcrush wet/dry mix (0-1) - controlled by Alpha
    bitcrushDepth: 19      // CC19: Bitcrush step count (coarse<->subtle)
  },

  // Fixed values to match Tone.js chorus settings
  // Sent once on MIDI connection
  fixedValues: {
    rate: 24,              // 1.5 Hz: (1.5 / 8) * 127 ≈ 24
    feedback: 64,          // 0.4 after PD ×0.8 scaling — adds richness
    gain: 70,              // ~0.55 default gain — reduced from 100 to avoid output clipping
    sweep: 0               // Turn OFF auto-sweep (xenbox controls params)
  },

  // Per-effect "knob 2" character parameter — current value, keyed by effect name.
  // Updated live by the encoder handler; sent once per effect on MIDI connect.
  effectParams: {
    Saturation: 28,        // Drive ~3 (maps to (28/127)*9+1 ≈ 3 in PD)
    Chorus: 64,             // Depth 0.5
    AutoPan: 32,            // Rate ~2Hz
    Tremolo: 40,            // Rate ~2.6Hz
    FilterSweep: 64,        // Sweep range, mid setting
    RingMod: 32,            // Carrier ~250Hz
    Bitcrush: 96            // Steps, moderately fine/subtle by default
  },

  // Rate limiting for CC messages (ms between sends)
  throttleMs: 50
};

// Effect registry — the single place that defines what effects exist and how
// they map to MIDI CCs. Add a new effect by adding one entry here (plus its
// CC numbers above, its .pd file on the Bela, and an EFFECT_ORDER entry).
const EFFECTS = {
  Saturation:  { label: 'Harmonics',    mixCC: MIDI_CONFIG.cc.satMix,     paramCC: MIDI_CONFIG.cc.satDrive,     paramLabel: 'Drive' },
  Chorus:      { label: 'Chorus',       mixCC: MIDI_CONFIG.cc.mix,        paramCC: MIDI_CONFIG.cc.depth,        paramLabel: 'Depth' },
  AutoPan:     { label: 'Auto-Pan',     mixCC: MIDI_CONFIG.cc.autopanMix, paramCC: MIDI_CONFIG.cc.autopanRate,  paramLabel: 'Rate' },
  Tremolo:     { label: 'Tremolo',      mixCC: MIDI_CONFIG.cc.tremoloMix, paramCC: MIDI_CONFIG.cc.tremoloRate,  paramLabel: 'Rate' },
  FilterSweep: { label: 'Filter Sweep', mixCC: MIDI_CONFIG.cc.filterMix,  paramCC: MIDI_CONFIG.cc.filterRange,  paramLabel: 'Range' },
  RingMod:     { label: 'Ring Mod',     mixCC: MIDI_CONFIG.cc.ringmodMix, paramCC: MIDI_CONFIG.cc.ringmodPitch, paramLabel: 'Pitch' },
  Bitcrush:    { label: 'Bitcrush',     mixCC: MIDI_CONFIG.cc.bitcrushMix,paramCC: MIDI_CONFIG.cc.bitcrushDepth,paramLabel: 'Depth' }
};
// Fixed cycling order for the threshold-knob button and the on-screen checkboxes
const EFFECT_ORDER = ['Saturation', 'Chorus', 'AutoPan', 'Tremolo', 'FilterSweep', 'RingMod', 'Bitcrush'];

// MIDI state
let midiOutput = null;
let midiEnabled = false;
let lastMidiSendTime = 0;
let _lastLoggedMix = -1;  // Track last logged mix value to reduce console spam
let hasEEGData = false;    // True when Muse is sending data
let midiStatusText = "MIDI: Not initialized";
let encoderThreshold = 64;     // Knob 3 raw value (0-127): threshold offset for effect activation
let activeEffect = 'Saturation';  // Default effect at power-up ('Chorus' or 'Saturation')

// Drift Fix — replaces the earlier "Autotrack" approach (which moved the
// threshold itself, and on reflection risked manufacturing crossings rather
// than just removing drift). Per Greg Appelbaum's suggestion: keep the
// threshold FIXED, and instead remove the drift from the signal before it
// ever reaches the comparator. Track alpha with two EMAs — fast and slow —
// and use their difference as the tracked value. Slow baseline drift moves
// both EMAs together and cancels out in the subtraction; a genuine, faster
// state change shows up in the fast EMA before the slow one catches up, so
// it still registers cleanly. Toggle with the depth-knob button (or its
// checkbox) for A/B comparison against the legacy lifetime-mean approach —
// both are always computed every frame (see draw()) so the drift-tracking
// plot can show both traces regardless of which one is currently driving
// the effect. On by default.
const DRIFT_CONFIG = {
  fastSeconds: 7.5,   // fast EMA time constant — tracks near-term alpha
  slowSeconds: 240,   // slow EMA time constant — tracks the drifting baseline.
                       // Bumped 120->240 (2min->4min) — a controlled steady-state
                       // test at 120s showed a multi-minute residual arc in the
                       // "corrected" trace, evidence 120s wasn't slow enough to
                       // fully absorb it. Greg's suggested range was 2-5 min.
  sigmoidGain: 20,     // Amplification applied to the (fastEMA - slowEMA) deviation
                       // before the sigmoid that maps it to the 0-127 tracked value.
                       // alpha_rel is a fraction (0-0.4 range), so the deviation
                       // between the two EMAs is small (0.01-0.1 typical) — without
                       // enough gain here the sigmoid barely moves off 63.5 and even
                       // genuine relaxation registers as a weak effect. Higher values
                       // amplify real signal but also noise; lower values are more
                       // conservative. Was hardcoded as 10; bumped to 20 as first
                       // experiment. Try 30 if signal still feels too weak; drop back
                       // to 10 to restore original behaviour.
  deadband: 8,         // ON/OFF hysteresis width around the threshold (0-127 units),
                       // prevents flicker right at the boundary
  readySeconds: 480    // how long the slow EMA needs to run before it's considered
                       // converged enough to trust for setting the threshold —
                       // 2x slowSeconds is a reasonable rule of thumb.
                       // Tried cutting to 1x (240) to shorten the "training" wait,
                       // reverted: a several-minute live trace showed persistent
                       // minute-scale wander in the drift-corrected signal even at
                       // the original 480 — readySeconds isn't the cause (it only
                       // gates when we trust the value, not whether fast-slow EMA
                       // subtraction actually removes this kind of movement — it
                       // doesn't; only much-slower-than-slowSeconds drift cancels).
                       // Shortening it would just mean trusting the still-wandering
                       // value sooner. Root cause is unresolved — see whether that
                       // 1-4min wander is real alpha-state signal or artifact before
                       // touching this again.
};
let driftFixEnabled = true;    // ON by default
let fastEMA_alpha = null;      // null = not yet seeded (seeded from first real sample)
let slowEMA_alpha = null;
let driftStartTime = null;     // performance.now() at first seed — for the readiness clock.
                                // Not reset by the A/B toggle (both EMAs always run
                                // regardless of which one is driving audio), only by a
                                // fresh Muse connection (see hasEEGData transition below)
let smoothedAlphaLegacy = 64;  // "A" — old lifetime-mean-based tracked value
let smoothedAlphaDrift = 64;   // "B" — new fast/slow-diff-based tracked value
let effectOnState = false;     // hysteresis on/off state machine
let driftCheckbox = null;      // DOM checkbox, assigned in setup()

// Rolling history for the drift-tracking plot — sampled once/sec (not every
// frame) so a modest buffer covers a genuinely useful multi-minute window
const DRIFT_HISTORY_LENGTH = 600;  // 600 samples @ 1/sec = 10 minutes — covers
                                    // the full readySeconds convergence window
                                    // plus several minutes of margin
let driftHistoryLegacy = [];
let driftHistoryDrift = [];
let lastDriftSampleTime = 0;
// Audio input source — one of INPUT_SOURCE_ORDER, cycled by the gain-knob button
// or picked directly via the on-screen checkboxes. Live is the default so the
// appliance is ready to process a real instrument the moment it powers up.
const INPUT_SOURCES = {
  Live:    { label: 'Live In',  cc: 1 },  // instrument through the Bela's live input
  Tone:    { label: 'Tone',     cc: 0 },  // built-in test tone generator
  Sample:  { label: 'Sample',   cc: 2 },  // looping mikebass.wav recording on the Bela
  Airport: { label: 'Airport',  cc: 3 },  // looping airports.wav recording on the Bela
  Zone:    { label: 'Zone',     cc: 4 }   // looping zone.wav recording on the Bela
};
const INPUT_SOURCE_ORDER = ['Live', 'Tone', 'Sample', 'Airport', 'Zone'];
let inputSource = 'Live';
const inputCheckboxes = {};        // DOM checkboxes for input-source selection (assigned in setup())
let rawAlphaMidi = 0;              // Raw alpha activity 0-127 (pre-threshold, for histogram display)
const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);  // Unique per page load
let smoothedAlpha = 64;            // EMA-smoothed raw alpha (0-127), ~4 second time constant
let noDataFrames = 0;              // Counter for consecutive zero-data frames (for disconnect detection)
let effectActive = false;          // True when EEG data flowing AND headset is worn

// WebSocket for LED status reporting
let ledSocket = null;
let lastBelaStatus = null;  // Track last sent status to avoid redundant sends

// Selects the audio input source (Live/Tone/Sample) and syncs the on-screen
// checkboxes to match. Shared by the checkboxes' own click handler and the
// gain-knob button, so both stay in sync the same way selectEffect() does.
function setInputSource(key) {
  if (!INPUT_SOURCES[key] || key === inputSource) return;
  inputSource = key;
  for (const otherKey of INPUT_SOURCE_ORDER) {
    if (inputCheckboxes[otherKey]) inputCheckboxes[otherKey].checked(otherKey === key);
  }
  sendMIDICC(MIDI_CONFIG.cc.inputSelect, INPUT_SOURCES[key].cc);
  console.log(`[INPUT] Source -> ${INPUT_SOURCES[key].label}`);
}

// Toggles Drift Fix on/off — A/B switch between the legacy lifetime-mean
// tracked signal and the new fast/slow-EMA drift-corrected one (see
// DRIFT_CONFIG above). Shared by its own checkbox and the depth-knob
// (middle, slot 2) button press.
function toggleDriftFix(forceValue) {
  driftFixEnabled = (forceValue !== undefined) ? forceValue : !driftFixEnabled;
  if (driftCheckbox) driftCheckbox.checked(driftFixEnabled);
  console.log(`[DRIFT FIX] ${driftFixEnabled ? 'ON' : 'OFF'}`);
}

// Advances to the next input source in INPUT_SOURCE_ORDER, wrapping around
function cycleInputSource() {
  const idx = INPUT_SOURCE_ORDER.indexOf(inputSource);
  const nextKey = INPUT_SOURCE_ORDER[(idx + 1) % INPUT_SOURCE_ORDER.length];
  setInputSource(nextKey);
}

// Selects an effect by key and syncs the on-screen checkboxes to match.
// Shared by the checkboxes' own click handler and the threshold-knob button,
// so both stay in sync the same way setInputSource() does for input source.
function selectEffect(key) {
  if (!EFFECTS[key] || key === activeEffect) return;
  activeEffect = key;
  for (const otherKey of EFFECT_ORDER) {
    if (checkboxes[otherKey]) checkboxes[otherKey].checked(otherKey === key);
  }
  console.log(`[EFFECT] -> ${EFFECTS[key].label}`);
}

// Advances to the next effect in EFFECT_ORDER, wrapping around at the end
function cycleEffect() {
  const idx = EFFECT_ORDER.indexOf(activeEffect);
  const nextKey = EFFECT_ORDER[(idx + 1) % EFFECT_ORDER.length];
  selectEffect(nextKey);
}

function connectLEDSocket() {
  try {
    console.log('[LED WS] Attempting to connect to ws://localhost:8765...');
    ledSocket = new WebSocket('ws://localhost:8765');
    ledSocket.onopen = () => {
      console.log('[LED WS] Connected to LED controller');
      // Send current Bela status on connect
      sendBelaStatus(midiEnabled);
    };
    ledSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'encoder_values') {
          // Knob 1: Gain (CC5) — always controls master gain
          const newGain = Math.max(0, Math.min(127, Math.round(msg.gain)));
          if (newGain !== MIDI_CONFIG.fixedValues.gain) {
            MIDI_CONFIG.fixedValues.gain = newGain;
            sendMIDICC(MIDI_CONFIG.cc.gain, newGain);
            console.log(`[ENC] Gain -> ${newGain}`);
          }

          // Knob 2: effect character parameter — depends on active effect
          const newKnob2 = Math.max(0, Math.min(127, Math.round(msg.depth)));
          {
            const eff = EFFECTS[activeEffect];
            if (newKnob2 !== MIDI_CONFIG.effectParams[activeEffect]) {
              MIDI_CONFIG.effectParams[activeEffect] = newKnob2;
              sendMIDICC(eff.paramCC, newKnob2);
              console.log(`[ENC] ${eff.paramLabel} -> ${newKnob2}`);
            }
          }

          // Knob 3: Threshold — controls effect activation offset. Fixed
          // now (no more Autotrack-style chasing) — Drift Fix corrects the
          // signal instead, so a manual turn just sets it directly.
          const newThreshold = Math.max(0, Math.min(127, Math.round(msg.threshold)));
          if (newThreshold !== Math.round(encoderThreshold)) {
            encoderThreshold = newThreshold;
            console.log(`[ENC] Threshold -> ${newThreshold}`);
          }
        } else if (msg.type === 'button_press' && msg.button === 'toggle_live_input') {
          console.log('[ENC] Gain knob button -> next input source');
          cycleInputSource();
        } else if (msg.type === 'button_press' && msg.button === 'cycle_effect') {
          console.log('[ENC] Threshold knob button -> next effect');
          cycleEffect();
        } else if (msg.type === 'button_press' && msg.button === 'toggle_autotrack') {
          // Wire message name kept as-is (Python side unchanged) — this now
          // toggles Drift Fix, the successor to the old Autotrack mechanism
          console.log('[ENC] Depth knob button -> toggling Drift Fix');
          toggleDriftFix();
        }
      } catch (e) {
        // Ignore parse errors on incoming messages
      }
    };
    ledSocket.onclose = () => {
      console.log('[LED WS] Disconnected, reconnecting in 2s...');
      ledSocket = null;
      setTimeout(connectLEDSocket, 2000);
    };
    ledSocket.onerror = (err) => {
      console.log('[LED WS] Error, will retry on close');
      // Don't retry here - onclose will handle it
    };
  } catch (e) {
    console.log('[LED WS] Exception:', e);
    setTimeout(connectLEDSocket, 2000);
  }
}

function sendBelaStatus(connected) {
  if (ledSocket?.readyState === WebSocket.OPEN && lastBelaStatus !== connected) {
    ledSocket.send(JSON.stringify({
      type: 'bela_status',
      connected: connected
    }));
    lastBelaStatus = connected;
  }
}

function sendAlphaScore(wetVal, ready) {
  // Send the exact effect mix value (0-1) to LED controller for the aqua LED,
  // plus whether the drift-tracking EMAs have converged enough to trust for
  // setting the threshold (LED 2 pulses yellow instead of aqua while not)
  try {
    if (ledSocket?.readyState === WebSocket.OPEN) {
      ledSocket.send(JSON.stringify({ type: 'alpha_score', wet: wetVal, ready: ready !== false }));
    }
  } catch (e) {
    console.log('[LED] sendAlphaScore failed:', e);
  }
}

// MIDI parameter values for visualization (0-127 scale)
let midiValues = {
  mix: 0,
  rate: 0,
  depth: 0,
  feedback: 0,
  gain: 0,
  sweep: 0,
  satMix: 0,
  satDrive: 0
};

// History for animated bars (smooth transitions)
let midiValueHistory = {
  mix: []
};
const MIDI_HISTORY_LENGTH = 50;

// EEG values for histogram display (normalized 0-1)
let eegDisplayValues = {
  alpha: 0,
  theta: 0,
  lowBeta: 0,
  highBeta: 0,
  gamma: 0
};

// Heart rate and worn detection
let heartRate = 0;
let isWorn = false;
let ppgSampleCount = 0;
let lastPpgValue = 0;
let ppgWaveform = [];
let ppgVariance = 0;

// UI elements
let micSelect;
let userMic;
let checkboxes = {};

// Audio effects
let chorus, flanger, reverb, delay, distortion;

// Running statistics for adaptive thresholding
let alphaN = 0;
let alphaMean = 0;
let gammaN = 0;
let gammaMean = 0;

// Effect names mapped to EEG bands
const effectNames = ["Chorus", "Flanger", "Reverb", "Delay", "Distortion"];
const eegBands = ["Alpha", "Low Beta", "High Beta", "Theta", "Gamma"];

// Frame rate tracking
let lastUpdateTime = 0;
let updateCount = 0;
let displayFPS = 0;

// Helper functions
function divideIfNotZero(numerator, denominator) {
  if (denominator === 0 || isNaN(denominator)) {
    return 0;
  }
  return numerator / denominator;
}

function sigmoid(x, k = STEEP, m = midpoint) {
  return 1 / (1 + Math.exp(-k * (x - m)));
}

// =============================================================================
// MIDI OUTPUT FUNCTIONS - Send CC to Bela GEM
// =============================================================================

// Store MIDI access for reconnection
let midiAccess = null;

async function initMIDI() {
  console.log("[MIDI] Initializing MIDI output...");
  try {
    midiAccess = await navigator.requestMIDIAccess();
    console.log(`[MIDI] Found ${midiAccess.outputs.size} MIDI output(s)`);

    // Listen for MIDI device connect/disconnect events
    midiAccess.onstatechange = (event) => {
      console.log(`[MIDI] State change: ${event.port.name} - ${event.port.state}`);
      if (event.port.type === 'output') {
        if (event.port.state === 'disconnected') {
          // Check if it was our Bela output
          if (midiOutput && event.port.id === midiOutput.id) {
            console.log("[MIDI] Bela disconnected!");
            midiOutput = null;
            midiEnabled = false;
            midiStatusText = "MIDI: Bela disconnected";
            sendBelaStatus(false);  // Notify LED controller
          }
        } else if (event.port.state === 'connected') {
          // Try to reconnect to Bela
          if (event.port.name.toLowerCase().includes(MIDI_CONFIG.outputName.toLowerCase())) {
            console.log("[MIDI] Bela reconnected!");
            connectToMIDIOutput(event.port);
          }
        }
      }
    };

    // Find and connect to Bela output
    for (const output of midiAccess.outputs.values()) {
      console.log(`[MIDI] Output available: "${output.name}"`);
      if (output.name.toLowerCase().includes(MIDI_CONFIG.outputName.toLowerCase())) {
        connectToMIDIOutput(output);
        return;
      }
    }

    // If Bela not found, list available outputs
    const outputNames = Array.from(midiAccess.outputs.values()).map(o => o.name);
    if (outputNames.length > 0) {
      midiStatusText = `MIDI: Bela not found. Available: ${outputNames.join(", ")}`;
      console.log("Bela not found. Available MIDI outputs:", outputNames);
    } else {
      midiStatusText = "MIDI: No outputs available";
      console.log("No MIDI outputs available");
    }
  } catch (err) {
    midiStatusText = `MIDI: Error - ${err.message}`;
    console.error("MIDI initialization error:", err);
  }
}

function connectToMIDIOutput(output) {
  midiOutput = output;
  midiEnabled = true;
  midiStatusText = `MIDI: Connected to ${output.name}`;
  console.log(`[MIDI] Connected to: ${output.name}`);
  sendBelaStatus(true);  // Notify LED controller

  // Send fixed parameter values on connect
  setTimeout(() => {
    sendMIDICC(MIDI_CONFIG.cc.rate, MIDI_CONFIG.fixedValues.rate);
    sendMIDICC(MIDI_CONFIG.cc.feedback, MIDI_CONFIG.fixedValues.feedback);
    sendMIDICC(MIDI_CONFIG.cc.gain, MIDI_CONFIG.fixedValues.gain);
    sendMIDICC(MIDI_CONFIG.cc.sweep, MIDI_CONFIG.fixedValues.sweep);
    // Every effect starts silent (mix=0) except whichever is active, and every
    // effect's character param gets its current/default value sent once
    for (const key of EFFECT_ORDER) {
      sendMIDICC(EFFECTS[key].mixCC, 0);
      sendMIDICC(EFFECTS[key].paramCC, MIDI_CONFIG.effectParams[key]);
    }
    sendMIDICC(MIDI_CONFIG.cc.inputSelect, INPUT_SOURCES[inputSource].cc);
    console.log("[MIDI] Sent parameters to Bela (default effect: " + activeEffect + ", input: " + inputSource + ")");
  }, 500);
}

function sendMIDICC(cc, value) {
  if (!midiOutput || !midiEnabled) return;

  // Clamp value to 0-127
  const midiValue = Math.max(0, Math.min(127, Math.round(value)));

  // Send CC message: [status, cc number, value]
  // Status = 0xB0 + channel for CC messages
  const status = 0xB0 + MIDI_CONFIG.channel;
  midiOutput.send([status, cc, midiValue]);

  // Track values for visualization
  if (cc === MIDI_CONFIG.cc.mix) {
    midiValues.mix = midiValue;
    if (activeEffect === 'Chorus') {
      midiValueHistory.mix.push(midiValue);
      if (midiValueHistory.mix.length > MIDI_HISTORY_LENGTH) midiValueHistory.mix.shift();
    }
  } else if (cc === MIDI_CONFIG.cc.rate) {
    midiValues.rate = midiValue;
  } else if (cc === MIDI_CONFIG.cc.depth) {
    midiValues.depth = midiValue;
  } else if (cc === MIDI_CONFIG.cc.feedback) {
    midiValues.feedback = midiValue;
  } else if (cc === MIDI_CONFIG.cc.gain) {
    midiValues.gain = midiValue;
  } else if (cc === MIDI_CONFIG.cc.sweep) {
    midiValues.sweep = midiValue;
  } else if (cc === MIDI_CONFIG.cc.satMix) {
    midiValues.satMix = midiValue;
    if (activeEffect === 'Saturation') {
      midiValueHistory.mix.push(midiValue);
      if (midiValueHistory.mix.length > MIDI_HISTORY_LENGTH) midiValueHistory.mix.shift();
    }
  } else if (cc === MIDI_CONFIG.cc.satDrive) {
    midiValues.satDrive = midiValue;
  } else if (cc === EFFECTS[activeEffect].mixCC) {
    // Any other effect's mix CC (auto-pan/tremolo/filter/ring mod/bitcrush),
    // tracked generically for the "Mix" history graph when it's the active one
    midiValueHistory.mix.push(midiValue);
    if (midiValueHistory.mix.length > MIDI_HISTORY_LENGTH) midiValueHistory.mix.shift();
  }
}

function sendMIDICCThrottled(cc, value) {
  const now = performance.now();
  if (now - lastMidiSendTime < MIDI_CONFIG.throttleMs) return;
  lastMidiSendTime = now;
  sendMIDICC(cc, value);
}

function setup() {
  // Fill most of the window
  createCanvas(windowWidth - 20, windowHeight - 20);
  textAlign(CENTER, CENTER);
  textSize(14);

  // Initialize MIDI output to Bela
  if (MIDI_CONFIG.enabled) {
    initMIDI();
  }

  // Connect to LED status WebSocket
  connectLEDSocket();

  // Close WebSocket cleanly on page unload so stale connections don't linger
  window.addEventListener('beforeunload', () => {
    if (ledSocket) {
      ledSocket.onclose = null;  // Prevent reconnect attempt
      ledSocket.close();
      ledSocket = null;
    }
  });

  // Mic selector
  navigator.mediaDevices.enumerateDevices().then(devices => {
    const inputs = devices.filter(d => d.kind === 'audioinput');
    micSelect = createSelect();
    micSelect.position(20, 20);
    micSelect.option("Choose a mic", "");

    inputs.forEach(device => {
      micSelect.option(device.label || `Device ${device.deviceId}`, device.deviceId);
    });

    micSelect.changed(() => startWithDevice(micSelect.value()));
  });

  // Effect selection — radio-style (only one active at a time)
  // Saturation ("Harmonics") is the default at power-up
  let y = 60;
  const effectOptions = EFFECT_ORDER.map(key => ({ name: EFFECTS[key].label, key }));
  for (let opt of effectOptions) {
    const isDefault = (opt.key === activeEffect);
    const checkbox = createCheckbox(opt.name, isDefault);
    checkbox.position(20, y);
    checkbox.changed(() => {
      // Radio behavior: only one active at a time
      if (checkbox.checked()) {
        selectEffect(opt.key);
      } else {
        // Don't allow unchecking the active one — recheck it
        checkbox.checked(true);
      }
    });
    checkboxes[opt.key] = checkbox;
    y += 25;
  }

  // Input source selection — visually separated from the effect checkboxes
  // above with a divider + label, since they're a different kind of control
  y += 10;  // gap after effect selection
  const inputDivider = createDiv();
  inputDivider.position(20, y);
  inputDivider.style('width', '150px');
  inputDivider.style('border-top', '1px solid rgba(255,255,255,0.4)');
  inputDivider.style('margin', '0');
  y += 10;
  const inputLabel = createP('INPUT SOURCE');
  inputLabel.position(20, y);
  inputLabel.style('color', '#aaa');
  inputLabel.style('font-size', '11px');
  inputLabel.style('letter-spacing', '1px');
  inputLabel.style('margin', '0');
  y += 20;

  const inputOptions = INPUT_SOURCE_ORDER.map(key => ({ name: INPUT_SOURCES[key].label, key }));
  for (let opt of inputOptions) {
    const isDefault = (opt.key === inputSource);
    const checkbox = createCheckbox(opt.name, isDefault);
    checkbox.position(20, y);
    checkbox.changed(() => {
      // Radio behavior: only one active at a time
      if (checkbox.checked()) {
        setInputSource(opt.key);
      } else {
        // Don't allow unchecking the active one — recheck it
        checkbox.checked(true);
      }
    });
    inputCheckboxes[opt.key] = checkbox;
    y += 25;
  }

  // Drift Fix — independent toggle, NOT part of the source radio group above
  // (it's a threshold-behavior mode, not an audio source, so it can be on
  // at the same time as any of Live/Tone/Sample without changing playback)
  driftCheckbox = createCheckbox("Drift Fix", driftFixEnabled);
  driftCheckbox.position(20, y);
  driftCheckbox.changed(() => {
    toggleDriftFix(driftCheckbox.checked());
  });
  y += 25;

  // Initialize audio effects
  chorus = new Tone.Chorus({
    frequency: 1.5,
    delayTime: 3.5,
    depth: .5,
    spread: 180,
    type: "sine"
  }).start();

  flanger = new Tone.FeedbackDelay(0.005, 0.5);
  reverb = new Tone.Reverb(10);
  delay = new Tone.FeedbackDelay(0.25, 0.4);
  distortion = new Tone.Distortion();
}

async function startWithDevice(deviceId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    });
    stream.getTracks().forEach(track => track.stop());

    await Tone.start();
    await Tone.context.resume();

    if (userMic) {
      userMic.disconnect();
      userMic.dispose();
    }

    userMic = new Tone.UserMedia();
    await userMic.open();
    updateWetValues();
  } catch (err) {
    console.error("Error accessing device:", err);
  }
}

function updateWetValues() {
  // Disconnect all effects first
  chorus.disconnect();
  flanger.disconnect();
  reverb.disconnect();
  delay.disconnect();
  distortion.disconnect();

  // Reconnect mic through chorus to destination (browser-side audio)
  if (userMic) userMic.disconnect();
  if (userMic) userMic.connect(chorus);
  chorus.connect(Tone.Destination);
}

function draw() {
  background(240);

  // Track update rate
  updateCount++;
  const currentTime = millis();
  if (currentTime - lastUpdateTime > 1000) {
    displayFPS = updateCount;
    updateCount = 0;
    lastUpdateTime = currentTime;
  }

  // Extract EEG values from data object (already scaled by sliders)
  const alpha = isFinite(Number(data?.["Alpha"])) ? Number(data["Alpha"]) : 0;
  const lowBeta = isFinite(Number(data?.["Low Beta"])) ? Number(data["Low Beta"]) : 0;
  const highBeta = isFinite(Number(data?.["High Beta"])) ? Number(data["High Beta"]) : 0;
  const theta = isFinite(Number(data?.["Theta"])) ? Number(data["Theta"]) : 0;
  const gamma = isFinite(Number(data?.["Gamma"])) ? Number(data["Gamma"]) : 0;

  // Extract heart rate and worn state (from PPG)
  heartRate = isFinite(Number(data?.["HR"])) ? Number(data["HR"]) : 0;
  isWorn = data?.["isWorn"] === true;
  ppgSampleCount = isFinite(Number(data?.["ppgSampleCount"])) ? Number(data["ppgSampleCount"]) : 0;
  lastPpgValue = isFinite(Number(data?.["lastPpgValue"])) ? Number(data["lastPpgValue"]) : 0;
  ppgVariance = isFinite(Number(data?.["ppgVariance"])) ? Number(data["ppgVariance"]) : 0;
  if (Array.isArray(data?.["ppgWaveform"])) {
    ppgWaveform = data["ppgWaveform"];
  }

  // Weighted aggregate = sum of all parameter values (slider-scaled data)
  const weighted = alpha + lowBeta + highBeta + theta + gamma;

  // Track EEG data presence with hysteresis — require 60 consecutive zero frames (~1s)
  // before declaring data lost. Prevents false resets during brief reconnection gaps.
  if (weighted > 0) {
    noDataFrames = 0;
    hasEEGData = true;
  } else {
    noDataFrames++;
    if (noDataFrames > 60 && hasEEGData) {
      hasEEGData = false;
      smoothedAlpha = 0;
      rawAlphaMidi = 0;
      // A real disconnect means the fast/slow EMAs' state is stale — start
      // the drift-tracking convergence clock over on reconnect
      fastEMA_alpha = null;
      slowEMA_alpha = null;
      driftStartTime = null;
      sendAlphaScore(0, false);
    }
  }

  // Calculate sum for normalization (for relative values used in effects)
  const sum = weighted; // same as the sum of all components

  // Relative values (normalized to sum) - for effect control
  const alpha_rel = divideIfNotZero(alpha, sum);
  const lowBeta_rel = divideIfNotZero(lowBeta, sum);
  const highBeta_rel = divideIfNotZero(highBeta, sum);
  const theta_rel = divideIfNotZero(theta, sum);
  const gamma_rel = divideIfNotZero(gamma, sum);

  // Store EEG values for histogram display
  eegDisplayValues.alpha = alpha_rel;
  eegDisplayValues.theta = theta_rel;
  eegDisplayValues.lowBeta = lowBeta_rel;
  eegDisplayValues.highBeta = highBeta_rel;
  eegDisplayValues.gamma = gamma_rel;

  // Update running statistics for adaptive thresholding
  alphaN += 1;
  alphaMean += (alpha_rel - alphaMean) / alphaN;

  gammaN += 1;
  gammaMean += (gamma_rel - gammaMean) / gammaN;

  const smoothK = 0.008;  // ~2s EMA at ~60fps, applied to both tracked signals below

  // --- "A" (legacy): deviation from a LIFETIME running mean. This mean's
  // effective memory window grows without bound as the session runs, so it
  // gradually stops tracking real drift at all — this is the root cause of
  // the original "gets stuck" problem, independent of the old Autotrack code.
  const deviationLegacy = alpha_rel - alphaMean;
  const mixLegacy = 1 / (1 + Math.exp(-10 * deviationLegacy));
  smoothedAlphaLegacy += smoothK * (mixLegacy * 127 - smoothedAlphaLegacy);

  // --- "B" (Drift Fix, per Greg Appelbaum): difference of a fast and a slow
  // bounded EMA on alpha_rel. Slow baseline drift moves both EMAs together
  // and cancels out in the subtraction; a genuine, faster state change shows
  // up in the fast EMA before the slow one catches up, so it still registers.
  // Unlike the lifetime mean above, the slow EMA never stops adapting.
  if (fastEMA_alpha === null) {
    fastEMA_alpha = alpha_rel;
    slowEMA_alpha = alpha_rel;
    driftStartTime = performance.now();
  }
  const kFast = 1 / (DRIFT_CONFIG.fastSeconds * 60);
  const kSlow = 1 / (DRIFT_CONFIG.slowSeconds * 60);
  fastEMA_alpha += kFast * (alpha_rel - fastEMA_alpha);
  slowEMA_alpha += kSlow * (alpha_rel - slowEMA_alpha);
  const deviationDrift = fastEMA_alpha - slowEMA_alpha;
  const mixDrift = 1 / (1 + Math.exp(-DRIFT_CONFIG.sigmoidGain * deviationDrift));
  smoothedAlphaDrift += smoothK * (mixDrift * 127 - smoothedAlphaDrift);

  // Readiness: has the slow EMA run long enough to be trusted for setting
  // the threshold? Sent to the LED controller so it can show a "still
  // training" indicator rather than letting you dial in a moving target.
  const driftReady = driftStartTime !== null &&
    (performance.now() - driftStartTime) >= DRIFT_CONFIG.readySeconds * 1000;

  // Active tracked signal — whichever the A/B toggle selects. Both are
  // always computed above regardless, so the drift-tracking plot can show
  // both traces for comparison no matter which one is driving the effect.
  smoothedAlpha = driftFixEnabled ? smoothedAlphaDrift : smoothedAlphaLegacy;
  rawAlphaMidi = smoothedAlpha;  // 0-127 for histogram display

  // Sample both traces into the drift-tracking plot's history once/sec —
  // a 5-minute buffer at this rate is what actually makes drift visible
  const nowMs = millis();
  if (nowMs - lastDriftSampleTime >= 1000) {
    lastDriftSampleTime = nowMs;
    driftHistoryLegacy.push(smoothedAlphaLegacy);
    driftHistoryDrift.push(smoothedAlphaDrift);
    if (driftHistoryLegacy.length > DRIFT_HISTORY_LENGTH) driftHistoryLegacy.shift();
    if (driftHistoryDrift.length > DRIFT_HISTORY_LENGTH) driftHistoryDrift.shift();
  }

  // Threshold gate with hysteresis: separate ON/OFF trip points around the
  // (now fixed — no more Autotrack-style chasing) threshold, so the effect
  // doesn't flicker right at the boundary. The threshold itself never moves;
  // only the signal (via Drift Fix above) does.
  const thresholdMidi = encoderThreshold;  // Knob 3 raw value 0-127, fixed
  const onThresh = Math.min(127, thresholdMidi + DRIFT_CONFIG.deadband / 2);
  const offThresh = Math.max(0, thresholdMidi - DRIFT_CONFIG.deadband / 2);
  if (!effectOnState && smoothedAlpha > onThresh) {
    effectOnState = true;
  } else if (effectOnState && smoothedAlpha < offThresh) {
    effectOnState = false;
  }
  const chorus_wetVal = effectOnState
    ? Math.min(1, Math.max(0, (smoothedAlpha - offThresh) / (127 - offThresh)))
    : 0;

  // Master gate: effect is only active when EEG data flowing AND headset is worn
  effectActive = hasEEGData && isWorn;

  // Send effect mix value to LED controller (~20Hz)
  if (frameCount % 3 === 0) {
    sendAlphaScore(effectActive ? chorus_wetVal : 0, driftReady);
  }

  // Other effects use sigmoid
  const flanger_wetVal = sigmoid(lowBeta_rel);
  const reverb_wetVal = sigmoid(highBeta_rel);
  const delay_feedback = sigmoid(theta_rel);
  const distortion_wetVal = 1 - sigmoid(gamma_rel, STEEP, gammaMean * threshold);


  // Console logging - log every 30 seconds (reduced to minimize noise)
  if (frameCount % 1800 === 0) {
    console.log(`[XENBOX] Alpha:${nf(alpha_rel,1,3)} Chorus:${nf(chorus_wetVal,1,2)} HR:${heartRate} Worn:${isWorn?'YES':'NO'} MIDI:${midiEnabled&&isWorn?'ON':'SUPPRESSED'}`);
  }

  // Draw MIDI parameter histogram
  drawMIDIHistogram();

  // PPG waveform debug view removed — worn/heart-rate detection is robust now
  drawDriftTrackingPlot();

  // Consolidated status panel (drawn AFTER plots so it renders on top)
  push();
  const panelX = 280;
  const panelY = 5;
  const panelW = 280;
  const panelH = 90;
  const rowH = 20;
  const dotR = 6;
  const textStartX = panelX + 25;

  // Dark semi-transparent background
  fill(30, 30, 30, 200);
  noStroke();
  rect(panelX, panelY, panelW, panelH, 8);

  // Row 1: MUSE status - green when PPG data flowing
  const museOk = ppgSampleCount > 0;
  fill(museOk ? color(0, 200, 0) : color(200, 0, 0));
  noStroke();
  ellipse(panelX + 14, panelY + 15, dotR * 2, dotR * 2);
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  text(`MUSE: ${museOk ? 'Connected' : 'No Data'}`, textStartX, panelY + 15);

  // Row 2: HEADSET status - green when worn
  fill(isWorn ? color(0, 200, 0) : color(200, 0, 0));
  noStroke();
  ellipse(panelX + 14, panelY + 15 + rowH, dotR * 2, dotR * 2);
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  if (isWorn) {
    text(`HEADSET: On Head (${heartRate || '--'} BPM)`, textStartX, panelY + 15 + rowH);
  } else {
    text('HEADSET: Off Head', textStartX, panelY + 15 + rowH);
  }

  // Row 3: BELA status - green when MIDI active
  fill(midiEnabled ? color(0, 200, 0) : color(200, 0, 0));
  noStroke();
  ellipse(panelX + 14, panelY + 15 + rowH * 2, dotR * 2, dotR * 2);
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  text(`BELA: ${midiEnabled ? 'MIDI Active' : 'Not Connected'}`, textStartX, panelY + 15 + rowH * 2);

  // Row 4: FPS (small, dimmed)
  fill(150);
  textSize(12);
  text(`FPS: ${displayFPS}`, textStartX, panelY + 15 + rowH * 3);

  pop();

  // Encoder values - large separate display below status panel
  push();
  const encX = panelX;
  const encY = panelY + panelH + 10;
  const encW = 340;
  const encH = 80;

  // Background
  fill(30, 30, 30, 220);
  noStroke();
  rect(encX, encY, encW, encH, 8);

  // Effect name + encoder label
  const effectLabel = EFFECTS[activeEffect].label.toUpperCase();
  const knob2Label = EFFECTS[activeEffect].paramLabel.toUpperCase();
  const knob2Value = MIDI_CONFIG.effectParams[activeEffect];
  fill(255, 220, 0);
  textSize(20);
  textAlign(LEFT, TOP);
  text(`EFFECT: ${effectLabel}`, encX + 10, encY + 5);

  // Values
  textSize(18);
  fill(255);
  text(`GAIN:${MIDI_CONFIG.fixedValues.gain}  ${knob2Label}:${knob2Value}  THR:${Math.round(encoderThreshold)}${driftFixEnabled ? ' DF' : ''}`, encX + 10, encY + 35);

  // Show threshold status: effect active or inactive
  const thresholdActive = chorus_wetVal > 0.1;
  fill(thresholdActive ? color(0, 150, 255) : color(80));
  textSize(14);
  text(thresholdActive ? 'ACTIVE' : 'IDLE', encX + 10, encY + 60);

  pop();

  // Apply effect modulations based on active effect
  // effectActive = hasEEGData && isWorn — zero when Muse disconnected OR headset off
  if (midiEnabled) {
    const wetValue = effectActive ? chorus_wetVal * 127 : 0;

    // Active effect gets the live EEG-driven wet value; every other effect
    // gets forced to 0 so only one is ever audibly active at a time
    for (const key of EFFECT_ORDER) {
      if (key === activeEffect) {
        sendMIDICCThrottled(EFFECTS[key].mixCC, wetValue);
      } else {
        sendMIDICC(EFFECTS[key].mixCC, 0);
      }
    }
  }

  // Also apply to Tone.js chorus (browser-side, if mic is active)
  chorus.wet.value = (activeEffect === 'Chorus' && isWorn) ? chorus_wetVal : 0;
  flanger.wet.value = 0;
  reverb.wet.value = 0;
  delay.feedback.value = 0;
  distortion.wet.value = 0;
}

function drawMIDIHistogram() {
  const histX = 20;
  // Below the effect checkboxes + input-source divider/label/checkboxes +
  // Drift Fix checkbox (see setup(): start y=60, 25px per effect row, +10 gap,
  // +10 divider, +20 label, 25px per input-source row, +25 Drift Fix row, +15 margin)
  const histY = 60 + EFFECT_ORDER.length * 25 + 10 + 10 + 20 + INPUT_SOURCE_ORDER.length * 25 + 25 + 15;
  const histWidth = 240;
  const histHeight = height - histY - 20;
  const barPadding = 4;
  const barHeight = 18;

  // Background
  push();
  fill(240);
  stroke(100);
  strokeWeight(1);
  rect(histX, histY, histWidth, histHeight, 5);
  pop();

  // ========== EEG SECTION ==========
  push();
  fill(effectActive ? 0 : 150);
  textSize(11);
  textAlign(CENTER, TOP);
  text(effectActive ? "EEG Bands (Relative)" : "EEG Bands (no data)", histX + histWidth / 2, histY + 5);
  pop();

  // EEG parameters (0-1 scale, shown as percentage)
  // Grey out colors when no EEG data
  const grey = [180, 180, 180];
  const eegParams = [
    { name: "Alpha", value: eegDisplayValues.alpha, color: effectActive ? [255, 100, 100] : grey },
    { name: "Theta", value: eegDisplayValues.theta, color: effectActive ? [255, 200, 100] : grey },
    { name: "Low Beta", value: eegDisplayValues.lowBeta, color: effectActive ? [100, 255, 100] : grey },
    { name: "High Beta", value: eegDisplayValues.highBeta, color: effectActive ? [100, 100, 255] : grey },
    { name: "Gamma", value: eegDisplayValues.gamma, color: effectActive ? [200, 100, 255] : grey }
  ];

  const barMaxWidth = histWidth - 70;
  let y = histY + 22;

  for (let param of eegParams) {
    // Label
    push();
    fill(0);
    textSize(9);
    textAlign(LEFT, CENTER);
    text(param.name, histX + 5, y + barHeight / 2);
    pop();

    // Bar background
    push();
    fill(200);
    noStroke();
    rect(histX + 55, y, barMaxWidth, barHeight, 3);
    pop();

    // Value bar (0-1 maps to full width)
    const barWidth = Math.min(param.value, 1) * barMaxWidth;
    push();
    fill(param.color);
    noStroke();
    rect(histX + 55, y, barWidth, barHeight, 3);
    pop();

    // Value text (show as percentage)
    push();
    fill(0);
    textSize(9);
    textAlign(RIGHT, CENTER);
    text((param.value * 100).toFixed(0) + "%", histX + histWidth - 5, y + barHeight / 2);
    pop();

    y += barHeight + barPadding;
  }

  // ========== MIDI SECTION ==========
  y += 8;
  push();
  fill(effectActive ? 0 : 150);
  textSize(11);
  textAlign(CENTER, TOP);
  text(effectActive ? "MIDI to Bela" : "MIDI to Bela (inactive)", histX + histWidth / 2, y);
  pop();
  y += 16;

  // MIDI parameters (0-127 scale)
  // Mix bar shows RAW alpha activity (pre-threshold), not the gated value
  // When no EEG data, show greyed out bars
  const knob2Name = EFFECTS[activeEffect].paramLabel;
  const knob2Val = MIDI_CONFIG.effectParams[activeEffect];
  const midiParams = [
    { name: "Mix", value: effectActive ? Math.round(smoothedAlpha) : 0, color: effectActive ? [76, 175, 80] : [180, 180, 180], dynamic: true },
    { name: knob2Name, value: knob2Val, color: [100, 100, 100], dynamic: false },
    { name: "Gain", value: midiValues.gain, color: [100, 100, 100], dynamic: false }
  ];

  for (let param of midiParams) {
    // Label
    push();
    fill(effectActive ? 0 : 150);
    textSize(9);
    textAlign(LEFT, CENTER);
    text(param.name, histX + 5, y + barHeight / 2);
    pop();

    // Bar background
    push();
    fill(200);
    noStroke();
    rect(histX + 55, y, barMaxWidth, barHeight, 3);
    pop();

    // Value bar
    const barWidth = (param.value / 127) * barMaxWidth;
    push();
    fill(param.color);
    noStroke();
    rect(histX + 55, y, barWidth, barHeight, 3);
    pop();

    // Orange threshold marker on Mix bar — kept high-contrast even when
    // inactive (was a light tan on a light gray background before, nearly
    // invisible, easy to mistake for "the threshold isn't moving")
    if (param.dynamic) {
      const thrX = histX + 55 + (encoderThreshold / 127) * barMaxWidth;
      push();
      stroke(effectActive ? color(255, 100, 0) : color(120, 60, 0));
      strokeWeight(2);
      line(thrX, y, thrX, y + barHeight);
      pop();
    }

    // Value text
    push();
    fill(effectActive ? 0 : 150);
    textSize(9);
    textAlign(RIGHT, CENTER);
    text(param.value, histX + histWidth - 5, y + barHeight / 2);
    pop();

    y += barHeight + barPadding;
  }

}

function drawDriftTrackingPlot() {
  // Shows the last 5 minutes of both tracked-signal candidates against the
  // fixed threshold + hysteresis band, so drift (and whether Drift Fix is
  // actually compensating for it) is visible at a glance rather than
  // inferred from the effect getting stuck. Light trace = legacy
  // (lifetime-mean) signal, which is expected to wander over a session;
  // bold trace = Drift Fix (fast/slow EMA) signal, which should stay near
  // the threshold band regardless of where the legacy trace has drifted to.
  const plotX = 280;
  const plotY = 50;  // takes the full space the raw multi-band plot used to occupy
  const plotH = height - plotY - 20;
  const plotW = width - plotX - 20;

  push();
  fill(255);
  stroke(100);
  strokeWeight(1);
  rect(plotX, plotY, plotW, plotH, 3);
  pop();

  push();
  fill(0);
  textSize(10);
  textAlign(LEFT, TOP);
  text(`Drift Tracking (last 5 min) — ${driftFixEnabled ? 'Drift Fix ON' : 'Drift Fix OFF, legacy active'}`, plotX + 5, plotY + 2);
  pop();

  // Legend
  push();
  textSize(9);
  textAlign(LEFT, CENTER);
  stroke(180, 180, 180); strokeWeight(1);
  line(plotX + plotW - 130, plotY + 8, plotX + plotW - 110, plotY + 8);
  noStroke(); fill(100);
  text("Legacy", plotX + plotW - 105, plotY + 8);
  stroke(0, 160, 80); strokeWeight(2);
  line(plotX + plotW - 60, plotY + 8, plotX + plotW - 40, plotY + 8);
  noStroke(); fill(0, 120, 60);
  text("Drift Fix", plotX + plotW - 35, plotY + 8);
  pop();

  const innerX = plotX + 28;  // reserves room for the value-axis labels below
  const innerY = plotY + 14;
  const innerW = plotW - 33;
  const innerH = plotH - 18;

  // Fixed 0-127 scale (same units as the threshold knob) so the threshold
  // line and hysteresis band are stationary reference points on this plot
  const valueToY = (v) => innerY + innerH - (v / 127) * innerH;

  // Gridlines + value labels (0/32/64/96/127) — cheap to add now that there's
  // real vertical room, and directly useful for judging the trend by eye
  push();
  stroke(230);
  strokeWeight(1);
  fill(150);
  textSize(9);
  textAlign(RIGHT, CENTER);
  for (const v of [0, 32, 64, 96, 127]) {
    const gy = valueToY(v);
    line(innerX, gy, innerX + innerW, gy);
    text(v, innerX - 3, gy);
  }
  pop();

  // Hysteresis deadband (shaded) + threshold center line
  const onThresh = Math.min(127, encoderThreshold + DRIFT_CONFIG.deadband / 2);
  const offThresh = Math.max(0, encoderThreshold - DRIFT_CONFIG.deadband / 2);
  push();
  noStroke();
  fill(255, 220, 0, 40);
  rect(innerX, valueToY(onThresh), innerW, valueToY(offThresh) - valueToY(onThresh));
  stroke(255, 180, 0);
  strokeWeight(1);
  line(innerX, valueToY(encoderThreshold), innerX + innerW, valueToY(encoderThreshold));
  pop();

  // Trace-drawing helper
  const drawTrace = (history, strokeColor, weight) => {
    if (history.length < 2) return;
    push();
    stroke(...strokeColor);
    strokeWeight(weight);
    noFill();
    beginShape();
    for (let i = 0; i < history.length; i++) {
      const x = innerX + (i / (DRIFT_HISTORY_LENGTH - 1)) * innerW;
      vertex(x, valueToY(history[i]));
    }
    endShape();
    pop();
  };

  drawTrace(driftHistoryLegacy, [180, 180, 180], 1);   // light gray, thin — legacy
  drawTrace(driftHistoryDrift, [0, 160, 80], 2);        // bold green — Drift Fix

  if (driftHistoryLegacy.length < 2) {
    push();
    fill(150);
    textSize(11);
    textAlign(CENTER, CENTER);
    text("Collecting data — plot fills in over the first few minutes", plotX + plotW / 2, plotY + plotH / 2 + 5);
    pop();
  }
}

function windowResized() {
  resizeCanvas(windowWidth - 20, windowHeight - 20);
}
