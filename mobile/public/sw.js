// Minimal service worker — exists only so the browser considers this an
// installable PWA (Add to Home Screen / Install App). This is a real-time
// multiplayer game with nothing meaningful to cache or serve offline, so
// it intentionally does NOT cache anything or intercept requests — every
// fetch passes straight through to the network as normal.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op: let the browser handle every request normally.
});

// "It's your turn" notifications — opt-in, registered via
// src/pushNotifications.js. The payload is always a small JSON object
// ({ title, body }) the server builds in index.js's notifyTurnIfChanged;
// falls back to plain text if that ever isn't the case, so a malformed or
// future-changed payload still shows SOMETHING rather than throwing.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Pick the Pack", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Pick the Pack";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Replaces any still-showing turn notification instead of stacking —
    // only the most recent "whose turn is it" is ever relevant.
    tag: "pick-the-pack-turn",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification should bring an already-open tab to the front
// rather than always opening a fresh one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
