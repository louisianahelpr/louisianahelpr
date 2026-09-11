// Service Worker for browser push notifications + offline support

const CACHE_NAME = 'helpr-offline-v5';
const OFFLINE_URL = '/offline.html';

// Cache offline page on install — always activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Clean up ALL old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation — never serve stale HTML
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request);
        } catch (err) {
          // A rejected fetch does NOT mean the user is offline — it also
          // throws on a transient server hiccup, an aborted navigation, or
          // (in dev) the dev server restarting mid-request. Retry once
          // before concluding the network is actually down, and only fall
          // back to the offline page when the browser itself agrees there's
          // no connection (navigator.onLine) — otherwise let the real error
          // surface instead of telling the user they're offline when
          // they're not. `self.navigator.onLine` is available in a service
          // worker's global scope (WorkerNavigator), same API as the page.
          try {
            return await fetch(event.request);
          } catch {
            if (self.navigator.onLine === false) {
              const cached = await caches.match(OFFLINE_URL);
              if (cached) return cached;
            }
            throw err;
          }
        }
      })(),
    );
  }
});

// Push notification handling
//
// A NULL LINK MEANS "NO DESTINATION" — it does not mean "/dashboard".
// Both this file and `showLocalNotification` in src/lib/pushNotifications.ts
// used to substitute `/dashboard` for a missing link, while the two readers
// that matter — `NotificationPanel.handleClick` and `nativePush.ts`, the one
// that actually runs in the shipped iOS app — navigate only when the link
// `startsWith("/")` and otherwise stay put. The same notification therefore
// went somewhere via web push and nowhere in-app. `/dashboard` is a guess, and
// for the rows in prod that carry `link: null` it is the wrong one. All three
// now agree: no link, no navigation.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Helpr";
  const link = typeof data.link === "string" && data.link.startsWith("/") ? data.link : null;
  const options = {
    body: data.message || "You have a new notification",
    icon: "/apple-touch-icon.png",
    badge: "/favicon-32.png",
    data: { link },
    tag: data.tag || "helpr-notification",
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data?.link;
  const link = typeof raw === "string" && raw.startsWith("/") ? raw : null;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          // With no destination, bring the tab they already have forward and
          // leave it exactly where it was. That is the browser equivalent of
          // what tapping a link-less notification does in the app and on
          // native: the app comes to the front, nothing navigates.
          if (link) client.navigate(link);
          return client.focus();
        }
      }
      // No window open at all. A notification click has to open SOMETHING —
      // an inert click reads as a broken notification — so with no link we
      // open the app's root and let it route to the normal post-auth landing,
      // rather than asserting a page the notification never named.
      return clients.openWindow(link || "/");
    })
  );
});
