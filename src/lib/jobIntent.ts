import { safeStorage, trackKey } from "@/lib/safeStorage";
import { safeInternalRedirect } from "@/lib/authRedirects";

/**
 * "The job I tapped before you asked me to sign up."
 *
 * Both guest browse feeds wall a card tap behind signup — `/browse`
 * (DashboardGuest, the native guest feed) and `/jobs` (the web one). Both pass
 * `?job=<id>` along to `/signup`, and both used to describe that param as the
 * thing that "bounces them back to the job they were actually interested in".
 * Nothing implemented it: Signup.tsx read `type`, `invite` and `ref` and never
 * `job`, so the visitor created an account and landed on a bare dashboard with
 * no trace of the job that motivated them. This module is that missing piece.
 *
 * Why storage and not just the URL: signup does not end at signup. It ends at
 * `/signup-pending`, and the visitor then leaves the app entirely to click a
 * verification link in their email — on native, often after the process has
 * been killed. A query param cannot survive that round-trip. A tracked
 * safeStorage key can: `trackKey` mirrors it into Capacitor Preferences, so it
 * outlives both a reload and an app restart.
 *
 * Consumed at exactly two points, both of which are "the moment a session
 * first exists": Login's post-sign-in redirect and Signup's
 * already-authenticated bounce. Reading is destructive (`takeJobIntent`) so a
 * stale intent can never hijack a later, unrelated sign-in.
 */
const KEY = "helpr.jobIntent";

// Mirror to durable Preferences — the whole point is surviving the email
// round-trip, which on native can include the app being terminated.
trackKey(KEY);

/** Remember the job a logged-out visitor tapped, before sending them to signup. */
export function rememberJobIntent(jobId: string): void {
  if (!jobId) return;
  safeStorage.setItem(KEY, jobId);
}

/**
 * Read and clear the pending job intent. Destructive on purpose: an intent is
 * good for the next sign-in only. Leaving it behind would mean a visitor who
 * abandoned signup in March gets yanked into that job's apply sheet in May.
 */
export function takeJobIntent(): string | null {
  const id = safeStorage.getItem(KEY);
  if (id) safeStorage.removeItem(KEY);
  return id || null;
}

/**
 * The post-authentication destination, honoring a pending job intent.
 *
 * Returns `fallback` when there is no intent. When there is one, returns the
 * dashboard with the job's apply sheet open — the same target JobDetail.tsx
 * sends signed-in visitors to, so a guest who tapped a job and a member who
 * opened a shared link converge on one screen.
 *
 * Note this still lands on the home dashboard, which is what Login's
 * `postLoginDest` comment requires ("log in → home"); the job rides in as a
 * param rather than replacing the destination.
 */
export function postAuthDestination(fallback = "/dashboard"): string {
  // A full destination path (`?redirect=`) is more specific than a bare job
  // id, so it wins. Both reads are destructive, so a session only ever spends
  // one of them and neither can fire again on an unrelated later sign-in.
  const path = takeSignupRedirect();
  const id = takeJobIntent();
  if (path) return path;
  return id ? `/dashboard?quickApply=${encodeURIComponent(id)}` : fallback;
}

/**
 * The same idea as the job intent above, one level more general: the exact
 * in-app path the visitor was trying to reach when the signup wall stopped
 * them (`/signup?redirect=/jobs/<id>`).
 *
 * SECURITY: the value arrives from the query string, so it is attacker
 * controllable — a crafted `/signup?redirect=https://evil.com` link is a
 * classic open redirect. It is run through `safeInternalRedirect` TWICE:
 * once here before it is ever written to storage, and again in
 * `takeSignupRedirect` before anything navigates to it. Validating on read as
 * well as on write means a value planted directly into localStorage (or left
 * behind by an older, laxer build) still cannot bounce a user off-site.
 */
const REDIRECT_KEY = "helpr.signupRedirect";
trackKey(REDIRECT_KEY);

/** Remember where a logged-out visitor was headed, before sending them to signup. */
export function rememberSignupRedirect(raw: string | null | undefined): void {
  const safe = safeInternalRedirect(raw);
  if (!safe) return; // off-site / malformed → fall back to the normal landing
  safeStorage.setItem(REDIRECT_KEY, safe);
}

/** Read, clear, and RE-validate the pending redirect. Destructive on purpose. */
export function takeSignupRedirect(): string | null {
  const raw = safeStorage.getItem(REDIRECT_KEY);
  if (raw !== null) safeStorage.removeItem(REDIRECT_KEY);
  return safeInternalRedirect(raw);
}

/** Build the `/signup` URL that carries a visitor's intended destination. */
export function signupUrlFor(path?: string | null): string {
  const safe = safeInternalRedirect(path);
  return safe ? `/signup?redirect=${encodeURIComponent(safe)}` : "/signup";
}


/**
 * "…and I wanted it SAVED, not just seen."
 *
 * The guest save hook (owner, 2026-08-24): a logged-out visitor tapping the
 * bookmark shouldn't dead-end — the tap is the strongest interest signal a
 * guest can give. Same storage rules as the job intent above (tracked key,
 * survives the verification round-trip, destructive read), consumed by
 * `consumePendingSave` from the authed bounce targets.
 */
const SAVE_KEY = "helpr.pendingSaveJob";
trackKey(SAVE_KEY);

export function rememberPendingSave(jobId: string): void {
  if (!jobId) return;
  safeStorage.setItem(SAVE_KEY, jobId);
}

/** Read-and-clear the pending save. */
export function takePendingSave(): string | null {
  const v = safeStorage.getItem(SAVE_KEY);
  if (v) safeStorage.removeItem(SAVE_KEY);
  return v || null;
}
