// What a tip costs the poster, quoted from the SAME function the server charges
// with (`tipChargeBreakdown`, supabase/functions/_shared/tipFees.ts). The Helpr
// receives 100% of the tip; Stripe's card-processing fee is added on top.
// Every tip prompt (TipDialog, CompletionPrompts) shows this before the poster
// (through TipPicker + TipCostBreakdown below)
// is sent to pay, and Stripe Checkout repeats the same two line items.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { CurrencyInput } from "@/components/ui/currency-input";
import { tipChargeBreakdown, TIP_MAX_CENTS, TIP_MIN_CENTS, type TipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";

/** The server's breakdown for a tip entered in dollars (rounded to whole cents, as create-payment does). */
export function tipQuoteForDollars(tipDollars: number): TipChargeBreakdown {
  return tipChargeBreakdown(Number.isFinite(tipDollars) ? Math.round(tipDollars * 100) : 0);
}

/** Cents as "$12.34" (always two decimals: this is a receipt line). */
export function centsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const MONEY = "hsl(var(--burnt-sienna))";

/**
 * Tip / card processing / you pay / <name> receives, for one amount (boards
 * 180 and 182: one card, rust amounts, "You pay" the big line).
 */
export function TipCostBreakdown({ tipDollars, receiverName }: { tipDollars: number; receiverName?: string }) {
  const q = tipQuoteForDollars(tipDollars);
  if (q.tipCents <= 0) return null;
  const row = (label: string, cents: number, big = false) => (
    <div className={`flex items-baseline justify-between gap-4 ${big ? "pt-2 mt-1 border-t" : ""}`} style={big ? { borderColor: "hsl(var(--olivewood) / 0.12)" } : undefined}>
      <dt className={`font-sans ${big ? "font-bold text-ds-16" : "text-ds-14"}`} style={{ color: "hsl(var(--ink-deep))" }}>{label}</dt>
      <dd className={`tabular-nums font-sans font-bold ${big ? "text-ds-22" : "text-ds-14"}`} style={{ color: MONEY }}>{centsLabel(cents)}</dd>
    </div>
  );
  return (
    <div className="rounded-ds-lg p-4" style={{ background: "hsl(var(--card))", boxShadow: "0 4px 18px rgba(32,30,26,0.06)" }}>
      <dl className="space-y-1" aria-label="Tip cost breakdown">
        {row("Tip", q.tipCents)}
        {row("Card processing", q.feeCents)}
        {row("You pay", q.chargeCents, true)}
        {row(`${receiverName ? receiverName.trim().split(/\s+/)[0] : "Your Helpr"} receives`, q.helperCents)}
      </dl>
      <p className="font-sans text-ds-12 mt-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Tips go 100% to them. Card processing is added on top.
      </p>
    </div>
  );
}

/**
 * The tip amount picker (board 180): 10 / 15 / 20% of the job price, or Other.
 * Percent presets need a price they can be a percent OF, and every one of them
 * inside create-payment's bounds; otherwise (no price yet, a small job whose
 * 10% is under the minimum) the row falls back to whole-dollar presets, so no
 * button ever offers an amount the server would refuse. Amounts are whole
 * cents (the server's own `Math.round(amount * 100)`).
 */
export function TipPicker({ jobPriceDollars, valueDollars, onChange }: {
  /** The price this Helpr's share of the job was (budget, or budget / crew size). */
  jobPriceDollars: number | null;
  valueDollars: number | undefined;
  onChange: (dollars: number | undefined) => void;
}) {
  const inBounds = (cents: number) => cents >= TIP_MIN_CENTS && cents <= TIP_MAX_CENTS;
  const pct = jobPriceDollars && jobPriceDollars > 0
    ? [10, 15, 20].map((p) => ({ label: `${p}%`, cents: Math.round(jobPriceDollars * p) }))
    : [];
  const presets = pct.length > 0 && pct.every((x) => inBounds(x.cents))
    ? pct
    : [5, 10, 20].map((d) => ({ label: `$${d}`, cents: d * 100 }));
  const valueCents = valueDollars === undefined ? undefined : Math.round(valueDollars * 100);
  const presetHit = presets.find((x) => x.cents === valueCents);
  const [other, setOther] = useState(valueCents !== undefined && !presetHit);
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Tip amount" className="grid grid-cols-4 gap-2">
        {presets.map((x) => {
          const on = !other && valueCents === x.cents;
          return (
            <button
              key={x.label}
              type="button"
              aria-pressed={on}
              onClick={() => { setOther(false); onChange(x.cents / 100); }}
              className={`min-h-14 rounded-ds-md px-1 py-2 font-sans transition-all active:scale-[0.97] ${on ? "btn-grad-primary" : ""}`}
              style={on ? { color: "hsl(var(--parchment))" } : { background: "hsl(var(--card))", color: "hsl(var(--ink-deep))", border: "1px solid hsl(var(--olivewood) / 0.22)" }}
            >
              <span className="block font-bold text-ds-15">{x.label}</span>
              {x.label.endsWith("%") && <span className="block text-ds-11 tabular-nums">{centsLabel(x.cents)}</span>}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={other}
          onClick={() => { setOther(true); onChange(undefined); }}
          className={`min-h-14 rounded-ds-md px-1 py-2 font-sans font-bold text-ds-15 transition-all active:scale-[0.97] ${other ? "btn-grad-primary" : ""}`}
          style={other ? { color: "hsl(var(--parchment))" } : { background: "hsl(var(--card))", color: "hsl(var(--ink-deep))", border: "1px solid hsl(var(--olivewood) / 0.22)" }}
        >
          Other
        </button>
      </div>
      {other && (
        <CurrencyInput
          id="tip-other-amount"
          className="text-ds-17 font-semibold"
          value={valueDollars}
          onChange={onChange}
          min={TIP_MIN_CENTS / 100}
          aria-label="Tip amount in dollars"
        />
      )}
    </div>
  );
}

/**
 * The job a tip is for: its title and the price ONE Helpr's share was (the
 * budget, or budget / crew size on a crew job, where a tip goes to one member).
 * The base the percent presets are a percent of; null while loading.
 */
export function useTipJob(jobId: string): { title: string; shareDollars: number } | null {
  const { data } = useQuery({
    queryKey: ["tip-job", jobId],
    queryFn: async () =>
      unwrap(
        await supabase.from("jobs").select("title, budget, is_group_job, helpers_needed").eq("id", jobId).maybeSingle(),
      ) as { title: string; budget: number | null; is_group_job: boolean | null; helpers_needed: number | null } | null,
    staleTime: 60_000,
  });
  if (!data || data.budget == null) return null;
  const crew = data.is_group_job && (data.helpers_needed ?? 0) > 1 ? data.helpers_needed! : 1;
  return { title: data.title, shareDollars: Number(data.budget) / crew };
}
