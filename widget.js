"use strict";

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const SENDER = uid();
const SETTINGS_KEY = "studyTimerWidgetSettingsV7";
const SYNC_SETUP_KEY = "studyTimerSyncSetupComplete";

let audioContext;
let swFrame;
let timerInterval;
let alarmInterval;
let alarmStopTimeout;
let ambientEngine = null;
let eventSource = null;
let lastCompanionSeen = 0;

const state = {
  swRunning: false,
  swStartedAt: 0,
  swElapsed: 0,
  timerRunning: false,
  timerEnd: 0,
  configuredMs: 25 * 60000,
  remainingMs: 25 * 60000,
  segmentStartedAt: null,
  segmentToken: null,
  masterPaused: false,
  resumeSw: false,
  resumeTimer: false
};

const soundLabels = {
  meditation: "Meditation",
  alpha: "Alpha-Waves",
  bowl: "Klangschalen",
  deep: "Ambient",
  rain: "Regen",
  campfire: "Lagerfeuer"
};

const soundNotes = {
  meditation: "Ruhiger Drone mit weichem Rauschen und gelegentlicher Klangschale.",
  alpha: "Zwei Sinustöne mit 10 Hz Differenz; Kopfhörer empfohlen.",
  bowl: "Sanfter tiefer Hintergrund mit regelmässigen Klangschalen.",
  deep: "Langsame, tiefe Ambient-Fläche ohne helle Töne.",
  rain: "Gleichmässiger Regen mit einzelnen weicheren Tropfen.",
  campfire: "Warmes Feuerrauschen mit unregelmässigem Knistern."
};

const alarmLabels = {
  egg: "Eieruhr",
  bell: "Glocke",
  digital: "Digitaler Doppelton",
  classic: "Klassischer Wecker",
  stopwatch: "Stoppuhr-Piepton",
  chime: "Sanftes Chime"
};

const alarmDurationLabels = {
  "30": "30 sec",
  "60": "1 min",
  "180": "3 min",
  manual: "bis Stop"
};

function audio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (!saved) return;

    if (typeof saved.ambientEnabled === "boolean") $("ambientEnabled").checked = saved.ambientEnabled;
    if (saved.ambientType && soundLabels[saved.ambientType]) $("ambientType").value = saved.ambientType;
    if (Number.isFinite(Number(saved.ambientVolume))) $("ambientVolume").value = saved.ambientVolume;

    if (typeof saved.alarmEnabled === "boolean") $("alarmEnabled").checked = saved.alarmEnabled;
    if (saved.alarmType && alarmLabels[saved.alarmType]) $("alarmType").value = saved.alarmType;
    if (["30", "60", "180", "manual"].includes(String(saved.alarmDuration))) $("alarmDuration").value = saved.alarmDuration;
    if (Number.isFinite(Number(saved.alarmVolume))) $("alarmVolume").value = saved.alarmVolume;
  } catch (_) {
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ambientEnabled: $("ambientEnabled").checked,
    ambientType: $("ambientType").value,
    ambientVolume: Number($("ambientVolume").value),
    alarmEnabled: $("alarmEnabled").checked,
    alarmType: $("alarmType").value,
    alarmDuration: $("alarmDuration").value,
    alarmVolume: Number($("alarmVolume").value)
  }));
}

function updateSettingsSummaries() {
  const ambientEnabled = $("ambientEnabled").checked;
  const alarmEnabled = $("alarmEnabled").checked;

  $("ambientSummary").textContent = ambientEnabled ? soundLabels[$("ambientType").value] : "Aus";
  $("ambientNote").textContent = soundNotes[$("ambientType").value];
  $("stopwatchSoundDetails").classList.toggle("ambient-disabled", !ambientEnabled);

  $("alarmSummary").textContent = alarmEnabled
    ? `${alarmLabels[$("alarmType").value]} · ${alarmDurationLabels[$("alarmDuration").value]}`
    : "Aus";
  $("alarmDetails").classList.toggle("alarm-disabled", !alarmEnabled);
}

