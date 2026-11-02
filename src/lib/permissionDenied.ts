/**
 * Permission-denied detection, dependency-free so errorLogger can import it.
 *
 * A 42501 on a read is what a bundle built before a grant was narrowed gets
 * (src/lib/clientCompat.ts). errorLogger.report() announces every one with
 * PERMISSION_DENIED_EVENT so the update path (src/lib/staleClient.ts on web,
 * useVersionCheck on native) re-checks at once instead of leaving the user on
 * "We couldn't load this".
 */
/**
 * Postgres's own grant refusal: what an old bundle gets for a withheld column,
 * table or function. Keyed on the MESSAGE, not the code alone: 42501 is also
 * what an RLS WITH CHECK failure ("new row violates row-level security
 * policy") and the app's own RPC "not allowed" raises use (65 public functions
 * raise it on prod, lh-authz-rls review 2026-10-05). Those are ordinary
 * refusals, not a stale bundle, and must not trigger a reload.
 */
export const isPermissionDenied = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && /permission denied for (table|column|relation|view|function|sequence|schema)\b/i.test(msg);
};

/** Fired (on window) whenever a permission-denied error is reported. */
export const PERMISSION_DENIED_EVENT = "helpr:permission-denied";

/** Announce a permission-denied error. Never throws. */
export function announcePermissionDenied(err: unknown): void {
  if (!isPermissionDenied(err)) return;
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT));
  } catch {
    /* CustomEvent unavailable (very old engine): the focus/resume checks still run. */
  }
}

/**
 * SESSION-LOSS NOISE (Q1596, lead decision 2026-11-02). Once ProtectedRoute
 * has confirmed the session is gone and reported "Session lost on a signed-in
 * screen", every read that screen still has in flight goes out with the anon
 * key and is refused as "permission denied". Those refusals are the session
 * loss, already reported once, not separate errors: measured on prod
 * 2026-10-19, 10-22 and 10-30, each "Session lost" row came in one batch with
 * 1-3 denials each on up to 9 tables/functions from the same client.
 *
 * So, from the moment the loss is marked until a new sign-in on this document,
 * report() drops permission-denied errors. Scoped to this client (module
 * state, one document) and this session (cleared by SIGNED_IN; the redirect to
 * Log In reloads the page, which clears it too). A denial while the session is
 * live is never marked, so it still reports.
 */
let sessionLostMarked = false;

/**
 * HELD DENIALS (Q2295, lead-approved 2026-11-02, extends Q1596). The denial
 * that STARTS ProtectedRoute's session-loss check, and any others that arrive
 * while confirmSessionLost() runs its refresh, came before the mark, so they
 * still reported: measured on prod (read-only SQL, Builder 188), the
 * 2026-10-19 16:00:48Z batch carried "Session lost on a signed-in screen"
 * together with denials on my_schedule_clashes, get_job_offer_targets and
 * applications from the same client.
 *
 * So report() holds a grant denial instead of sending it at once:
 * - markSessionLost() drops every held one (they are that loss);
 * - a "not lost" answer (ProtectedRoute calls releaseHeldDenials()), the hold
 *   window ending, or the page going away (pagehide) sends them as before.
 * The window starts at the first held denial and is not extended, so a steady
 * stream of denials can never hold reports for longer than DENIAL_HOLD_MS.
 */
export const DENIAL_HOLD_MS = 10_000;
let heldDenials: Array<() => void> = [];
let holdTimer: ReturnType<typeof setTimeout> | null = null;

const clearHoldTimer = (): void => {
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = null;
};

/** Hold one denial's report until the session-loss check answers (or the window ends). */
export function holdDenial(send: () => void): void {
  heldDenials.push(send);
  if (holdTimer === null) holdTimer = setTimeout(releaseHeldDenials, DENIAL_HOLD_MS);
}

/** Send every held denial now (a confirmed loss already dropped them in markSessionLost). */
export function releaseHeldDenials(): void {
  clearHoldTimer();
  const sends = heldDenials;
  heldDenials = [];
  for (const send of sends) send();
}

/** How many denials are held right now (tests and diagnostics). */
export const heldDenialCount = (): number => heldDenials.length;

/**
 * SIGN-OUT NOISE (Q2507/Q2515, 2026-11-02). A sign-out the session-lost net
 * never sees (the refresh token was refused, another tab signed out): reads
 * the screen already had in flight go out with the anon key and come back
 * "permission denied" just as ProtectedRoute sends the person to Log In.
 * Measured: Sentry JAVASCRIPT-2T + JAVASCRIPT-49, one iPhone, 2026-10-22
 * 16:34:47Z, four 401s in 100-150 ms and a plain /login?redirect= (no
 * session-lost note). For SIGNED_OUT_NOISE_MS after SIGNED_OUT those denials
 * are dropped; after it, a guest page's denial reports again. Guard:
 * src/lib/errorLoggerSignedOutNoise.test.ts.
 */
export const SIGNED_OUT_NOISE_MS = 5_000;
let signedOutAt = Number.NEGATIVE_INFINITY;

/** The client calls this on SIGNED_OUT. */
export function markSignedOut(now: number = Date.now()): void {
  signedOutAt = now;
}

/** True for a permission-denied error inside the window after a sign-out. */
export const isSignedOutNoise = (err: unknown, now: number = Date.now()): boolean =>
  now - signedOutAt < SIGNED_OUT_NOISE_MS && isPermissionDenied(err);

/** ProtectedRoute calls this when it reports a confirmed session loss. */
export function markSessionLost(): void {
  sessionLostMarked = true;
  // Q2295: the denials held while the check ran are this loss too.
  clearHoldTimer();
  heldDenials.length = 0;
}

/** A new session (SIGNED_IN): denials report again. */
export function clearSessionLost(): void {
  sessionLostMarked = false;
  signedOutAt = -Infinity;
}

/** True for a permission-denied error that follows a confirmed session loss. */
export const isSessionLossNoise = (err: unknown): boolean => sessionLostMarked && isPermissionDenied(err);
