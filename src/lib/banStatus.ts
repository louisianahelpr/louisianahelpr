/**
 * One definition of "is this account locked out right now".
 *
 * `temp_banned` is a TIMED state: the strike ladder sets
 * `ban_status = 'temp_banned'` plus `auto_suspended_until = now() + 7 days`,
 * and a server-side sweeper (`20260506175614_trigger_respects_existing_bans_and_expiry_sweeper`)
 * flips the row back to `active` once the window has passed. That sweeper is
 * scheduled, not instantaneous — so between the moment a suspension actually
 * ends and the moment the sweep runs, the row still says `temp_banned` while
 * the suspension is over.
 *
 * ProtectedRoute used to test membership in the ban-status list alone, so that
 * gap became up to a full sweep interval of extra lockout for a user whose
 * penalty had already expired — the app told them they were suspended and
 * showed them a date in the past. StrikeBanner already read the timestamp
 * (`StrikeBanner.tsx`); the route gate did not. This is the shared carve-out.
 *
 * Deliberately narrow: `banned` and `permanently_banned` are UNTIMED and are
 * never released here, whatever `auto_suspended_until` holds. A manual ban
 * leaves that column NULL, and a NULL is not an expiry — it is "no expiry".
 *
 * The server-side triggers and RLS are untouched by this; this only stops the
 * CLIENT from over-enforcing a penalty the server has already let lapse.
 */
export const LOCKOUT_BAN_STATUSES = ["banned", "temp_banned", "permanently_banned"] as const;

export function isLockedOut(
  banStatus: string | null | undefined,
  autoSuspendedUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!banStatus) return false;
  if (!(LOCKOUT_BAN_STATUSES as readonly string[]).includes(banStatus)) return false;

  if (banStatus === "temp_banned") {
    // No timestamp at all → treat as locked out. An admin-set temp ban with no
    // expiry is still a ban, and failing open on a missing column would be the
    // wrong direction to guess in.
    if (!autoSuspendedUntil) return true;
    const until = new Date(autoSuspendedUntil);
    if (Number.isNaN(until.getTime())) return true; // unparseable → fail closed
    return until > now;
  }

  return true;
}
