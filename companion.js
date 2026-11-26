// Windows-App (installierbare Edge-App): volle Bedienung, Windows-Benachrichtigungen,
// Alarmton und Mini-Fenster, das über allen Fenstern bleibt.

import * as C from "./core.js?v=10.0";
import { FIREBASE_DATABASE_URL } from "./config.js?v=10.0";
import { createController, resolveRoom, setRoom } from "./app.js?v=10.0";
import { startSync } from "./sync.js?v=10.0";
import { SoundEngine } from "./sounds.js?v=10.0";
import { mountClocks } from "./ui.js?v=10.0";
import { createRuntime } from "./runtime.js?v=10.0";
import { pipSupported, openPip } from "./pip.js?v=10.0";
import { $, setChip, serverState, peerState, wireCopyButtons, embedUrl } from "./shared-ui.js?v=10.0";

const databaseURL = C.isValidDatabaseUrl(FIREBASE_DATABASE_URL) ? FIREBASE_DATABASE_URL.trim().replace(/\/$/, "") : "";
const params = new URLSearchParams(location.search);
const pendingAction = params.get("notify")
  ? { type: "notification", action: params.get("notify"), clockId: params.get("clock"), expiryId: params.get("expiry") }
  : null;
const { room } = resolveRoom("desktop");
if (location.search) history.replaceState({}, "", location.pathname);

const swReady = registerServiceWorker();
let installPrompt = null;

wireCopyButtons();
setupInstallButton();

if (room) {
  start(room);
} else {
  showSetup();
}

/* ---------- Ohne Code: einmalig verbinden ---------- */

function showSetup() {
  $("setup").hidden = false;
  $("connectPanel").hidden = true;
  $("notifyPanel").hidden = true;
  setChip($("serverChip"), "Server: noch kein Code", "wait");
  setChip($("notionChip"), "Notion: –", "wait");
  setChip($("notifyChip"), "Meldungen: –", "wait");
  $("setupConnect").addEventListener("click", () => {
    const code = C.cleanCode($("setupRoom").value);
    if (!C.isValidCode(code)) {
      $("setupHint").textContent = "Der Code muss mindestens 24 Zeichen lang sein. Kopiere ihn im Notion-Widget unter „Verbindungscode“.";
      return;
    }
    setRoom("desktop", code);
    location.reload();
  });
}

/* ---------- Mit Code ---------- */

