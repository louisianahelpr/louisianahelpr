import { isIdvRequirementPaused } from "@/lib/featureFlags";

/**
 * The acceptance gate, client side.
 *
 * A helper may browse and APPLY freely, but may not be AWARDED a job until
 * Stripe can pay them AND Stripe has finished verifying who they are (owner's
 * decision, 2026-08-27 — "we are verifying this is the person doing the job but
 * also want their payment info set up").
 *
 * THE ENFORCEMENT IS NOT HERE. It is the `jobs_award_gate` trigger in migration
 * 20260827191647, which raises these exact codes from `helper_award_block_reason`
 * on every write that hands someone a job. This module exists so the app can
 * (a) stop the user before the tap, and (b) explain a refusal the server did
 * make. Turning it off would change nothing about who can be hired.
 *
 * THIS HEADER USED TO SAY `idv_status` MEANS NOTHING. It does not say that any
 * more, and the reversal is deliberate rather than a drift. When commit
 * 47eef666 wrote that line, `idv_status` was an unreviewed upload flag an admin
 * flipped by hand. It is now written by `stripe-idv-webhook` from a real Stripe
 * Identity document + selfie session, it is the only identity check a helper
 * can complete from inside this app, and since migration 20260907013734 the
 * server gate accepts it. A client gate that still ignores it refuses people
 * the database would hire — see {@link isIdentityVerified} for the measurement.
 */
export type AwardBlockReason =
  | "helper_payout_setup_incomplete"
  | "helper_identity_unverified"
  | "helper_unknown";

const REASONS: readonly string[] = [
  "helper_payout_setup_incomplete",
  "helper_identity_unverified",
  "helper_unknown",
];

/** Reads a gate refusal out of a Postgres error the server actually raised. */
export function awardBlockFromError(err: unknown): AwardBlockReason | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  return (REASONS.find((r) => msg.includes(r)) as AwardBlockReason | undefined) ?? null;
}

/** The subset of `stripe-connect { action: "status" }` this gate reads. */
export interface AwardGateStatus {
  connected?: boolean;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  identity_verified?: boolean;
}

/**
 * The identity verdict, in the exact shape `helper_award_block_reason` uses.
 *
 * TWO checks answer "do we know who this is", and the server accepts EITHER
 * (migration 20260907013734):
 *
 *   • `stripe_identity_verified` — the Stripe CONNECT verdict, true only when
 *     no identity requirement is outstanding on the payout account. Nothing in
 *     this app can put that flow in front of a person on its own; it clears as
 *     a side effect of payout onboarding.
 *   • `idv_status = 'verified'`  — Stripe IDENTITY, the document + selfie check
 *     `stripe-idv-start` launches. This is the one a helper can actually go and
 *     complete, and it is the stronger of the two.
 *
 * Reading only the Connect flag — which is what this module did until now — is
 * a FALSE BLOCK, not a conservative one. Measured against prod 2026-09-06: one
 * live non-seed profile has `idv_status = 'verified'`, `stripe_identity_verified
 * = false`, payouts enabled, and `helper_award_block_reason() = NULL`. The
 * server would hand that person the job; the client stopped them at
 * "Stripe Is Still Verifying You" with a CTA that had nothing left to collect.
 *
 * Fails CLOSED on absence: an unknown `idvStatus` contributes nothing.
 */
export function isIdentityVerified(source: {
  /** `identity_verified` from `stripe-connect { action: "status" }`, or the
      cached `profiles.stripe_identity_verified`. */
  connectIdentityVerified?: boolean | null;
  /** `profiles.idv_status`. */
  idvStatus?: string | null;
}): boolean {
  return source.connectIdentityVerified === true || source.idvStatus === "verified";
}

