// Verbindung über Firebase Realtime Database (kostenloser Spark-Plan).
// Struktur: rooms/<Code>/clocks/<id>      – eine Uhr pro Eintrag
//           rooms/<Code>/presence/<Rolle>/<Sitzung> – wird beim Trennen automatisch entfernt
//           rooms/<Code>/lastSeen/<Rolle>  – Zeitpunkt der letzten Verbindung

import { VERSION, toRemote } from "./core.js?v=10.0";

export const FIREBASE_SDK_VERSION = "12.19.0";
const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let sdkPromise = null;

function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import(`${SDK_BASE}/firebase-app.js`),
      import(`${SDK_BASE}/firebase-database.js`)
    ]).catch(error => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

export async function startSync({ databaseURL, room, role, sessionId, onClocks, onOffset, onPresence, onLastSeen, onStatus }) {
  const [appSdk, fb] = await loadSdk();
  const app = appSdk.initializeApp({ databaseURL: databaseURL.replace(/\/$/, "") }, `lern-timer-${role}-${sessionId}`);
  const db = fb.getDatabase(app);
  const base = `rooms/${room}`;
  const mine = fb.ref(db, `${base}/presence/${role}/${sessionId}`);
  const seen = fb.ref(db, `${base}/lastSeen/${role}`);
  const unsubscribe = [];
  let denied = false;

  const fail = error => {
    const message = String(error?.message || error || "");
    if (/permission|denied/i.test(message)) {
      denied = true;
      onStatus("denied", "Firebase verweigert den Zugriff – sind die Regeln aus der Anleitung veröffentlicht?");
    } else {
      onStatus("error", message);
    }
  };

  async function announce() {
    try {
      await fb.onDisconnect(mine).remove();
      await fb.onDisconnect(seen).set(fb.serverTimestamp());
      await fb.set(mine, { at: fb.serverTimestamp(), v: VERSION });
      await fb.set(seen, fb.serverTimestamp());
    } catch (error) {
      fail(error);
    }
  }

  unsubscribe.push(fb.onValue(fb.ref(db, ".info/connected"), snapshot => {
    const connected = snapshot.val() === true;
    if (!denied) onStatus(connected ? "connected" : "offline");
    if (connected) announce();
  }));

  unsubscribe.push(fb.onValue(fb.ref(db, ".info/serverTimeOffset"), snapshot => {
    onOffset(Number(snapshot.val()) || 0);
  }));

  unsubscribe.push(fb.onValue(fb.ref(db, `${base}/clocks`), snapshot => {
    onClocks(snapshot.val() || {});
  }, fail));

  unsubscribe.push(fb.onValue(fb.ref(db, `${base}/presence`), snapshot => {
    onPresence(snapshot.val() || {});
  }, () => {}));

  unsubscribe.push(fb.onValue(fb.ref(db, `${base}/lastSeen`), snapshot => {
    onLastSeen(snapshot.val() || {});
  }, () => {}));

  return {
    write(clock) {
      return fb.set(fb.ref(db, `${base}/clocks/${clock.id}`), toRemote(clock)).catch(fail);
    },
    remove(id) {
      return fb.remove(fb.ref(db, `${base}/clocks/${id}`)).catch(fail);
    },
    stop() {
      unsubscribe.forEach(off => off());
      fb.remove(mine).catch(() => {});
    }
  };
}
