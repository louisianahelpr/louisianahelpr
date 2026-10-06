import { jobOfferCutoff, OFFER_MIN_LEAD_MINUTES } from "@/lib/offerDeadline";

/**
 * Q1378 (owner, 2026-10-05): when a member leaves a booked crew, the rest
 * carry on. The job stays booked ('accepted') and the poster may refill the
 * empty spot from their applicants before the start
 * (accept_group_application admits a booked crew with a free spot and refuses
 * one inside OFFER_MIN_LEAD_MINUTES of the start, as every hire does;
 * supabase/migrations/20261006015121_crew_rest_carry_on.sql).
 *
 * True when the poster's card should offer that refill: a booked crew whose
 * roster has fewer rows than spots, with the start far enough away for a hire.
 * Every roster row holds a spot, including a member whose account was later
 * deleted (helper_id NULL), exactly as the server counts it. An unknown roster
 * (not loaded) offers nothing rather than guessing.
 */
export function crewSpotRefillable(
  job: {
    is_group_job?: boolean | null;
    status?: string | null;
    helpers_needed?: number | null;
    date_needed?: string | null;
    start_time?: string | null;
  },
  roster: readonly unknown[] | undefined,
  now: Date = new Date(),
): boolean {
  if (!job.is_group_job || job.status !== "accepted" || !roster) return false;
  const cutoff = jobOfferCutoff(job.date_needed, job.start_time);
  if (cutoff && cutoff.getTime() <= now.getTime() + OFFER_MIN_LEAD_MINUTES * 60_000) return false;
  const needed = job.is_group_job ? Math.max(1, Math.floor(job.helpers_needed ?? 1) || 1) : 1;
  const filled = roster.length;
  return filled < needed;
}

/**
 * Whether the poster's card shows the Applicants button: an open job, or a
 * booked crew a member left (Q1378: the rest carry on and the poster may refill
 * the spot from their applicants before the start).
 */
export function takesApplicants(
  job: Parameters<typeof crewSpotRefillable>[0],
  roster: readonly unknown[] | undefined,
  now: Date = new Date(),
): boolean {
  return job.status === "open" || crewSpotRefillable(job, roster, now);
}
