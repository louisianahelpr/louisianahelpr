/**
 * Payout setup after the hire (owner decision 2026-10-25; copy approved by the
 * lead 2026-10-25 with "a few minutes", never a promised time: Stripe's review
 * can take longer). Behind the hidden switch `payout_after_hire` (migration
 * 20261025162003, created testers): the accept goes through at once and the
 * Helpr's pay is held until their payout account is ready.
 *
 * One sentence set, for whoever was hired: never addressed to Helprs or
 * posters only. The reminder notices and emails use the same words
 * (supabase/functions/_shared/payoutSetupReminder.ts; the guard
 * src/test/payoutAfterHire.test.ts keeps them equal).
 */
export const HIRED_PAYOUT_TITLE = "You're hired. Set up payouts to get paid.";
export const HIRED_PAYOUT_BODY =
  "The job is yours. Stripe checks your ID and adds your bank in one short step, a few minutes, once. Your pay for this job is held safely until it's done.";
/** While payout setup is paused for everyone (switch payout_setup off). */
export const HIRED_PAYOUT_PAUSED_TITLE = "You're hired.";
export const HIRED_PAYOUT_PAUSED_BODY = "The job is yours. Your pay for this job is held safely until your payout account is ready.";
export const FINISH_PAYOUT_SETUP_LABEL = "Finish payout setup";
export const JOB_PAYOUT_SETUP_HEADLINE = "Finish payout setup to get paid.";

/** The job's line: "Your $X for this job is held until your payout account is ready." */
export function jobPayoutHeldLine(amountLabel: string | null): string {
  return `Your ${amountLabel ?? "pay"} for this job is held until your payout account is ready.`;
}

/** Is this profile's payout account ready (Stripe answered payouts on)? The same test the payout paths use. */
export function payoutAccountReady(profile: { stripe_account_id?: string | null; stripe_payouts_enabled?: boolean | null } | null | undefined): boolean {
  return !!profile?.stripe_account_id && profile.stripe_payouts_enabled === true;
}
