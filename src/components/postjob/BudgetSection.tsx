import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Zap, Lightbulb, TrendingUp } from "lucide-react";
import type { CategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { SectionCard } from "@/components/postjob/SectionCard";

interface BudgetSuggestion {
  min: number;
  max: number;
  label: string;
}

interface BudgetSectionProps {
  /** 1-based chapter number for the section header. */
  stepNumber: number;
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
  stepNumber,
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
    <SectionCard
      stepNumber={stepNumber}
      eyebrow="Money"
      title="Budget"
      icon={DollarSign}
      complete={budgetComplete}
    >
      <div className="space-y-3">
        <Label htmlFor="budget">Budget <span className="text-destructive">*</span></Label>
        {/* CurrencyInput stores the value as a number, but the parent form
            still keeps `budget` as a string (it's threaded through draft
            persistence and validation that expect a string). Convert at
            this boundary only — `""` ↔ `undefined`, else `toString()`. */}
        <CurrencyInput
          id="budget"
          value={budget === "" ? undefined : Number.parseFloat(budget) || undefined}
          onChange={(next) => setBudget(next === undefined ? "" : next.toString())}
          placeholder="50.00"
          className="text-[15px] font-medium"
          required
          aria-label="Job budget in dollars"
          enterKeyHint="done"
        />
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
    </SectionCard>
  );
}
