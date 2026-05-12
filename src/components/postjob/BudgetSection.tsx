import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Zap, CheckCircle2 } from "lucide-react";

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="font-display text-ds-15 font-semibold">Budget</h2>
        </div>
        {budgetComplete && <CheckCircle2 className="w-4 h-4 text-primary" />}
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
        {suggested && (
          <div className="flex items-center gap-2 rounded-ds-md bg-primary/5 border border-primary/15 px-3 py-2">
            <span className="text-ds-15 leading-none">💡</span>
            <p className="text-ds-11 text-muted-foreground">
              Suggested: <span className="font-semibold text-primary">${suggested.min}–${suggested.max}</span> for {suggested.label} jobs
            </p>
          </div>
        )}
        {/* Quick-tap budget presets */}
        <div className="flex flex-wrap gap-2 pt-1">
          {budgetPresets.map((amt) => {
            const isActive = parseFloat(budget) === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => setBudget(amt.toFixed(2))}
                aria-pressed={isActive}
                className={`min-h-11 px-4 py-2 rounded-full text-ds-13 font-semibold tabular-nums transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
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
