/**
 * The landing's proof (owner, 2026-10-23, landing option B): one real finished job, plus the money rule and either
 * the pick rule or the ID rule.
 *
 * Owner 11-09 (10:31 PM, screenshot at 375): the "Just finished / You pick who helps · Paid when it's done" block took
 * up space as a block of its own above "Open jobs near you". It is no longer a block: the finished job is the FIRST
 * CARD of the Jobs section's card grid (LiveJobsSection.tsx), the same shape as a job card, and the two facts are the
 * section's one line under its heading (proofLine, drawn by LandingBrowseShell).
 *
 * Every line is true today, checked on prod 2026-10-23:
 *   - "Just finished": job 7c6deb77 "Mow two lawns", Iberia, status completed,
 *     a $20 tip with payment_status paid, and a 5-star review. The photo is the
 *     owner's own picture of that job (owner: "you can use this on the job picture").
 *     It is a dated record, not a live count: replace it with the next real one.
 *   - Photo ID: identity_is_verified gates a member's first posted job and a
 *     Helpr heading out (20261021081258). Browsing and applying are not gated,
 *     so the line says "before anyone posts or heads out", never "every member".
 *     While the ID check is off (switch `identity_check`, owner 2026-10-23:
 *     "just remove the verify id entirely") the ID line is not shown: it would
 *     be false.
 *   - Money: held until the poster approves (or the auto-release window), the
 *     same rule the money band below states with the cron's own hours.
 *   - You pick who helps (lead 2026-10-27): a job's poster sees everyone who applied, can write to any of them before
 *     hiring (MessageApplicantButton, poster-first, server rule can_send_message_to_in_job) and hires the one they
 *     choose. It takes the ID line's place while the ID check is off.
 */
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";

/** The Jobs section's one line under its heading: the two facts, ID first while the ID check is on. */
export function proofLine(idOn: boolean): string {
  return idOn
    ? "Photo ID checked before anyone posts or heads out. Paid only when it’s done."
    : "You pick who helps. Paid only when it’s done.";
}

export function useProofLine(): string {
  return proofLine(useIdentityCheckOnStore());
}

/** The finished job, as the first card of the Jobs grid: a row on a phone, a column card from lg (the job cards' shape). */
export function LandingProof() {
  return (
    <div
      data-testid="landing-proof"
      className="h-full rounded-2xl p-4 lg:p-6 flex lg:flex-col items-center lg:items-start gap-3 lg:gap-4 min-w-0"
      style={{ background: "var(--lp-ground)", color: "var(--lp-ink)" }}
    >
      <img
        loading="lazy"
        src="/landing/new-iberia-yard.jpg"
        alt="A freshly mowed yard in New Iberia"
        width={72}
        height={72}
        decoding="async"
        className="w-14 h-14 lg:w-[72px] lg:h-[72px] shrink-0 rounded-xl object-cover"
      />
      <div className="flex flex-col gap-0.5 lg:gap-1 min-w-0">
        <span className="text-ds-11 lg:text-ds-12 font-bold uppercase tracking-[0.1em]" style={{ color: "var(--lp-action-strong)" }}>
          Just finished
        </span>
        <span className="text-ds-15 lg:text-ds-16 font-semibold" style={{ color: "var(--lp-ink)" }}>
          2 yards in New Iberia
        </span>
        <span className="text-ds-13 lg:text-ds-14" style={{ color: "var(--lp-body)" }}>
          <span role="img" aria-label="5 stars" style={{ color: "var(--lp-money)" }}>★★★★★</span> · $20 tip
        </span>
      </div>
    </div>
  );
}
