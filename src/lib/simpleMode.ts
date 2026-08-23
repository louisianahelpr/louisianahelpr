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
 *
 * ── The OS drives this; the toggle only overrides it ───────────────────
 * Apple's HIG expects Dynamic Type: a user who enlarges text in
 * Settings > Display & Brightness gets larger text in every app, without
 * hunting for a per-app switch. This app shipped the accommodation but made
 * the user find it at /accessibility, which for the audience it was built for
 * (see above) is close to not shipping it at all.
 *
 * So the preference is now TRI-state:
 *   "1"     — user explicitly turned it ON  → always on
 *   "0"     — user explicitly turned it OFF → always off, even if iOS asks
 *   absent  — no opinion → FOLLOW THE OS
 *
 * The explicit-off state is why absence and "0" have to be distinguishable:
 * without it, someone with large system text who deliberately turned this off
 * would have it switched back on at every launch.
 */

const STORAGE_KEY = "helpr_simple_mode";
export const SIMPLE_MODE_CLASS = "simple-mode";

/** iOS default body size. Dynamic Type scales this: 17 → 19/21/23/28/33/40/53. */
const IOS_DEFAULT_BODY_PX = 17;
/** First rung that means "this person asked for bigger text", not just a nudge. */
const ENLARGED_BODY_PX = 20;

/**
 * The OS body text size, in px, as WebKit reports it.
 *
 * `font: -apple-system-body` is the one CSS hook that reflects the Dynamic
 * Type setting inside a WKWebView — no native bridge needed. Measured rather
 * than assumed, because it is the only way to read the setting from JS.
 *
 * Returns null off-Apple (or if the shorthand is not understood), where the
 * value would be meaningless: a browser that does not implement it falls back
 * to the default font size, which would read as "not enlarged" anyway.
 */
function osBodyPx(): number | null {
  if (typeof document === "undefined") return null;
  try {
    const probe = document.createElement("span");
    // `font:` shorthand — the -apple-system-* keywords only work as a whole
    // font shorthand, not as `font-family`.
    probe.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;visibility:hidden;font:-apple-system-body;";
    probe.textContent = "M";
    document.documentElement.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/** True when the OS asks for noticeably larger text than the iOS default. */
export function osWantsLargeText(): boolean {
  const px = osBodyPx();
  if (px === null) return false;
  // Guard against a browser that resolves the keyword to something unrelated:
  // only trust a value in the plausible Dynamic Type band.
  if (px < IOS_DEFAULT_BODY_PX) return false;
  return px >= ENLARGED_BODY_PX;
}

/** The user's explicit choice, or null when they have not made one. */
function storedPreference(): boolean | null {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function isSimpleMode(): boolean {
  const explicit = storedPreference();
  return explicit !== null ? explicit : osWantsLargeText();
}

/** Whether the CURRENT state came from the OS rather than a stored choice. */
export function isSimpleModeFromOS(): boolean {
  return storedPreference() === null && osWantsLargeText();
}

/** Add/remove the class that index.css keys every override off. */
function applyClass(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(SIMPLE_MODE_CLASS, on);
}

export function setSimpleMode(on: boolean): void {
  try {
    // "0", not removeItem. Removing would return the user to "follow the OS",
    // so someone with large system text who deliberately switched this OFF
    // would find it back on at the next launch.
    safeStorage.setItem(STORAGE_KEY, on ? "1" : "0");
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

  // Dynamic Type can change while the app is merely backgrounded — the user
  // goes to Settings, drags the slider, comes back. Without this the app would
  // keep the size it launched with until it was force-quit.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) applyClass(isSimpleMode());
    });
  }
}
