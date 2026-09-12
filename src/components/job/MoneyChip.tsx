import type { CSSProperties } from "react";

/**
 * MoneyChip — the bark-tinted pill a job's money is set in.
 *
 * `JobPrice` is documented as "THE single money element", but only for the
 * figures it computes itself. The same pill — `hsl(var(--bark) / 0.10)` fill,
 * `0.5px solid hsl(var(--bark) / 0.28)` border, `rounded-ds-md`, `px-2.5 py-1`,
 * an 800-weight `text-ds-17` tabular figure with a 0.82em `$` — was written out
 * by hand wherever the amount was ALREADY a string (JobCardTitleBar, the My
 * Posts / My Jobs header bars). Those copies had to be hand-synced to JobPrice
 * twice already, once for the palette and once for the geometry.
 *
 * So the LOOK lives here and the math stays in JobPrice: JobPrice renders this
 * with the net take-home it computed, and a card that is handed a pre-formatted
 * amount renders the same component with that string. One pill, two callers,
 * no third copy.
 */
export const MONEY_CHIP_SURFACE: CSSProperties = {
  background: "hsl(var(--bark) / 0.10)",
  border: "0.5px solid hsl(var(--bark) / 0.28)",
};

/**
 * `lg` — the one raised treatment, used where the chip is the single money
 * element on the screen (JobDetailDialog's title row). Stronger border + the
 * bark elevation token so it leads its row.
 */
export const MONEY_CHIP_SURFACE_LG: CSSProperties = {
  background: "hsl(var(--bark) / 0.10)",
  border: "0.5px solid hsl(var(--bark) / 0.4)",
  boxShadow: "var(--elev-bark-raised)",
};

/** The figure itself — `$` pulled tight to the digits, tabular so columns of
 *  cards line up. Exported separately because JobPrice wraps it in its own
 *  chip element. */
export function MoneyAmount({ amount, size = "sm" }: { amount: string; size?: "sm" | "lg" }) {
  return (
    <span
      className={`font-sans leading-none tabular-nums ${size === "lg" ? "text-ds-22" : "text-ds-17"}`}
      style={{ fontWeight: 800, color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
    >
      <span style={{ fontSize: "0.82em", verticalAlign: "0.02em", marginRight: "0.5px" }}>$</span>
      {amount}
    </span>
  );
}

export function MoneyChip({
  amount,
  size = "sm",
  title,
  className,
}: {
  /** Pre-formatted amount WITHOUT the currency symbol, e.g. `"42"`. */
  amount: string;
  size?: "sm" | "lg";
  /** Optional native tooltip (e.g. budget + fee breakdown). */
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-col items-center justify-center rounded-ds-md text-center ${size === "lg" ? "px-3.5 py-2" : "px-2.5 py-1"}${className ? ` ${className}` : ""}`}
      title={title}
      style={size === "lg" ? MONEY_CHIP_SURFACE_LG : MONEY_CHIP_SURFACE}
    >
      <MoneyAmount amount={amount} size={size} />
    </span>
  );
}
