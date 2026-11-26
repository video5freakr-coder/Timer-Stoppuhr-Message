// Notion-Widget: volle Bedienung, lokaler Speicher, Synchronisierung mit der Windows-App.

import * as C from "./core.js?v=10.0";
import { FIREBASE_DATABASE_URL } from "./config.js?v=10.0";
import { createController, resolveRoom, setRoom } from "./app.js?v=10.0";
import { startSync } from "./sync.js?v=10.0";
import { SoundEngine } from "./sounds.js?v=10.0";
import { mountClocks } from "./ui.js?v=10.0";
import { createRuntime } from "./runtime.js?v=10.0";
import { $, setChip, serverState, peerState, wireCopyButtons, embedUrl, companionUrl } from "./shared-ui.js?v=10.0";

const databaseURL = C.isValidDatabaseUrl(FIREBASE_DATABASE_URL) ? FIREBASE_DATABASE_URL.trim().replace(/\/$/, "") : "";
const { room, source } = resolveRoom("notion");
const controller = createController({ role: "notion", room, databaseURL, startSync });
const sounds = new SoundEngine();
const view = mountClocks($("clocks"), controller, sounds);

controller.start();

createRuntime(controller, sounds, {
  ambientAllowed: () => controller.device.ambientHere,
  alarmAllowed: () => {
    const mode = controller.device.alarmHere;
    return mode === "on" || (mode === "auto" && !controller.isOnline("desktop"));
  },
  onCheck: ({ wantsSound }) => view.setWantsSound(wantsSound)
});

/* ---------- Verbindungsbereich ---------- */

const panel = $("syncPanel");
panel.open = controller.ui.panels.sync === true || !databaseURL;
panel.addEventListener("toggle", () => {
  controller.ui.panels.sync = panel.open;
  controller.saveUi();
});

$("openCompanion").href = companionUrl(room);
$("embedLink").value = embedUrl(room);
$("roomCode").value = room;
$("embedHint").textContent = source === "url"
  ? "✓ Dieses Widget verwendet bereits den Link mit Code."
  : "Tipp: In Notion einen neuen Embed-Block mit diesem Link anlegen und den alten löschen.";
$("setupHint").hidden = Boolean(databaseURL);

$("alarmHere").value = controller.device.alarmHere;
$("ambientHere").checked = controller.device.ambientHere;
$("alarmHere").addEventListener("change", event => {
  controller.device.alarmHere = event.target.value;
  controller.saveDevice();
});
$("ambientHere").addEventListener("change", event => {
  controller.device.ambientHere = event.target.checked;
  controller.saveDevice();
});

$("useRoom").addEventListener("click", () => {
  const code = C.cleanCode($("newRoom").value);
  if (!C.isValidCode(code)) {
    $("roomHint").textContent = "Der Code muss mindestens 24 Zeichen lang sein (Buchstaben und Ziffern).";
    return;
  }
  setRoom("notion", code);
  if (source === "url") {
    $("roomHint").textContent = "Gespeichert. Ersetze jetzt auch den Embed-Link in Notion durch den neuen Link – sonst gilt beim nächsten Laden wieder der alte Code.";
    $("embedLink").value = embedUrl(code);
    return;
  }
  location.reload();
});

wireCopyButtons();

function renderStatus() {
  const [serverText, serverKind] = serverState(controller);
  const [desktopText, desktopKind] = peerState(controller, "desktop");
  setChip($("serverChip"), serverText, serverKind);
  setChip($("desktopChip"), desktopText, desktopKind);

  const summary = !databaseURL
    ? ["nur lokal", "wait"]
    : controller.status !== "connected"
      ? [`Server ${serverText}`, serverKind]
      : controller.isOnline("desktop") ? ["verbunden", "ok"] : [desktopText.split(" · ")[0], desktopKind];
  setChip($("summaryChip"), summary[0], summary[1]);
  panel.classList.toggle("attention", Boolean(databaseURL) && controller.status !== "connected" && controller.status !== "connecting");
}

controller.subscribe(renderStatus);
renderStatus();
setInterval(renderStatus, 15000);
