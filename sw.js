/* urNotes — lucru fără internet.
   Fișierele aplicației: mai întâi rețeaua (ca să primești mereu ultima versiune), copia salvată doar când nu e semnal.
   Fonturile și Chart.js: copia salvată imediat, actualizată în fundal. Firebase nu trece pe aici. */
const CACHE = "urnotes-v1";
const SHELL = ["./", "index.html", "style.css", "script.js", "cloud.js", "firebase-config.js", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png"];
const CDN = ["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin === location.origin) {
        event.respondWith(fetch(req).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
    } else if (CDN.some(o => req.url.startsWith(o))) {
        event.respondWith(caches.open(CACHE).then(async c => {
            const hit = await c.match(req);
            const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
            return hit || net;
        }));
    }
});
