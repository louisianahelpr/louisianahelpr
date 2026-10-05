/**
 * WHO A CHECKOUT RETURN IS FOR (owner bug, 2026-10-05).
 *
 * A Stripe return URL names a job (`/payment-success?job_id=…`,
 * `/home?boosted=…`), and any signed-in account that can READ that job can open
 * it. An admin reads every job, so the owner, signed in to their admin account,
 * was told "Payment authorized — $10 is held securely" and offered View
 * Applicants for a job their OTHER account had paid for. The page had read the
 * job by id alone.
 *
 * The claim belongs to the person who paid: the job's poster
 * (`jobs.customer_id`). Everyone else gets an honest "this belongs to a
 * different account" state. Never role-based: an admin is just another
 * account that did not post the job. A null on either side (an anonymised
 * job whose poster deleted their account, or no session) is never a match.
 *
 * Every page that consumes an id-carrying `success_url` calls this before it
 * makes its claim (src/test/checkoutReturnsCheckThePoster.test.ts).
 */
export function isJobPoster(
  customerId: string | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  return !!customerId && !!viewerId && customerId === viewerId;
}
