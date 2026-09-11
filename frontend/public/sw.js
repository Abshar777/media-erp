/* mediaERP service worker — minimal, safe runtime caching for installability
   + basic offline. Deliberately never touches /api/ so data & auth stay live. */
const CACHE = "mediaerp-v1";
const STATIC_DESTS = ["style", "script", "font", "image"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Only handle same-origin GETs. Never intercept the API (network-only → fresh
  // data + auth) or WebSocket upgrades.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigation → network-first (always try for the freshest app shell), then cache.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/dashboard")))
    );
    return;
  }

  // Static assets → stale-while-revalidate.
  if (STATIC_DESTS.includes(req.destination) || url.pathname.startsWith("/_next/")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

/* ── Web Push ────────────────────────────────────────────────────────────────
   Fires even with every tab closed, which is the whole point of push over the
   in-page Notification API. The payload is the JSON the server sends. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push with no body (or a keepalive) still deserves something useful
    // rather than a crash in the handler.
    data = {};
  }

  const title = data.title || "mediaERP";
  const body = data.message || "";
  const type = data.type || "info";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Same tag replaces rather than stacks, so a burst doesn't bury the
      // notification shade in duplicates.
      tag: `merp-${type}`,
      renotify: true,
      data: {
        type,
        notificationId: data.id || "",
        metadata: data.metadata || {},
      },
    })
  );
});

/* Clicking should land on the relevant screen, and reuse an open tab rather
   than piling up new ones. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const d = event.notification.data || {};
  const taskId = (d.metadata && d.metadata.task_id) || "";
  let path = "/dashboard";
  if (d.type === "mention") path = "/chat";
  else if (taskId) path = "/projects";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if (c.url.includes(self.location.origin)) {
            c.navigate(self.location.origin + path);
            return c.focus();
          }
        }
        return self.clients.openWindow(path);
      })
  );
});
