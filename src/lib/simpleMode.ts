import { safeStorage } from "@/lib/safeStorage";

/**
 * Simple Mode — a larger, calmer rendering of the whole app.
 *
 * Modelled on Uber's Simple Mode for older adults. Helpr's audience skews
 * older than a typical marketplace (storm prep, yard work, errands, care for a
 * family member), and the type scale is tuned for density: plenty of ds-10 and
 * ds-11 rungs, which are 10px and 11px. That is a lot to ask of someone who
 * would otherwise be perfectly capable of hiring a helper.
 *
 * ── How it works, and why not root font-size ───────────────────────────
 * The obvious lever — bumping `html { font-size }` — does nothing here. The
 * ds-* scale is defined in PIXELS in tailwind.config.ts, and px does not
 * respond to root font-size. Rather than convert 18 rungs to rem (which would
 * re-flow every screen in the app and invalidate the whole visual audit), this
 * toggles a class on <html> and index.css restates the smaller rungs at larger
 * values under it. Bounded, reversible, and it cannot leak into the default
 * rendering.
 *
 * Stored in safeStorage (Capacitor Preferences on device) rather than on the
 * profile: it must apply on the very first paint, before any network call, and
 * it is a per-DEVICE preference — the phone someone reads with is not
 * necessarily the tablet they book from.
 */

const STORAGE_KEY = "helpr_simple_mode";
export const SIMPLE_MODE_CLASS = "simple-mode";

export function isSimpleMode(): boolean {
  try {
    return safeStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Add/remove the class that index.css keys every override off. */
function applyClass(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(SIMPLE_MODE_CLASS, on);
}

export function setSimpleMode(on: boolean): void {
  try {
    if (on) safeStorage.setItem(STORAGE_KEY, "1");
    else safeStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort — quota / private mode. The class still applies for this
       session, so the toggle is never a no-op in front of the user. */
  }
  applyClass(on);
}

/**
 * Apply the stored preference. Called once from main.tsx before first paint.
 *
 * Deliberately synchronous and storage-read-only: anything async here would
 * let the app paint at the small size first and then jump, which is precisely
 * the experience this mode exists to avoid.
 */
export function initSimpleMode(): void {
  applyClass(isSimpleMode());
}
