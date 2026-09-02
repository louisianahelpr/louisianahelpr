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
// "senior-mode" — the merged class (owner, 2026-08-24). Simple Mode and
// Senior Mode were two names for one larger-type feature; Senior survived.
// This module keeps what it alone provides: first-paint application from
// device storage / OS text size, before React or the profile has loaded.
const SIMPLE_MODE_CLASS = "senior-mode";

/**
 * iOS default body size ("Large"). Dynamic Type scales this: 17 → 19/21/23/
 * 28/33/40/53. Exported because it is the divisor for the continuous text
 * scale in accessibility.ts — same constant, same probe, one definition.
 */
export const IOS_DEFAULT_BODY_PX = 17;
/** First rung that means "this person asked for bigger text", not just a nudge. */
const ENLARGED_BODY_PX = 20;
/**
 * Plausible Dynamic Type band. iOS body runs 14px (xSmall) to 53px (AX5); the
 * margin either side is slack, not a claim about a rung that exists.
 */
const MIN_BODY_PX = 10;
const MAX_BODY_PX = 60;
/**
 * Inherited size given to the probe's host — outside the band above, so a
 * browser that ignores `font: -apple-system-body` hands it straight back and
 * is recognised as "no reading" rather than as 16px of real measurement.
 */
const SENTINEL_PX = 99;

/**
 * The OS body text size, in px, as WebKit reports it — or null off-Apple.
 *
 * `font: -apple-system-body` is the one CSS hook that reflects the Dynamic
 * Type setting inside a WKWebView — no native bridge needed. The root
 * font-size does NOT: `getComputedStyle(root).fontSize` stays pinned at 16px
 * however large the user's OS text setting is.
 *
 * ── Why the sentinel, and not `CSS.supports` ───────────────────────────
 * A browser that does not implement the keyword drops the declaration and
 * leaves the probe at its INHERITED size, which reads back as a perfectly
 * plausible measurement (16px) rather than as "no data". Something has to
 * distinguish the two.
 *
 * `CSS.supports("font", "-apple-system-body")` is the obvious discriminator
 * and it is the wrong one: WebKit has shipped versions that answer false for
 * the system-font keywords in the `font` shorthand while still resolving them.
 * Gating on it throws away a good measurement on exactly the platform this
 * exists to read — a silent false negative that leaves Dynamic Type users at
 * scale 1.0 forever.
 *
 * So: give the probe's host an inherited size no Dynamic Type rung can
 * produce. If the keyword is honored we get 14–53; if it is ignored we get the
 * sentinel back and answer null. No feature query, no platform sniff.
 *
 * This is the single Dynamic Type probe for the app. accessibility.ts consumes
 * it for the continuous `--user-text-scale`; the boolean below is the same
 * measurement thresholded. They used to be two implementations with two
 * different gates and two different thresholds, which agreed by coincidence.
 */
export function osBodyPx(): number | null {
  if (typeof document === "undefined" || !document.documentElement) return null;
  try {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;visibility:hidden;" +
      "pointer-events:none;height:0;overflow:hidden;" +
      `font-size:${SENTINEL_PX}px;`;
    const probe = document.createElement("span");
    // `font:` shorthand — the -apple-system-* keywords only work as a whole
    // font shorthand, not as `font-family`.
    probe.style.cssText = "font: -apple-system-body;";
    probe.textContent = "M";
    host.appendChild(probe);
    document.documentElement.appendChild(host);
    const px = parseFloat(getComputedStyle(probe).fontSize);
    host.remove();
    // The sentinel comes back untouched when the keyword was dropped; anything
    // outside the Dynamic Type band is not a reading we should act on.
    if (!Number.isFinite(px) || px < MIN_BODY_PX || px > MAX_BODY_PX) return null;
    return px;
  } catch {
    return null;
  }
}

/** True when the OS asks for noticeably larger text than the iOS default. */
function osWantsLargeText(): boolean {
  const px = osBodyPx();
  return px !== null && px >= ENLARGED_BODY_PX;
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

/**
 * The account-level `profiles.senior_mode` flag, mirrored here.
 *
 * App.tsx owns the VALUE (it arrives over the network, long after boot); this
 * module owns the DECISION, because it is also the only thing that has to make
 * that decision before React exists. Splitting those was the bug: App.tsx
 * resolved `profileSenior || osLargeText` and wrote the result straight to the
 * class list, which silently discarded the device preference `initSimpleMode()`
 * had just honoured. Traced 2026-09-01 by patching `DOMTokenList.toggle` with
 * `helpr_simple_mode: "1"` stored:
 *
 *   t=141ms  applyClass (simpleMode.ts)  force:true    ← device pref honoured
 *   t=164ms  App.tsx                     force:false   ← and thrown away
 *   t=192ms  App.tsx                     force:false
 *   final: no class on <html>
 *
 * So the toggle at /profile?tab=accessibility appeared to work — the class went
 * on, the page got bigger — and was undone ~23ms later, on every launch, for
 * every user who was not ALSO carrying the profile flag or an enlarged OS text
 * size. One resolver, one writer, and the inputs can no longer clobber each
 * other.
 */
let profileSeniorMode = false;

/**
 * Resolve the mode from all three inputs.
 *
 *   1. An explicit per-device choice wins outright. That is the entire reason
 *      turning it off stores "0" instead of removing the key (see setSimpleMode
 *      below): someone who deliberately switched this OFF on this phone must
 *      not have it forced back on by their account flag or by the OS at the
 *      next launch.
 *   2. Otherwise the account opt-in turns it on.
 *   3. Otherwise the OS's Dynamic Type setting does.
 *
 * `osLargeText` is a parameter because App.tsx also watches the OS text size,
 * via the continuous `--user-text-scale`. It is OR'd rather than swapped so the
 * pre-React path, which has no hook to read, still gets an answer.
 *
 * Both sides now come off the SAME `osBodyPx()` reading, so they cannot
 * disagree: App.tsx's `scale >= 1.2` is px >= 20.4, which is a strict subset of
 * this file's `px >= 20`. That subsumption is why the OR is safe — and it is
 * worth stating, because it did not used to hold. The two used to be separate
 * probes with separate platform gates: App.tsx's required
 * `CSS.supports("font","-apple-system-body")`, which WebKit can deny while
 * still resolving the keyword, so on a real iOS device the account-side input
 * could read "not enlarged" while this one read "enlarged". They agreed by
 * coincidence, not construction. Now there is one probe.
 */
function isSimpleMode(osLargeText = false): boolean {
  const explicit = storedPreference();
  if (explicit !== null) return explicit;
  return profileSeniorMode || osLargeText || osWantsLargeText();
}

/**
 * The single writer. App.tsx calls this whenever the profile or the measured
 * Dynamic Type scale changes; everything else keeps flowing through the
 * resolver above, so a later call can never drop an input an earlier one set.
 */
export function syncSeniorMode(input: {
  profileSenior: boolean;
  osLargeText: boolean;
}): void {
  profileSeniorMode = input.profileSenior;
  applyClass(isSimpleMode(input.osLargeText));
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
  //
  // This re-resolve reads `profileSeniorMode` too, which is what stops it being
  // a second copy of the boot bug: before the resolver existed it consulted
  // only device storage and the OS probe, so returning from the background
  // stripped the class off any user whose Senior Mode came from their PROFILE
  // rather than from this device. Same erasure as App.tsx's, on a different
  // trigger, and it would have outlived a fix to App.tsx alone.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) applyClass(isSimpleMode());
    });
  }
}