/**
 * Why this helper cannot be awarded a job right now, or `null` if they can.
 *
 * Derived from ONE live Stripe read (`stripe-connect { action: "status" }`),
 * not from a second query of its own. That matters: the same edge-function call
 * writes the live verdict back onto `profiles.stripe_payouts_enabled` /
 * `stripe_identity_verified`, which is exactly what the server trigger
 * enforces — so by construction the answer the user is shown and the answer the
 * database will give cannot drift apart, and a cache left empty by the
 * no-backfill rollout heals on the very attempt it would have blocked.
 *
 * `identity_verified` is absent until the edge function redeploys. Treated as
 * "not verified", which fails CLOSED — the safe direction for a safety gate.
 *
 * `idvStatus` is the SECOND half of the identity verdict and must be passed in
 * by every caller that can reach it: without it this function refuses people
 * the server would let through. See {@link isIdentityVerified}.
 */
export async function awardBlockReasonFromStatus(
  status: AwardGateStatus | null | undefined,
  /** `profiles.idv_status` for the same person. Omit only when unreachable. */
  idvStatus?: string | null,
): Promise<AwardBlockReason | null> {
  if (!status) return "helper_unknown";
  if (!status.connected || !status.details_submitted || status.payouts_enabled !== true) {
    return "helper_payout_setup_incomplete";
  }
  // Operator kill switch for a Stripe Identity outage (Admin → Settings). The
  // server honours the same flag; `isIdvRequirementPaused` fails closed, so a
  // dropped read can never quietly drop the requirement.
  const identityOk = isIdentityVerified({
    connectIdentityVerified: status.identity_verified,
    idvStatus,
  });
  if (!identityOk && !(await isIdvRequirementPaused())) {
    return "helper_identity_unverified";
  }
  return null;
}

export interface AwardBlockCopy {
  /** Dialog headline. */
  title: string;
  /** What is actually missing, in the helper's own terms. */
  body: string;
  /** The one tap that fixes it. */
  ctaLabel: string;
  /**
   * Which Stripe requirement set the CTA's Account Link must collect.
   *
   * `eventually_due` for the identity block is load-bearing, not a preference:
   * the identity verdict is only TRUE when nothing identity-shaped is
   * outstanding in ANY bucket, so a `currently_due`-only link sends the helper
   * through Stripe and returns them still blocked. See the matching note in
   * supabase/functions/stripe-connect/index.ts.
   */
  collect: "currently_due" | "eventually_due";
}

export function awardBlockCopy(reason: AwardBlockReason): AwardBlockCopy {
  switch (reason) {
    case "helper_payout_setup_incomplete":
      return {
        title: "Set Up Payouts to Take This Job",
        body:
          "Helpr pays through Stripe, so your payout account has to exist before a job can become yours. It takes about two minutes, and you only do it once.",
        ctaLabel: "Set Up Payouts",
        collect: "currently_due",
      };
    case "helper_identity_unverified":
      return {
        title: "Stripe Is Still Verifying You",
        body:
          "Your payout account is connected, but Stripe hasn't finished confirming who you are — it's usually a Social Security number or a photo ID it still needs. Posters are letting you into their homes, so we wait for that answer before a job becomes yours. Finish what Stripe is asking for and this clears on its own.",
        ctaLabel: "Finish Verification with Stripe",
        collect: "eventually_due",
      };
    case "helper_unknown":
      return {
        title: "We Couldn't Find Your Profile",
        body:
          "Something's off with your account — we couldn't read the verification status this job needs. Try again in a moment, and get in touch if it keeps happening.",
        ctaLabel: "Open Payout Settings",
        collect: "currently_due",
      };
  }
}

/**
 * What the POSTER is told when the gate refuses THEIR hire. Different audience,
 * different fix: there is nothing for the poster to do about someone else's
 * Stripe account, so this names the situation and stops rather than offering a
 * CTA they cannot complete.
 */
export function posterAwardBlockMessage(reason: AwardBlockReason, helperName?: string): string {
  const who = helperName?.trim() || "This helper";
  switch (reason) {
    case "helper_payout_setup_incomplete":
      return `${who} hasn't finished setting up payouts yet, so they can't be hired. They'll show as ready once they do.`;
    case "helper_identity_unverified":
      return `Stripe hasn't finished verifying ${who}'s identity yet, so they can't be hired. We'll let them know.`;
    case "helper_unknown":
      return `We couldn't check ${who}'s verification status — give it a moment and try again.`;
  }
}
