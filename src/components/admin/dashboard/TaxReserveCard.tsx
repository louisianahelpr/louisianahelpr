import { useState, useEffect } from "react";
import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

// IRS estimated-tax quarterly due dates (standard schedule). Returns the
// next deadline after `now` so the admin always sees the upcoming one.
const nextEstimatedTaxDate = (now: Date): Date => {
  const y = now.getFullYear();
  const dates = [
    new Date(y, 3, 15),       // Apr 15 — Q1
    new Date(y, 5, 15),       // Jun 15 — Q2
    new Date(y, 8, 15),       // Sep 15 — Q3
    new Date(y + 1, 0, 15),   // Jan 15 next year — Q4
  ];
  return dates.find((d) => d > now) ?? dates[0];
};

const RESERVE_RATE_KEY = "helpr.admin.taxReserveRate";
const RESERVE_RATE_OPTIONS = [0.2, 0.25, 0.3, 0.35];

/**
 * Tax-reserve tracker — surfaces roughly how much of the platform-fee
 * revenue should be parked for income tax so the owner isn't surprised
 * by an April bill. It does NOT move money; it's a running "set aside
 * about $X" figure plus the next quarterly-estimate due date.
 *
 * The reserve is computed off GROSS platform fees (a deliberately
 * conservative basis — actual taxable profit is lower after Stripe
 * fees + hosting + other deductible expenses, so over-reserving is the
 * safe direction to err). The rate is admin-adjustable and persisted
 * to localStorage.
 */
export const TaxReserveCard = ({
  totalFees,
  feesThisQuarter,
  statsLoading,
  feesUnknown,
}: {
  totalFees: number;
  feesThisQuarter: number;
  statsLoading: boolean;
  /** True when no captured job carries a recorded platform fee — see
   *  DashboardHome. Every figure on this card is a percentage OF `totalFees`,
   *  so it inherits that falsehood exactly: "$0 — 30% of $0 all-time platform
   *  fees" reads as "you owe nothing" when the truth is "nobody wrote the fee
   *  down". Reserving against an unknown is the one direction you cannot err
   *  safely, so the card says so instead of quoting a number. */
  feesUnknown?: boolean;
}) => {
  const [rate, setRate] = useState(0.3);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RESERVE_RATE_KEY);
      const parsed = stored ? parseFloat(stored) : NaN;
      if (RESERVE_RATE_OPTIONS.includes(parsed)) setRate(parsed);
    } catch {
      // private mode / quota — fall back to the 30% default
    }
  }, []);

  const setRatePersisted = (next: number) => {
    setRate(next);
    try { window.localStorage.setItem(RESERVE_RATE_KEY, String(next)); } catch { /* ignore */ }
  };

  const reserveAllTime = totalFees * rate;
  const reserveThisQuarter = feesThisQuarter * rate;
  const dueDate = nextEstimatedTaxDate(new Date());
  const dueLabel = dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div
      className="rounded-ds-md liquid-glass p-4 sm:p-5 space-y-4"
      style={{
        backgroundImage:
          "radial-gradient(80% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.10) 0%, transparent 60%)",
      }}
    >
      {/* AdminCard's header rule, applied by hand because this plate keeps its
          own gradient: column on a phone, title-beside-action from `sm` up. The
          four rate pills claimed ~150 of 343 points at 375 and folded "Tax
          reserve / Set aside for income tax — not a payment" into a six-line
          ribbon down the left edge. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-ds-sm flex items-center justify-center bg-accent/10 text-accent shrink-0">
            <Landmark className="w-4 h-4 sm:w-5 sm:h-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display font-bold leading-tight text-ds-16" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Tax reserve
            </p>
            <p className="text-ds-11 text-muted-foreground leading-tight">
              Set aside for income tax — not a payment
            </p>
          </div>
        </div>
        {/* Reserve-rate selector — conservative default 30%. */}
        <div className="flex items-center gap-1 shrink-0">
          {RESERVE_RATE_OPTIONS.map((opt) => {
            const active = opt === rate;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setRatePersisted(opt)}
                className={cn(
                  "px-1.5 h-6 rounded-md text-ds-10 font-semibold tabular-nums transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {Math.round(opt * 100)}%
              </button>
            );
          })}
        </div>
      </div>

      {/* Big all-time reserve figure */}
      <div>
        <p
          className="text-ds-24 sm:text-ds-28 font-bold tabular-nums leading-none"
          style={{ color: "hsl(var(--ink-deep))" }}
          title={feesUnknown ? "No platform fee is recorded on any captured job, so there is no fee base to reserve against." : undefined}
        >
          {statsLoading || feesUnknown ? "—" : money(reserveAllTime)}
        </p>
        <p className="text-ds-11 mt-1 leading-snug" style={feesUnknown ? { color: "hsl(var(--amber-ink))" } : undefined}>
          {feesUnknown ? (
            <>
              No platform fee is recorded on any captured job, so there is no fee base to reserve against.
              Reconcile the fee columns before trusting a reserve figure.
            </>
          ) : (
            <span className="text-muted-foreground">
              {Math.round(rate * 100)}% of {statsLoading ? "—" : money(totalFees)} all-time platform fees.
              A conservative estimate on gross revenue — actual tax owed is lower after expenses.
            </span>
          )}
        </p>
      </div>

      {/* This-quarter row + next due date */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/50">
        <div>
          <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">This quarter</p>
          <p className="text-ds-15 font-bold tabular-nums mt-0.5" style={{ color: "hsl(var(--ink-deep))" }}>
            {statsLoading || feesUnknown ? "—" : money(reserveThisQuarter)}
          </p>
          <p className="text-ds-10 text-muted-foreground leading-tight">
            {feesUnknown ? "no recorded fees" : <>on {statsLoading ? "—" : money(feesThisQuarter)} in fees</>}
          </p>
        </div>
        <div>
          <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">Next estimate due</p>
          <p className="text-ds-15 font-bold mt-0.5" style={{ color: "hsl(var(--ink-deep))" }}>
            {dueLabel}
          </p>
          <p className="text-ds-10 text-muted-foreground leading-tight">
            IRS quarterly estimated tax
          </p>
        </div>
      </div>

      <p className="text-ds-10 text-muted-foreground leading-snug italic">
        Park this in a separate account as you earn it and pay quarterly estimates — confirm the exact rate with your CPA.
      </p>
    </div>
  );
};
