/**
 * safeStorage — durable key/value storage that survives WebKit eviction.
 *
 * On iOS Capacitor, WebKit can evict `localStorage` when memory is low or
 * after a force-quit. That makes things like dismissed jobs, drafts, and
 * cooldown timers unreliable for a real app.
 *
 * This wrapper writes to BOTH `localStorage` (sync, instant) and Capacitor
 * `Preferences` (async, durable, backed by NSUserDefaults / SharedPrefs).
 * Reads stay synchronous from `localStorage` so existing call sites that
 * read inside `useState(() => ...)` keep working.
 *
 * On app boot we call `hydrate()` BEFORE React mounts: any keys present in
 * Preferences but missing from localStorage (because WebKit evicted them)
 * are copied back. This means the first render sees the durable value.
 *
 * On web, Preferences is a thin localStorage shim, so writes are effectively
 * just localStorage — no overhead, no behavior change.
 *
 * Auth tokens (`sb-*-auth-token`) are deliberately NOT routed through this:
 * Supabase manages those keys directly and would not pick up our mirror.
 */
import { Preferences } from "@capacitor/preferences";

/** Keys we want mirrored to durable Preferences storage. */
const TRACKED_KEYS = new Set<string>();

/** Whitespace-separated prefixes whose keys should also be mirrored. */
const TRACKED_PREFIXES = [
  "admin_seen_", // Admin nav "seen" timestamps
  "helpr_",      // App-wide product keys
];

function isTracked(key: string): boolean {
  if (TRACKED_KEYS.has(key)) return true;
  for (const p of TRACKED_PREFIXES) if (key.startsWith(p)) return true;
  return false;
}

/** Register an explicit key for mirroring (in addition to prefix matches). */
export function trackKey(key: string) {
  TRACKED_KEYS.add(key);
}

// All the explicit keys our app uses outside the tracked prefixes.
[
  "theme",
  "birthday_popup_dismissed",
  "greeting_dismissed_at",
  "push-prompt-dismissed",
  // High-intent push permission re-ask nudge (see pushPermissionNudge.ts).
  // Per-reason "shown" markers (push-nudge-shown:<reason>) are mirrored via
  // the trackKey() call in that module to avoid coupling this list to the
  // NudgeReason union here.
  "push-nudge-dismissed-at",
  "admin_resolved_job_flags",
  "admin_seen_user_ids_v1",
  "helpr_dismissed_jobs",
  "helpr_draft_job",
  "helpr_post_job_cooldown",
  "helpr_signup_cooldown",
  "helpr_onboarding_completed_at",
  "helpr_last_seen_at",
  "helpr_reengagement_dismissed_at",
  "helpr_do_not_sell",
  "helpr_ppo_attribution",
  "helpr_in_app_review_last",
  "helpr_email_verified", // prefix base for `${EMAIL_VERIFIED_KEY}_${userId}`
  "helpr_onboarding_state",
].forEach(trackKey);

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore quota / private mode */ }
}

function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Mirror a write into Capacitor Preferences. Fire-and-forget: callers
 * remain synchronous, durability happens on the next microtask.
 */
function mirrorSet(key: string, value: string) {
  Preferences.set({ key, value }).catch(() => { /* best-effort */ });
}

function mirrorRemove(key: string) {
  Preferences.remove({ key }).catch(() => { /* best-effort */ });
}

export const safeStorage = {
  /** Synchronous read — same semantics as localStorage.getItem. */
  getItem(key: string): string | null {
    return safeGet(key);
  },

  /** Synchronous write that ALSO mirrors to durable Preferences. */
  setItem(key: string, value: string) {
    safeSet(key, value);
    if (isTracked(key)) mirrorSet(key, value);
  },

  /** Synchronous remove that ALSO clears from durable Preferences. */
  removeItem(key: string) {
    safeRemove(key);
    if (isTracked(key)) mirrorRemove(key);
  },
};

/**
 * Restore tracked keys from Preferences into localStorage.
 *
 * Call once during app boot, BEFORE React mounts, so the first render of
 * any component that reads from localStorage sees the durable values.
 *
 * Strategy: list all keys in Preferences, and for each tracked key NOT
 * already present in localStorage, copy it back. We don't overwrite — if
 * localStorage has a value, that's the most recent write.
 */
/**
 * Memoized so ANY caller can await the same hydration rather than starting a
 * second pass. Needed by consumers for which the "read a sensible default on
 * first render" contract above is unsafe — specifically the app lock
 * (`lib/appLock.ts`), where the default is the INSECURE state: a synchronous
 * read that misses the durable value silently leaves the app unlocked. Those
 * consumers await `hydrate()` before deciding.
 */
let hydratePromise: Promise<void> | null = null;

/**
 * Await the app's ONE hydration pass.
 *
 * Separate from `hydrate()` — which stays un-memoized so existing callers and
 * tests keep their "run it again" semantics — because memoizing that would
 * silently change its contract.
 */
export function ensureHydrated(): Promise<void> {
  if (!hydratePromise) hydratePromise = hydrate();
  return hydratePromise;
}

export async function hydrate(): Promise<void> {
  try {
    const { keys } = await Preferences.keys();
    if (!keys?.length) return;

    await Promise.all(
      keys.map(async (key) => {
        if (!isTracked(key)) return;
        // localStorage is the source of truth when present (last write wins).
        if (safeGet(key) !== null) return;
        try {
          const { value } = await Preferences.get({ key });
          if (value !== null && value !== undefined) safeSet(key, value);
        } catch { /* ignore individual key failures */ }
      })
    );
  } catch {
    // Preferences unavailable (very old WebView, unusual env) — fall back
    // to localStorage-only behavior. Non-fatal.
  }
}
