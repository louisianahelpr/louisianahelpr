import { isIdentityVerified } from "@/lib/awardGate";
import { REVIEW_SLA, REVIEW_SLA_HOURS } from "@/lib/reviewSla";
import type { Profile } from "./types";

/**
 * What the Profile landing should render in the ID-verification slot.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Until now there was no such slot. External QA (2026-09-06) clicked through
 * Profile, Account Security and the entire settings list and found no
 * verification row, no banner, and no control anywhere that started an ID
 * check. The ONLY identity prompt in the whole product was `IDVPromptDialog`,
 * mounted from exactly one place — `PostJob` — so a member who never tried to
 * post a job was never told the check existed. Reaching it otherwise required
 * calling the `stripe-idv-start` edge function by hand.
 *
 * That is a gap with teeth, because identity is load-bearing on BOTH sides of
 * this marketplace. Verified against prod 2026-09-06:
 *
 *   • `jobs` INSERT policy "Customers can create jobs" requires
 *     `profiles.idv_status = 'verified'` (or the operator pause flag). No ID
 *     check, no posting — the Stripe Connect flag does NOT satisfy this one.
 *   • `helper_award_block_reason()` requires `stripe_identity_verified` OR
 *     `idv_status = 'verified'`. No ID check, no being hired.
 *
 * So the member is stopped in both directions by a step nothing invited them
 * to take.
 *
 * WHY THE PREDICATE IS `idv_status`, NOT THE EITHER-VERDICT
 *
 * The hire gate accepts either verdict; the posting policy accepts only
 * `idv_status`. This slot therefore keys on `idv_status`, the stricter of the
 * two and the only one a member can move by doing something — otherwise
 * somebody whose Connect account happens to carry Stripe's identity flag would
 * see no prompt and still be refused at Post Job with nothing to act on. One
 * live non-seed profile is in exactly that state today.
 */
export type VerificationPrompt =
  | { kind: "none" }
  /**
   * Nothing has been started, or a session was claimed and abandoned.
   * `resuming` is the second case: `claim_idv_attempt` writes `idv_status =
   * 'pending'` the moment it hands out the one paid attempt, so 'pending'
   * means "a Stripe session exists and is waiting for photos", not "Stripe is
   * thinking". Re-entering reuses that session and costs nothing — the reuse
   * branch in `stripe-idv-start` sits ABOVE the cost gate.
   */
  | { kind: "start"; feeDue: boolean; resuming: boolean; hireOnlyCleared: boolean }
  /** Stripe has the photos and is deciding. Nothing for the member to do. */
  | { kind: "in_progress" }
  /** The one paid attempt is spent; a human has it. Nothing to do but wait. */
  | { kind: "manual_review" };

export function verificationPromptFor(profile: Profile | null): VerificationPrompt {
  // Not "verified by omission": with no profile loaded we assert nothing and
  // render nothing, rather than telling someone they need a check we have not
  // established they need.
  if (!profile) return { kind: "none" };
  if (profile.idv_status === "verified") return { kind: "none" };

  // 'failed' is legacy — migration 20260829 converts it to 'manual_review' —
  // but rows written before that may still carry it, and it means the same
  // thing: the automated check is spent and a person has to look.
  if (profile.idv_status === "manual_review" || profile.idv_status === "failed") {
    return { kind: "manual_review" };
  }
  if (profile.idv_status === "processing") return { kind: "in_progress" };

  return {
    kind: "start",
    resuming: profile.idv_status === "pending",
    // THE $2 IS DISCLOSED HERE, BEFORE THE TAP. `claim_idv_attempt` refuses
    // with `onboarding_fee_unpaid` and `stripe-idv-start` turns that into a
    // 402 — which used to be the FIRST time anyone learned a fee was involved.
    // A price is not an error message.
    feeDue: profile.onboarding_fee_paid !== true,
    // True when Stripe Connect already carries an identity verdict, so the
    // hire gate is satisfied and only posting is still blocked. Keeps the copy
    // from telling this member that posters cannot hire them, which would be
    // false.
    hireOnlyCleared: isIdentityVerified({
      connectIdentityVerified: profile.stripe_identity_verified,
      idvStatus: profile.idv_status,
    }),
  };
}

export interface VerificationPromptCopy {
  /** Bolded lead-in. */
  headline: string;
  /** The rest of the sentence. */
  body: string;
  /** Button label, or null for the states with nothing to press. */
  action: string | null;
}

/**
 * @param feeLabel Formatted fee (e.g. "$2") read from
 *   `platform_settings.onboarding_fee_cents`, or null while unknown. NEVER
 *   hard-code it: the amount is an admin-editable setting, and quoting a
 *   number the platform does not charge is worse than quoting none.
 */
export function verificationPromptCopy(
  prompt: VerificationPrompt,
  feeLabel: string | null,
): VerificationPromptCopy | null {
  switch (prompt.kind) {
    case "none":
      return null;
    case "manual_review":
      return {
        headline: "Your ID check is with our team.",
        // REVIEW_SLA, not a hand-typed window. A manual ID check goes to the
        // same human queue as account approval, so a literal here would put a
        // second, different number on the same wait — which is the exact
        // inconsistency src/lib/reviewSla.ts was created to end (/account-pending
        // once promised "24-48 hours" and "under 2 hours" on one screen).
        body: `We review these by hand and email you as soon as it's done — usually ${REVIEW_SLA} during ${REVIEW_SLA_HOURS}. There's nothing else for you to do.`,
        action: null,
      };
    case "in_progress":
      return {
        headline: "Your ID check is running.",
        body: "Stripe is comparing your photos now. Most finish in under 2 minutes and we'll notify you.",
        action: null,
      };
    case "start": {
      const stakes = prompt.hireOnlyCleared
        ? "You'll need it before you can post a job."
        : "You'll need it before you can post a job or be hired for one.";
      if (prompt.resuming) {
        return {
          headline: "Finish verifying your ID.",
          body: `You started an ID check but haven't sent the photos yet. Picking it back up is free — it's the same check. ${stakes}`,
          action: "Finish",
        };
      }
      return {
        headline: "Verify your ID.",
        body: prompt.feeDue
          ? `A photo ID and a quick selfie, preceded by your one-time${feeLabel ? ` ${feeLabel}` : ""} account setup fee — charged once, never again. ${stakes}`
          : `A photo ID and a quick selfie, handled by Stripe. Your setup fee already covers it. ${stakes}`,
        action: prompt.feeDue ? "Start" : "Verify",
      };
    }
  }
}
