/**
 * Job deep-link source attribution — client-side only.
 *
 * When a job link includes a `?ref=<token>` query param (e.g.
 * `?ref=msg` from a message thread, `?ref=notif` from a push tap),
 * `captureJobRef` writes the token to sessionStorage once on page load.
 *
 * This is purely a client-side signal — no DB column, no migration.
 * Use `readJobRef()` to pull the last-seen ref for analytics callbacks
 * (e.g. when the user applies, we can tag the application with its
 * source in the analytics event payload).
 *
 * Token registry — add new surfaces here as the app grows:
 *   "msg"   — opened from a message thread job-context header
 *   "notif" — opened via a push notification deep-link
 *   "share" — opened via the OS Share Sheet (Capacitor or Web Share)
 *   "email" — opened from a transactional email link
 */

export type JobLinkRef = "msg" | "notif" | "share" | "email";

const KEY = "helpr_job_link_ref";
const VALID: JobLinkRef[] = ["msg", "notif", "share", "email"];

/**
 * Validate and persist the inbound `?ref=` query param.
 *
 * Call once on mount in the job detail view (via `useJobRef`).
 * Unknown tokens are silently dropped — we only store tokens from
 * the known registry so stale or crafted params don't pollute the
 * attribution data.
 *
 * Returns the captured ref, or `null` if the param is absent/invalid.
 */
export function captureJobRef(ref: string | null): JobLinkRef | null {
  if (!ref) return null;
  const r = ref as JobLinkRef;
  if (!VALID.includes(r)) return null;
  try {
    sessionStorage.setItem(KEY, r);
  } catch {
    /* storage may be unavailable in privacy-restricted contexts */
  }
  return r;
}

