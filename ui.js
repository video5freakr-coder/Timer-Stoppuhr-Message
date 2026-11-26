// Gemeinsame Oberfläche der Uhren (Notion-Widget und Windows-App).
// Karten werden einmal aufgebaut und danach nur gezielt aktualisiert –
// so verliert ein Eingabefeld nie den Fokus, wenn eine Änderung von der Gegenseite eintrifft.

import * as C from "./core.js?v=10.0";

const AMBIENT_OPTIONS = Object.entries(C.AMBIENT)
  .map(([value, sound]) => `<option value="${value}">${sound.option}</option>`).join("");
const ALARM_OPTIONS = Object.entries(C.ALARMS)
  .map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
const DURATION_OPTIONS = Object.entries(C.ALARM_DURATIONS)
  .map(([value, item]) => `<option value="${value}">${item.label}</option>`).join("");

export const ICONS = {
  play: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 2.2v11.6L13.4 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="2.2" width="3.4" height="11.6" rx="1" fill="currentColor"/><rect x="9.6" y="2.2" width="3.4" height="11.6" rx="1" fill="currentColor"/></svg>'
};

const MASTER_ROW = `
  <div class="master-row">
    <button class="soft master-toggle" type="button" data-mode="start">${ICONS.play}<span>Alle starten</span></button>
    <button class="soft master-reset" type="button">↺ Alle zurücksetzen</button>
  </div>`;

const STRUCTURE = `
  ${MASTER_ROW}
  <section class="group">
    <div class="group-head">
      <h2>Stoppuhren</h2>
      <button class="icon add" type="button" data-add="stopwatch" aria-label="Stoppuhr hinzufügen" title="Stoppuhr hinzufügen">＋</button>
    </div>
    <div class="list" data-list="stopwatch"></div>
  </section>
  <section class="group">
    <div class="group-head">
      <h2>Timer</h2>
      <button class="icon add" type="button" data-add="timer" aria-label="Timer hinzufügen" title="Timer hinzufügen">＋</button>
    </div>
    <div class="list" data-list="timer"></div>
  </section>
  ${MASTER_ROW}
  <p class="audio-hint" hidden>Klicke einmal hier hinein, damit der Browser Töne abspielen darf.</p>
  <div class="toast" hidden><span class="toast-text"></span><button type="button" class="toast-undo">Rückgängig</button></div>`;

const SUMMARY = `
  <summary>
    <span class="chev" aria-hidden="true"></span>
    <span class="name"></span>
    <span class="sum-time"></span>
    <span class="status"></span>
    <button class="icon del" type="button" data-action="delete" aria-label="Löschen" title="Löschen">×</button>
  </summary>`;

const STOPWATCH_BODY = `
  ${SUMMARY}
  <div class="content">
    <div class="display"><span class="main">00:00:00</span><span class="fraction">.00</span></div>
    <div class="controls">
      <button class="primary" type="button" data-action="toggle">Start</button>
      <button class="soft" type="button" data-action="reset">Zurücksetzen</button>
    </div>
    <details class="settings" data-panel="settings">
      <summary><span>Einstellungen</span><span class="summary-value"></span></summary>
      <div class="settings-content">
        <label class="row"><span>Name</span><input type="text" data-field="label" maxlength="40" autocomplete="off"></label>
        <label class="toggle"><input type="checkbox" data-field="sound-enabled"> Klang während der Laufzeit</label>
        <label class="row"><span>Klang</span><select data-field="sound-type">${AMBIENT_OPTIONS}</select></label>
        <label class="row"><span>Lautstärke</span><input type="range" data-field="sound-volume" min="0" max="0.38" step="0.005"></label>
        <p class="note" data-role="sound-note"></p>
      </div>
    </details>
  </div>`;

const adjustButtons = sign => [1, 5, 10, 30]
  .map(minutes => `<button type="button" data-action="adjust" data-minutes="${sign * minutes}">${sign > 0 ? "+" : "−"}${minutes} min</button>`)
  .join("");

