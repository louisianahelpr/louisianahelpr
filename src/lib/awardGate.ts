
/**
 * The acceptance gate, client side.
 *
 * A helper may browse and APPLY freely, and a poster may OFFER them a job
 * whatever their Stripe state. The Helpr's ACCEPT completes only once their
 * payout setup and Stripe Identity are both done (owner, 2026-10-02/03, Q1180;
 * Identity = photo ID + selfie only since 2026-10-21): tapping Accept before
 * that records the accept as pending and opens the thank-you dialog listing
 * only what is missing; the accept completes by itself when both are done, and
 * only then is the poster told. Stripe Identity also gates a member's job post
 * and a Helpr's On the way (migration 20261021081258); the poster's Hire,
 * confirm and release are never gated on it.
 *
 * THE ENFORCEMENT IS NOT HERE. It is `accept_job_offer`, `jobs_award_gate` and
 * `helper_accept_block_reason` (migration 20261003193541). This module exists
 * so the app can explain the server's answer and ask for exactly the missing
 * steps. Turning it off would change nothing about who can accept a job.
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

/** What `accept_job_offer` says is still missing (helper_accept_missing). */
export type AcceptMissing = "payout_setup" | "stripe_id";

/**
 * The client's copy of `helper_accept_missing` (20261003193541), branch for
 * branch, from the caller's own profile row: the seed carve-out, the payout
 * check, then Stripe Identity ({@link hasIdBadge}: the server's
 * identity_is_verified is idv_status = 'verified' only since 20261021081258).
 */
export function acceptMissingFromProfile(profile: {
  is_seed?: boolean | null;
  stripe_account_id?: string | null;
  stripe_payouts_enabled?: boolean | null;
  idv_status?: string | null;
}): AcceptMissing[] {
  if (profile.is_seed === true && profile.stripe_account_id == null) return [];
  const missing: AcceptMissing[] = [];
  if (profile.stripe_account_id == null || profile.stripe_payouts_enabled !== true) missing.push("payout_setup");
  if (!hasIdBadge(profile.idv_status)) missing.push("stripe_id");
  return missing;
}

/** The first missing step as a gate reason (helper_accept_block_reason's order). */
export function reasonFromMissing(missing: readonly AcceptMissing[]): AwardBlockReason | null {
  if (missing.includes("payout_setup")) return "helper_payout_setup_incomplete";
  if (missing.includes("stripe_id")) return "helper_identity_unverified";
  return null;
}

/** Reads a gate refusal out of a Postgres error the server actually raised. */
export function awardBlockFromError(err: unknown): AwardBlockReason | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  return (REASONS.find((r) => msg.includes(r)) as AwardBlockReason | undefined) ?? null;
}

/**
 * The award pop-up's sentence for a gate refusal that came back from some
 * other RPC's write (jobs_award_gate is a trigger, so its codes are not the
 * RPC's own and have no row in RPC_ERROR_COPY), or null.
 */
export function awardBlockMessage(err: unknown): string | null {
  const reason = awardBlockFromError(err);
  return reason ? awardBlockCopy(reason).body : null;
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
 * "ID verified", THE one rule for badges AND gates (owner, 2026-10-21): Stripe
 * Identity's photo ID + selfie verdict, `profiles.idv_status = 'verified'`, and
 * nothing else. Payout setup (Stripe Connect, `stripe_identity_verified` /
 * `stripe_payouts_enabled`) is a separate fact with its own "Payouts set up"
 * badge and never counts as an ID check. The server says the same
 * (get_safe_profiles.is_id_verified, 20261021074131; identity_is_verified,
 * 20261021081258). An admin-approved ID writes the same value (Q2201).
 */
export function hasIdBadge(idvStatus: string | null | undefined): boolean {
  return idvStatus === "verified";
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
        // Accept-first (owner, 2026-10-06/07, Q1399): the accept is never the
        // barrier; the job is fully theirs once payouts are set up.
        title: "Set Up Payouts to Get Paid",
        body:
          "Helpr pays through Stripe, so this job is fully yours once your payout account is set up. It takes about two minutes, and you only do it once.",
        ctaLabel: "Set Up Payouts",
        collect: "eventually_due",
      };
    case "helper_identity_unverified":
      return {
        title: "Verify your ID with Stripe",
        body:
          "Stripe checks a photo ID and a selfie before your first job is booked. It takes about 2 minutes, once, and the job is fully yours as soon as it's done.",
        ctaLabel: "Verify my ID",
        // Not a Connect link: the CTA opens the Stripe Identity sheet
        // (AwardGateDialog). `collect` only matters for the payout step.
        collect: "eventually_due",
      };
    case "helper_unknown":
      return {
        title: "We Couldn't Find Your Profile",
        body:
          "Something's off with your account — we couldn't read the verification status this job needs. Try again in a moment, and get in touch if it keeps happening.",
        ctaLabel: "Open Payout Settings",
        collect: "eventually_due",
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
        headline: "You can apply and accept offers. Set up payouts to get paid.",
        body:
          "Helpr pays through Stripe. If you accept an offer first, the job becomes yours as soon as your payout account is set up. It takes about two minutes, once.",
        ctaLabel: "Set Up Payouts",
        href: "/profile?tab=payment",
      };
    case "helper_identity_unverified":
      return {
        headline: "You can apply and accept offers. Verify your ID before your first job.",
        body:
          "Stripe checks a photo ID and a selfie. If you accept an offer first, the job becomes yours as soon as it's done. It takes about 2 minutes, once.",
        ctaLabel: "Verify my ID",
        href: "/home?verify_id=1",
      };
  }
}

