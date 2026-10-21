import type { ReactNode } from "react";

/**
 * MoneyNote: the ONE "money state" note (spec v2 §3 "Status bubbles and money
 * notes": any held, released, payout, refund or chargeback state uses the
 * money tint). Rust tint fill, money ink text. Boards 142, 144, 145.
 *
 * Copy only; every amount a caller puts inside comes from a server-stamped
 * figure, never a client recomputation (truth rule, spec v2 §1.5).
 */
export function MoneyNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-money-note=""
      className={`rounded-2xl px-4 py-3 text-ds-13 leading-snug ${className}`}
      style={{ background: "hsl(var(--burnt-sienna) / 0.08)", color: "hsl(var(--accent-ink))" }}
    >
      {children}
    </div>
  );
}

/** A money amount inside a MoneyNote or a decision card: bold, tabular. */
export function MoneyAmount({ cents }: { cents: number }) {
  return <span className="font-bold tabular-nums">{formatUsd(cents)}</span>;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
