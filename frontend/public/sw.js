/* eslint-disable no-restricted-globals */
// Service worker cho PWA. Không dùng Workbox — handler thuần để dễ debug
// và không kéo thêm dependency. Caching strategy:
//   - app shell: stale-while-revalidate (cùng-origin GET HTML/JS/CSS)
//   - Leaflet/OSM tiles: cache-first 7 ngày
//   - API: network-only (data realtime, không cache)

const SW_VERSION = "v1";
const SHELL_CACHE = `shell-${SW_VERSION}`;
const TILE_CACHE = `tiles-${SW_VERSION}`;
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  // Skip waiting để bản mới apply ngay lần reload tiếp theo.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Dọn cache phiên bản cũ
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.endsWith(SW_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isTileRequest(url) {
  return (
    url.hostname.endsWith(".tile.openstreetmap.org") ||
    url.hostname.endsWith(".tile.osm.org") ||
    url.hostname.endsWith("a.tile.opencyclemap.org") ||
    url.pathname.match(/\/[0-9]+\/[0-9]+\/[0-9]+\.(png|jpg|webp)$/)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API requests — không cache, để app tự handle offline
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.includes("socket.io")) return;

  // Leaflet tiles — cache-first
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          const dateHeader = cached.headers.get("sw-cached-at");
          const cachedAt = dateHeader ? Number(dateHeader) : 0;
          if (Date.now() - cachedAt < TILE_MAX_AGE_MS) {
            return cached;
          }
        }
        try {
          const res = await fetch(req);
          if (res.ok) {
            // Wrap response để gắn timestamp custom header
            const copy = new Response(await res.clone().blob(), {
              status: res.status,
              statusText: res.statusText,
              headers: new Headers({
                ...Object.fromEntries(res.headers.entries()),
                "sw-cached-at": String(Date.now()),
              }),
            });
            cache.put(req, copy);
          }
          return res;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      }),
    );
    return;
  }

  // Same-origin app shell — stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res.ok && res.type === "basic") {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      }),
    );
  }
});

// --- Push notifications ---
//
// Payload từ backend PushService:
// {
//   type: "sos" | "geofence_breach" | "low_battery" | "device_offline",
//   title, body, url?, data?: { deviceId, ... }
// }
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Cảnh báo", body: event.data.text() };
  }

  const title = payload.title || "deviceTracking";
  const isSos = payload.type === "sos";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.type
      ? `${payload.type}-${payload.data?.deviceId ?? "all"}`
      : undefined,
    renotify: isSos,
    requireInteraction: isSos,
    vibrate: isSos ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: { url: payload.url || "/dashboard", ...payload.data },
    actions: isSos
      ? [
          { action: "view", title: "Xem vị trí" },
          { action: "dismiss", title: "Bỏ qua" },
        ]
      : [{ action: "view", title: "Xem" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Nếu đã có tab mở — focus + điều hướng nó
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            client.navigate(url).catch(() => undefined);
          }
          return;
        }
      }
      // Không có tab nào — mở mới
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    }),
  );
});
