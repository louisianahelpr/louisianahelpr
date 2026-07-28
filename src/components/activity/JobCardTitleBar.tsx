interface JobCardTitleBarProps {
  title: string;
  /** Pre-formatted amount string (e.g. `"42"` or `"38.50"`). */
  amount: string;
  /** Optional native tooltip on the currency chip — e.g. budget + fee breakdown. */
  amountTitle?: string;
}

/**
 * Italic display title + sienna currency chip — the top bar shared by the
 * poster and helper activity cards. Visually identical across both surfaces.
 */
export function JobCardTitleBar({ title, amount, amountTitle }: JobCardTitleBarProps) {
  return (
    <div
      className="w-full px-4 py-2.5 flex items-center justify-between text-left"
      style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
    >
      <h3
        className="font-display italic font-bold leading-snug line-clamp-2 min-w-0 text-headline-card"
        style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
      >
        {title}
      </h3>
      {/* Same surface + ink as JobPrice's `chip` variant — the component
          documented as "THE single money element". The comment below already
          claimed an amount "reads identically everywhere", but it did not:
          Browse rendered the net take-home as bark-on-bark/0.10 in a
          rounded-ds-md tile, while this bar rendered the SAME net figure
          (AppliedJobCard passes `payout`) as sienna-on-sienna/0.10 in a pill.
          One number, two looks, side by side across Browse / My Posts /
          My Jobs. Aligned to JobPrice rather than the reverse because
          JobPrice also owns the job-detail payout tile, so it is the shape a
          user sees most and the one the codebase treats as canonical. */}
      <span
        className="inline-flex items-baseline font-display font-bold tabular-nums text-ds-13 px-2 py-0.5 rounded-ds-md shrink-0 ml-3"
        title={amountTitle}
        style={{
          background: "hsl(var(--bark) / 0.10)",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
          color: "hsl(var(--bark))",
          letterSpacing: "-0.02em",
        }}
      >
        {/* Tight text "$" pulled to the digits — matches JobPrice, the canonical
            money element, so an amount reads identically everywhere. */}
        <span style={{ fontSize: "0.82em", marginRight: "0.5px" }}>$</span>
        {amount}
      </span>
    </div>
  );
}