/* Synchronisierung */
function randomCode() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

function getCode() {
  let code = localStorage.getItem("studyTimerSyncCode");
  if (!code) {
    code = randomCode();
    localStorage.setItem("studyTimerSyncCode", code);
  }
  return code;
}

function topic() {
  return `study_timer_${getCode()}`;
}

function updateCompanionLink() {
  $("syncCode").value = getCode();
  $("openCompanion").href = `companion.html?code=${encodeURIComponent(getCode())}`;
}

function currentSw() {
  return state.swRunning ? state.swElapsed + Date.now() - state.swStartedAt : state.swElapsed;
}

function snapshot() {
  return {
    swRunning: state.swRunning,
    swStartedAt: state.swStartedAt,
    swElapsed: state.swElapsed,
    timerRunning: state.timerRunning,
    timerEnd: state.timerEnd,
    configuredMs: state.configuredMs,
    remainingMs: state.timerRunning ? Math.max(0, state.timerEnd - Date.now()) : state.remainingMs,
    segmentStartedAt: state.segmentStartedAt,
    segmentToken: state.segmentToken,
    sentAt: Date.now()
  };
}

async function publish(kind, data = {}) {
  try {
    await fetch(`https://ntfy.sh/${topic()}`, {
      method: "POST",
      body: JSON.stringify({ app: "study-timer-sync-v2", kind, sender: SENDER, at: Date.now(), ...data }),
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Cache": "no",
        "Firebase": "no"
      }
    });
  } catch (_) {
    setSyncStatus("Sync offline", "error");
  }
}

function publishState() {
  publish("state", { state: snapshot() });
}

function setSyncStatus(text, cssClass = "") {
  $("syncStatus").textContent = text;
  $("syncDetails").classList.remove("connected", "error");
  if (cssClass) $("syncDetails").classList.add(cssClass);

  const complete = localStorage.getItem(SYNC_SETUP_KEY) === "true";
  $("syncSummaryText").textContent = complete ? "Windows-Begleit-App" : "Begleit-App einmalig verbinden";
}

function markCompanionConnected() {
  lastCompanionSeen = Date.now();
  localStorage.setItem(SYNC_SETUP_KEY, "true");
  setSyncStatus("Verbunden", "connected");
  $("syncDetails").open = false;
}

function connectRelay() {
  eventSource?.close();
  updateCompanionLink();

  eventSource = new EventSource(`https://ntfy.sh/${topic()}/sse`);
  eventSource.onmessage = event => {
    try {
      const envelope = JSON.parse(event.data);
      if (envelope.event !== "message") return;
      const message = JSON.parse(envelope.message);
      if (message.app !== "study-timer-sync-v2" || message.sender === SENDER) return;

      if (message.kind === "companion_ready" || message.kind === "companion_ping") {
        markCompanionConnected();
        publishState();
      } else if (message.kind === "request_state") {
        publishState();
      }
    } catch (_) {
    }
  };
  eventSource.onerror = () => setSyncStatus("Verbindung wird aufgebaut", "error");
}

setInterval(() => {
  if (lastCompanionSeen && Date.now() - lastCompanionSeen > 150000) {
    setSyncStatus("App geschlossen");
  }
}, 30000);

/* Stoppuhr */
function formatSw(ms) {
  const centisecondsTotal = Math.floor(ms / 10);
  const centiseconds = centisecondsTotal % 100;
  const secondsTotal = Math.floor(centisecondsTotal / 100);
  const seconds = secondsTotal % 60;
  const minutesTotal = Math.floor(secondsTotal / 60);
  const minutes = minutesTotal % 60;
  const hours = Math.floor(minutesTotal / 60);

  return {
    main: [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":"),
    fraction: String(centiseconds).padStart(2, "0")
  };
}

function renderSw() {
  const formatted = formatSw(currentSw());
  $("swMain").textContent = formatted.main;
  $("swFraction").textContent = "." + formatted.fraction;
  if (state.swRunning) swFrame = requestAnimationFrame(renderSw);
}

