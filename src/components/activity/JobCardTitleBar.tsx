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
      <span
        className="inline-flex items-baseline font-display italic font-bold tabular-nums text-ds-13 px-2 py-0.5 rounded-full shrink-0 ml-3"
        title={amountTitle}
        style={{
          background: "hsl(var(--burnt-sienna) / 0.10)",
          color: "hsl(var(--burnt-sienna))",
          letterSpacing: "-0.015em",
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
