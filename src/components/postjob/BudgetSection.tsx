import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Zap, Lightbulb, TrendingUp, Sparkles } from "lucide-react";
import type { CategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { SectionCard } from "@/components/postjob/SectionCard";
import { categoryPricing, getSmartPrice } from "@/lib/pricingGuide";
import { formatPrice } from "@/lib/format";

/**
 * PRICING_MODE_REMOVED — 2026-08-19.
 *
 * There is only one way to price a job now: the poster sets the budget.
 *
 * "Accept bids" is gone. In production it had been used exactly ZERO times —
 * no application ever carried a `proposed_price`, no counter-offer was ever
 * sent, no negotiation ever left the 'open' state, and the only four jobs
 * with `pricing_mode = 'accept_bids'` were seeded demo rows. It also carried
 * a live money bug: a bid job still went straight to escrow at post time and
 * charged the hidden fixed-price `budget`, which had nothing to do with the
 * bid ceiling on screen (ceiling $200, charge $95). Fixing that meant
 * choosing a payment model for a feature nobody had used. Deleting it was
 * cheaper and made escrow coherent: one price, agreed up front, held safely.
 *
 * "Smart price" was retired earlier and folded into the suggestion chip.
 *
 * The `jobs.pricing_mode`, `bid_ceiling`, `bid_deadline` and `bids_sealed`
 * columns still exist — dropping them is a separate migration — but nothing
 * in the client reads or writes them any more, and `pricing_mode` keeps its
 * 'set_price' default for the rows that remain.
 */

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
  /** Current job category — used for smart-price midpoint lookup. */
  category?: string;
}

/**
 * The static category suggestion, with a one-tap way to take it.
 *
 * This is where the retired "Smart Price" mode went. That mode's entire
 * contribution was the midpoint of this very range, pre-filled — so it is
 * offered here as a chip instead of as a third card the poster has to choose
 * between. Reading the suggestion and accepting it are now one gesture rather
 * than two screens.
 *
 * The chip is hidden when the midpoint is already the current budget: an
 * action that would change nothing should not look available.
 */
