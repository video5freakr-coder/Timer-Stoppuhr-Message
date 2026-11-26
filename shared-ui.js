// Kleine Helfer für Statusanzeigen und Kopierfelder (beide Modi).

export const $ = id => document.getElementById(id);

export function setChip(element, text, kind) {
  if (!element) return;
  if (element.textContent !== text) element.textContent = text;
  element.className = `chip ${kind}`;
}

export function formatSeen(timestamp) {
  if (!timestamp) return "";
  const date = new Date(Number(timestamp));
  const today = new Date();
  const time = date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function serverState(controller) {
  switch (controller.status) {
    case "local": return ["nicht eingerichtet", "wait"];
    case "connecting": return ["verbinde …", "wait"];
    case "connected": return ["verbunden", "ok"];
    case "offline": return ["getrennt – versucht es weiter", "bad"];
    case "denied": return ["Zugriff verweigert", "bad"];
    case "unavailable": return ["nicht erreichbar", "bad"];
    default: return ["Fehler", "bad"];
  }
}

export function peerState(controller, role) {
  if (!controller.syncEnabled) return ["–", "wait"];
  if (controller.isOnline(role)) return ["geöffnet", "ok"];
  const seen = controller.lastSeen?.[role];
  if (seen) return [`geschlossen · zuletzt ${formatSeen(seen)}`, role === "desktop" ? "bad" : "wait"];
  return ["noch nie verbunden", "wait"];
}

export function wireCopyButtons(root = document) {
  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const input = document.getElementById(button.dataset.copy);
    if (!input) return;
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (_) {
      input.select();
      document.execCommand("copy");
    }
    button.textContent = "Kopiert";
    setTimeout(() => { button.textContent = original; }, 1200);
  });
}

export function embedUrl(room) {
  const url = new URL("./", location.href);
  url.search = `?room=${encodeURIComponent(room)}`;
  return url.href;
}

export function companionUrl(room) {
  const url = new URL("./companion.html", location.href);
  url.search = `?room=${encodeURIComponent(room)}`;
  return url.href;
}
