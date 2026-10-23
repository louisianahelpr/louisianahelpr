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
 *   - Money: held until the poster approves (or the auto-release window), the
 *     same rule the money band below states with the cron's own hours.
 */
const ITEMS = [
  { label: "Verified ID", title: "Photo ID checked", body: "Before anyone posts or heads out to a job" },
  { label: "You name the price", title: "Paid only when it’s done", body: "Money held safely until then" },
] as const;

export function LandingProof() {
  return (
    <ul
      data-testid="landing-proof"
      className="mt-12 lg:mt-16 w-full max-w-[1120px] mx-auto border-t pt-8 lg:pt-10 grid gap-4 lg:gap-16 text-left lg:grid-cols-3"
      style={{ borderColor: "var(--lp-line)" }}
    >
      <li className="flex items-center justify-center lg:justify-start gap-4 lg:gap-5 min-w-0">
        <img
          src="/landing/new-iberia-yard.jpg"
          alt="A freshly mowed yard in New Iberia"
          width={104}
          height={104}
          loading="lazy"
          decoding="async"
          className="w-16 h-16 lg:w-[104px] lg:h-[104px] shrink-0 rounded-xl lg:rounded-2xl object-cover"
        />
        <div className="flex flex-col gap-1 lg:gap-2 min-w-0">
          <span className="text-ds-11 lg:text-ds-14 font-bold uppercase tracking-[0.1em]" style={{ color: "var(--lp-action-strong)" }}>
            Just finished
          </span>
          <span className="text-ds-15 lg:text-ds-20 font-semibold" style={{ color: "var(--lp-ink)" }}>
            2 yards in New Iberia
          </span>
          <span className="text-ds-13 lg:text-ds-17" style={{ color: "var(--lp-body)" }}>
            <span aria-label="5 stars" style={{ color: "var(--lp-money)" }}>★★★★★</span> · $20 tip
          </span>
        </div>
      </li>
      {ITEMS.map((it) => (
        <li key={it.label} className="hidden lg:flex flex-col gap-2 min-w-0">
          <span className="text-ds-11 lg:text-ds-14 font-bold uppercase tracking-[0.1em]" style={{ color: "var(--lp-action-strong)" }}>
            {it.label}
          </span>
          <span className="text-ds-15 lg:text-ds-20 font-semibold" style={{ color: "var(--lp-ink)" }}>
            {it.title}
          </span>
          <span className="text-ds-13 lg:text-ds-17 text-balance" style={{ color: "var(--lp-body)" }}>
            {it.body}
          </span>
        </li>
      ))}
      {/* Phone: the same two facts on one quiet line (owner, 2026-10-23: less space on the phone). */}
      <li className="lg:hidden text-center text-ds-13 font-semibold" style={{ color: "var(--lp-body)" }}>
        ✓ Photo ID checked · Paid when it’s done
      </li>
    </ul>
  );
}
