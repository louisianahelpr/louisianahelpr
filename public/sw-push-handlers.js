// Web push handlers, loaded INTO the one service worker the website runs (the
// Workbox /sw.js vite-plugin-pwa generates) by `workbox.importScripts` in
// vite.config.ts. There is no second registration: two service workers cannot
// share the "/" scope, and registering /sw-push.js beside /sw.js made each
// replace the other (B58 plan, 2026-10-29).
//
// The payload is what send-push-notification encrypts (supabase/functions/
// _shared/webPush.ts): { title, message, link, tag }.
//
// A NULL LINK MEANS "NO DESTINATION", never "/home" (the same rule as
// showLocalNotification in src/lib/pushNotifications.ts, NotificationPanel and
// nativePush.ts): no link, no navigation.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // A push that is not JSON still has to show SOMETHING: browsers punish a
    // push that shows no notification (userVisibleOnly) by revoking it.
    console.error("[sw-push-handlers] push payload is not JSON", err);
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Helpr";
  const link = typeof data.link === "string" && data.link.startsWith("/") ? data.link : null;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.message === "string" && data.message ? data.message : "You have a new notification",
      icon: "/apple-touch-icon.png",
      badge: "/favicon-32.png",
      data: { link },
      tag: typeof data.tag === "string" && data.tag ? data.tag : "helpr-notification",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.link;
  const link = typeof raw === "string" && raw.startsWith("/") ? raw : null;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          // A tab is open: bring it forward, and go to the link if there is one.
          if (link && "navigate" in client) client.navigate(link);
          return client.focus();
        }
      }
      // No window: open the link, or the app's root when there is none (an
      // inert click reads as a broken notification).
      return self.clients.openWindow(link || "/");
    }),
  );
});