const TIMER_BODY = `
  ${SUMMARY}
  <div class="content">
    <div class="inputs">
      <label class="field">Stunden<input type="number" data-field="hours" min="0" max="99" inputmode="numeric"></label>
      <label class="field">Minuten<input type="number" data-field="minutes" min="0" max="59" inputmode="numeric"></label>
      <label class="field">Sekunden<input type="number" data-field="seconds" min="0" max="59" inputmode="numeric"></label>
    </div>
    <div class="display timer-display">00:25:00</div>
    <div class="progress" aria-hidden="true"><span></span></div>
    <div class="adjust-row">${adjustButtons(1)}</div>
    <div class="adjust-row negative">${adjustButtons(-1)}</div>
    <div class="controls">
      <button class="primary" type="button" data-action="toggle">Start</button>
      <button class="soft" type="button" data-action="reset">Zurücksetzen</button>
      <button class="alarm-stop" type="button" data-action="stop-alarm" hidden>Alarm stoppen</button>
    </div>
    <details class="settings" data-panel="settings">
      <summary><span>Einstellungen</span><span class="summary-value"></span></summary>
      <div class="settings-content">
        <label class="row"><span>Name</span><input type="text" data-field="label" maxlength="40" autocomplete="off"></label>
        <label class="toggle"><input type="checkbox" data-field="alarm-enabled"> Alarmton</label>
        <div class="row">
          <span>Alarmklang</span>
          <span class="with-button">
            <select data-field="alarm-type" aria-label="Alarmklang">${ALARM_OPTIONS}</select>
            <button class="soft small" type="button" data-action="preview" title="Probe hören">▶</button>
          </span>
        </div>
        <label class="row"><span>Alarmdauer</span><select data-field="alarm-duration">${DURATION_OPTIONS}</select></label>
        <label class="row"><span>Lautstärke</span><input type="range" data-field="alarm-volume" min="0" max="0.40" step="0.01"></label>
      </div>
    </details>
  </div>`;

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setValue(element, value) {
  if (!element || element === document.activeElement) return;
  if (element.type === "checkbox") {
    if (element.checked !== value) element.checked = value;
  } else if (String(element.value) !== String(value)) {
    element.value = value;
  }
}

