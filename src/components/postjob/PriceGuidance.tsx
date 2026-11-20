import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPostJob";

/**
 * Owner 2026-11-20 (ease batch, item 1): a fair price hint from recent similar jobs near the poster, computed on the
 * server (get_fair_price_hint, 20261120205106) from REAL non-seed jobs: "near" = 5+ jobs from 3+ posters within 25
 * miles, "state" = the same statewide, "typical" = a fixed starting range for the category when real data is thin
 * (and the only answer a guest gets). Each scope says what it is: only a real range says "near you" or "on Helpr".
 * It replaced board 190's statewide get_price_guidance (30+ completed jobs, testers switch), which never showed.
 */
export interface FairPriceHint {
  scope: "near" | "state" | "typical";
  count: number | null;
  low: number;
  high: number;
}

/** The hint for a category; null while loading, on an error (reported), or for a category with no range. */
export function useFairPriceHint(category: string | null | undefined): FairPriceHint | null {
  const { profile } = useCurrentUser();
  // The member's saved point (profiles.latitude/longitude); without one the server answers statewide.
  const lat = typeof profile?.latitude === "number" ? Math.round(profile.latitude * 100) / 100 : null;
  const lng = typeof profile?.longitude === "number" ? Math.round(profile.longitude * 100) / 100 : null;
  const { data } = useQuery({
    queryKey: ["fair-price-hint", category ?? null, lat, lng, !!profile],
    enabled: !!category,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<FairPriceHint | null> => {
      const { data: rows, error } = await supabase.rpc("get_fair_price_hint", { p_category: category as string, ...(lat !== null && lng !== null ? { p_lat: lat, p_lng: lng } : {}) });
      if (error) {
        // A brand-new RPC not yet deployed (PGRST202) is expected for a few minutes after a merge: the card is left out.
        if (!isMissingRpcNamed(error, "get_fair_price_hint")) report(error, { severity: "warning", tags: { source: "useFairPriceHint" } });
        return null;
      }
      const r = Array.isArray(rows) ? rows[0] : null;
      if (!r || r.low_dollars == null || r.high_dollars == null) return null;
      const scope = r.scope === "near" || r.scope === "state" ? r.scope : "typical";
      return { scope, count: r.sample_count ?? null, low: r.low_dollars, high: r.high_dollars };
    },
  });
  return data ?? null;
}

/**
 * The card under the price: "Most yard jobs near you are $40–$80", a bar with a marker at the poster's price; below
 * the range, a gentle nudge with "Use $40" / "Keep $25". Nothing while there is no range.
 */
export function PriceGuidanceCard({ category, budget, onUse }: { category: string; budget: number; onUse: (dollars: number) => void }) {
  const g = useFairPriceHint(category);
  return g ? <PriceGuidanceView g={g} category={category} budget={budget} onUse={onUse} /> : null;
}

const MONEY = { color: "hsl(var(--burnt-sienna))" } as const;

function PriceGuidanceView({ g, category, budget, onUse }: { g: FairPriceHint; category: string; budget: number; onUse: (dollars: number) => void }) {
  const { t } = useLanguage();
  const [kept, setKept] = useState<number | null>(null);
  const what = jobCategoryLabel(category).toLowerCase();
  const range = `$${g.low}–$${g.high}`;
  const headline = t(g.scope === "near" ? "postJob.hint.near" : g.scope === "state" ? "postJob.hint.state" : "postJob.hint.typical", { what });
  const source = g.scope === "typical" ? t("postJob.hint.typicalSource") : t("postJob.hint.realSource", { n: g.count ?? 0 });
  const below = budget > 0 && budget < g.low && kept !== budget;
  if (below) {
    return (
      <section aria-label={t("postJob.hint.label")} className="rounded-2xl border border-border bg-card p-4" data-testid="price-guidance-nudge" data-scope={g.scope}>
        <p className="font-semibold text-foreground">{t("postJob.hint.below")}</p>
        <p className="mt-1 text-ds-13 text-muted-foreground">
          {headline} <span className="whitespace-nowrap" style={MONEY}>{range}</span>. {t("postJob.hint.belowWhy")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setKept(budget)}>
            {t("postJob.hint.keep", { n: budget })}
          </Button>
          <Button type="button" size="sm" className="btn-grad-primary" onClick={() => onUse(g.low)}>
            {t("postJob.hint.use", { n: g.low })}
          </Button>
        </div>
      </section>
    );
  }
  // Marker position on a bar whose middle half is the range (the range sits from 25% to 75%).
  const span = g.high - g.low || 1;
  const pos = budget > 0 ? Math.min(100, Math.max(0, 25 + ((budget - g.low) / span) * 50)) : null;
  return (
    <section aria-label={t("postJob.hint.label")} className="rounded-2xl border border-border bg-card p-4" data-testid="price-guidance" data-scope={g.scope}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold text-foreground">{headline}</p>
        <p className="shrink-0 whitespace-nowrap font-semibold tabular-nums" style={MONEY}>{range}</p>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-y-0 left-1/4 right-1/4 rounded-full" style={{ background: "hsl(var(--burnt-sienna) / 0.18)" }} />
        {pos !== null && (
          <div className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full" style={{ left: `${pos}%`, background: "hsl(var(--burnt-sienna))" }} />
        )}
      </div>
      <p className="mt-2 text-ds-13 text-muted-foreground">
        {source}
        {budget > 0 ? ` ${t("postJob.hint.youre", { n: budget })}` : ""}
      </p>
    </section>
  );
}
