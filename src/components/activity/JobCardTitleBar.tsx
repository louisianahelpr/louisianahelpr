import { type ReactNode } from "react";

interface JobCardTitleBarProps {
  title: string;
  /**
   * Job category, e.g. "cleaning". NOT rendered here — JobCardShell paints the
   * tab over the card's top-left corner. This bar only needs to know whether a
   * tab exists, so it can reserve the vertical space the tab overlays.
   */
  category?: string | null;
  /** Pre-formatted amount string (e.g. `"42"` or `"38.50"`). */
  amount: string;
  /** Optional native tooltip on the currency chip — e.g. budget + fee breakdown. */
  amountTitle?: string;
  /** Location · date · time row, rendered INSIDE the header block — under the
      title + amount, above the divider (owner: "move location date and time
      up under money and title globally. up above the line"). */
  meta?: ReactNode;
}

/**
 * Italic display title + sienna currency chip.
 *
 * The location/date/time row is NOT here. It used to be lifted up beside the
 * title on `lg:` while phone kept it stacked below — two arrangements of the
 * same card depending on width, and the desktop one squeezed the city to an
 * ellipsis before it dropped. It lives under the title on every width now
 * (owner: "move back under title globally"), which is also the only version
 * that never truncates. — the top bar shared by the
 * poster and helper activity cards. Visually identical across both surfaces.
 */
export function JobCardTitleBar({ title, category, amount, amountTitle, meta }: JobCardTitleBarProps) {
  return (
    <div
      // `pt-6` clears the category tab JobCardShell paints over the card's
      // top-left corner. Without it the tab sits on top of the job title.
      // Same trick, same reason, as Browse's JobCard (`px-3.5 pt-6 pb-2.5`).
      className={`w-full px-4 text-left ${category ? "pt-6 pb-2.5" : "py-2.5"}`}
      style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
    >
      <div className="flex items-center justify-between">
      <h3
        className="font-display italic font-bold leading-snug truncate min-w-0 text-headline-card"
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
      {/* GEOMETRY matched too, not just the palette (owner: "should be same
          format font style etc"). The surface and ink already came from
          JobPrice, but this chip was `text-ds-13 / weight 700 / px-2 py-0.5`
          against JobPrice's `text-ds-17 / weight 800 / px-2.5 py-1` — so on the
          desktop website the same money, on two cards a column apart, was set
          two sizes and two weights. Every value below is JobPrice's `chip`
          variant verbatim; change one, change both. */}
      <span
        className="inline-flex flex-col items-center justify-center px-2.5 py-1 rounded-ds-md text-center shrink-0 ml-3"
        title={amountTitle}
        style={{
          background: "hsl(var(--bark) / 0.10)",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
        }}
      >
        <span
          className="font-display leading-none tabular-nums text-ds-17"
          style={{
            fontWeight: 800,
            color: "hsl(var(--bark))",
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ fontSize: "0.82em", verticalAlign: "0.02em", marginRight: "0.5px" }}>
            $
          </span>
          {amount}
        </span>
      </span>
      </div>
      {meta ? <div className="mt-1.5">{meta}</div> : null}
    </div>
  );
}