export function mountClocks(root, controller, sounds) {
  root.innerHTML = STRUCTURE;
  const lists = {
    stopwatch: root.querySelector('[data-list="stopwatch"]'),
    timer: root.querySelector('[data-list="timer"]')
  };
  const cards = new Map();
  const toast = root.querySelector(".toast");
  const audioHint = root.querySelector(".audio-hint");
  let toastTimer = null;
  let toastUndo = null;
  let wantsSound = false;

  function build(clock) {
    const card = document.createElement("details");
    card.className = `card ${clock.kind}`;
    card.dataset.id = clock.id;
    card.dataset.kind = clock.kind;
    card.innerHTML = clock.kind === "timer" ? TIMER_BODY : STOPWATCH_BODY;
    card.open = controller.ui.open[clock.id] !== false;
    const panel = card.querySelector('[data-panel="settings"]');
    panel.open = controller.ui.panels[clock.id] === true;
    card._refs = {
      name: card.querySelector(".name"),
      sumTime: card.querySelector(".sum-time"),
      status: card.querySelector(".status"),
      del: card.querySelector(".del"),
      toggle: card.querySelector('[data-action="toggle"]'),
      main: card.querySelector(".main"),
      fraction: card.querySelector(".fraction"),
      timerDisplay: card.querySelector(".timer-display"),
      progress: card.querySelector(".progress span"),
      alarmStop: card.querySelector(".alarm-stop"),
      summaryValue: card.querySelector(".summary-value"),
      fields: Object.fromEntries([...card.querySelectorAll("[data-field]")].map(input => [input.dataset.field, input])),
      soundNote: card.querySelector('[data-role="sound-note"]')
    };
    return card;
  }

  function updateStatic(card, clock) {
    const refs = card._refs;
    const fields = refs.fields;
    setText(refs.name, clock.label);
    setValue(fields.label, clock.label);
    refs.del.disabled = !controller.canDelete(clock.id);

    if (clock.kind === "stopwatch") {
      setValue(fields["sound-enabled"], clock.sound.enabled);
      setValue(fields["sound-type"], clock.sound.type);
      setValue(fields["sound-volume"], clock.sound.volume);
      setText(refs.soundNote, C.AMBIENT[clock.sound.type].note);
      setText(refs.summaryValue, clock.sound.enabled ? C.AMBIENT[clock.sound.type].label : "Klang aus");
      card.classList.toggle("muted", !clock.sound.enabled);
    } else {
      const seconds = Math.floor(clock.durationMs / 1000);
      setValue(fields.hours, Math.floor(seconds / 3600));
      setValue(fields.minutes, Math.floor(seconds / 60) % 60);
      setValue(fields.seconds, seconds % 60);
      ["hours", "minutes", "seconds"].forEach(name => { fields[name].disabled = clock.running; });
      setValue(fields["alarm-enabled"], clock.alarm.enabled);
      setValue(fields["alarm-type"], clock.alarm.type);
      setValue(fields["alarm-duration"], clock.alarm.duration);
      setValue(fields["alarm-volume"], clock.alarm.volume);
      setText(refs.summaryValue, clock.alarm.enabled
        ? `${C.ALARMS[clock.alarm.type]} · ${C.ALARM_DURATIONS[clock.alarm.duration].short}`
        : "Alarm aus");
      card.classList.toggle("muted", !clock.alarm.enabled);
    }
  }

  function updateLive(card, clock, now) {
    const refs = card._refs;
    setText(refs.status, C.clockStatus(clock, now));
    card.classList.toggle("running", clock.running);

    if (clock.kind === "stopwatch") {
      const ms = C.stopwatchMs(clock, now);
      const formatted = C.formatStopwatch(ms);
      setText(refs.main, formatted.main);
      setText(refs.fraction, `.${formatted.fraction}`);
      setText(refs.sumTime, C.formatCompact(ms, "stopwatch"));
      setText(refs.toggle, clock.running ? "Pause" : ms > 0 ? "Weiter" : "Start");
    } else {
      const ms = C.timerMs(clock, now);
      const ringing = C.alarmActive(clock, now);
      setText(refs.timerDisplay, C.formatTimer(ms));
      setText(refs.sumTime, C.formatCompact(ms, "timer"));
      card.classList.toggle("overrun", ms < 0 || (clock.running && ms <= 0));
      card.classList.toggle("ringing", ringing);
      refs.alarmStop.hidden = !ringing;
      const fraction = clock.durationMs > 0 ? Math.min(1, Math.max(0, ms / clock.durationMs)) : 0;
      const width = ms <= 0 && clock.expiryId ? "100%" : `${(fraction * 100).toFixed(2)}%`;
      if (refs.progress.style.width !== width) refs.progress.style.width = width;
      const label = clock.running ? "Pause" : ms === clock.durationMs ? "Start" : "Weiter";
      setText(refs.toggle, label);
      refs.toggle.disabled = !clock.running && clock.durationMs <= 0 && ms === 0;
      ["hours", "minutes", "seconds"].forEach(name => { refs.fields[name].disabled = clock.running; });
    }
  }

  function syncStructure() {
    for (const kind of ["stopwatch", "timer"]) {
      const list = lists[kind];
      const visible = C.visibleClocks(controller.clocks, kind);
      const ids = new Set(visible.map(clock => clock.id));
      for (const [id, card] of cards) {
        if (card.dataset.kind === kind && !ids.has(id)) {
          card.remove();
          cards.delete(id);
        }
      }
      visible.forEach((clock, index) => {
        let card = cards.get(clock.id);
        if (!card) {
          card = build(clock);
          cards.set(clock.id, card);
        }
        if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
        updateStatic(card, clock);
      });
    }
    const mode = C.masterMode(controller.clocks);
    const label = { resume: "Alle fortsetzen", pause: "Alle pausieren", start: "Alle starten" }[mode];
    root.querySelectorAll(".master-toggle").forEach(button => {
      if (button.dataset.mode === mode) return;
      button.dataset.mode = mode;
      button.innerHTML = `${mode === "pause" ? ICONS.pause : ICONS.play}<span>${label}</span>`;
    });
    frame(true);
  }

  function frame(once = false) {
    const now = controller.now();
    for (const [id, card] of cards) {
      const clock = controller.clocks[id];
      if (clock) updateLive(card, clock, now);
    }
    audioHint.hidden = !(wantsSound && !sounds.ready);
    if (once !== true) requestAnimationFrame(frame);
  }

  function showToast(message, undo) {
    clearTimeout(toastTimer);
    toastUndo = undo;
    setText(toast.querySelector(".toast-text"), message);
    toast.querySelector(".toast-undo").hidden = !undo;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; toastUndo = null; }, 9000);
  }

  function readDuration(card) {
    const fields = card._refs.fields;
    const hours = C.clamp(fields.hours.value, 0, 99);
    const minutes = C.clamp(fields.minutes.value, 0, 59);
    const seconds = C.clamp(fields.seconds.value, 0, 59);
    return (Math.floor(hours) * 3600 + Math.floor(minutes) * 60 + Math.floor(seconds)) * 1000;
  }

  /* ---------- Bedienung ---------- */

  root.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target || !root.contains(target)) return;

    if (target.classList.contains("toast-undo")) {
      toastUndo?.();
      toast.hidden = true;
      toastUndo = null;
      return;
    }
    if (target.classList.contains("master-toggle")) {
      sounds.unlock();
      controller.master();
      return;
    }
    if (target.classList.contains("master-reset")) {
      const ids = C.visibleClocks(controller.clocks).filter(clock => C.isActive(clock, controller.now())).map(clock => clock.id);
      if (!ids.length) return;
      const saved = controller.snapshot(ids);
      controller.resetAll();
      showToast("Alle Uhren zurückgesetzt", () => controller.restore(saved));
      return;
    }
    if (target.dataset.add) {
      const id = controller.add(target.dataset.add);
      requestAnimationFrame(() => cards.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
      return;
    }

    const card = target.closest(".card");
    const clock = card && controller.clocks[card.dataset.id];
    if (!clock) return;
    const action = target.dataset.action;

    if (action === "delete") {
      event.preventDefault();
      event.stopPropagation();
      const saved = controller.snapshot([clock.id]);
      if (controller.remove(clock.id)) showToast(`„${clock.label}“ gelöscht`, () => controller.restore(saved));
    } else if (action === "toggle") {
      sounds.unlock();
      controller.toggle(clock.id);
    } else if (action === "reset") {
      const active = C.isActive(clock, controller.now());
      const saved = controller.snapshot([clock.id]);
      controller.reset(clock.id);
      if (active) showToast(`„${clock.label}“ zurückgesetzt`, () => controller.restore(saved));
    } else if (action === "adjust") {
      controller.adjust(clock.id, Number(target.dataset.minutes));
    } else if (action === "stop-alarm") {
      controller.stopAlarm(clock.id);
    } else if (action === "preview") {
      sounds.previewAlarm(clock.alarm.type, Math.max(clock.alarm.volume, 0.05));
    }
  });

  root.addEventListener("change", event => {
    const field = event.target.dataset?.field;
    const card = event.target.closest(".card");
    const clock = card && controller.clocks[card.dataset.id];
    if (!field || !clock) return;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;

    if (["hours", "minutes", "seconds"].includes(field)) controller.setDuration(clock.id, readDuration(card));
    else if (field === "label") controller.rename(clock.id, value) || setValue(event.target, clock.label);
    else if (field === "sound-enabled") controller.setSound(clock.id, { enabled: value });
    else if (field === "sound-type") controller.setSound(clock.id, { type: value });
    else if (field === "sound-volume") controller.setSound(clock.id, { volume: Number(value) });
    else if (field === "alarm-enabled") controller.setAlarm(clock.id, { enabled: value });
    else if (field === "alarm-type") controller.setAlarm(clock.id, { type: value });
    else if (field === "alarm-duration") controller.setAlarm(clock.id, { duration: value });
    else if (field === "alarm-volume") controller.setAlarm(clock.id, { volume: Number(value) });
  });

  root.addEventListener("input", event => {
    const field = event.target.dataset?.field;
    const card = event.target.closest(".card");
    const clock = card && controller.clocks[card.dataset.id];
    if (!clock) return;
    if (field === "sound-volume") controller.setSound(clock.id, { volume: Number(event.target.value) }, { delay: 400 });
    if (field === "alarm-volume") controller.setAlarm(clock.id, { volume: Number(event.target.value) }, { delay: 400 });
  });

  root.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.matches("input[type=number], input[type=text]")) event.target.blur();
  });

  // Auf- und Zuklappen pro Gerät merken (wird nicht synchronisiert).
  root.addEventListener("toggle", event => {
    const element = event.target;
    const card = element.closest?.(".card");
    if (!card) return;
    if (element === card) controller.ui.open[card.dataset.id] = card.open;
    else if (element.dataset.panel) controller.ui.panels[card.dataset.id] = element.open;
    controller.saveUi();
  }, true);

  root.addEventListener("pointerdown", () => sounds.unlock(), { passive: true });

  controller.subscribe(reason => {
    if (reason !== "presence" && reason !== "status" && reason !== "device") syncStructure();
  });

  syncStructure();
  requestAnimationFrame(frame);

  return {
    setWantsSound(value) { wantsSound = value; },
    showToast,
    refresh: syncStructure
  };
}