function noiseBuffer(ctx, colour = "white", seconds = 5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const output = buffer.getChannelData(0);
  let last = 0;

  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (colour === "brown") {
      last = (last + 0.025 * white) / 1.025;
      output[index] = last * 3.2;
    } else {
      output[index] = white;
    }
  }
  return buffer;
}

function createAmbientEngine() {
  const ctx = audio();
  const master = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor).connect(ctx.destination);
  master.gain.setValueAtTime(0.0001, ctx.currentTime);

  return {
    ctx,
    master,
    stoppables: [],
    intervals: [],
    timeouts: [],
    stopped: false
  };
}

function registerStop(engine, node) {
  engine.stoppables.push(node);
  return node;
}

function engineTimeout(engine, callback, delay) {
  const id = setTimeout(() => {
    if (!engine.stopped && ambientEngine === engine) callback();
  }, delay);
  engine.timeouts.push(id);
  return id;
}

function engineInterval(engine, callback, delay) {
  const id = setInterval(() => {
    if (!engine.stopped && ambientEngine === engine) callback();
  }, delay);
  engine.intervals.push(id);
  return id;
}

function playBowl(destination, strength = 0.10, base = 261.63) {
  const ctx = audio();
  const now = ctx.currentTime;
  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2400;

  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(strength, now + 0.035);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 6.2);

  [base, base * 2.01, base * 3.03, base * 4.08].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = index === 0 ? "sine" : "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.value = [0.62, 0.22, 0.08, 0.035][index];
    oscillator.connect(gain).connect(filter);
    oscillator.start(now);
    oscillator.stop(now + 6.4);
  });

  filter.connect(master).connect(destination);
}

function addDrone(engine, frequencies, lowpass = 1200) {
  const filter = engine.ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const group = engine.ctx.createGain();
  group.gain.value = 0.72;
  filter.connect(group).connect(engine.master);

  frequencies.forEach(({ hz, type = "sine", gain: amount }) => {
    const oscillator = registerStop(engine, engine.ctx.createOscillator());
    const gain = engine.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = hz;
    gain.gain.value = amount;
    oscillator.connect(gain).connect(filter);
    oscillator.start();
  });

  const lfo = registerStop(engine, engine.ctx.createOscillator());
  const lfoGain = engine.ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain).connect(group.gain);
  lfo.start();
}

function addLoopNoise(engine, colour, filterType, frequency, gainAmount) {
  const source = registerStop(engine, engine.ctx.createBufferSource());
  const filter = engine.ctx.createBiquadFilter();
  const gain = engine.ctx.createGain();
  source.buffer = noiseBuffer(engine.ctx, colour);
  source.loop = true;
  filter.type = filterType;
  filter.frequency.value = frequency;
  gain.gain.value = gainAmount;
  source.connect(filter).connect(gain).connect(engine.master);
  source.start();
  return { source, filter, gain };
}

function scheduleRainDrop(engine) {
  if (engine.stopped) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(1500 + Math.random() * 1800, now);
  oscillator.frequency.exponentialRampToValueAtTime(650 + Math.random() * 500, now + 0.09);
  panner.pan.value = Math.random() * 1.6 - 0.8;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.018 + Math.random() * 0.025, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  oscillator.connect(gain).connect(panner).connect(engine.master);
  oscillator.start(now);
  oscillator.stop(now + 0.14);
  engineTimeout(engine, () => scheduleRainDrop(engine), 250 + Math.random() * 1000);
}

function scheduleCrackle(engine) {
  if (engine.stopped) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  source.buffer = noiseBuffer(ctx, "white", 0.08);
  filter.type = "highpass";
  filter.frequency.value = 1300 + Math.random() * 2500;
  panner.pan.value = Math.random() * 1.4 - 0.7;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.025 + Math.random() * 0.065, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045 + Math.random() * 0.05);
  source.connect(filter).connect(gain).connect(panner).connect(engine.master);
  source.start(now);
  engineTimeout(engine, () => scheduleCrackle(engine), 120 + Math.random() * 850);
}

