// Mini-Fenster (Bild-in-Bild) über die Document Picture-in-Picture API von Edge/Chrome.
// Das Fenster bleibt über allen anderen Fenstern sichtbar, bis du es schliesst.

import * as C from "./core.js?v=10.0";
import { ICONS } from "./ui.js?v=10.0";

const PIP_CSS = `
:root { color-scheme: dark; --bg:#191919; --text:rgba(255,255,255,.81); --strong:rgba(255,255,255,.92); --muted:rgba(255,255,255,.46); --soft:rgba(255,255,255,.07); --danger:#eb5757; --danger-soft:rgba(235,87,87,.16); --ok:#4dab9a; --accent:#2383e2; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--text); font-family: Inter, system-ui, "Segoe UI", sans-serif; }
.pip { display:flex; flex-direction:column; gap:6px; padding:8px 10px; }
.row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:2px 8px; padding:6px 8px; border-radius:10px; }
.row + .row { border-top:1px solid var(--soft); }
.meta { grid-column:1 / -1; display:flex; gap:8px; justify-content:space-between; font-size:11px; color:var(--muted); }
.name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }
.time { color:var(--strong); font-size:26px; font-weight:750; letter-spacing:-.03em; font-variant-numeric:tabular-nums; line-height:1.05; }
.primary .time { font-size:44px; }
.actions { display:flex; gap:4px; }
button { display:inline-grid; place-items:center; min-width:32px; min-height:28px; border:0; border-radius:9px; padding:6px 9px; font:inherit; font-size:13px; font-weight:650; color:var(--text); background:var(--soft); cursor:pointer; }
button.stop { color:#fff; background:var(--danger); }
.bar { grid-column:1 / -1; height:4px; border-radius:4px; background:var(--soft); overflow:hidden; }
.bar span { display:block; height:100%; background:var(--accent); }
.overrun .time, .overrun .status { color:var(--danger); }
.overrun .bar span { background:var(--danger); }
.running:not(.overrun) .status { color:var(--ok); }
.ringing { background:var(--danger-soft); animation:ring 1.2s ease-in-out infinite; }
@keyframes ring { 50% { background:transparent; } }
.empty { padding:16px 4px; text-align:center; color:var(--muted); font-size:12px; }
[hidden] { display:none !important; }
`;

export function pipSupported() {
  return "documentPictureInPicture" in window;
}

function priority(clock, now) {
  if (clock.kind === "timer" && C.alarmActive(clock, now)) return [0, clock.endsAt];
  if (clock.kind === "timer" && clock.running) return [1, clock.endsAt];
  if (clock.running) return [2, clock.order];
  if (C.isActive(clock, now)) return [3, clock.order];
  return [4, clock.order];
}

export async function openPip(controller, sounds) {
  if (window.documentPictureInPicture.window) {
    window.documentPictureInPicture.window.focus();
    return window.documentPictureInPicture.window;
  }

  const pip = await window.documentPictureInPicture.requestWindow({ width: 300, height: 200 });
  const doc = pip.document;
  doc.title = "Lern-Timer";
  const style = doc.createElement("style");
  style.textContent = PIP_CSS;
  doc.head.append(style);
  const root = doc.createElement("main");
  root.className = "pip";
  doc.body.append(root);
  const rows = new Map();
  const empty = doc.createElement("p");
  empty.className = "empty";
  empty.textContent = "Keine Uhr vorhanden.";

  function buildRow(clock) {
    const row = doc.createElement("div");
    row.dataset.id = clock.id;
    row.innerHTML = `
      <div class="meta"><span class="name"></span><span class="status"></span></div>
      <div class="time"></div>
      <div class="actions">
        <button type="button" data-action="toggle" title="Start/Pause"></button>
        <button type="button" class="stop" data-action="stop-alarm" title="Alarm stoppen" hidden>Stopp</button>
      </div>
      ${clock.kind === "timer" ? '<div class="bar"><span></span></div>' : ""}`;
    row._refs = {
      name: row.querySelector(".name"),
      status: row.querySelector(".status"),
      time: row.querySelector(".time"),
      toggle: row.querySelector('[data-action="toggle"]'),
      stop: row.querySelector('[data-action="stop-alarm"]'),
      bar: row.querySelector(".bar span")
    };
    return row;
  }

  function render() {
    const now = controller.now();
    const all = C.visibleClocks(controller.clocks)
      .map(clock => ({ clock, rank: priority(clock, now) }))
      .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
    const anyActive = all.some(item => item.rank[0] <= 3);
    const shown = (anyActive ? all.filter(item => item.rank[0] <= 3) : all).slice(0, 6).map(item => item.clock);
    const ids = new Set(shown.map(clock => clock.id));

    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.remove(); rows.delete(id); }
    }
    shown.forEach((clock, index) => {
      let row = rows.get(clock.id);
      if (!row) { row = buildRow(clock); rows.set(clock.id, row); }
      if (root.children[index] !== row) root.insertBefore(row, root.children[index] || null);
      const refs = row._refs;
      const ms = clock.kind === "timer" ? C.timerMs(clock, now) : C.stopwatchMs(clock, now);
      const ringing = clock.kind === "timer" && C.alarmActive(clock, now);
      row.className = ["row", index === 0 && "primary", clock.running && "running",
        clock.kind === "timer" && (ms < 0 || (clock.running && ms <= 0)) && "overrun", ringing && "ringing"].filter(Boolean).join(" ");
      const time = C.formatCompact(ms, clock.kind);
      if (refs.name.textContent !== clock.label) refs.name.textContent = clock.label;
      const status = C.clockStatus(clock, now);
      if (refs.status.textContent !== status) refs.status.textContent = status;
      if (refs.time.textContent !== time) refs.time.textContent = time;
      const icon = clock.running ? "pause" : "play";
      if (refs.toggle.dataset.icon !== icon) {
        refs.toggle.dataset.icon = icon;
        refs.toggle.innerHTML = ICONS[icon];
      }
      refs.stop.hidden = !ringing;
      if (refs.bar) {
        const fraction = clock.durationMs > 0 ? Math.min(1, Math.max(0, ms / clock.durationMs)) : 0;
        refs.bar.style.width = ms <= 0 && clock.expiryId ? "100%" : `${(fraction * 100).toFixed(1)}%`;
      }
    });
    if (!shown.length && !empty.isConnected) root.append(empty);
    if (shown.length && empty.isConnected) empty.remove();
  }

  root.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    const id = button?.closest(".row")?.dataset.id;
    if (!id) return;
    sounds.unlock();
    if (button.dataset.action === "toggle") controller.toggle(id);
    if (button.dataset.action === "stop-alarm") controller.stopAlarm(id);
    render();
  });

  // Das Mini-Fenster ist sichtbar – seine eigenen Timer werden nicht gedrosselt.
  const interval = pip.setInterval(render, 250);
  const unsubscribe = controller.subscribe(render);
  pip.addEventListener("pagehide", () => {
    pip.clearInterval(interval);
    unsubscribe();
  });
  render();
  return pip;
}
