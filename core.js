// Lern-Timer v10 – Kernlogik ohne Browser-Abhängigkeiten.
// Alle Zeiten sind absolute Zeitstempel in Millisekunden (Serverzeit-korrigiert).
// Dadurch laufen Uhren nach einem Neuladen, Absturz oder Verbindungsabbruch korrekt weiter.

export const VERSION = "10.0";
export const SCHEMA = 10;
export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const TOMBSTONE_TTL = 30 * DAY;
export const LATE_LIMIT = 12 * HOUR; // ältere Abläufe lösen keine Meldung/keinen Alarm mehr aus

export const AMBIENT = {
  meditation: { label: "Meditation", option: "Meditation – Drone & Klangschale", note: "Ruhiger Drone mit weichem Rauschen und gelegentlicher Klangschale." },
  alpha: { label: "Alpha-Waves", option: "Alpha-Waves – 10 Hz", note: "Zwei Sinustöne mit 10 Hz Differenz; Kopfhörer empfohlen." },
  bowl: { label: "Klangschalen", option: "Klangschalen", note: "Sanfter Hintergrund mit regelmässigen Klangschalen." },
  deep: { label: "Ambient", option: "Tiefe Ambient-Fläche", note: "Langsame, tiefe Ambient-Fläche ohne helle Töne." },
  rain: { label: "Regen", option: "Regen", note: "Gleichmässiger Regen mit einzelnen weicheren Tropfen." },
  ocean: { label: "Wellen am Meer", option: "Wellen am Meer", note: "Langsames Meeresrauschen mit anschwellenden und abklingenden Wellen." }
};

export const ALARMS = {
  egg: "Eieruhr",
  bell: "Glocke",
  digital: "Digitaler Doppelton",
  classic: "Klassischer Wecker",
  stopwatch: "Stoppuhr-Piepton",
  chime: "Sanftes Chime"
};

export const ALARM_DURATIONS = {
  "30": { label: "30 Sekunden", short: "30 Sek." },
  "60": { label: "1 Minute", short: "1 Min." },
  "180": { label: "3 Minuten", short: "3 Min." },
  manual: { label: "Bis manuell gestoppt", short: "bis Stopp" }
};

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

export const uid = () => randomString(16);
export const randomCode = () => randomString(32);

