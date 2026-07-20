"use strict";

const $ = id => document.getElementById(id);
const roundMin = ms => Math.round(ms / 60000);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const SENDER = uid();

let eventSource = null;
let remote = null;
let lastMessage = 0;
let lastNotified = localStorage.getItem("lastNotifiedToken") || "";
let registration = null;
let installPrompt = null;

function normalize(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
}

function topic() {
  const code = normalize($("codeInput").value);
  return code ? `study_timer_${code}` : "";
}

async function publish(kind, data = {}) {
  if (!topic()) return;
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
    setConnection("Sync offline", "error");
  }
}

function setConnection(text, cssClass = "") {
  $("connectionStatus").textContent = text;
  $("connectionStatus").className = `status ${cssClass}`;
}

function connect() {
  const code = normalize($("codeInput").value);
  if (!code) {
    setConnection("Code fehlt", "error");
    $("connectDetails").open = true;
    return;
  }

  $("codeInput").value = code;
  localStorage.setItem("studyTimerCompanionCode", code);
  eventSource?.close();
  setConnection("Verbinde …");

  eventSource = new EventSource(`https://ntfy.sh/${topic()}/sse`);
  eventSource.onopen = () => {
    setConnection("Verbunden", "connected");
    $("connectDetails").open = false;
    publish("companion_ready");
    publish("request_state");
  };

  eventSource.onmessage = event => {
    try {
      const envelope = JSON.parse(event.data);
      if (envelope.event !== "message") return;
      const message = JSON.parse(envelope.message);
      if (message.app !== "study-timer-sync-v2" || message.sender === SENDER) return;

      lastMessage = Date.now();
      setConnection("Verbunden", "connected");
      if (message.kind === "state") {
        remote = message.state;
        render();
      } else if (message.kind === "finished") {
        notifyOnce(message.segmentToken, message.configuredMs, message.segmentMs);
      }
    } catch (_) {
    }
  };

  eventSource.onerror = () => setConnection("Verbindung wird neu aufgebaut", "error");
}

function disconnect() {
  eventSource?.close();
  eventSource = null;
  remote = null;
  localStorage.removeItem("studyTimerCompanionCode");
  $("codeInput").value = "";
  setConnection("Nicht verbunden");
  $("connectDetails").open = true;
  render();
}

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

function formatTimer(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function render() {
  if (!remote) {
    $("swMain").textContent = "00:00:00";
    $("swFraction").textContent = ".00";
    $("timerDisplay").textContent = "00:00:00";
    $("swStatus").textContent = "—";
    $("timerStatus").textContent = "—";
    $("durationInfo").textContent = "Warte auf Daten aus Notion.";
    return;
  }

  const now = Date.now();
  const sw = remote.swRunning ? remote.swElapsed + now - remote.swStartedAt : remote.swElapsed;
  const formatted = formatSw(Math.max(0, sw));
  const remaining = remote.timerRunning ? Math.max(0, remote.timerEnd - now) : remote.remainingMs;

  $("swMain").textContent = formatted.main;
  $("swFraction").textContent = "." + formatted.fraction;
  $("swStatus").textContent = remote.swRunning ? "Läuft" : (sw > 0 ? "Pausiert" : "Bereit");
  $("timerDisplay").textContent = formatTimer(remaining);
  $("timerStatus").textContent = remote.timerRunning ? "Läuft" : (remaining > 0 ? "Pausiert" : "Fertig");
  $("durationInfo").textContent = `Eingestellt: ${roundMin(remote.configuredMs)} Minuten`;

  if (remote.timerRunning && remaining <= 0 && remote.segmentToken) {
    const segment = Math.max(0, remote.timerEnd - remote.segmentStartedAt);
    notifyOnce(remote.segmentToken, remote.configuredMs, segment);
    remote.timerRunning = false;
  }
}

async function notifyOnce(token, configuredMs, segmentMs) {
  if (!token || token === lastNotified) return;
  lastNotified = token;
  localStorage.setItem("lastNotifiedToken", token);

  if (!$("notifyEnabled").checked || !("Notification" in window) || Notification.permission !== "granted") return;

  const title = `${roundMin(configuredMs)}/${roundMin(segmentMs)} Minuten Timer abgelaufen`;
  const options = {
    body: "Dein Lern-Timer ist beendet.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: `study-timer-${token}`,
    renotify: true,
    data: { url: "./companion.html" }
  };

  try {
    const activeRegistration = registration || await navigator.serviceWorker.ready;
    await activeRegistration.showNotification(title, options);
  } catch (_) {
    try { new Notification(title, options); } catch (_) {}
  }
}

function updateNotify() {
  if (!("Notification" in window)) {
    $("notifyStatus").textContent = "Nicht unterstützt";
    $("notifyEnabled").checked = false;
    return;
  }

  if (Notification.permission === "denied") {
    $("notifyStatus").textContent = "Blockiert";
    $("notifyEnabled").checked = false;
    return;
  }

  $("notifyStatus").textContent = $("notifyEnabled").checked && Notification.permission === "granted" ? "An" : "Aus";
}

async function changeNotify() {
  if (!$("notifyEnabled").checked) {
    localStorage.setItem("studyTimerNotify", "false");
    updateNotify();
    return;
  }

  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    $("notifyEnabled").checked = permission === "granted";
    localStorage.setItem("studyTimerNotify", String(permission === "granted"));
  } catch (_) {
    $("notifyEnabled").checked = false;
  }
  updateNotify();
}

async function init() {
  if ("serviceWorker" in navigator) {
    try {
      registration = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    } catch (_) {
    }
  }

  const params = new URLSearchParams(location.search);
  const linkedCode = normalize(params.get("code"));
  if (linkedCode) {
    localStorage.setItem("studyTimerCompanionCode", linkedCode);
    history.replaceState({}, "", "companion.html");
  }

  const code = linkedCode || localStorage.getItem("studyTimerCompanionCode") || "";
  $("codeInput").value = code;
  $("notifyEnabled").checked = localStorage.getItem("studyTimerNotify") === "true" && ("Notification" in window) && Notification.permission === "granted";
  updateNotify();

  if (code) {
    $("connectDetails").open = false;
    connect();
  } else {
    $("connectDetails").open = true;
  }

  setInterval(render, 200);
  setInterval(() => {
    if (eventSource) publish("companion_ping");
  }, 60000);
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  $("installButton").classList.remove("hidden");
});

$("installButton").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("installButton").classList.add("hidden");
};

$("connectButton").onclick = connect;
$("disconnectButton").onclick = disconnect;
$("notifyEnabled").onchange = changeNotify;

init();