function start(currentRoom) {
  const controller = createController({ role: "desktop", room: currentRoom, databaseURL, startSync });
  const sounds = new SoundEngine();
  sounds.unlock(); // Installierte Apps dürfen in Edge meist ohne Klick Töne abspielen.
  document.addEventListener("pointerdown", () => sounds.unlock(), { passive: true });
  document.addEventListener("keydown", () => sounds.unlock());
  const view = mountClocks($("clocks"), controller, sounds);
  const shownNotifications = new Map();

  controller.start();

  createRuntime(controller, sounds, {
    ambientAllowed: () => controller.device.ambientHere,
    alarmAllowed: () => controller.device.alarmHere !== "off",
    onExpired(clock, now) {
      if (controller.notified.has(clock.expiryId)) return;
      controller.markNotified(clock.expiryId);
      if (now - clock.endsAt <= C.LATE_LIMIT) showTimerNotification(clock);
    },
    onCheck({ now, wantsSound }) {
      view.setWantsSound(wantsSound);
      closeResolvedNotifications();
      updateTitle(now);
    }
  });

  /* Benachrichtigungen */

  async function showTimerNotification(clock) {
    if (!controller.device.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    const tag = `timer-${clock.expiryId}`;
    const title = `${clock.label} ist abgelaufen`;
    const options = {
      body: `${C.formatDuration(clock.durationMs)} eingestellt · die Überzeit läuft weiter.`,
      tag,
      icon: "icon-192.png",
      badge: "icon-192.png",
      requireInteraction: true,
      renotify: true,
      timestamp: clock.endsAt,
      data: { clockId: clock.id, expiryId: clock.expiryId },
      actions: [
        { action: "stop", title: "Alarm stoppen" },
        { action: "snooze", title: "Noch 5 Min." }
      ]
    };
    shownNotifications.set(tag, { clockId: clock.id, expiryId: clock.expiryId });
    try {
      const registration = await swReady;
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }
    } catch (_) {
    }
    try {
      const { actions, ...plain } = options;
      const notification = new Notification(title, plain);
      notification.onclick = () => { window.focus(); notification.close(); };
      shownNotifications.get(tag).notification = notification;
    } catch (_) {
    }
  }

  // Wurde der Alarm anderswo gestoppt oder der Timer zurückgesetzt, verschwindet die Meldung.
  function closeResolvedNotifications() {
    for (const [tag, info] of shownNotifications) {
      const clock = controller.clocks[info.clockId];
      const resolved = !clock || clock.deleted || clock.expiryId !== info.expiryId || clock.alarmStoppedId === info.expiryId;
      if (!resolved) continue;
      shownNotifications.delete(tag);
      info.notification?.close();
      swReady.then(registration => registration?.getNotifications({ tag }))
        .then(list => list?.forEach(notification => notification.close()))
        .catch(() => {});
    }
  }

  function handleNotificationAction(data) {
    if (data?.type !== "notification") return;
    const clock = controller.clocks[data.clockId];
    if (!clock || (data.expiryId && clock.expiryId !== data.expiryId)) return;
    if (data.action === "stop") controller.stopAlarm(clock.id);
    if (data.action === "snooze") {
      const remaining = C.timerMs(clock, controller.now());
      controller.adjust(clock.id, (5 * C.MINUTE - remaining) / C.MINUTE);
    }
  }

  navigator.serviceWorker?.addEventListener("message", event => handleNotificationAction(event.data));
  if (pendingAction) handleNotificationAction(pendingAction);

  function updateTitle(now) {
    const running = C.visibleClocks(controller.clocks, "timer")
      .filter(clock => clock.running)
      .sort((a, b) => a.endsAt - b.endsAt)[0];
    const title = running ? `${C.formatCompact(C.timerMs(running, now), "timer")} · ${running.label} – Lern-Timer` : "Lern-Timer";
    if (document.title !== title) document.title = title;
  }

  /* Einstellungen */

  const notifyBox = $("notifyEnabled");
  notifyBox.checked = controller.device.notify && "Notification" in window && Notification.permission === "granted";
  $("alarmHere").checked = controller.device.alarmHere !== "off";
  $("ambientHere").checked = controller.device.ambientHere;

  notifyBox.addEventListener("change", async () => {
    if (!notifyBox.checked) {
      controller.device.notify = false;
      controller.saveDevice();
      return renderStatus();
    }
    let permission = "denied";
    try {
      permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    } catch (_) {
    }
    controller.device.notify = permission === "granted";
    notifyBox.checked = controller.device.notify;
    controller.saveDevice();
    renderStatus();
  });

  $("alarmHere").addEventListener("change", event => {
    controller.device.alarmHere = event.target.checked ? "on" : "off";
    controller.saveDevice();
  });
  $("ambientHere").addEventListener("change", event => {
    controller.device.ambientHere = event.target.checked;
    controller.saveDevice();
  });

  $("testNotify").addEventListener("click", async () => {
    if (Notification.permission !== "granted") {
      notifyBox.checked = true;
      notifyBox.dispatchEvent(new Event("change"));
      return;
    }
    const registration = await swReady;
    const options = { body: "So sieht die Meldung aus, wenn ein Timer abläuft.", tag: "test", icon: "icon-192.png", requireInteraction: true };
    try {
      if (registration) await registration.showNotification("Test: Lern-Timer", options);
      else new Notification("Test: Lern-Timer", options);
    } catch (error) {
      $("notifyHint").textContent = `Benachrichtigung fehlgeschlagen: ${error.message}`;
    }
  });

  /* Mini-Fenster */

  if (pipSupported()) {
    $("pipButton").hidden = false;
    $("pipButton").addEventListener("click", async () => {
      try {
        await openPip(controller, sounds);
      } catch (error) {
        view.showToast(`Mini-Fenster nicht möglich: ${error.message}`);
      }
    });
  }

  /* Verbindung */

  $("roomCode").value = currentRoom;
  $("embedLink").value = embedUrl(currentRoom);
  $("configHint").hidden = Boolean(databaseURL);
  $("useRoom").addEventListener("click", () => {
    const code = C.cleanCode($("newRoom").value);
    if (!C.isValidCode(code)) {
      $("newRoom").value = "";
      $("newRoom").placeholder = "Ungültiger Code (mind. 24 Zeichen)";
      return;
    }
    setRoom("desktop", code);
    location.reload();
  });

  const notifyPanel = $("notifyPanel");
  const connectPanel = $("connectPanel");
  notifyPanel.open = controller.ui.panels.notify === true;
  connectPanel.open = controller.ui.panels.connect === true || !databaseURL;
  notifyPanel.addEventListener("toggle", () => { controller.ui.panels.notify = notifyPanel.open; controller.saveUi(); });
  connectPanel.addEventListener("toggle", () => { controller.ui.panels.connect = connectPanel.open; controller.saveUi(); });

  function notifyState() {
    if (!("Notification" in window)) return ["nicht unterstützt", "bad"];
    if (Notification.permission === "denied") return ["blockiert", "bad"];
    if (Notification.permission !== "granted") return ["noch nicht erlaubt", "bad"];
    return controller.device.notify ? ["an", "ok"] : ["aus", "bad"];
  }

  let notifyPanelOpened = false;

  function renderStatus() {
    const [serverText, serverKind] = serverState(controller);
    const [notionText, notionKind] = peerState(controller, "notion");
    const [notifyText, notifyKind] = notifyState();
    setChip($("serverChip"), `Server ${serverText}`, serverKind);
    setChip($("serverChip2"), serverText, serverKind);
    setChip($("serverChip3"), serverText, serverKind);
    setChip($("notionChip"), `Notion ${notionText.split(" · ")[0]}`, notionKind === "ok" ? "ok" : "wait");
    setChip($("notionChip2"), notionText, notionKind === "ok" ? "ok" : "wait");
    setChip($("notifyChip"), `Meldungen ${notifyText}`, notifyKind);
    setChip($("notifyChip2"), notifyText, notifyKind);
    if (notifyKind === "bad" && Notification.permission !== "granted") {
      $("notifyHint").textContent = Notification.permission === "denied"
        ? "Edge blockiert die Meldungen. Klicke links neben der Adresse auf das Schloss → Berechtigungen → Benachrichtigungen zulassen."
        : "Setze den Haken bei „Windows-Benachrichtigung“ und bestätige die Abfrage von Edge.";
      if (!notifyPanelOpened) notifyPanel.open = true;
      notifyPanelOpened = true;
    }
    const count = C.visibleClocks(controller.clocks).length;
    $("backupInfo").textContent = `${count} Uhren sind auf diesem Gerät gesichert und werden bei jeder Änderung neu gespeichert.`;
  }

  controller.subscribe(renderStatus);
  renderStatus();
  setInterval(renderStatus, 15000);
}

/* ---------- Service Worker & Installation ---------- */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register("sw.js");
    return await navigator.serviceWorker.ready;
  } catch (_) {
    return null;
  }
}

function setupInstallButton() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    $("installButton").hidden = false;
  });
  $("installButton").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $("installButton").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("installButton").hidden = true; });
}
