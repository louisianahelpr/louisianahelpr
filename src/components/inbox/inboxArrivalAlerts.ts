import { onNotificationArrival } from "@/components/notificationPanel/notificationFeed";
import { alertNotificationArrival } from "@/components/notificationPanel/arrivalAlert";
import { isPushSupported, registerServiceWorker } from "@/lib/pushNotifications";

/**
 * What the mounted bell used to add on every signed-in page, kept now that the Inbox icon replaced it (owner 11-15):
 * the chime, vibration and hidden-tab local notification for each live arrival, and the push service worker. ONE
 * subscription however many Inbox icons and inline lists are mounted (the phone bar and the Inbox's own list can be
 * on screen together), so an arrival never chimes twice.
 */
let holders = 0;
let stop: (() => void) | null = null;

export function holdArrivalAlerts(): () => void {
  holders += 1;
  if (holders === 1) {
    stop = onNotificationArrival(alertNotificationArrival);
    if (isPushSupported()) void registerServiceWorker();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) {
      stop?.();
      stop = null;
    }
  };
}
