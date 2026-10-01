
/**
 * The acceptance gate, client side.
 *
 * A helper may browse and APPLY freely, but may not be AWARDED a job until
 * Stripe can pay them. Identity verification used to be a second requirement
 * (owner, 2026-08-27); it was removed on 2026-10-01 ("Remove finish verifying
 * id we don't do that anymore", migration 20261001222911). Identity is now
 * display only: see {@link isIdentityVerified}.
 *
 * THE ENFORCEMENT IS NOT HERE. It is the `jobs_award_gate` trigger in migration
 * 20260827191647, which raises these exact codes from `helper_award_block_reason`
 * on every write that hands someone a job. This module exists so the app can
 * (a) stop the user before the tap, and (b) explain a refusal the server did
 * make. Turning it off would change nothing about who can be hired.
 */
export type AwardBlockReason =
  | "helper_payout_setup_incomplete"
  | "helper_unknown";

const REASONS: readonly string[] = [
  "helper_payout_setup_incomplete",
  "helper_unknown",
];

/** Reads a gate refusal out of a Postgres error the server actually raised. */
export function awardBlockFromError(err: unknown): AwardBlockReason | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  return (REASONS.find((r) => msg.includes(r)) as AwardBlockReason | undefined) ?? null;
}

/**
 * The funding gate's refusal (trigger `enforce_job_funded_before_award`,
 * 23514): the job's escrow is not funded, e.g. it was refunded after the offer.
 * No retry by the helper can clear it, so it must not be shown as "try again"
 * (Q320).
 */
export const UNFUNDED_AWARD_COPY =
  "This job isn't funded right now, so it can't be accepted yet. The person who posted this job needs to complete checkout first.";
export function isUnfundedAwardRefusal(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return String(e?.code ?? "") === "23514" && /not funded/i.test(String(e?.message ?? ""));
}

/** The subset of `stripe-connect { action: "status" }` this gate reads. */
export interface AwardGateStatus {
  connected?: boolean;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
}

/**
 * The identity verdict, for DISPLAY (badges, Work Record, admin). It gates
 * nothing since 2026-10-01 (migration 20261001222911).
 *
 * TWO checks answer "do we know who this is", and either one counts:
 *
 *   • `stripe_identity_verified` — the Stripe CONNECT verdict, true only when
 *     no identity requirement is outstanding on the payout account. Nothing in
 *     this app can put that flow in front of a person on its own; it clears as
 *     a side effect of payout onboarding.
 *   • `idv_status = 'verified'`  — Stripe IDENTITY, the document + selfie check
 *     `stripe-idv-start` launches (no screen has opened that flow since
 *     2026-10-01; existing verdicts still draw the badge).
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
 * writes the live verdict back onto `profiles.stripe_payouts_enabled`, which is
 * exactly what the server trigger enforces, so the answer the user is shown and
 * the answer the database will give cannot drift apart.
 */
// Still async purely so every existing `await` call site keeps working; it no
// longer awaits anything itself.
export async function awardBlockReasonFromStatus(
  status: AwardGateStatus | null | undefined,
): Promise<AwardBlockReason | null> {
  if (!status) return "helper_unknown";
  if (!status.connected || !status.details_submitted || status.payouts_enabled !== true) {
    return "helper_payout_setup_incomplete";
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
  /** Which Stripe requirement set the CTA's Account Link must collect. */
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

export interface ApplyBlockNotice {
  /** Bolded lead-in. */
  headline: string;
  /** The rest of the sentence, in the helper's own terms. */
  body: string;
  /** The one tap that fixes it. */
  ctaLabel: string;
  /** Where that tap goes. */
  href: string;
}

/**
 * What the HELPER is told ON THE APPLY STEP, while they can still apply.
 *
 * A THIRD audience, distinct from both of the above, and the one nobody was
 * writing for. {@link awardBlockCopy} is for `AwardGateDialog`, which STOPS a
 * helper at the accept step — its copy is phrased as a barrier ("Set Up Payouts
 * to Take This Job") because at that moment there is a job on the table and the
 * tap has already failed. {@link posterAwardBlockMessage} is for the other
 * party entirely.
 *
 * Here nothing has failed and nothing is being refused: applying is
 * deliberately ungated (see the module header), and this notice must not read
 * as though the button below it will not work. It says what the helper cannot
 * yet be given, not what they cannot do — the distinction matters, because
 * seven of eight live non-seed profiles are in this state and can apply all
 * day. The failure it prevents is the silent one: applications that go out,
 * receive nothing back, and read as posters passing them over.
 *
 * Deliberately no `helper_unknown` case. That verdict means we could not read
 * the profile at all, and a notice on the apply step is the wrong place to
 * report an internal read failure to somebody mid-application — the accept-step
 * dialog still covers it if it persists.
 */
export function helperApplyBlockNotice(
  reason: Exclude<AwardBlockReason, "helper_unknown">,
): ApplyBlockNotice {
  switch (reason) {
    case "helper_payout_setup_incomplete":
      return {
        headline: "You can apply — but you can't be hired yet.",
        body:
          "Helpr pays through Stripe, and no one can hand you a job until your payout account exists. It takes about two minutes, once.",
        ctaLabel: "Set Up Payouts",
        href: "/profile?tab=payment",
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
  const who = helperName?.trim() || "This Helpr";
  switch (reason) {
    case "helper_payout_setup_incomplete":
      return `${who} hasn't finished setting up payouts yet, so they can't be hired. They'll show as ready once they do.`;
    case "helper_unknown":
      return `We couldn't check ${who}'s verification status — give it a moment and try again.`;
  }
}
