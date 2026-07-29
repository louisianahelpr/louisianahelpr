import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Zap, Lightbulb, TrendingUp, Gavel, Sparkles } from "lucide-react";
import type { CategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { SectionCard } from "@/components/postjob/SectionCard";
import { categoryPricing, getSmartPrice } from "@/lib/pricingGuide";
import { formatPrice } from "@/lib/format";

export type PricingMode = "set_price" | "accept_bids" | "smart_price";

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
  /** Pricing mode selected by poster. */
  pricingMode: PricingMode;
  setPricingMode: (v: PricingMode) => void;
  /** Accept-bids sub-fields */
  bidCeiling: string;
  setBidCeiling: (v: string) => void;
  bidDeadline: string;
  setBidDeadline: (v: string) => void;
  bidsSealed: boolean;
  setBidsSealed: (v: boolean) => void;
}

// ── Pricing mode card data ────────────────────────────────────────────────────
const MODES: { id: PricingMode; icon: React.ElementType; label: string; sub: string }[] = [
  { id: "set_price",    icon: DollarSign, label: "Set my price",  sub: "I name it"       },
  { id: "accept_bids",  icon: Gavel,      label: "Accept bids",   sub: "Pros propose"    },
  { id: "smart_price",  icon: Sparkles,   label: "Smart Price",   sub: "Helpr picks"     },
];

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
  pricingMode,
  setPricingMode,
  bidCeiling,
  setBidCeiling,
  bidDeadline,
  setBidDeadline,
  bidsSealed,
  setBidsSealed,
}: BudgetSectionProps) {
  const budgetNum = parseFloat(budget) || 0;

  // Smart price midpoint for the selected category
  const smartPrice = getSmartPrice(category);

  // Static category pricing for lowball warning and comps text
  const catPricing = categoryPricing[category] ?? null;

  // Lowball threshold: below 70% of the category minimum
  const lowballFloor = catPricing ? Math.round(catPricing.min * 0.7) : null;
  const showLowballWarning =
    pricingMode === "set_price" &&
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
      {/* ── MODE SELECTOR ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {MODES.map(({ id, icon: Icon, label, sub }) => {
          const active = pricingMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPricingMode(id);
                // Smart Price: auto-fill budget with midpoint
                if (id === "smart_price" && smartPrice != null) {
                  setBudget(smartPrice.toFixed(2));
                }
                // Accept bids: budget is optional — clear any lowball lock
              }}
              aria-pressed={active}
              className="flex flex-col items-center justify-center gap-1 rounded-ds-md px-2 py-3 text-center transition-all"
              style={{
                background: active
                  ? "hsl(var(--bark) / 0.12)"
                  : "hsl(var(--bark) / 0.04)",
                border: active
                  ? "1px solid hsl(var(--bark) / 0.5)"
                  : "0.5px solid hsl(var(--bark) / 0.15)",
              }}
            >
              <Icon
                className="w-4 h-4"
                style={{ color: active ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))" }}
                strokeWidth={2}
              />
              <span
                className="font-display italic font-semibold text-ds-12 leading-tight"
                style={{ color: active ? "hsl(var(--bark))" : "hsl(var(--foreground))" }}
              >
                {label}
              </span>
              <span
                className="font-serif italic text-ds-11 leading-none"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {sub}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── SET MY PRICE MODE ────────────────────────────────────────────── */}
      {pricingMode === "set_price" && (
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

          {/* Comps hint from category pricing */}
          {catPricing && (
            <p
              className="font-serif italic text-ds-12"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Most {catPricing.label} jobs in Louisiana go for ${catPricing.min}–${catPricing.max}
            </p>
          )}

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
                  ${formatPrice(amt)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SMART PRICE MODE ─────────────────────────────────────────────── */}
      {pricingMode === "smart_price" && (
        <div className="space-y-3">
          <Label htmlFor="budget-smart">Budget (auto-set)</Label>
          <CurrencyInput
            id="budget-smart"
            value={budget === "" ? undefined : Number.parseFloat(budget) || undefined}
            onChange={(next) => setBudget(next === undefined ? "" : next.toString())}
            placeholder="0.00"
            className="text-[15px] font-medium opacity-60 cursor-not-allowed"
            aria-label="Auto-set budget in dollars"
            readOnly
            enterKeyHint="done"
          />
          {smartPrice != null && (
            <p className="text-ds-12 text-muted-foreground">
              Helpr set{" "}
              <span className="font-semibold text-foreground tabular-nums">${smartPrice}</span>{" "}
              based on typical <span className="lowercase">{catPricing?.label ?? category}</span> jobs nearby
            </p>
          )}
          <button
            type="button"
            className="text-ds-12 underline underline-offset-2"
            style={{ color: "hsl(var(--bark))" }}
            onClick={() => {
              // Switch to set_price, preserving the smart price as a starting point
              setPricingMode("set_price");
            }}
          >
            Change it anyway
          </button>
        </div>
      )}

      {/* ── ACCEPT BIDS MODE ─────────────────────────────────────────────── */}
      {pricingMode === "accept_bids" && (
        <div className="space-y-4">
          {/* Explanatory note */}
          <div className="flex items-start gap-2 rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2">
            <Gavel className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-ds-11 text-muted-foreground">
              Pros will propose their own price. You compare and award.
            </p>
          </div>

          {/* Optional ceiling */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-ceiling" className="text-ds-13">
              Set a max budget{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <CurrencyInput
              id="bid-ceiling"
              value={bidCeiling === "" ? undefined : Number.parseFloat(bidCeiling) || undefined}
              onChange={(next) => setBidCeiling(next === undefined ? "" : next.toString())}
              placeholder="$"
              className="text-[15px] font-medium"
              aria-label="Maximum bid ceiling in dollars"
              enterKeyHint="done"
            />
          </div>

          {/* Bid deadline chips */}
          <div className="space-y-1.5">
            <Label className="text-ds-13">
              Bid deadline{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {["24 hours", "48 hours", "1 week"].map((opt) => {
                const active = bidDeadline === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setBidDeadline(active ? "" : opt)}
                    aria-pressed={active}
                    className={`min-h-9 px-4 py-2 rounded-full text-ds-12 font-medium transition-all border ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sealed bids toggle */}
          <div className={`rounded-ds-md border p-4 flex items-center justify-between gap-3 ${bidsSealed ? "border-primary/30 bg-primary/5" : "border-border"}`}>
            <div className="flex flex-col gap-0.5">
              <p className="text-ds-13 font-semibold">Sealed bids</p>
              <p className="text-ds-11 text-muted-foreground">
                Helpers can't see each other's bids
              </p>
            </div>
            <Switch
              id="bids-sealed"
              checked={bidsSealed}
              onCheckedChange={setBidsSealed}
            />
          </div>
        </div>
      )}

      {/* Urgent Job — shown for all modes */}
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
