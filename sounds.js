// Alle Klänge werden live mit Web Audio erzeugt (keine Audiodateien).
// Klangdesign aus v9 übernommen. Alarme werden im Voraus auf der Audio-Zeitachse geplant,
// damit sie auch in einem minimierten Fenster gleichmässig weiterklingen.

const ALARM_REPEAT = { egg: 1.8, bell: 3.0, digital: 1.7, classic: 1.7, stopwatch: 2.1, chime: 3.6 };
const SCHEDULE_AHEAD = 20; // Sekunden

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

function tone(ctx, destination, frequency, start, duration, volume, type = "sine", endFrequency = null) {
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

function alarmCycle(ctx, output, type, at) {
  if (type === "egg") {
    for (let index = 0; index < 9; index += 1) tone(ctx, output, index % 2 ? 2550 : 2200, at + index * 0.085, 0.07, 0.55, "square");
    tone(ctx, output, 1500, at + 0.82, 0.34, 0.55, "triangle", 950);
  } else if (type === "bell") {
    [440, 880, 1320, 1760].forEach((frequency, index) => {
      tone(ctx, output, frequency, at, 2.2 + index * 0.15, [0.62, 0.25, 0.10, 0.05][index], index ? "triangle" : "sine");
    });
  } else if (type === "digital") {
    [0, 0.19].forEach(offset => tone(ctx, output, 1050, at + offset, 0.12, 0.62, "square"));
  } else if (type === "classic") {
    for (let index = 0; index < 8; index += 1) tone(ctx, output, index % 2 ? 980 : 720, at + index * 0.11, 0.095, 0.52, "square");
  } else if (type === "stopwatch") {
    [0, 0.16, 0.32].forEach(offset => tone(ctx, output, 1250, at + offset, 0.10, 0.64, "sine"));
  } else {
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      tone(ctx, output, frequency, at + index * 0.22, 1.45, [0.50, 0.40, 0.32][index], "sine");
    });
  }
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.ambient = new Map();
    this.alarms = new Map();
  }

  context() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.ctx.addEventListener?.("statechange", () => this.onStateChange?.());
    }
    return this.ctx;
  }

  unlock() {
    const ctx = this.context();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  get ready() {
    return this.ctx?.state === "running";
  }

  /* ---------- Hintergrundklänge der Stoppuhren ---------- */

  // desired: Map(id → { type, volume })
  syncAmbient(desired) {
    for (const [id, engine] of this.ambient) {
      const wanted = desired.get(id);
      if (!wanted || wanted.type !== engine.type) this.stopAmbient(id);
    }
    if (!this.ready) return;
    for (const [id, wanted] of desired) {
      const engine = this.ambient.get(id);
      if (engine) {
        if (Math.abs(engine.volume - wanted.volume) > 0.0005) {
          engine.volume = wanted.volume;
          engine.master.gain.setTargetAtTime(Math.max(0.0001, wanted.volume), this.ctx.currentTime, 0.06);
        }
      } else {
        this.startAmbient(id, wanted.type, wanted.volume);
      }
    }
  }

  startAmbient(id, type, volume) {
    const ctx = this.ctx;
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor).connect(ctx.destination);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), ctx.currentTime + 0.6);
    const engine = { ctx, type, volume, master, compressor, stoppables: [], intervals: [], timeouts: [], stopped: false };
    this.ambient.set(id, engine);
    buildAmbient(engine, type);
  }

  stopAmbient(id) {
    const engine = this.ambient.get(id);
    if (!engine) return;
    this.ambient.delete(id);
    engine.stopped = true;
    engine.intervals.forEach(clearInterval);
    engine.timeouts.forEach(clearTimeout);
    const now = engine.ctx.currentTime;
    try {
      engine.master.gain.cancelScheduledValues(now);
      engine.master.gain.setValueAtTime(Math.max(0.0001, engine.master.gain.value), now);
      engine.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      engine.stoppables.forEach(node => { try { node.stop(now + 0.32); } catch (_) {} });
      setTimeout(() => { try { engine.compressor.disconnect(); } catch (_) {} }, 400);
    } catch (_) {
    }
  }

  /* ---------- Alarme ---------- */

  // desired: Map(id → { type, volume, untilMs }) – untilMs ist die Wanduhrzeit, bis zu der geläutet wird.
  syncAlarms(desired, nowMs) {
    for (const [id, alarm] of this.alarms) {
      const wanted = desired.get(id);
      if (!wanted || wanted.type !== alarm.type) this.stopAlarm(id);
    }
    if (!this.ready) return;
    const ctx = this.ctx;
    for (const [id, wanted] of desired) {
      let alarm = this.alarms.get(id);
      if (!alarm) {
        const output = ctx.createGain();
        output.gain.value = wanted.volume;
        output.connect(ctx.destination);
        alarm = { type: wanted.type, volume: wanted.volume, output, nextAt: ctx.currentTime + 0.05 };
        this.alarms.set(id, alarm);
      }
      if (Math.abs(alarm.volume - wanted.volume) > 0.001) {
        alarm.volume = wanted.volume;
        alarm.output.gain.setTargetAtTime(wanted.volume, ctx.currentTime, 0.05);
      }
      const until = ctx.currentTime + Math.max(0, (wanted.untilMs - nowMs) / 1000);
      const horizon = Math.min(ctx.currentTime + SCHEDULE_AHEAD, until);
      if (alarm.nextAt < ctx.currentTime) alarm.nextAt = ctx.currentTime + 0.05;
      while (alarm.nextAt < horizon) {
        alarmCycle(ctx, alarm.output, alarm.type, alarm.nextAt);
        alarm.nextAt += ALARM_REPEAT[alarm.type] || 2;
      }
    }
  }

  stopAlarm(id) {
    const alarm = this.alarms.get(id);
    if (!alarm) return;
    this.alarms.delete(id);
    try {
      alarm.output.gain.cancelScheduledValues(this.ctx.currentTime);
      alarm.output.gain.setValueAtTime(0, this.ctx.currentTime);
      alarm.output.disconnect();
    } catch (_) {
    }
  }

  previewAlarm(type, volume) {
    const ctx = this.unlock();
    if (!ctx) return;
    const play = () => {
      const output = ctx.createGain();
      output.gain.value = volume;
      output.connect(ctx.destination);
      alarmCycle(ctx, output, type, ctx.currentTime + 0.03);
      setTimeout(() => { try { output.disconnect(); } catch (_) {} }, 4000);
    };
    if (ctx.state === "running") play();
    else ctx.resume().then(play).catch(() => {});
  }

  stopAll() {
    [...this.ambient.keys()].forEach(id => this.stopAmbient(id));
    [...this.alarms.keys()].forEach(id => this.stopAlarm(id));
  }
}

