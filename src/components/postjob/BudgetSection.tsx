import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Zap, CheckCircle2, Lightbulb, TrendingUp } from "lucide-react";
import type { CategoryPriceStats } from "@/hooks/useCategoryPriceStats";

interface BudgetSuggestion {
  min: number;
  max: number;
  label: string;
}

interface BudgetSectionProps {
  budget: string;
  setBudget: (v: string) => void;
  suggested: BudgetSuggestion | null;
  budgetPresets: number[];
  /** Smart Pricing Guidance — live range from real completed jobs. */
  priceStats: CategoryPriceStats | null;
  /** True while the price-stats RPC is in flight (renders a skeleton). */
  priceStatsLoading: boolean;
  isUrgent: boolean;
  setIsUrgent: (v: boolean) => void;
  urgentFee: string;
  setUrgentFee: (v: string) => void;
  customUrgentFee: boolean;
  setCustomUrgentFee: (v: boolean) => void;
  budgetComplete: boolean;
}

export function BudgetSection({
  budget,
  setBudget,
  suggested,
  budgetPresets,
  priceStats,
  priceStatsLoading,
  isUrgent,
  setIsUrgent,
  urgentFee,
  setUrgentFee,
  customUrgentFee,
  setCustomUrgentFee,
  budgetComplete,
}: BudgetSectionProps) {
  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-5 shadow-sm">
      {/* Brand-aligned section header — bigger icon (w-9), font-display
          italic font-bold title, eyebrow above. Unified across all 3
          PostJob sections (Details / Logistics / Budget). */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4 text-primary" />
          </div>
          <div className="leading-none min-w-0">
            <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              Money
            </p>
            <h2 className="font-display italic font-bold mt-1" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Budget
            </h2>
          </div>
        </div>
        {budgetComplete && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
      </div>

      <div className="space-y-3">
        <Label htmlFor="budget">Budget <span className="text-destructive">*</span></Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-muted-foreground">$</span>
          <Input
            id="budget"
            type="text"
            inputMode="decimal"
            value={budget}
            onChange={(e) => {
              // Keep digits and a single decimal point only — store as plain number string
              const cleaned = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*?)\..*/g, "$1");
              setBudget(cleaned);
            }}
            onBlur={(e) => {
              const n = parseFloat(e.target.value);
              if (!Number.isNaN(n) && n > 0) setBudget(n.toFixed(2));
            }}
            placeholder="50.00"
            className="pl-8 text-[15px] font-medium tabular-nums"
            required
          />
        </div>
        {/* Smart Pricing Guidance — while the RPC is in flight show a
            quiet skeleton so the hint doesn't pop in jarringly; the form
            is never blocked on it. Once resolved, a live range (from real
            completed jobs) is worded as market data; the static fallback
            keeps the original "Suggested" phrasing. */}
        {priceStatsLoading && !priceStats && (
          <div
            className="h-9 rounded-ds-md bg-primary/5 border border-primary/10 animate-pulse"
            aria-hidden="true"
          />
        )}
        {!priceStatsLoading && priceStats && priceStats.source === "live" && (
          <div className="flex items-start gap-2 rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-ds-11 text-muted-foreground">
              {priceStats.parishMatch ? "Jobs like this near you pay " : "Jobs like this pay "}
              <span className="font-semibold text-primary tabular-nums">
                ${priceStats.min}–${priceStats.max}
              </span>
              {priceStats.median !== null && (
                <>
                  {" "}
                  (most around{" "}
                  <span className="font-semibold text-primary tabular-nums">
                    ${priceStats.median}
                  </span>
                  )
                </>
              )}
              <span className="block text-ds-9 text-muted-foreground/70 mt-0.5">
                Based on {priceStats.sampleCount} completed{" "}
                {priceStats.sampleCount === 1 ? "job" : "jobs"}
                {priceStats.parishMatch ? " in your parish" : " across Louisiana"}
              </span>
            </p>
          </div>
        )}
        {!priceStatsLoading && priceStats && priceStats.source === "static" && suggested && (
          <div className="flex items-center gap-2 rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2">
            <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2} />
            <p className="text-ds-11 text-muted-foreground">
              Suggested: <span className="font-semibold text-primary">${suggested.min}–${suggested.max}</span> for {suggested.label} jobs
            </p>
          </div>
        )}
        {/* If the stats hook hasn't run yet at all (no category) but a
            static suggestion exists, still show it — keeps parity with
            the previous behavior. */}
        {!priceStats && !priceStatsLoading && suggested && (
          <div className="flex items-center gap-2 rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2">
            <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2} />
            <p className="text-ds-11 text-muted-foreground">
              Suggested: <span className="font-semibold text-primary">${suggested.min}–${suggested.max}</span> for {suggested.label} jobs
            </p>
          </div>
        )}
        {/* Quick-tap budget presets — outline pills so they stay
            secondary to the budget input above. Only the selected
            preset fills solid. */}
        <div className="flex flex-wrap gap-2 pt-1">
          {budgetPresets.map((amt) => {
            const isActive = parseFloat(budget) === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => setBudget(amt.toFixed(2))}
                aria-pressed={isActive}
                className={`min-h-11 px-4 py-2 rounded-full text-ds-13 font-semibold tabular-nums transition-all border ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                    : "bg-transparent text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                ${amt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Urgent Job */}
      <div className={`rounded-ds-md border p-4 space-y-3 ${isUrgent ? "border-accent bg-accent/5" : "border-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            <Label htmlFor="urgent" className="cursor-pointer">Mark as Urgent</Label>
          </div>
          <Switch id="urgent" checked={isUrgent} onCheckedChange={setIsUrgent} />
        </div>
        {isUrgent && (
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              ⚡ Your job will be highlighted and nearby helprs notified immediately. The urgent bonus goes directly to the helpr — no platform fee applied.
            </p>
            <Label className="text-ds-11">Urgent bonus ($5 minimum)</Label>
            <div className="flex flex-wrap gap-2">
              {["5", "10", "15", "20"].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => { setUrgentFee(amt); setCustomUrgentFee(false); }}
                  className={`px-3 py-1.5 rounded-full text-ds-11 font-medium transition-colors ${
                    urgentFee === amt && !customUrgentFee
                      ? "bg-accent text-accent-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  ${amt}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setCustomUrgentFee(true); setUrgentFee(""); }}
                className={`px-3 py-1.5 rounded-full text-ds-11 font-medium transition-colors ${
                  customUrgentFee
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                Custom
              </button>
            </div>
            {customUrgentFee && (
              <div className="flex items-center gap-2 mt-1">
                <Label htmlFor="custom-urgent-fee" className="text-ds-11 font-sans text-muted-foreground shrink-0">
                  Custom bonus
                </Label>
                <Input
                  id="custom-urgent-fee"
                  type="number"
                  inputMode="numeric"
                  min="5"
                  step="1"
                  value={urgentFee}
                  onChange={(e) => setUrgentFee(e.target.value)}
                  placeholder="$25"
                  className="w-32"
                  aria-label="Custom urgent fee amount in dollars"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
