import { getPushPermission, showLocalNotification } from "@/lib/pushNotifications";
import { notificationDestination } from "./notificationDestination";
import type { Notification } from "./types";

/**
 * What a mounted bell adds to a live arrival: the chime, a vibration, and a
 * local notification while the tab is hidden. Moved verbatim out of
 * NotificationPanel.tsx (its god-component ratchet, Q104 landing).
 */
export function alertNotificationArrival(n: Notification) {
  // Play notification chime + vibrate
  try {
    const ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(830, ctx.currentTime);
    osc.frequency.setValueAtTime(990, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    // Browsers cap concurrent AudioContexts (~6); without this
    // the chime silently stops firing after a handful of
    // notifications. Release it once the tone finishes.
    osc.onended = () => { ctx.close().catch(() => {}); };
  } catch {
    // Best effort, never reported: no AudioContext (old WebView, autoplay policy) just means no chime;
    // the badge and the row itself still arrive. Same as when this lived in NotificationPanel.tsx.
  }
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  if (document.hidden && getPushPermission() === "granted") {
    // Same resolution as a tap in the panel — a realtime row must
    // not open somewhere different from the row it just inserted.
    showLocalNotification(n.title, n.message, notificationDestination(n) ?? undefined);
  }
}