/* ---------- Bausteine der Hintergrundklänge ---------- */

function registerStop(engine, node) {
  engine.stoppables.push(node);
  return node;
}

function engineTimeout(engine, callback, delay) {
  engine.timeouts.push(setTimeout(() => { if (!engine.stopped) callback(); }, delay));
}

function engineInterval(engine, callback, delay) {
  engine.intervals.push(setInterval(() => { if (!engine.stopped) callback(); }, delay));
}

function playBowl(ctx, destination, strength = 0.10, base = 261.63) {
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
  const { ctx } = engine;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const group = ctx.createGain();
  group.gain.value = 0.72;
  filter.connect(group).connect(engine.master);
  frequencies.forEach(({ hz, type = "sine", gain: amount }) => {
    const oscillator = registerStop(engine, ctx.createOscillator());
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = hz;
    gain.gain.value = amount;
    oscillator.connect(gain).connect(filter);
    oscillator.start();
  });
  const lfo = registerStop(engine, ctx.createOscillator());
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain).connect(group.gain);
  lfo.start();
}

function addNoise(engine, colour, filterType, frequency, gainAmount) {
  const { ctx } = engine;
  const source = registerStop(engine, ctx.createBufferSource());
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer(ctx, colour);
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
  const { ctx } = engine;
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

function buildAmbient(engine, type) {
  const { ctx } = engine;
  if (type === "alpha") {
    const left = registerStop(engine, ctx.createOscillator());
    const right = registerStop(engine, ctx.createOscillator());
    const leftPan = ctx.createStereoPanner();
    const rightPan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    left.frequency.value = 200;
    right.frequency.value = 210;
    leftPan.pan.value = -1;
    rightPan.pan.value = 1;
    gain.gain.value = 0.42;
    left.connect(leftPan).connect(gain).connect(engine.master);
    right.connect(rightPan).connect(gain).connect(engine.master);
    left.start();
    right.start();
    addNoise(engine, "brown", "lowpass", 700, 0.055);
  } else if (type === "rain") {
    addNoise(engine, "white", "lowpass", 6500, 0.19);
    addNoise(engine, "brown", "lowpass", 1200, 0.10);
    scheduleRainDrop(engine);
  } else if (type === "ocean") {
    const waves = addNoise(engine, "brown", "lowpass", 1350, 0.25);
    const foam = addNoise(engine, "white", "bandpass", 1650, 0.06);
    foam.filter.Q.value = 0.5;
    const lfo = registerStop(engine, ctx.createOscillator());
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.075;
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain).connect(waves.gain.gain);
    lfo.start();
    const lfo2 = registerStop(engine, ctx.createOscillator());
    const lfoGain2 = ctx.createGain();
    lfo2.frequency.value = 0.052;
    lfoGain2.gain.value = 0.045;
    lfo2.connect(lfoGain2).connect(foam.gain.gain);
    lfo2.start();
  } else if (type === "deep") {
    addDrone(engine, [
      { hz: 73.42, gain: 0.34 },
      { hz: 110.00, gain: 0.23 },
      { hz: 146.83, gain: 0.12 },
      { hz: 220.00, gain: 0.045, type: "triangle" }
    ], 800);
    addNoise(engine, "brown", "lowpass", 500, 0.07);
  } else if (type === "bowl") {
    addDrone(engine, [{ hz: 82.41, gain: 0.23 }, { hz: 123.47, gain: 0.12 }], 650);
    playBowl(ctx, engine.master, 0.12, 220);
    engineInterval(engine, () => playBowl(ctx, engine.master, 0.11, Math.random() > 0.5 ? 220 : 261.63), 12000);
  } else {
    addDrone(engine, [
      { hz: 110.00, gain: 0.34 },
      { hz: 164.81, gain: 0.18 },
      { hz: 220.00, gain: 0.075, type: "triangle" },
      { hz: 329.63, gain: 0.035 }
    ], 1200);
    addNoise(engine, "brown", "lowpass", 900, 0.10);
    engineTimeout(engine, () => playBowl(ctx, engine.master, 0.11), 1600);
    engineInterval(engine, () => playBowl(ctx, engine.master, 0.10), 18000);
  }
}
