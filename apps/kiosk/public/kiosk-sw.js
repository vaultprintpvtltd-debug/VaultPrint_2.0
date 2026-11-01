// ---------------------------------------------------------------------------
// VaultPrint kiosk service worker (scope /kiosk/)
//
// 1. Makes the kiosk screen installable as a full-screen app — Chrome before
//    v108 (the Android box runs 101) requires a fetch handler for that.
// 2. If the network drops, shows a self-reloading "Reconnecting…" screen
//    instead of Chrome's offline error page (which would expose browser UI).
//
// Nothing is cached: every navigation goes to the network.
// ---------------------------------------------------------------------------

const OFFLINE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VaultPrint</title>
<style>
  html,body{margin:0;height:100%;background:#09090b;color:#e4e4e7;font-family:system-ui,sans-serif}
  body{display:flex;align-items:center;justify-content:center;text-align:center}
  .s{width:48px;height:48px;margin:0 auto 20px;border:4px solid #3f3f46;border-top-color:#2dd4bf;border-radius:50%;animation:r 1s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  p{color:#a1a1aa}
</style></head>
<body><div><div class="s"></div><h1>Reconnecting…</h1><p>The kiosk lost its internet connection. It will come back automatically.</p></div>
<script>setTimeout(function(){location.reload()},5000)</script></body></html>`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    )
  )
})
