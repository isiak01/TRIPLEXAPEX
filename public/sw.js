self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith("/api/")
  ) return;

  event.respondWith(fetch(event.request).catch(() => {
    if (event.request.mode === "navigate") {
      return new Response(
        "<!doctype html><html lang=\"en\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Triplex offline</title><body><main><h1>You are offline</h1><p>Reconnect to the internet to securely access your Triplex account.</p></main></body></html>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    return new Response(null, { status: 503, statusText: "Offline" });
  }));
});
