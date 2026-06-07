const CACHE = "opposition-fleurieux-v1";
const SHELL = ["/", "/index.html"];

// Installation : cache le shell
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activation : nettoyer anciens caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch : network-first pour l'API, cache-first pour le shell
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // API : toujours réseau
  if (url.pathname.startsWith("/api/")) return;

  // Navigation : renvoyer index.html (SPA)
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Assets : network-first avec fallback cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push notifications
self.addEventListener("push", e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); }
  catch { data = { title: "Opposition Fleurieux", body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(data.title || "Opposition Fleurieux", {
      body: data.body || "",
      icon: data.icon || "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
      vibrate: [200, 100, 200],
      tag: "opposition-fleurieux",
    })
  );
});

// Clic sur notification → ouvrir l'app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      const c = clients.find(c => c.url.includes(self.location.origin));
      if (c) { c.focus(); c.navigate(url); }
      else self.clients.openWindow(url);
    })
  );
});