/**
 * The thank-you dialog after an Accept that is waiting on setup (owner,
 * 2026-10-03: "thank you for accepting the offer, in order to fully accept
 * these 2 things must be done before we will notify the poster that you have
 * accepted"). Names only what is still missing.
 */
export function acceptPendingCopy(missing: readonly AcceptMissing[]): AwardBlockCopy {
  const steps = [
    missing.includes("payout_setup") ? "set up payouts" : null,
    missing.includes("stripe_id") ? "verify your ID with Stripe (a photo ID and a selfie)" : null,
  ].filter(Boolean) as string[];
  const todo = steps.length === 2 ? `${steps[0]} and ${steps[1]}` : steps[0] ?? "finish your Stripe setup";
  // NOT ACCEPTED YET, said in the first words (owner, 2026-10-07, Q1399): the
  // job is not theirs until the setup is done, so the pop-up must not read as
  // a finished accept.
  return {
    title: "Thanks for Accepting!",
    body: `You're not booked yet. To fully accept, ${todo}. As soon as ${steps.length === 2 ? "both are" : "that's"} done, your accept goes through and we let the person who posted the job know.`,
    // The payout step first when both are missing; the ID row has its own button.
    ctaLabel: missing.includes("payout_setup") ? "Set up payouts" : "Verify my ID",
    collect: "eventually_due",
  };
}

/**
 * The Helpr's offer card after an Accept that waits on setup (owner,
 * 2026-10-07, Q1399: "make it clear the job is NOT fully accepted until those
 * are done ... on the card afterwards"). Names only what is still missing,
 * from the same profile mirror of helper_accept_missing as the pop-up.
 */
export function pendingAcceptStatus(missing: readonly AcceptMissing[]): { headline: string; body: string } {
  const what =
    missing.includes("payout_setup") && missing.includes("stripe_id")
      ? "your payout setup and Stripe ID check"
      : missing.includes("stripe_id")
        ? "your Stripe ID check"
        : missing.includes("payout_setup")
          ? "your payout setup"
          : "Stripe to finish your setup";
  return {
    headline: `Not accepted yet: waiting on ${what}.`,
    body: "The job isn't yours until that's done. Then your accept goes through and we tell the person who posted it. Tap Accept Job to see what's left.",
  };
}

/**
 * What the POSTER reads on an applicant whose ID is not verified yet (owner,
 * 2026-10-20: ID is "required but only once they are offered and accept a
 * job"). Informational, never a refusal: the poster's offer stays open to
 * anyone, and the Helpr's accept is what waits on the ID (the one helper,
 * helper_accept_block_reason, 20261020043346). Names the person, never a
 * gendered pronoun.
 */
export function applicantIdNote(helperName?: string | null): string {
  const who = helperName?.trim() || "This Helpr";
  return `${who} verifies their ID when they accept.`;
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
    case "helper_identity_unverified":
      return `${who} hasn't verified their ID with Stripe yet, so they can't be booked yet.`;
    case "helper_unknown":
      return `We couldn't check ${who}'s verification status — give it a moment and try again.`;
  }
}
