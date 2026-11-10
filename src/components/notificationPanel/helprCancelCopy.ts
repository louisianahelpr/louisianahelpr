/**
 * Is this stored notice the HELPR's copy of a job cancel? The bell gives that row "View" (the Helpr never owns the
 * job, so "Repost" would offer a poster-only action to the wrong person).
 *
 * MATCHES STORED TEXT, not copy this app owns: Postgres writes these bodies (`poster_cancel_job`,
 * `notify_on_job_update`). Since 20260925143327 they say "cancelled by the person who posted it"; rows stored before
 * it say "cancelled by the poster" and always will, so both match. F176 (20261109231855): notify_on_job_update now
 * says who cancelled, so its copy can also read '"<job>" was cancelled by our team.', '... was cancelled after our
 * team decided the dispute.' or just '... was cancelled.'; those are matched on the title AND the whole sentence, so
 * a poster's own "Job cancelled" notice (which goes on to say more) is not caught.
 */
const CANCELLED_BY_POSTER_NEEDLES = ["cancelled by the poster", "cancelled by the person who posted"] as const;
const HELPR_CANCEL_NOTICE_TAIL = /" was cancelled(?: by our team| after our team decided the dispute)?\.$/;

export function isHelprCancelCopy(n: { type: string; title: string; message: string }): boolean {
  if (n.type !== "warning") return false;
  const lower = n.message.toLowerCase();
  if (CANCELLED_BY_POSTER_NEEDLES.some((needle) => lower.includes(needle))) return true;
  return n.title === "Job cancelled" && HELPR_CANCEL_NOTICE_TAIL.test(n.message);
}
