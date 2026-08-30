// Minimal service worker for the spike: registers and claims, no caching
// (avoids stale test pages during iteration).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* passthrough */ });
