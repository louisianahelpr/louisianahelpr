/**
 * Expired is not cancelled (owner 10-31 ~18:30: "people shouldnt see on my
 * profile that the job was cancelled").
 *
 * auto-expire-jobs closes a listing whose time passed with no Helpr as
 * status 'cancelled' with one fixed reason (supabase/functions/
 * auto-expire-jobs/index.ts). That job was never cancelled by anyone: it is
 * never shown as "Cancelled" and never counted as a cancellation. Only its
 * poster sees it, as "Expired", with Repost. The same rule is in SQL in
 * get_public_profile_stats (20261031234653).
 *
 * The reason text alone is free text a poster could type, so the sweep's real
 * marker is cancelled_by: auto-expire-jobs never sets it and poster_cancel_job
 * always does. A row read without cancelled_by is treated as unset.
 */
export const EXPIRED_LISTING_REASON_PREFIX = "Job listing expired";

export function isExpiredListing(job: {
  status?: string | null;
  helper_id?: string | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
}): boolean {
  return (
    job.status === "cancelled" &&
    !job.helper_id &&
    !job.cancelled_by &&
    (job.cancellation_reason ?? "").startsWith(EXPIRED_LISTING_REASON_PREFIX)
  );
}

/**
 * PostgREST `or` filter for a count of REAL cancellations: a cancelled row
 * stays unless it is an unfilled expired listing (a person cancelled it, or it
 * had a Helpr, or its reason is not the sweep's).
 */
export const NOT_AN_EXPIRED_LISTING_FILTER = `helper_id.not.is.null,cancelled_by.not.is.null,cancellation_reason.is.null,cancellation_reason.not.like."${EXPIRED_LISTING_REASON_PREFIX}*"`;

/**
 * The same, for a count over EVERY status (Jobs posted): any row that is not
 * cancelled stays, and a cancelled one stays unless it is an expired listing.
 */
export const NOT_AN_EXPIRED_LISTING_ANY_STATUS = `status.neq.cancelled,${NOT_AN_EXPIRED_LISTING_FILTER}`;
