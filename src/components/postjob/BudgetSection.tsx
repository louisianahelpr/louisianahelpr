import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Zap, Gift } from "lucide-react";
import { SectionCard } from "@/components/postjob/SectionCard";
import { formatPriceExact } from "@/lib/format";
import { MIN_JOB_BUDGET_DOLLARS, MAX_JOB_BUDGET_DOLLARS, MAX_URGENT_FEE_DOLLARS, URGENT_FEE_FLOOR_DOLLARS, formatDollarsWhole } from "@/lib/moneyLimits";

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
 * The bid columns (`applications.proposed_price` / `counter_price` /
 * `negotiation_status` / `proposed_rate` and `jobs.bid_ceiling` /
 * `bid_deadline` / `bids_sealed`), the counter-offer RPCs and the
 * `trg_enforce_bid_price_lock` trigger were all dropped on 2026-08-27.
 * `jobs.pricing_mode` survives — its CHECK now allows only 'set_price', and
 * the `open_jobs_browse` view still projects it.
 */

interface BudgetSectionProps {
  /** 1-based chapter number for the section header. */
  stepNumber: number;
  budget: string;
  setBudget: (v: string) => void;
  isUrgent: boolean;
  setIsUrgent: (v: boolean) => void;
  urgentFee: string;
  setUrgentFee: (v: string) => void;
  customUrgentFee: boolean;
  setCustomUrgentFee: (v: boolean) => void;
  budgetComplete: boolean;
  /**
   * Value of the gift card funding this post, in dollars, or 0.
   *
   * Shown as a note beside the budget field — NOT prefilled into it. The gift
   * is money off a job the poster prices themselves ("deducted off the amount
   * they choose to spend"), so seeding the field with the gift's value would
   * quietly argue a poster who wants a $120 job down to exactly $75. The note
   * carries the reassurance the gift survived the trip; the field stays
   * theirs.
   */
  giftAmount?: number;
}


