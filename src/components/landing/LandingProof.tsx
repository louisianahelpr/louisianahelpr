/**
 * The hero's proof row (owner, 2026-10-23, landing option B): one real finished
 * job, the ID rule and the money rule, under the search.
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
 *   - You pick who helps (lead 2026-10-27, owner: the row showed 2 of its 3
 *     items, the ID line being hidden while the check is off, so the right
 *     third stood empty): a job's poster sees everyone who applied, can write
 *     to any of them before hiring (MessageApplicantButton, poster-first, server
 *     rule can_send_message_to_in_job) and hires the one they choose. It is the
 *     second step of "How it works" below ("See who applied and chat before you
 *     hire"). It takes the ID line's place while the ID check is off, so the
 *     row always holds three items.
 */
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
const ID_ITEM = { label: "Verified ID", title: "Photo ID checked", body: "Before anyone posts or heads out to a job" } as const;
const PICK_ITEM = { label: "You pick who helps", title: "Chat before you hire", body: "See who applied, then choose" } as const;
const PRICE_ITEM = { label: "You name the price", title: "Paid only when it’s done", body: "Money held safely until then" } as const;

/** The two text items beside the finished job: always two, so the row is always three even columns. */
export function proofItems(idOn: boolean) {
  return [idOn ? ID_ITEM : PICK_ITEM, PRICE_ITEM];
}

export function LandingProof() {
  const idOn = useIdentityCheckOnStore();
  const items = proofItems(idOn);
  return (
    <ul
      data-testid="landing-proof"
      className="mt-8 w-full max-w-[1040px] mx-auto border-t pt-5 lg:pt-6 grid gap-3 lg:grid-cols-3 lg:gap-10 text-left"
      style={{ borderColor: "var(--lp-line)" }}
    >
      <li className="flex items-center justify-center lg:justify-start gap-3 lg:gap-4 min-w-0">
        <img
          src="/landing/new-iberia-yard.jpg"
          alt="A freshly mowed yard in New Iberia"
          width={72}
          height={72}
          loading="lazy"
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
      </li>
      {items.map((it) => (
        <li key={it.label} className="hidden lg:flex flex-col justify-center gap-1 min-w-0">
          <span className="text-ds-11 lg:text-ds-12 font-bold uppercase tracking-[0.1em]" style={{ color: "var(--lp-action-strong)" }}>
            {it.label}
          </span>
          <span className="text-ds-15 lg:text-ds-16 font-semibold" style={{ color: "var(--lp-ink)" }}>
            {it.title}
          </span>
          <span className="text-ds-13 lg:text-ds-14 text-balance" style={{ color: "var(--lp-body)" }}>
            {it.body}
          </span>
        </li>
      ))}
      {/* Phone: the same two facts on one quiet line (owner, 2026-10-23: less space on the phone). */}
      <li className="lg:hidden text-center text-ds-13 font-semibold" style={{ color: "var(--lp-body)" }}>
        {idOn ? "✓ Photo ID checked · Paid when it’s done" : "✓ You pick who helps · Paid when it’s done"}
      </li>
    </ul>
  );
}
