import { useSyncExternalStore } from "react";

/**
 * Which side the landing leans to: "declutter" when the visit came by /#declutter (a Facebook link), else "jobs".
 * How it works opens on "Buy or sell" for a Declutter visit (preview tweak 1, 11-10).
 *
 * Owner 11-18: the hero's Jobs | Declutter tabs are gone (the one search covers both), so nothing picks a side by hand
 * any more and no pick is remembered; the jobs and the Declutter grid both show under the hero (LandingBrowseSwitch).
 */
export type LandingMode = "jobs" | "declutter";

/** The hash a shared link uses to open on Declutter: https://www.louisianahelpr.com/#declutter */
export const LANDING_DECLUTTER_HASH = "#declutter";

let current: LandingMode | null = null;
const listeners = new Set<() => void>();

/** /#declutter, else jobs. Read once per page load. */
function read(): LandingMode {
  if (current === null) current = window.location.hash === LANDING_DECLUTTER_HASH ? "declutter" : "jobs";
  return current;
}

/** Sets the landing's side (a /#declutter link followed while the landing is open). */
export function setLandingMode(mode: LandingMode): void {
  if (current === mode) return;
  current = mode;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLandingMode(): LandingMode {
  return useSyncExternalStore(subscribe, read, () => "jobs");
}

/** Tests only: forget the page-load read so the next render reads the hash again. */
export function resetLandingModeForTests(): void {
  current = null;
}
