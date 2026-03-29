/**
 * coi-serviceworker — Cross-Origin Isolation via Service Worker
 * Adds COOP + COEP headers to enable SharedArrayBuffer (required for Atomics.wait).
 * COEP "credentialless" lets CDN resources (Pyodide, numpy…) load without CORP headers.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.status === 0 || response.type === "opaque") {
          return response;
        }

        const headers = new Headers(response.headers);

        if (request.mode === "navigate") {
          headers.set("Cross-Origin-Opener-Policy", "same-origin");
          headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        } else {
          // For cross-origin sub-resources, add CORP so they can be shared
          try {
            const reqOrigin = new URL(request.url).origin;
            if (reqOrigin !== self.location.origin && !headers.has("Cross-Origin-Resource-Policy")) {
              headers.set("Cross-Origin-Resource-Policy", "cross-origin");
            }
          } catch (_) { /* relative URL, skip */ }
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch(() => fetch(request))
  );
});
