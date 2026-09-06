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