function buildAmbient(engine, type) {
  if (type === "alpha") {
    const left = registerStop(engine, engine.ctx.createOscillator());
    const right = registerStop(engine, engine.ctx.createOscillator());
    const leftPan = engine.ctx.createStereoPanner();
    const rightPan = engine.ctx.createStereoPanner();
    const toneGain = engine.ctx.createGain();
    left.frequency.value = 200;
    right.frequency.value = 210;
    leftPan.pan.value = -1;
    rightPan.pan.value = 1;
    toneGain.gain.value = 0.42;
    left.connect(leftPan).connect(toneGain).connect(engine.master);
    right.connect(rightPan).connect(toneGain).connect(engine.master);
    left.start();
    right.start();
    addLoopNoise(engine, "brown", "lowpass", 700, 0.055);
  } else if (type === "rain") {
    addLoopNoise(engine, "white", "lowpass", 6500, 0.19);
    addLoopNoise(engine, "brown", "lowpass", 1200, 0.10);
    scheduleRainDrop(engine);
  } else if (type === "campfire") {
    const fire = addLoopNoise(engine, "brown", "bandpass", 750, 0.24);
    fire.filter.Q.value = 0.7;
    const lfo = registerStop(engine, engine.ctx.createOscillator());
    const lfoGain = engine.ctx.createGain();
    lfo.frequency.value = 0.8;
    lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(fire.gain.gain);
    lfo.start();
    scheduleCrackle(engine);
  } else if (type === "deep") {
    addDrone(engine, [
      { hz: 73.42, gain: 0.34 },
      { hz: 110.00, gain: 0.23 },
      { hz: 146.83, gain: 0.12 },
      { hz: 220.00, gain: 0.045, type: "triangle" }
    ], 800);
    addLoopNoise(engine, "brown", "lowpass", 500, 0.07);
  } else if (type === "bowl") {
    addDrone(engine, [
      { hz: 82.41, gain: 0.23 },
      { hz: 123.47, gain: 0.12 }
    ], 650);
    playBowl(engine.master, 0.12, 220);
    engineInterval(engine, () => playBowl(engine.master, 0.11, Math.random() > 0.5 ? 220 : 261.63), 12000);
  } else {
    addDrone(engine, [
      { hz: 110.00, gain: 0.34 },
      { hz: 164.81, gain: 0.18 },
      { hz: 220.00, gain: 0.075, type: "triangle" },
      { hz: 329.63, gain: 0.035 }
    ], 1200);
    addLoopNoise(engine, "brown", "lowpass", 900, 0.10);
    engineTimeout(engine, () => playBowl(engine.master, 0.11), 1600);
    engineInterval(engine, () => playBowl(engine.master, 0.10), 18000);
  }
}

function startAmbient() {
  if (ambientEngine || !state.swRunning || !$("ambientEnabled").checked || Number($("ambientVolume").value) <= 0) return;

  const engine = createAmbientEngine();
  ambientEngine = engine;
  buildAmbient(engine, $("ambientType").value);
  engine.master.gain.exponentialRampToValueAtTime(Number($("ambientVolume").value), engine.ctx.currentTime + 0.65);
}

function stopAmbient() {
  if (!ambientEngine || !audioContext) return;
  const engine = ambientEngine;
  ambientEngine = null;
  engine.stopped = true;
  engine.intervals.forEach(clearInterval);
  engine.timeouts.forEach(clearTimeout);

  const now = audioContext.currentTime;
  try {
    engine.master.gain.cancelScheduledValues(now);
    engine.master.gain.setValueAtTime(Math.max(0.0001, engine.master.gain.value), now);
    engine.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    engine.stoppables.forEach(node => {
      try { node.stop(now + 0.32); } catch (_) {}
    });
  } catch (_) {
  }
}

function restartAmbientIfRunning() {
  stopAmbient();
  if (state.swRunning) startAmbient();
}

function startSw() {
  if (state.swRunning) return;
  audio();
  state.swStartedAt = Date.now();
  state.swRunning = true;
  $("swToggle").textContent = "Pause";
  $("swStatus").textContent = "Läuft";
  startAmbient();
  renderSw();
  publishState();
}