export function BudgetSection({
  stepNumber,
  budget,
  setBudget,
  isUrgent,
  setIsUrgent,
  urgentFee,
  setUrgentFee,
  customUrgentFee,
  setCustomUrgentFee,
  budgetComplete,
  giftAmount = 0,
}: BudgetSectionProps) {
  const budgetNum = parseFloat(budget) || 0;

  // Below the posting minimum. Owner, 2026-10-01: typed $5.00 and the button
  // stayed "Set a Budget to Continue" with nothing saying why — budgetComplete
  // needs MIN_JOB_BUDGET_DOLLARS and no line on the form named it. Said here,
  // in place of the lowball hint (a budget that cannot be posted at all is the
  // stronger message, and two amber boxes would say the same thing twice).
  const underBudgetMin = budgetNum > 0 && budgetNum < MIN_JOB_BUDGET_DOLLARS;

  // Urgent bonus has a hard floor. Surface it inline (same pattern as the
  // lowball warning) the moment a user types a sub-floor amount, so the rule
  // isn't a silent submit-time rejection.
  //
  // The number comes from moneyLimits, not from here. That module's own header
  // says every screen naming one of these figures MUST import it — "that is how
  // the '$5 min' vs '$10 min' drift happened". useJobSubmit obeyed it; this
  // file, the FORM the poster actually reads, hand-typed the floor. If the form
  // and the validator ever disagree, the user is shown a minimum the submit
  // path then rejects.
  const overBudgetCap = (parseFloat(budget) || 0) > MAX_JOB_BUDGET_DOLLARS;
  const urgentFeeNum = parseFloat(urgentFee) || 0;
  const showUrgentMinWarning =
    isUrgent && urgentFee.trim() !== "" && urgentFeeNum < URGENT_FEE_FLOOR_DOLLARS;
  // The bonus cap ($250, Q210(c)) is the shared constant create-payment and the
  // jobs_urgent_fee_ceiling CHECK use; said here before submit refuses it.
  const showUrgentMaxWarning = isUrgent && urgentFeeNum > MAX_URGENT_FEE_DOLLARS;

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
          <Label htmlFor="budget">Budget <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
          {/* CurrencyInput stores the value as a number, but the parent form
              still keeps `budget` as a string (it's threaded through draft
              persistence and validation that expect a string). Convert at
              this boundary only — `""` ↔ `undefined`, else `toString()`. */}
          <CurrencyInput
            id="budget"
            value={budget === "" ? undefined : Number.parseFloat(budget) || undefined}
            onChange={(next) => setBudget(next === undefined ? "" : next.toString())}
            className="text-ds-15 font-medium"
            required
            aria-label="Job budget in dollars"
            enterKeyHint="done"
          />
          {/* Gift note — the answer to "where did my gift card go?".
              Deliberately phrased as a DEDUCTION off whatever they choose,
              not as a budget suggestion: the field above stays the poster's
              number, and the subtraction is shown for real at checkout. */}
          {giftAmount > 0 && (
            <p
              className="flex items-start gap-1.5 text-ds-12 leading-snug"
              style={{ color: "hsl(var(--success-ink))" }}
            >
              <Gift className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              <span>
                You have a{" "}
                <span className="font-semibold">${formatPriceExact(giftAmount)}</span>{" "}
                gift card. Set whatever budget the job is worth — the gift comes
                off your total at checkout.
              </span>
            </p>
          )}

          {/* The category comps line used to live here — "Most Yard Work jobs
              in Louisiana go for $30–$100" — directly above a "Suggested:
              $30–$100 for Yard Work jobs" callout further down. Two sentences,
              same numbers, same category, ~80px apart. Kept the callout (it
              has the lightbulb affordance and sits with the preset pills) and
              removed this one. */}

          {underBudgetMin && (
            <div
              className="flex items-center gap-2 rounded-ds-md px-3 py-2 border"
              style={{
                background: "hsl(var(--amber-tint) / 0.10)",
                borderColor: "hsl(var(--amber-tint) / 0.30)",
              }}
              role="status"
            >
              <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                The minimum budget is {formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)}.
              </p>
            </div>
          )}


          {/* No lowball warning, suggested range or preset prices (owner,
              2026-10-08: "remove the suggested prices from post a job ... also
              remove jobs under rarely get applications"). The poster sets the
              price; the minimum and the cap below are the only rules. */}
          {/* Price cap (Q202, $1,000 since 2026-09-23). Said the moment the
              typed budget passes it, not only as a submit-time toast. The
              number is the shared constant the server and the DB CHECK use. */}
          {overBudgetCap && (
            <div
              className="flex items-center gap-2 rounded-ds-md px-3 py-2 border"
              style={{
                background: "hsl(var(--amber-tint) / 0.10)",
                borderColor: "hsl(var(--amber-tint) / 0.30)",
              }}
              role="status"
            >
              <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                The most a job can be is {formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}. Split a bigger project into separate jobs.
              </p>
            </div>
          )}

        </div>
      )}


      {/* Urgent Job — shown for all modes */}
      {/* Same surface as every other block on this form when it is OFF, and
          an accent wash when it is ON — the toggle's state is the only thing
          that should change its appearance. It used to sit in a bare
          hairline-bordered box that matched nothing else on the page (owner:
          "polish and fill space better"). */}
      <div
        className="rounded-ds-lg p-4 space-y-3 transition-colors"
        style={
          isUrgent
            ? {
                background: "hsl(var(--accent) / 0.07)",
                border: "1px solid hsl(var(--accent) / 0.45)",
              }
            : {
                background: "hsl(var(--parchment) / 0.5)",
                border: "1px solid hsl(var(--olivewood) / 0.12)",
              }
        }
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            {/* mb-0: <Label> bakes in `mb-2 block` for stacked form fields, which
                in a centred row makes the label box 8px taller at the bottom and
                pushes the text 4px ABOVE the switch's centre line. The W-9 row in
                pages/post-job/FormStep.tsx sidesteps this by using a plain <p>; we
                keep the real <Label> for the htmlFor association and drop the margin. */}
            <Label htmlFor="urgent" className="mb-0 cursor-pointer">Mark as Urgent</Label>
          </div>
          <Switch id="urgent" checked={isUrgent} onCheckedChange={setIsUrgent} />
        </div>
        {isUrgent && (
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              ⚡ For jobs that need doing right away. Nearby Helprs are notified the moment you post, and the Helpr who takes it gets all of your bonus — no platform fee, and its small card fee is added on top at checkout. (To reach more Helprs over time, Boost the post after publishing instead.)
            </p>
            <Label className="text-ds-11">Urgent Bonus ({formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)} Minimum, {formatDollarsWhole(MAX_URGENT_FEE_DOLLARS)} Maximum)</Label>
            <div className="flex flex-wrap gap-2">
              {["5", "10", "15", "20"].map((amt) => (
                <button
                  aria-pressed={urgentFee === amt && !customUrgentFee}
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
                  Custom Bonus
                </Label>
                <Input
                  id="custom-urgent-fee"
                  type="number"
                  inputMode="decimal"
                  min="5"
                  max={MAX_URGENT_FEE_DOLLARS}
                  step="1"
                  value={urgentFee}
                  onChange={(e) => setUrgentFee(e.target.value)}
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
            {showUrgentMaxWarning && (
              <div
                className="flex items-center gap-2 rounded-ds-md px-3 py-2 border"
                style={{
                  background: "hsl(var(--amber-tint) / 0.10)",
                  borderColor: "hsl(var(--amber-tint) / 0.30)",
                }}
                role="status"
              >
                <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  The most an urgent bonus can be is {formatDollarsWhole(MAX_URGENT_FEE_DOLLARS)}.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
