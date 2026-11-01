import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFeature } from "@/hooks/useFeature";
import { report } from "@/lib/errorLogger";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { Button } from "@/components/ui/button";

/** What most real completed jobs in a category paid (get_price_guidance, 20261021054721). */
interface PriceGuidance {
  count: number;
  low: number;
  high: number;
}

const MONEY = { color: "hsl(var(--burnt-sienna))" } as const;

/**
 * Board 190: the middle half of what REAL completed jobs in this category paid in the last 90 days.
 * The server returns a range only when 30+ jobs back it (owner: hidden until ~30 real jobs); below that,
 * off ('price_guidance', testers), not deployed or failed, this is null and the screen shows nothing
 * (truth rule: every number is real or hidden).
 */
function usePriceGuidance(category: string | null | undefined): PriceGuidance | null {
  const on = useFeature("price_guidance");
  // Not keyed by member: the answer is a statewide aggregate, the same for everyone (signed out reads 0).
  const { data } = useQuery({
    queryKey: ["price-guidance", category ?? null],
    enabled: on && !!category,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<PriceGuidance | null> => {
      const { data: rows, error } = await supabase.rpc("get_price_guidance", { p_category: category as string });
      if (error) {
        // 42501 = feature_disabled when the switch flips off mid-session: expected, not a warning.
        if (!isMissingRpcNamed(error, "get_price_guidance") && error.code !== "42501") report(error, { severity: "warning", tags: { source: "usePriceGuidance" } });
        return null;
      }
      const r = Array.isArray(rows) ? rows[0] : null;
      if (!r || r.low_dollars == null || r.high_dollars == null || !(r.sample_count > 0)) return null;
      return { count: r.sample_count, low: r.low_dollars, high: r.high_dollars };
    },
  });
  return on && data ? data : null;
}

/**
 * The card under the price (board 190): "Most jobs paid $80–$120", a bar with a marker at the poster's
 * price, the count and window; below the range, a gentle nudge with "Use $80" / "Keep $40". Nothing at
 * all when there is no real range.
 */
export function PriceGuidanceCard({ category, budget, onUse }: { category: string; budget: number; onUse: (dollars: number) => void }) {
  const g = usePriceGuidance(category);
  return g ? <PriceGuidanceView g={g} category={category} budget={budget} onUse={onUse} /> : null;
}

/** The card itself, for a range the server returned. */
function PriceGuidanceView({ g, category, budget, onUse }: { g: PriceGuidance; category: string; budget: number; onUse: (dollars: number) => void }) {
  const [kept, setKept] = useState<number | null>(null);
  const what = jobCategoryLabel(category).toLowerCase();
  const range = `$${g.low}–$${g.high}`;
  const below = budget > 0 && budget < g.low && kept !== budget;
  if (below) {
    return (
      <section aria-label="Price guidance" className="rounded-2xl border border-border bg-card p-4" data-testid="price-guidance-nudge">
        <p className="font-semibold text-foreground">That's below what most jobs paid</p>
        <p className="mt-1 text-ds-13 text-muted-foreground">
          Most {what} jobs on Helpr paid <span className="whitespace-nowrap" style={MONEY}>{range}</span>. Lower prices usually take longer to fill.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setKept(budget)}>
            Keep ${budget}
          </Button>
          <Button type="button" size="sm" className="btn-grad-primary" onClick={() => onUse(g.low)}>
            Use ${g.low}
          </Button>
        </div>
      </section>
    );
  }
  // Marker position on a bar whose middle half is the range (the range sits from 25% to 75%).
  const span = g.high - g.low || 1;
  const pos = budget > 0 ? Math.min(100, Math.max(0, 25 + ((budget - g.low) / span) * 50)) : null;
  return (
    <section aria-label="Price guidance" className="rounded-2xl border border-border bg-card p-4" data-testid="price-guidance">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold text-foreground">Most {what} jobs paid</p>
        <p className="shrink-0 whitespace-nowrap font-semibold tabular-nums" style={MONEY}>{range}</p>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-y-0 left-1/4 right-1/4 rounded-full" style={{ background: "hsl(var(--burnt-sienna) / 0.18)" }} />
        {pos !== null && (
          <div className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full" style={{ left: `${pos}%`, background: "hsl(var(--burnt-sienna))" }} />
        )}
      </div>
      <p className="mt-2 text-ds-13 text-muted-foreground">
        From {g.count} completed jobs on Helpr in the last 90 days.{budget > 0 ? ` You're at $${budget}.` : ""}
      </p>
    </section>
  );
}
