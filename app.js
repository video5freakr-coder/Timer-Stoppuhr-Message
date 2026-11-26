// Gemeinsame Steuerung für Notion-Widget und Windows-App.
// Jede Änderung wird sofort lokal gespeichert (übersteht Neuladen und Abstürze)
// und anschliessend an Firebase geschickt. Beim Verbinden gewinnt pro Uhr die neuere Änderung.

import * as C from "./core.js?v=10.0";

const KEY_PREFIX = "lernTimer.v10";
const LEGACY = {
  widgetState: "studyTimerWidgetStateV9",
  companionState: "studyTimerCompanionStateV9",
  v8Settings: "studyTimerWidgetSettingsV7",
  notified: "studyTimerNotifiedTokensV9"
};

const DEVICE_DEFAULTS = {
  notion: { ambientHere: true, alarmHere: "auto", notify: false },
  desktop: { ambientHere: false, alarmHere: "on", notify: true }
};

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function storageKey(name) {
  return `${KEY_PREFIX}.${name}`;
}

export function createController({ role, room, databaseURL, startSync }) {
  const clocksKey = storageKey(`clocks.${room}`);
  const migratedKey = storageKey(`migrated.${room}`);
  const offsetKey = storageKey("serverOffset");
  const deviceKey = storageKey(`device.${role}`);
  const uiKey = storageKey(`ui.${role}`);
  const notifiedKey = storageKey(`notified.${role}`);
  const sessionId = C.uid();

  const listeners = new Set();
  const pendingWrites = new Map();
  let clocks = {};
  let offset = Number(localStorage.getItem(offsetKey)) || 0;
  let sync = null;
  let firstSnapshot = true;
  let migratedNow = false;
  let presence = {};
  let lastSeen = {};
  let status = databaseURL ? "connecting" : "local";
  let statusDetail = "";

  const device = { ...DEVICE_DEFAULTS[role], ...readJson(deviceKey, {}) };
  const ui = { open: {}, panels: {}, ...readJson(uiKey, {}) };
  const notified = new Set(readJson(notifiedKey, []));

  const now = () => Date.now() + offset;

  /* ---------- Laden ---------- */

  function load() {
    const stored = readJson(clocksKey);
    if (stored && typeof stored === "object" && stored.schema === C.SCHEMA) {
      for (const raw of Object.values(stored.clocks || {})) {
        const clock = C.normalizeClock(raw);
        if (clock) {
          if (raw.provisional) clock.provisional = true;
          clocks[clock.id] = clock;
        }
      }
      if (Object.keys(clocks).length) return "local";
    }

    if (localStorage.getItem(migratedKey) !== "1") {
      const legacyKey = role === "desktop" ? LEGACY.companionState : LEGACY.widgetState;
      const migrated = C.migrateV9(readJson(legacyKey), Date.now());
      if (migrated) {
        migrated.clocks.forEach(clock => { clocks[clock.id] = clock; });
        migrated.alreadyAlarmed.forEach(id => notified.add(id));
        readJson(LEGACY.notified, []).forEach(id => notified.add(String(id)));
        localStorage.setItem(migratedKey, "1");
        migratedNow = true;
        saveNotified();
        save();
        return "migrated";
      }
    }

    const defaults = C.applyV8Settings(C.defaultClocks(), readJson(LEGACY.v8Settings));
    defaults.forEach(clock => {
      clock.provisional = true;
      clocks[clock.id] = clock;
    });
    save();
    return "defaults";
  }

  function save() {
    const ok = writeJson(clocksKey, { schema: C.SCHEMA, savedAt: Date.now(), clocks });
    if (!ok) statusDetail = "Lokaler Speicher voll oder gesperrt";
    return ok;
  }

  function saveNotified() {
    writeJson(notifiedKey, [...notified].slice(-300));
  }

  /* ---------- Ereignisse ---------- */

  function emit(reason) {
    listeners.forEach(listener => {
      try {
        listener(reason);
      } catch (error) {
        console.error(error);
      }
    });
  }

  function push(clock, delay = 0) {
    if (!sync) return;
    clearTimeout(pendingWrites.get(clock.id));
    if (delay > 0) {
      pendingWrites.set(clock.id, setTimeout(() => {
        pendingWrites.delete(clock.id);
        if (clocks[clock.id]) sync.write(clocks[clock.id]);
      }, delay));
    } else {
      pendingWrites.delete(clock.id);
      sync.write(clock);
    }
  }

  // Wendet eine Änderung auf eine Kopie an, stempelt sie und verteilt sie.
  function change(id, mutate, { delay = 0 } = {}) {
    const current = clocks[id];
    if (!current) return false;
    const draft = JSON.parse(JSON.stringify(current));
    const t = now();
    if (mutate(draft, t) === false) return false;
    C.touch(draft, t, role);
    clocks[id] = draft;
    save();
    push(draft, delay);
    emit("local");
    return true;
  }

  function changeMany(ids, mutate) {
    const t = now();
    const changed = [];
    for (const id of ids) {
      const current = clocks[id];
      if (!current) continue;
      const draft = JSON.parse(JSON.stringify(current));
      if (mutate(draft, t) === false) continue;
      C.touch(draft, t, role);
      clocks[id] = draft;
      changed.push(draft);
    }
    if (!changed.length) return false;
    save();
    changed.forEach(clock => push(clock));
    emit("local");
    return true;
  }

  /* ---------- Firebase ---------- */

  function handleRemote(remoteRaw) {
    const remote = {};
    for (const [key, raw] of Object.entries(remoteRaw || {})) {
      const clock = C.normalizeClock({ ...raw, id: raw?.id || key });
      if (clock && clock.id === key) remote[key] = clock;
    }

    if (firstSnapshot) {
      firstSnapshot = false;
      const remoteHasClocks = Object.keys(remote).length > 0;
      for (const clock of Object.values(clocks)) {
        if (!clock.provisional) continue;
        if (remoteHasClocks) {
          delete clocks[clock.id];
        } else {
          C.touch(clock, now(), role);
        }
      }
      pruneTombstones(remote);
    }

    const { merged, push: toPush, changed } = C.mergeClocks(clocks, remote);
    clocks = merged;

    // Hat die andere Seite schon Standard-Uhren angelegt, während hier alte v9-Uhren übernommen
    // wurden, werden die unbenutzten Standard-Uhren entfernt (keine doppelten „Stoppuhr 1“).
    if (migratedNow) {
      migratedNow = false;
      for (const id of ["default-stopwatch", "default-timer"]) {
        const clock = clocks[id];
        if (clock && !clock.deleted && !C.isActive(clock, now()) && C.visibleClocks(clocks, clock.kind).length > 1) {
          clock.deleted = true;
          C.touch(clock, now(), role);
          if (!toPush.includes(id)) toPush.push(id);
        }
      }
    }
    if (changed || toPush.length) save();
    toPush.forEach(id => {
      if (!pendingWrites.has(id)) push(clocks[id]);
    });
    if (changed || toPush.length) emit("remote");
  }

  function pruneTombstones(remote) {
    const t = now();
    for (const id of C.expiredTombstones({ ...remote, ...clocks }, t)) {
      delete clocks[id];
      delete remote[id];
      sync?.remove(id);
    }
  }

  async function connect() {
    if (!databaseURL || !startSync) return;
    status = "connecting";
    emit("status");
    try {
      sync = await startSync({
        databaseURL,
        room,
        role,
        sessionId,
        onClocks: handleRemote,
        onOffset(value) {
          if (!Number.isFinite(value)) return;
          offset = value;
          localStorage.setItem(offsetKey, String(Math.round(value)));
        },
        onPresence(value) {
          presence = value || {};
          emit("presence");
        },
        onLastSeen(value) {
          lastSeen = value || {};
          emit("presence");
        },
        onStatus(value, detail) {
          status = value;
          statusDetail = detail ? String(detail.message || detail) : "";
          emit("status");
        }
      });
    } catch (error) {
      status = "unavailable";
      statusDetail = String(error?.message || error);
      emit("status");
      // Firebase-Bibliothek nicht ladbar (offline?) – später erneut versuchen.
      setTimeout(connect, 30000);
    }
  }

  /* ---------- Öffentliche Aktionen ---------- */

  const api = {
    role,
    room,
    sessionId,
    now,
    device,
    ui,
    notified,
    get clocks() { return clocks; },
    get status() { return status; },
    get statusDetail() { return statusDetail; },
    get presence() { return presence; },
    get lastSeen() { return lastSeen; },
    get syncEnabled() { return Boolean(databaseURL); },

    isOnline(otherRole) {
      const entries = presence?.[otherRole];
      return Boolean(entries && typeof entries === "object" && Object.keys(entries).length);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    toggle(id) { return change(id, (clock, t) => C.toggle(clock, t)); },
    reset(id) { return change(id, clock => C.reset(clock)); },
    adjust(id, minutes) { return change(id, (clock, t) => C.adjust(clock, Number(minutes) * C.MINUTE, t)); },
    setDuration(id, ms) { return change(id, clock => C.setDuration(clock, ms)); },
    stopAlarm(id) { return change(id, clock => C.stopAlarm(clock)); },

    rename(id, label) {
      const clean = String(label || "").replace(/\s+/g, " ").trim().slice(0, 40);
      return change(id, clock => {
        if (!clean || clean === clock.label) return false;
        clock.label = clean;
      });
    },

    setSound(id, patch, options) {
      return change(id, clock => {
        if (clock.kind !== "stopwatch") return false;
        clock.sound = { ...clock.sound, ...patch };
        clock.sound.volume = C.clamp(clock.sound.volume, 0, 0.38);
      }, options);
    },

    setAlarm(id, patch, options) {
      return change(id, clock => {
        if (clock.kind !== "timer") return false;
        clock.alarm = { ...clock.alarm, ...patch };
        clock.alarm.volume = C.clamp(clock.alarm.volume, 0, 0.4);
      }, options);
    },

    add(kind) {
      const t = now();
      const clock = kind === "timer"
        ? C.createTimer({ label: C.nextLabel(clocks, "timer"), order: t, now: t })
        : C.createStopwatch({ label: C.nextLabel(clocks, "stopwatch"), order: t, now: t, soundEnabled: false });
      C.touch(clock, t, role);
      clocks[clock.id] = clock;
      ui.open[clock.id] = true;
      api.saveUi();
      save();
      push(clock);
      emit("local");
      return clock.id;
    },

    canDelete(id) {
      const clock = clocks[id];
      return Boolean(clock) && C.visibleClocks(clocks, clock.kind).length > 1;
    },

    remove(id) {
      if (!api.canDelete(id)) return false;
      return change(id, clock => { clock.deleted = true; });
    },

    // Für "Rückgängig": stellt gespeicherte Kopien wieder her (laufende Uhren laufen nahtlos weiter).
    snapshot(ids) {
      return ids.map(id => clocks[id]).filter(Boolean).map(clock => JSON.parse(JSON.stringify(clock)));
    },

    restore(snapshot) {
      const byId = Object.fromEntries(snapshot.map(clock => [clock.id, clock]));
      return changeMany(Object.keys(byId), draft => {
        const saved = byId[draft.id];
        Object.keys(draft).forEach(key => delete draft[key]);
        Object.assign(draft, JSON.parse(JSON.stringify(saved)));
      });
    },

    master() {
      const mode = C.masterMode(clocks);
      const visible = C.visibleClocks(clocks);
      if (mode === "resume") {
        return changeMany(visible.filter(clock => clock.groupPaused).map(clock => clock.id), (clock, t) => {
          clock.groupPaused = false;
          C.start(clock, t);
        });
      }
      if (mode === "pause") {
        return changeMany(visible.filter(clock => clock.running).map(clock => clock.id), (clock, t) => {
          C.pause(clock, t);
          clock.groupPaused = true;
        });
      }
      return changeMany(visible.map(clock => clock.id), (clock, t) => {
        clock.groupPaused = false;
        if (clock.running) return false;
        return C.start(clock, t);
      });
    },

    resetAll() {
      return changeMany(C.visibleClocks(clocks).map(clock => clock.id), clock => C.reset(clock));
    },

    saveDevice() { writeJson(deviceKey, device); emit("device"); },
    saveUi() { writeJson(uiKey, ui); },
    markNotified(expiryId) { notified.add(expiryId); saveNotified(); },
    flush() { save(); },

    start() {
      const source = load();
      emit("load");
      connect();
      return source;
    }
  };

  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", save);
  window.addEventListener("storage", event => {
    // Zweites Fenster desselben Geräts (z.B. zwei Notion-Tabs): lokalen Stand übernehmen.
    if (event.key !== clocksKey || !event.newValue) return;
    try {
      const stored = JSON.parse(event.newValue);
      const incoming = {};
      for (const raw of Object.values(stored.clocks || {})) {
        const clock = C.normalizeClock(raw);
        if (clock) incoming[clock.id] = clock;
      }
      const { merged, changed } = C.mergeClocks(clocks, incoming);
      clocks = merged;
      if (changed) emit("remote");
    } catch (_) {
    }
  });

  return api;
}

/* ---------- Code (Raum) bestimmen ---------- */

export function resolveRoom(role) {
  const params = new URLSearchParams(location.search);
  const fromUrl = C.cleanCode(params.get("room") || params.get("code"));
  const roomKey = storageKey(`room.${role}`);
  const stored = C.cleanCode(localStorage.getItem(roomKey));
  const legacy = C.cleanCode(localStorage.getItem(role === "desktop" ? "studyTimerCompanionCode" : "studyTimerSyncCode"));

  let room = "";
  let source = "";
  if (C.isValidCode(fromUrl)) { room = fromUrl; source = "url"; }
  else if (C.isValidCode(stored)) { room = stored; source = "stored"; }
  else if (C.isValidCode(legacy)) { room = legacy; source = "legacy"; }
  else if (role === "notion") { room = C.randomCode(); source = "new"; }

  if (room) localStorage.setItem(roomKey, room);
  return { room, source };
}

export function setRoom(role, room) {
  localStorage.setItem(storageKey(`room.${role}`), room);
}
