'use strict';
/* KoboFlow service worker (production).
   Isolation rules — several apps share the uniqueapps-dev.github.io origin and
   therefore share one CacheStorage:
   - This worker owns only caches whose name starts with APP_PREFIX.
   - It deletes only its own older versions, never another app's caches.
   - It reads only from its own cache (never the origin-wide caches.match).
   - Page loads are network-first, so a new release is picked up on the next
     online open and a cache wiped by another app refills itself.
   Financial data lives in IndexedDB and is never touched here. */
var APP_PREFIX = 'koboflow-prod-';
var VERSION = '3.2.0';
var CACHE = APP_PREFIX + VERSION;
var SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
var SCOPE_PATH = new URL('./', self.location).pathname;

function ownCache() { return caches.open(CACHE); }
function fillShell() { return ownCache().then(function (c) { return c.addAll(SHELL); }); }
function ensureShell() {
  return ownCache().then(function (c) {
    return c.match('./index.html').then(function (hit) { return hit ? null : c.addAll(SHELL); });
  }).catch(function () {});
}

self.addEventListener('install', function (e) {
  e.waitUntil(fillShell().then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf(APP_PREFIX) === 0 && k !== CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.indexOf(SCOPE_PATH) !== 0) return; // not ours

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        e.waitUntil(ownCache().then(function (c) { return c.put('./index.html', copy); }).then(ensureShell));
      }
      return res;
    }).catch(function () {
      return ownCache().then(function (c) {
        return c.match('./index.html').then(function (hit) { return hit || c.match('./'); });
      }).then(function (hit) { return hit || new Response('KoboFlow is offline and not cached yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); });
    }));
    return;
  }

  e.respondWith(ownCache().then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          e.waitUntil(c.put(req, copy));
        }
        return res;
      });
    });
  }).catch(function () { return Response.error(); }));
});
