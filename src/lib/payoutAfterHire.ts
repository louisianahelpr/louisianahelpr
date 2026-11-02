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

/**
 * A3-29 (audit 11-01): the job card's next step, on the shared next-step line: "Next: finish payout setup · your $40 is
 * held until then". No deadline: the money waits. Its one button is SET_UP_PAYOUTS_LABEL.
 */
export function jobPayoutNextStep(amountLabel: string | null): { who: "you"; text: string; by: string } {
  return { who: "you", text: "Finish payout setup", by: `your ${amountLabel ?? "pay"} is held until then` };
}
export const SET_UP_PAYOUTS_LABEL = "Set up payouts";

/** Is this profile's payout account ready (Stripe answered payouts on)? The same test the payout paths use. */
export function payoutAccountReady(profile: { stripe_account_id?: string | null; stripe_payouts_enabled?: boolean | null } | null | undefined): boolean {
  return !!profile?.stripe_account_id && profile.stripe_payouts_enabled === true;
}
