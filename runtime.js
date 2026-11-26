// Überwacht Abläufe und Klänge. Der Ablauf-Zeitpunkt wird mit einem einzelnen Timeout geplant,
// der immer über einen MessageChannel neu angesetzt wird. So zählt er für Chrome/Edge nicht als
// "verketteter" Timer und wird auch in minimierten Fenstern nur auf 1 Sekunde genau gebremst
// (statt auf 1 Minute).

import * as C from "./core.js?v=10.0";

export function createRuntime(controller, sounds, { alarmAllowed, ambientAllowed, onExpired, onCheck }) {
  let timeout = null;
  const channel = new MessageChannel();
  channel.port1.onmessage = plan;

  function check() {
    const now = controller.now();
    const clocks = C.visibleClocks(controller.clocks);

    for (const clock of clocks) {
      if (C.isExpired(clock, now)) onExpired?.(clock, now);
    }

    const ambient = new Map();
    if (ambientAllowed()) {
      for (const clock of clocks) {
        if (clock.kind === "stopwatch" && clock.running && clock.sound.enabled && clock.sound.volume > 0) {
          ambient.set(clock.id, { type: clock.sound.type, volume: clock.sound.volume });
        }
      }
    }

    const alarms = new Map();
    if (alarmAllowed()) {
      for (const clock of clocks) {
        if (clock.kind === "timer" && C.alarmActive(clock, now) && clock.alarm.volume > 0) {
          alarms.set(clock.id, {
            type: clock.alarm.type,
            volume: clock.alarm.volume,
            untilMs: clock.endsAt + C.alarmWindowMs(clock)
          });
        }
      }
    }

    sounds.syncAmbient(ambient);
    sounds.syncAlarms(alarms, now);
    onCheck?.({ now, wantsSound: ambient.size + alarms.size > 0, ringing: alarms.size > 0 });
    channel.port2.postMessage(0);
  }

  function plan() {
    clearTimeout(timeout);
    const now = controller.now();
    let next = Infinity;
    for (const clock of C.visibleClocks(controller.clocks, "timer")) {
      if (!clock.running || !clock.expiryId) continue;
      if (clock.endsAt > now) next = Math.min(next, clock.endsAt);
      else if (C.alarmActive(clock, now)) next = Math.min(next, now + 5000, clock.endsAt + C.alarmWindowMs(clock));
    }
    if (next === Infinity) return;
    timeout = setTimeout(check, Math.max(0, Math.min(next - now + 25, 2_000_000_000)));
  }

  controller.subscribe(check);
  document.addEventListener("visibilitychange", check);
  setInterval(check, 1000);
  setTimeout(check, 0);
  return { check };
}
