// Service Worker der Windows-App: Offline-Start, Benachrichtigungs-Klicks.
// Speichert nur die eigenen App-Dateien und die Firebase-Bibliothek – nichts anderes.

const VERSION = "10.0";
const CACHE = `lern-timer-${VERSION}`;
const APP_FILES = [
  "./companion.html",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  ...["styles.css", "core.js", "app.js", "sync.js", "sounds.js", "ui.js", "runtime.js", "pip.js",
    "shared-ui.js", "widget.js", "companion.js", "config.js"].map(file => `./${file}?v=${VERSION}`)
];
const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(APP_FILES.map(file => cache.add(file).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.href.startsWith(FIREBASE_CDN)) {
    // Versionierte Bibliothek: einmal laden, danach aus dem Speicher (auch offline).
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  // Nur die eigenen App-Dateien – keine Datenverbindungen, keine fremden Seiten.
  const scopePath = new URL(self.registration.scope).pathname;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  if (request.headers.get("accept")?.includes("text/event-stream")) return;
  if (request.mode !== "navigate" && !/\.(html|js|css|png|webmanifest)$/.test(url.pathname)) return;

  // Eigene Dateien: zuerst aus dem Netz (damit Updates sofort ankommen), sonst aus dem Speicher.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request) || await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") return (await cache.match("./companion.html")) || Response.error();
      return Response.error();
    }
  })());
});

self.addEventListener("notificationclick", event => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || "open";
  notification.close();

  event.waitUntil((async () => {
    const message = { type: "notification", action, clockId: data.clockId, expiryId: data.expiryId };
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = clients.find(client => new URL(client.url).pathname.endsWith("/companion.html")) || clients[0];
    if (app) {
      app.postMessage(message);
      if (action === "open" && "focus" in app) return app.focus();
      return undefined;
    }
    const url = new URL("./companion.html", self.location.href);
    if (action !== "open" && data.clockId) {
      url.searchParams.set("notify", action);
      url.searchParams.set("clock", data.clockId);
      url.searchParams.set("expiry", data.expiryId || "");
    }
    return self.clients.openWindow(url.href);
  })());
});