function pauseSw(label = "Pausiert") {
  if (!state.swRunning) return;
  state.swElapsed = currentSw();
  state.swStartedAt = 0;
  state.swRunning = false;
  cancelAnimationFrame(swFrame);
  stopAmbient();
  $("swToggle").textContent = "Weiter";
  $("swStatus").textContent = label;
  renderSw();
  publishState();
}

function resetSw() {
  state.swRunning = false;
  state.swElapsed = 0;
  state.swStartedAt = 0;
  state.resumeSw = false;
  cancelAnimationFrame(swFrame);
  stopAmbient();
  $("swToggle").textContent = "Start";
  $("swStatus").textContent = "Bereit";
  renderSw();
  publishState();
}

/* Timer und Alarm */
function inputMs() {
  return (
    clamp($("hours").value, 0, 99) * 3600 +
    clamp($("minutes").value, 0, 59) * 60 +
    clamp($("seconds").value, 0, 59)
  ) * 1000;
}

function writeInputs(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  $("hours").value = Math.floor(seconds / 3600);
  $("minutes").value = Math.floor(seconds / 60) % 60;
  $("seconds").value = seconds % 60;
}

function formatTimer(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function renderTimer() {
  $("timerDisplay").textContent = formatTimer(state.remainingMs);
}

function tone(destination, frequency, start, duration, volume, type = "sine", endFrequency = null) {
  const ctx = audio();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playAlarmCycle() {
  if (!$("alarmEnabled").checked || Number($("alarmVolume").value) <= 0) return;

  const ctx = audio();
  const now = ctx.currentTime;
  const output = ctx.createGain();
  output.gain.value = Number($("alarmVolume").value);
  output.connect(ctx.destination);
  const type = $("alarmType").value;

  if (type === "egg") {
    for (let index = 0; index < 9; index += 1) {
      tone(output, index % 2 ? 2550 : 2200, now + index * 0.085, 0.07, 0.55, "square");
    }
    tone(output, 1500, now + 0.82, 0.34, 0.55, "triangle", 950);
  } else if (type === "bell") {
    [440, 880, 1320, 1760].forEach((frequency, index) => {
      tone(output, frequency, now, 2.2 + index * 0.15, [0.62, 0.25, 0.10, 0.05][index], index ? "triangle" : "sine");
    });
  } else if (type === "digital") {
    [0, 0.19].forEach(offset => tone(output, 1050, now + offset, 0.12, 0.62, "square"));
  } else if (type === "classic") {
    for (let index = 0; index < 8; index += 1) {
      tone(output, index % 2 ? 980 : 720, now + index * 0.11, 0.095, 0.52, "square");
    }
  } else if (type === "stopwatch") {
    [0, 0.16, 0.32].forEach(offset => tone(output, 1250, now + offset, 0.10, 0.64, "sine"));
  } else {
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      tone(output, frequency, now + index * 0.22, 1.45, [0.50, 0.40, 0.32][index], "sine");
    });
  }
}

function alarmRepeatDelay() {
  return {
    egg: 1800,
    bell: 3000,
    digital: 1700,
    classic: 1700,
    stopwatch: 2100,
    chime: 3600
  }[$("alarmType").value] || 2000;
}

function stopAlarm() {
  clearInterval(alarmInterval);
  clearTimeout(alarmStopTimeout);
  alarmInterval = null;
  alarmStopTimeout = null;
  $("timerCard").classList.remove("finished");
  $("alarmStop").style.display = "none";
}

function startAlarm() {
  stopAlarm();
  $("timerCard").classList.add("finished");

  if (!$("alarmEnabled").checked) return;

  $("alarmStop").style.display = "block";
  playAlarmCycle();
  alarmInterval = setInterval(playAlarmCycle, alarmRepeatDelay());

  const duration = $("alarmDuration").value;
  if (duration !== "manual") {
    alarmStopTimeout = setTimeout(stopAlarm, Number(duration) * 1000);
  }
}