function SuggestionBox({
  budget,
  suggested,
  smartPrice,
  onUse,
}: {
  suggested: BudgetSuggestion;
  budget: string;
  smartPrice: number | null;
  onUse: (v: string) => void;
}) {
  // Once the suggestion has been taken, the box has done its job — it would
  // otherwise sit there restating a number the field already shows. Compared
  // numerically so "60" and "60.00" both count as taken.
  const taken =
    smartPrice != null &&
    budget.trim() !== "" &&
    Number(budget) === Number(smartPrice.toFixed(2));
  if (taken) return null;

  return (
    <div className="flex items-center gap-2 rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2">
      <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2} />
      <p className="text-ds-11 text-muted-foreground">
        Suggested: <span className="font-semibold text-primary">${suggested.min}–${suggested.max}</span> for {suggested.label} jobs
      </p>
      {smartPrice != null && (
        <button
          type="button"
          onClick={() => onUse(smartPrice.toFixed(2))}
          className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-ds-11 font-semibold tabular-nums text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
          Use ${smartPrice}
        </button>
      )}
    </div>
  );
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
  category = "other",
}: BudgetSectionProps) {
  const budgetNum = parseFloat(budget) || 0;

  // Smart price midpoint for the selected category
  const smartPrice = getSmartPrice(category);

  // Static category pricing for lowball warning and comps text
  const catPricing = categoryPricing[category] ?? null;

  // Lowball threshold: below 70% of the category minimum
  const lowballFloor = catPricing ? Math.round(catPricing.min * 0.7) : null;
  const showLowballWarning =
    budgetNum > 0 &&
    lowballFloor != null &&
    budgetNum < lowballFloor;

  // Urgent bonus has a hard $5 floor. Surface it inline (same pattern as
  // the lowball warning) the moment a user types a sub-$5 amount, so the
  // rule isn't a silent submit-time rejection.
  const urgentFeeNum = parseFloat(urgentFee) || 0;
  const showUrgentMinWarning = isUrgent && urgentFee.trim() !== "" && urgentFeeNum < 5;

  return (
    <SectionCard
      stepNumber={stepNumber}
      title="Budget"
      icon={DollarSign}
      complete={budgetComplete}
    >
      {/* No pricing-mode picker. There used to be two cards here, "Set my
          price" and "Accept bids"; bidding is gone (see the note on
          `PRICING_MODE_REMOVED` below) and "Smart price" was folded into the
          suggestion chip before that. A picker offering one option is not a
          choice — it is a step. The poster names a price, which is what all
          but a handful of seeded rows ever did anyway. */}
      {(
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
            className="text-ds-15 font-medium"
            required
            aria-label="Job budget in dollars"
            enterKeyHint="done"
          />

          {/* The category comps line used to live here — "Most Yard Work jobs
              in Louisiana go for $30–$100" — directly above a "Suggested:
              $30–$100 for Yard Work jobs" callout further down. Two sentences,
              same numbers, same category, ~80px apart. Kept the callout (it
              has the lightbulb affordance and sits with the preset pills) and
              removed this one. */}

          {/* Lowball warning */}
          {showLowballWarning && (
            <div
              className="flex items-center gap-2 rounded-ds-md px-3 py-2 border"
              style={{
                background: "hsl(var(--amber-tint) / 0.10)",
                borderColor: "hsl(var(--amber-tint) / 0.30)",
              }}
            >
              <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                Jobs under ${lowballFloor} rarely get applicants
              </p>
            </div>
          )}

          {/* Smart Pricing Guidance — while the RPC is in flight show a
              quiet skeleton so the hint doesn't pop in jarringly; the form
              is never blocked on it. Once resolved, a live range (from real
              completed jobs) is worded as market data; the static fallback
              keeps the original "Suggested" phrasing. */}
          {priceStatsLoading && !priceStats && (
            <div
              className="h-9 rounded-ds-md bg-primary/5 border border-primary/10 motion-safe:animate-pulse"
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
            <SuggestionBox budget={budget} suggested={suggested} smartPrice={smartPrice} onUse={setBudget} />
          )}
          {/* If the stats hook hasn't run yet at all (no category) but a
              static suggestion exists, still show it — keeps parity with
              the previous behavior. */}
          {!priceStats && !priceStatsLoading && suggested && (
            <SuggestionBox budget={budget} suggested={suggested} smartPrice={smartPrice} onUse={setBudget} />
          )}
          {/* Quick-tap budget presets — outline pills so they stay
              secondary to the budget input above. Only the selected
              preset fills solid. */}
          <div className="flex gap-2 pt-1 min-w-0 overflow-x-auto pb-1 pr-5 scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
            {budgetPresets.map((amt) => {
              const isActive = parseFloat(budget) === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setBudget(amt.toFixed(2))}
                  aria-pressed={isActive}
                  className={`shrink-0 whitespace-nowrap min-h-11 px-4 py-2 rounded-full text-ds-13 font-semibold tabular-nums transition-all border ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                      : "bg-transparent text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                  }`}
                >
                  ${formatPrice(amt)}
                </button>
              );
            })}
          </div>
        </div>
      )}


      {/* Urgent Job — shown for all modes */}
      <div className={`rounded-ds-md border p-4 space-y-3 ${isUrgent ? "border-accent bg-accent/5" : "border-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            {/* mb-0: <Label> bakes in `mb-2 block` for stacked form fields, which
                in a centred row makes the label box 8px taller at the bottom and
                pushes the text 4px ABOVE the switch's centre line. The W-9 row in
                pages/postjob/FormStep.tsx sidesteps this by using a plain <p>; we
                keep the real <Label> for the htmlFor association and drop the margin. */}
            <Label htmlFor="urgent" className="mb-0 cursor-pointer">Mark as Urgent</Label>
          </div>
          <Switch id="urgent" checked={isUrgent} onCheckedChange={setIsUrgent} />
        </div>
        {isUrgent && (
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              ⚡ For jobs that need doing right away. Nearby Helprs are notified the moment you post, and your bonus goes straight to the Helpr who takes it — no platform fee applied. (To reach more Helprs over time, Boost the post after publishing instead.)
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
                  inputMode="decimal"
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
            {showUrgentMinWarning && (
              <div
                className="flex items-center gap-2 rounded-ds-md px-3 py-2 border"
                style={{
                  background: "hsl(var(--amber-tint) / 0.10)",
                  borderColor: "hsl(var(--amber-tint) / 0.30)",
                }}
              >
                <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  Urgent bonus must be at least $5
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
