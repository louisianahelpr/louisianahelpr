/**
 * Payout setup pause (owner ruling by pop-up, 2026-10-23).
 *
 * Stripe closed Helpr's platform account on 2026-10-23 ("You cannot create new
 * accounts because your account has been rejected", function_logs). The owner
 * paused ONLY Helpr payout-account setup: creating a Connect account and every
 * Account Link (onboard, update_onboarding, reset, and the non-Express arm of
 * dashboard). Posting and paying for jobs are untouched.
 *
 * The switch is the hidden feature switch `payout_setup` (migration
 * 20261023201657), created OFF; OFF is the pause. The decision is the same one
 * the app asks (featureEnabledForUser -> public.feature_enabled_for_user), for
 * the VERIFIED caller, and it fails CLOSED: an RPC error reads as paused, so
 * no Stripe setup call is made on an answer the server could not read.
 *
 * The app shows PayoutSetupPausedNotice before any of this is reached
 * (usePayoutSetupPaused); this refusal is what stops an old app build or a
 * direct call. Guard: src/test/payoutSetupPausedEntryPoints.test.ts.
 */
import { featureEnabledForUser, type FeatureSwitchClient, type VerifiedUser } from "./featureSwitch.ts";

export const PAYOUT_SETUP_SWITCH = "payout_setup";

/** The machine code of the refusal (409). */
export const PAYOUT_SETUP_PAUSED_CODE = "payout_setup_paused";

/**
 * The same words as src/components/payouts/PayoutSetupPausedNotice.tsx
 * (PAYOUT_SETUP_PAUSED_COPY; the guard keeps the two equal), so an old app
 * build that toasts the `error` field still reads the calm notice.
 */
export const PAYOUT_SETUP_PAUSED_MESSAGE =
  "Payout setup is paused while our payment provider reviews our account. Your profile and jobs are not affected. We'll let you know when it's back.";

/** The stripe-connect actions that create a Connect account or an Account Link. */
export const PAYOUT_SETUP_ACTIONS: ReadonlySet<string> = new Set(["onboard", "update_onboarding", "reset"]);

/** True while payout setup is paused for this caller (switch off, or unreadable). */
export async function payoutSetupPausedFor(client: FeatureSwitchClient, user: VerifiedUser): Promise<boolean> {
  return !(await featureEnabledForUser(client, PAYOUT_SETUP_SWITCH, user));
}

/** The 409 every paused setup path answers, before any Stripe call. */
export function payoutSetupPausedResponse(headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ error: PAYOUT_SETUP_PAUSED_MESSAGE, code: PAYOUT_SETUP_PAUSED_CODE, reason: PAYOUT_SETUP_PAUSED_CODE }),
    { status: 409, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