function startTimer() {
  if (state.timerRunning) return;
  stopAlarm();
  audio();

  if (state.remainingMs <= 0) state.remainingMs = state.configuredMs;
  if (state.remainingMs <= 0) {
    $("timerStatus").textContent = "Zeit einstellen";
    return;
  }

  state.segmentStartedAt = Date.now();
  state.segmentToken = uid();
  state.timerEnd = state.segmentStartedAt + state.remainingMs;
  state.timerRunning = true;
  $("timerToggle").textContent = "Pause";
  $("timerStatus").textContent = "Läuft";
  timerInterval = setInterval(tick, 100);
  tick();
  publishState();
}

function pauseTimer(label = "Pausiert") {
  if (!state.timerRunning) return;
  state.remainingMs = Math.max(0, state.timerEnd - Date.now());
  state.timerRunning = false;
  state.segmentStartedAt = null;
  clearInterval(timerInterval);
  $("timerToggle").textContent = "Weiter";
  $("timerStatus").textContent = label;
  renderTimer();
  publishState();
}

function tick() {
  state.remainingMs = Math.max(0, state.timerEnd - Date.now());
  renderTimer();
  if (state.remainingMs <= 0) finishTimer();
}

function finishTimer() {
  const segmentMs = state.segmentStartedAt ? Math.max(0, Date.now() - state.segmentStartedAt) : 0;
  const token = state.segmentToken;
  state.timerRunning = false;
  state.remainingMs = 0;
  state.segmentStartedAt = null;
  state.resumeTimer = false;
  clearInterval(timerInterval);
  $("timerToggle").textContent = "Start";
  $("timerStatus").textContent = "Fertig";
  renderTimer();
  startAlarm();
  publish("finished", { configuredMs: state.configuredMs, segmentMs, segmentToken: token });
  publishState();
  updateMaster();
}

function resetTimer() {
  state.timerRunning = false;
  state.segmentStartedAt = null;
  state.remainingMs = state.configuredMs;
  state.resumeTimer = false;
  clearInterval(timerInterval);
  stopAlarm();
  $("timerToggle").textContent = "Start";
  $("timerStatus").textContent = state.remainingMs > 0 ? "Bereit" : "Zeit einstellen";
  renderTimer();
  publishState();
}

function syncInputs() {
  if (state.timerRunning) return;
  stopAlarm();
  state.configuredMs = inputMs();
  state.remainingMs = state.configuredMs;
  $("timerStatus").textContent = state.remainingMs > 0 ? "Bereit" : "Zeit einstellen";
  renderTimer();
  updateMaster();
  publishState();
}

function adjustTimer(minutes) {
  stopAlarm();
  const delta = Number(minutes) * 60000;
  state.configuredMs = Math.max(0, state.configuredMs + delta);
  state.remainingMs = Math.max(0, state.remainingMs + delta);
  writeInputs(state.configuredMs);

  if (state.timerRunning) {
    if (state.remainingMs <= 0) {
      finishTimer();
      return;
    }
    state.timerEnd = Date.now() + state.remainingMs;
    $("timerStatus").textContent = "Läuft";
  } else {
    $("timerStatus").textContent = state.remainingMs > 0
      ? (state.masterPaused ? "Gemeinsam pausiert" : "Bereit")
      : "Zeit einstellen";
  }

  renderTimer();
  updateMaster();
  publishState();
}

/* Gemeinsame Steuerung */
const masterButtons = [...document.querySelectorAll(".master-toggle")];
const masterResetButtons = [...document.querySelectorAll(".master-reset")];

function updateMaster() {
  const label = state.masterPaused
    ? "▶ Beide fortsetzen"
    : (state.swRunning || state.timerRunning ? "⏸ Beide pausieren" : "▶ Beide starten");

  masterButtons.forEach(button => { button.textContent = label; });
  $("swToggle").disabled = state.masterPaused;
  $("timerToggle").disabled = state.masterPaused;
}

function startBoth() {
  if (!state.swRunning) startSw();
  if (!state.timerRunning) startTimer();
  updateMaster();
}

