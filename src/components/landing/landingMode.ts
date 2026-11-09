import { useSyncExternalStore } from "react";

/**
 * The landing's one Jobs | Declutter choice, shared by the hero search (F012, owner's UI audit 11-09: the hero searched
 * only jobs) and the switch under the hero (LandingBrowseSwitch, owner 11-08). Picking Declutter in either one turns
 * both: the hero's box says "Search Declutter" and the section under it shows the Declutter grid.
 *
 * The visitor's last pick is remembered in this browser (localStorage, best effort), and /#declutter opens on Declutter.
 */
export type LandingMode = "jobs" | "declutter";

export const LANDING_MODE_KEY = "lh.landing.mode";
/** The hash a shared link uses to open on Declutter: https://www.louisianahelpr.com/#declutter */
export const LANDING_DECLUTTER_HASH = "#declutter";

/** The remembered pick, or null (none saved, or storage unavailable: a private window, blocked site data). */
function readSavedMode(): LandingMode | null {
  try {
    const v = window.localStorage.getItem(LANDING_MODE_KEY);
    return v === "jobs" || v === "declutter" ? v : null;
  } catch {
    // Storage can throw in a private window or with site data blocked: no remembered pick, so the default (jobs).
    return null;
  }
}

function saveMode(mode: LandingMode) {
  try {
    window.localStorage.setItem(LANDING_MODE_KEY, mode);
  } catch {
    // Remembering is a convenience only: the switch still works for this visit when storage is unavailable.
  }
}

let current: LandingMode | null = null;
const listeners = new Set<() => void>();

/** /#declutter wins; then the remembered pick; then jobs. Read once per page load. */
function read(): LandingMode {
  if (current === null) current = window.location.hash === LANDING_DECLUTTER_HASH ? "declutter" : readSavedMode() ?? "jobs";
  return current;
}

/** Sets the shared choice; `remember` saves it as the visitor's pick (a /#declutter link does not). */
export function setLandingMode(mode: LandingMode, remember = true): void {
  if (remember) saveMode(mode);
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

/** Tests only: forget the page-load read so the next render reads hash and storage again. */
export function resetLandingModeForTests(): void {
  current = null;
}