export function cleanCode(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

export function isValidCode(value) {
  return /^[A-Za-z0-9_-]{24,64}$/.test(String(value ?? ""));
}

export function isValidDatabaseUrl(value) {
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(String(value ?? "").trim());
}

export const clamp = (value, min, max) => {
  const number = Number(value);
  return Math.min(Math.max(Number.isFinite(number) ? number : min, min), max);
};

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const text = (value, fallback, max = 60) => {
  const result = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return result || fallback;
};

/* ---------- Erzeugen ---------- */

function baseClock(kind, { id, label, order, now }) {
  return {
    id: id || uid(),
    kind,
    label,
    order: finite(order, now || 0),
    updatedAt: finite(now, 0),
    rev: uid(),
    by: "",
    deleted: false,
    groupPaused: false
  };
}

export function createStopwatch({ id, label = "Stoppuhr 1", order, now = 0, soundEnabled = true } = {}) {
  return {
    ...baseClock("stopwatch", { id, label, order, now }),
    running: false,
    startedAt: 0,
    elapsedMs: 0,
    sound: { enabled: soundEnabled, type: "meditation", volume: 0.11 }
  };
}

export function createTimer({ id, label = "Timer 1", order, now = 0, durationMs = 25 * MINUTE } = {}) {
  return {
    ...baseClock("timer", { id, label, order, now }),
    durationMs,
    running: false,
    endsAt: 0,
    remainingMs: durationMs,
    expiryId: "",
    alarmStoppedId: "",
    alarm: { enabled: true, type: "egg", duration: "60", volume: 0.16 }
  };
}

// Feste IDs: Öffnen Notion und Windows-App gleichzeitig zum ersten Mal,
// entstehen dadurch keine doppelten Standard-Uhren.
export function defaultClocks() {
  return [
    createStopwatch({ id: "default-stopwatch", label: "Stoppuhr 1", order: 1, now: 0 }),
    createTimer({ id: "default-timer", label: "Timer 1", order: 2, now: 0 })
  ];
}

/* ---------- Normalisieren (alles, was von aussen kommt) ---------- */

export function normalizeClock(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind === "timer" ? "timer" : raw.kind === "stopwatch" ? "stopwatch" : null;
  const id = String(raw.id ?? "").replace(/[.#$/[\]]/g, "").slice(0, 64);
  if (!kind || !id) return null;

  const clock = {
    id,
    kind,
    label: text(raw.label, kind === "timer" ? "Timer" : "Stoppuhr"),
    order: finite(raw.order, 0),
    updatedAt: finite(raw.updatedAt, 0),
    rev: String(raw.rev ?? ""),
    by: String(raw.by ?? "").slice(0, 20),
    deleted: raw.deleted === true,
    groupPaused: raw.groupPaused === true
  };

  if (kind === "stopwatch") {
    const sound = raw.sound && typeof raw.sound === "object" ? raw.sound : {};
    clock.running = raw.running === true;
    clock.startedAt = finite(raw.startedAt, 0);
    clock.elapsedMs = Math.max(0, finite(raw.elapsedMs, 0));
    if (clock.running && !clock.startedAt) clock.running = false;
    clock.sound = {
      enabled: sound.enabled !== false,
      type: AMBIENT[sound.type] ? sound.type : "meditation",
      volume: clamp(sound.volume ?? 0.11, 0, 0.38)
    };
  } else {
    const alarm = raw.alarm && typeof raw.alarm === "object" ? raw.alarm : {};
    clock.durationMs = Math.max(0, Math.min(finite(raw.durationMs, 25 * MINUTE), 100 * HOUR));
    clock.running = raw.running === true;
    clock.endsAt = finite(raw.endsAt, 0);
    clock.remainingMs = finite(raw.remainingMs, clock.durationMs);
    if (clock.running && !clock.endsAt) clock.running = false;
    clock.expiryId = String(raw.expiryId ?? "").slice(0, 40);
    clock.alarmStoppedId = String(raw.alarmStoppedId ?? "").slice(0, 40);
    clock.alarm = {
      enabled: alarm.enabled !== false,
      type: ALARMS[alarm.type] ? alarm.type : "egg",
      duration: ALARM_DURATIONS[String(alarm.duration)] ? String(alarm.duration) : "60",
      volume: clamp(alarm.volume ?? 0.16, 0, 0.4)
    };
  }
  return clock;
}

// Für Firebase: keine undefined-Werte, keine lokalen Hilfsfelder.
export function toRemote(clock) {
  const copy = JSON.parse(JSON.stringify(clock));
  delete copy.provisional;
  return copy;
}

/* ---------- Werte & Status ---------- */

export function stopwatchMs(clock, now) {
  return Math.max(0, clock.elapsedMs + (clock.running ? now - clock.startedAt : 0));
}

export function timerMs(clock, now) {
  return clock.running ? clock.endsAt - now : clock.remainingMs;
}

export function isExpired(clock, now) {
  return clock.kind === "timer" && !clock.deleted && clock.running && Boolean(clock.expiryId) && clock.endsAt <= now;
}

export function alarmWindowMs(clock) {
  return clock.alarm.duration === "manual" ? LATE_LIMIT : Number(clock.alarm.duration) * 1000;
}

// Gilt geräteübergreifend: Der Alarm ist aktiv, solange der Timer abgelaufen ist,
// niemand ihn gestoppt hat und die eingestellte Alarmdauer noch nicht vorbei ist.
export function alarmActive(clock, now) {
  return isExpired(clock, now) &&
    clock.alarm.enabled &&
    clock.alarmStoppedId !== clock.expiryId &&
    now - clock.endsAt < alarmWindowMs(clock);
}

export function stopwatchStatus(clock, now) {
  if (clock.running) return "Läuft";
  if (clock.groupPaused) return "Gemeinsam pausiert";
  return stopwatchMs(clock, now) > 0 ? "Pausiert" : "Bereit";
}

export function timerStatus(clock, now) {
  const value = timerMs(clock, now);
  if (clock.running) return value <= 0 ? "Überzeit" : "Läuft";
  if (clock.groupPaused) return "Gemeinsam pausiert";
  if (value < 0) return "Überzeit pausiert";
  if (clock.durationMs <= 0 && value <= 0) return "Zeit einstellen";
  if (value === clock.durationMs) return "Bereit";
  return value > 0 ? "Pausiert" : "Fertig";
}

export function clockStatus(clock, now) {
  return clock.kind === "timer" ? timerStatus(clock, now) : stopwatchStatus(clock, now);
}

export function isActive(clock, now) {
  if (clock.deleted) return false;
  if (clock.running) return true;
  if (clock.kind === "stopwatch") return clock.elapsedMs > 0;
  return clock.remainingMs !== clock.durationMs;
}

/* ---------- Aktionen (verändern die übergebene Kopie) ---------- */

export function touch(clock, now, by = "") {
  clock.updatedAt = Math.max(Math.round(now), (clock.updatedAt || 0) + 1);
  clock.rev = uid();
  clock.by = by;
  delete clock.provisional;
  return clock;
}

export function start(clock, now) {
  if (clock.running || clock.deleted) return false;
  if (clock.kind === "stopwatch") {
    clock.startedAt = now;
    clock.running = true;
    return true;
  }
  if (clock.remainingMs > 0) {
    clock.endsAt = now + clock.remainingMs;
    clock.running = true;
    clock.expiryId = uid();
    clock.alarmStoppedId = "";
    return true;
  }
  if (clock.durationMs <= 0 && clock.remainingMs === 0) return false;
  // Überzeit fortsetzen: Der Alarm dieses Ablaufs bleibt gestoppt.
  clock.endsAt = now + clock.remainingMs;
  clock.running = true;
  if (!clock.expiryId) clock.expiryId = uid();
  clock.alarmStoppedId = clock.expiryId;
  return true;
}

export function pause(clock, now) {
  if (!clock.running) return false;
  if (clock.kind === "stopwatch") {
    clock.elapsedMs = stopwatchMs(clock, now);
    clock.startedAt = 0;
    clock.running = false;
    return true;
  }
  clock.remainingMs = clock.endsAt - now;
  clock.endsAt = 0;
  clock.running = false;
  if (clock.remainingMs <= 0 && clock.expiryId) clock.alarmStoppedId = clock.expiryId;
  return true;
}

export function toggle(clock, now) {
  clock.groupPaused = false;
  return clock.running ? pause(clock, now) : start(clock, now);
}

export function reset(clock) {
  clock.running = false;
  clock.groupPaused = false;
  if (clock.kind === "stopwatch") {
    clock.startedAt = 0;
    clock.elapsedMs = 0;
  } else {
    clock.endsAt = 0;
    clock.remainingMs = clock.durationMs;
    clock.expiryId = "";
    clock.alarmStoppedId = "";
  }
  return true;
}

export function adjust(clock, deltaMs, now) {
  if (clock.kind !== "timer") return false;
  const before = timerMs(clock, now);
  const after = before + deltaMs;
  clock.durationMs = clamp(clock.durationMs + deltaMs, 0, 100 * HOUR);
  clock.groupPaused = false;

  if (clock.running) {
    clock.endsAt = now + after;
    if (before <= 0 && after > 0) {
      clock.expiryId = uid();
      clock.alarmStoppedId = "";
    }
  } else {
    clock.remainingMs = before < 0 ? after : Math.max(0, after);
    if (clock.remainingMs > 0) {
      clock.expiryId = "";
      clock.alarmStoppedId = "";
    }
  }
  return true;
}

export function setDuration(clock, durationMs) {
  if (clock.kind !== "timer" || clock.running) return false;
  clock.durationMs = clamp(Math.round(durationMs / 1000) * 1000, 0, 100 * HOUR);
  clock.remainingMs = clock.durationMs;
  clock.endsAt = 0;
  clock.expiryId = "";
  clock.alarmStoppedId = "";
  clock.groupPaused = false;
  return true;
}

export function stopAlarm(clock) {
  if (clock.kind !== "timer" || !clock.expiryId || clock.alarmStoppedId === clock.expiryId) return false;
  clock.alarmStoppedId = clock.expiryId;
  return true;
}

/* ---------- Zusammenführen ---------- */

// true, wenn a gegenüber b gewinnt (neuere Änderung, bei Gleichstand entscheidet rev).
export function wins(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return String(a.rev) > String(b.rev);
}

const sameVersion = (a, b) => Boolean(a && b && a.updatedAt === b.updatedAt && a.rev === b.rev);

// Führt lokale und entfernte Uhren pro Uhr zusammen.
// push: lokale Uhren, die neuer sind als die entfernte Kopie (oder dort fehlen).
export function mergeClocks(local, remote) {
  const merged = {};
  const push = [];
  let changed = false;
  const ids = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const id of ids) {
    const mine = local[id];
    const theirs = remote[id];
    if (theirs && (!mine || wins(theirs, mine) || sameVersion(theirs, mine))) {
      merged[id] = theirs;
      if (!sameVersion(theirs, mine)) changed = true;
    } else if (mine) {
      merged[id] = mine;
      push.push(id);
    }
  }
  return { merged, push, changed };
}

export function expiredTombstones(clocks, now) {
  return Object.values(clocks)
    .filter(clock => clock.deleted && now - clock.updatedAt > TOMBSTONE_TTL)
    .map(clock => clock.id);
}

/* ---------- Gruppe ---------- */

export function visibleClocks(clocks, kind) {
  return Object.values(clocks)
    .filter(clock => !clock.deleted && (!kind || clock.kind === kind))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function nextLabel(clocks, kind) {
  const prefix = kind === "timer" ? "Timer" : "Stoppuhr";
  const used = new Set(visibleClocks(clocks, kind).map(clock => clock.label));
  let number = 1;
  while (used.has(`${prefix} ${number}`)) number += 1;
  return `${prefix} ${number}`;
}

export function masterMode(clocks) {
  const list = visibleClocks(clocks);
  if (list.some(clock => clock.groupPaused)) return "resume";
  if (list.some(clock => clock.running)) return "pause";
  return "start";
}

/* ---------- Formatierung ---------- */

const pad = value => String(value).padStart(2, "0");

export function formatStopwatch(ms) {
  const centisTotal = Math.floor(Math.max(0, ms) / 10);
  const secondsTotal = Math.floor(centisTotal / 100);
  return {
    main: `${pad(Math.floor(secondsTotal / 3600))}:${pad(Math.floor(secondsTotal / 60) % 60)}:${pad(secondsTotal % 60)}`,
    fraction: pad(centisTotal % 100)
  };
}

// Positive Restzeit wird aufgerundet (00:00:01 bis zum Ablauf),
// Überzeit abgerundet (−00:00:01 erst nach einer vollen Sekunde).
function timerSeconds(ms) {
  return ms >= 0 ? Math.ceil(ms / 1000) : -Math.floor(-ms / 1000);
}

export function formatTimer(ms) {
  const total = timerSeconds(ms);
  const abs = Math.abs(total);
  const body = `${pad(Math.floor(abs / 3600))}:${pad(Math.floor(abs / 60) % 60)}:${pad(abs % 60)}`;
  return total < 0 ? `−${body}` : body;
}

export function formatCompact(ms, kind) {
  const total = kind === "timer" ? timerSeconds(ms) : Math.floor(Math.max(0, ms) / 1000);
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 3600);
  const body = hours > 0
    ? `${hours}:${pad(Math.floor(abs / 60) % 60)}:${pad(abs % 60)}`
    : `${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return total < 0 ? `−${body}` : body;
}

export function formatDuration(ms) {
  if (ms < MINUTE) return `${Math.round(Math.max(0, ms) / 1000)} Sek.`;
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

/* ---------- Übernahme aus v8/v9 ---------- */

export function migrateV9(raw, now) {
  if (!raw || typeof raw !== "object" || Number(raw.schema) !== 9) return null;
  const updatedAt = finite(raw.meta?.updatedAt, now) || now;
  const pausedSw = new Set(raw.groupPause?.active ? raw.groupPause.stopwatchIds || [] : []);
  const pausedTimers = new Set(raw.groupPause?.active ? raw.groupPause.timerIds || [] : []);
  const result = [];
  const alreadyAlarmed = [];

  (Array.isArray(raw.stopwatches) ? raw.stopwatches : []).forEach((old, index) => {
    const clock = normalizeClock({
      id: old?.id,
      kind: "stopwatch",
      label: old?.label || `Stoppuhr ${index + 1}`,
      order: index + 1,
      updatedAt,
      rev: uid(),
      running: old?.running === true,
      startedAt: old?.startedAt,
      elapsedMs: old?.elapsedMs,
      groupPaused: pausedSw.has(old?.id),
      sound: { ...(old?.sound || {}), type: old?.sound?.type === "campfire" ? "ocean" : old?.sound?.type }
    });
    if (clock) result.push(clock);
  });

  (Array.isArray(raw.timers) ? raw.timers : []).forEach((old, index) => {
    const valueAtAnchor = finite(old?.valueAtAnchor, finite(old?.configuredMs, 25 * MINUTE));
    const running = old?.running === true && finite(old?.anchorAt, 0) > 0;
    const endsAt = running ? finite(old.anchorAt) + valueAtAnchor : 0;
    const expiryId = String(old?.expiryToken || "");
    const alarmed = expiryId && old?.alarmTriggeredToken === expiryId;
    const clock = normalizeClock({
      id: old?.id,
      kind: "timer",
      label: old?.label || `Timer ${index + 1}`,
      order: 100 + index + 1,
      updatedAt,
      rev: uid(),
      durationMs: old?.configuredMs,
      running,
      endsAt,
      remainingMs: running ? 0 : valueAtAnchor,
      expiryId: running ? expiryId : "",
      alarmStoppedId: running && alarmed ? expiryId : "",
      groupPaused: pausedTimers.has(old?.id),
      alarm: old?.alarm
    });
    if (clock) {
      result.push(clock);
      if (alarmed) alreadyAlarmed.push(expiryId);
    }
  });

  return result.length ? { clocks: result, alreadyAlarmed } : null;
}

// v8 hat nur die Klang-Einstellungen gespeichert (Schlüssel "…SettingsV7").
export function applyV8Settings(clocks, legacy) {
  if (!legacy || typeof legacy !== "object") return clocks;
  const sw = clocks.find(clock => clock.kind === "stopwatch");
  const timer = clocks.find(clock => clock.kind === "timer");
  if (sw) {
    if (typeof legacy.ambientEnabled === "boolean") sw.sound.enabled = legacy.ambientEnabled;
    const type = legacy.ambientType === "campfire" ? "ocean" : legacy.ambientType;
    if (AMBIENT[type]) sw.sound.type = type;
    if (Number.isFinite(Number(legacy.ambientVolume))) sw.sound.volume = clamp(legacy.ambientVolume, 0, 0.38);
  }
  if (timer) {
    if (typeof legacy.alarmEnabled === "boolean") timer.alarm.enabled = legacy.alarmEnabled;
    if (ALARMS[legacy.alarmType]) timer.alarm.type = legacy.alarmType;
    if (ALARM_DURATIONS[String(legacy.alarmDuration)]) timer.alarm.duration = String(legacy.alarmDuration);
    if (Number.isFinite(Number(legacy.alarmVolume))) timer.alarm.volume = clamp(legacy.alarmVolume, 0, 0.4);
  }
  return clocks;
}