function pauseBoth() {
  state.resumeSw = state.swRunning;
  state.resumeTimer = state.timerRunning;
  if (state.swRunning) pauseSw("Gemeinsam pausiert");
  if (state.timerRunning) pauseTimer("Gemeinsam pausiert");
  stopAlarm();
  state.masterPaused = true;
  updateMaster();
}

function resumeBoth() {
  state.masterPaused = false;
  const startSwAgain = state.resumeSw;
  const startTimerAgain = state.resumeTimer;
  state.resumeSw = false;
  state.resumeTimer = false;
  if (startSwAgain) startSw();
  if (startTimerAgain && state.remainingMs > 0) startTimer();
  updateMaster();
}

function toggleMaster() {
  audio();
  if (state.masterPaused) resumeBoth();
  else if (state.swRunning || state.timerRunning) pauseBoth();
  else startBoth();
}

function resetBoth() {
  state.masterPaused = false;
  state.resumeSw = false;
  state.resumeTimer = false;
  resetSw();
  resetTimer();
  updateMaster();
}

/* Events */
$("swToggle").addEventListener("click", () => {
  if (state.masterPaused) return;
  state.swRunning ? pauseSw() : startSw();
  updateMaster();
});

$("swReset").addEventListener("click", () => {
  resetSw();
  updateMaster();
});

[$("ambientEnabled"), $("ambientType")].forEach(element => {
  element.addEventListener("change", () => {
    saveSettings();
    updateSettingsSummaries();
    restartAmbientIfRunning();
  });
});

$("ambientVolume").addEventListener("input", () => {
  saveSettings();
  if (ambientEngine && audioContext) {
    const value = Number($("ambientVolume").value);
    if (value <= 0) stopAmbient();
    else ambientEngine.master.gain.setTargetAtTime(value, audioContext.currentTime, 0.06);
  } else if (state.swRunning) {
    startAmbient();
  }
});

[$("hours"), $("minutes"), $("seconds")].forEach(input => input.addEventListener("input", syncInputs));
document.querySelectorAll("[data-minutes]").forEach(button => button.addEventListener("click", () => adjustTimer(button.dataset.minutes)));

$("timerToggle").addEventListener("click", () => {
  if (state.masterPaused) return;
  state.timerRunning ? pauseTimer() : startTimer();
  updateMaster();
});

$("timerReset").addEventListener("click", () => {
  resetTimer();
  updateMaster();
});

$("alarmStop").addEventListener("click", stopAlarm);

[$("alarmEnabled"), $("alarmType"), $("alarmDuration")].forEach(element => {
  element.addEventListener("change", () => {
    saveSettings();
    updateSettingsSummaries();
  });
});

$("alarmVolume").addEventListener("input", saveSettings);

masterButtons.forEach(button => button.addEventListener("click", toggleMaster));
masterResetButtons.forEach(button => button.addEventListener("click", resetBoth));

$("copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(getCode());
    $("copyCode").textContent = "Kopiert";
    setTimeout(() => { $("copyCode").textContent = "Code kopieren"; }, 1200);
  } catch (_) {
    $("syncCode").select();
    document.execCommand("copy");
  }
});

$("newCode").addEventListener("click", () => {
  if (!confirm("Die bisherige Begleit-App verliert dadurch die Verbindung. Wirklich zurücksetzen?")) return;
  localStorage.setItem("studyTimerSyncCode", randomCode());
  localStorage.removeItem(SYNC_SETUP_KEY);
  lastCompanionSeen = 0;
  updateCompanionLink();
  setSyncStatus("Nicht eingerichtet");
  $("syncDetails").open = true;
  connectRelay();
});

/* Start */
loadSettings();
updateSettingsSummaries();
renderSw();
renderTimer();
updateMaster();
updateCompanionLink();

const setupComplete = localStorage.getItem(SYNC_SETUP_KEY) === "true";
$("syncDetails").open = !setupComplete;
setSyncStatus(setupComplete ? "App geschlossen" : "Nicht eingerichtet");
connectRelay();
publishState();
