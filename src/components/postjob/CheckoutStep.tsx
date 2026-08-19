import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  ImagePlus,
  MapPin,
  Calendar,
  Repeat,
  Zap,
  CreditCard,
  CheckCircle2,
  Users,
  BookOpen,
  DollarSign,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import type { HelprActivity } from "@/hooks/useHelprActivity";
// formatPriceExact, not formatPrice: this card SHOWS THE ARITHMETIC, which
// is exactly the case format.ts documents the exact variant for. With
// whole-dollar rounding a $50 + $6.50 + $6.50 breakdown rendered as
// 50 + 7 + 7 against a printed total of 63 — the poster can see it not add
// up, on the screen where they decide whether to trust us with a card.
import { formatPriceExact } from "@/lib/format";
import { estimatedSalesTax, hasTaxableLine } from "@/lib/salesTax";
import { useParishTaxRate } from "@/hooks/useParishTaxRate";
import { formatJobDate } from "@/lib/dateUtils";

const isSafeBlobPreviewUrl = (value: string): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "blob:";
  } catch {
    return false;
  }
};

interface CheckoutStepProps {
  title: string;
  description: string;
  categoryLabel: string;
  /** Raw category KEY (e.g. "assembly") — drives LA sales-tax classification.
   *  `categoryLabel` is the display string and can't be matched against the
   *  taxable-category list. */
  category: string;
  imagePreviews: string[];
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  dateNeeded: string;
  startTime: string;
  estimatedHours: string;
  isFlexibleSchedule: boolean;
  specialRequirements: string;
  isRecurring: boolean;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  isUrgent: boolean;
  urgentFeeNum: number;
  budgetNum: number;
  /** Parish-scoped helpr-activity signal, or null when not meaningful. */
  helprActivity: HelprActivity | null;
  customerFee: number | null;
  customerFeeAmount: number;
  /** One-time account-setup fee, in dollars — 0 once the poster has paid it. */
  onboardingFeeAmount: number;
  totalCharge: number;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  /** Opt-in to saving the card for off-session future use (Stripe `setup_future_usage`). */
  saveCardForFuture?: boolean;
  setSaveCardForFuture?: (v: boolean) => void;
  saving: boolean;
  uploading: boolean;
  uploadProgress?: { done: number; total: number } | null;
  onSubmit: () => void;
  /** Poster's parish — shown in the location row when available. */
  parish?: string | null;
  /** Preferred helper stub — shown as a "Send to [name] first?" shortcut
   *  when the poster has a trusted repeat helper set on their profile. */
  preferredHelper?: { id: string; name: string | null } | null;
  /** Whether the "send to preferred helper first" checkbox is checked. */
  sendToPreferred?: boolean;
  /** Callback when the checkbox changes. */
  onSendToPreferredChange?: (checked: boolean) => void;
}

export function CheckoutStep({
  title,
  description,
  categoryLabel,
  category,
  imagePreviews,
  streetAddress,
  city,
  addrState,
  zipCode,
  dateNeeded,
  startTime,
  estimatedHours,
  isFlexibleSchedule,
  specialRequirements,
  isRecurring,
  recurrenceInterval,
  recurrenceEndDate,
  isUrgent,
  urgentFeeNum,
  budgetNum,
  helprActivity,
  customerFee,
  customerFeeAmount,
  onboardingFeeAmount,
  totalCharge,
  confirmed,
  setConfirmed,
  saveCardForFuture,
  setSaveCardForFuture,
  saving,
  uploading,
  uploadProgress,
  onSubmit,
  parish,
  preferredHelper,
  sendToPreferred,
  onSendToPreferredChange,
}: CheckoutStepProps) {
  // Real parish rate from `parish_tax_rates` (seeded for all 64 parishes,
  // world-readable). null until the zip resolves a parish, or if the parish
  // has no row — callers must not invent a rate in that gap.
  const { totalRatePercent: parishTaxRate, loading: parishRateLoading } = useParishTaxRate(parish);
  // Sales tax, resolved ONCE. Both the summary card at the top of the screen
  // and the payment breakdown at the bottom read this — the two used to be
  // computed independently (summary showed `totalCharge`, breakdown added an
  // invented 9-11%), which is exactly why the screen showed two different
  // answers to "what will you charge me".
  //   0    → exempt category: tax is a known zero, the total is exact.
  //   null → taxable category whose parish rate isn't resolved yet.
  const salesTax = estimatedSalesTax(budgetNum, category, parishTaxRate);
  const totalWithTax = totalCharge + (salesTax ?? 0);
  return (
    <>
      {/* A "Review your job before paying" line used to open this card.
          Removed on owner instruction: the screen is already titled "Order
          summary" and carries a DETAILS → REVIEW AND PAY step rail, so it was
          the third statement of the same instruction before any content. */}

      {/* ── Review & Post summary card ─────────────────────────────
          A clean read-only summary of everything the poster set. Shows
          the key fields at a glance so they can catch mistakes before
          committing to payment. The fee breakdown shows both sides:
          "You pay $X · Helper earns $Y" for full transparency.

          Type sizes here are one step up from the rest of the sheet (L6): the
          whole purpose of this card is catching a mistake before paying, and
          the street address a stranger will be sent to was rendering at the
          same size as a legal footnote. */}
      <div className="rounded-ds-md liquid-glass overflow-hidden">
        <div
          className="px-4 py-2.5 flex items-center gap-2 border-b border-border"
          style={{ background: "hsl(var(--bark) / 0.04)" }}
        >
          <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <p
            className="text-ds-10 uppercase tracking-wide font-semibold"
            style={{ color: "hsl(var(--bark))" }}
          >
            Your post at a glance
          </p>
        </div>
        <div className="divide-y divide-border">
          {/* Title + category */}
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Job</span>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-ds-13 font-semibold text-foreground truncate">{title}</p>
              <span
                className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-ds-10 font-semibold capitalize"
                style={{
                  background: "hsl(var(--bark) / 0.09)",
                  color: "hsl(var(--bark))",
                }}
              >
                {categoryLabel}
              </span>
            </div>
          </div>

          {/* Description (clamped to 3 lines) */}
          {description && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Details</span>
              <p
                className="flex-1 text-ds-13 text-foreground leading-relaxed line-clamp-3"
                style={{ wordBreak: "break-word" }}
              >
                {description}
              </p>
            </div>
          )}

          {/* Budget with fee breakdown */}
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            {/* Label is "Total", not "Budget" — it names the figure that now
                leads this row (what the poster is charged), so the label and
                the number agree. */}
            <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
              <DollarSign className="w-3 h-3" />Total
            </span>
            {/* The number that LEAVES the poster's account leads; the budget
                (which does not) is the secondary line.
                It previously read the other way round — budget bold at ds-13,
                "You pay" beneath it at ds-11 — so the smaller figure was the
                real one.

                `totalCharge` is rendered here, NOT re-derived. This used to
                compute `budgetNum + customerFeeAmount + urgentFeeNum +
                onboardingFeeAmount` inline while the breakdown below rendered
                the hook's `totalCharge` — the same formula in two places, 150
                lines apart. They agreed only by coincidence: the moment a fee
                is waived, capped or made conditional in useJobDerived, this
                screen would show the poster two different answers to "what
                will you charge me". One source, both places. */}
            <div className="text-right">
              <p className="text-ds-13 font-bold text-foreground">
                ${formatPriceExact(totalWithTax)}
                {/* A taxable job whose parish isn't known yet can only be
                    quoted pre-tax — mark it rather than let this read as the
                    final number. */}
                {salesTax === null && <span className="font-normal text-ds-11 text-muted-foreground"> + tax</span>}
              </p>
              {budgetNum > 0 && (
                <p className="text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  <span className="font-semibold text-foreground">${formatPriceExact(budgetNum)}</span>
                  {" "}budget + fees
                </p>
              )}
            </div>
          </div>

          {/* Location — full street address (the poster's own job, so
              showing the complete address once at checkout is fine). */}
          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" />Location
            </span>
            <p className="flex-1 text-ds-13 text-foreground text-right">
              {[streetAddress, city, addrState, zipCode].filter(Boolean).join(", ")}
              {parish ? ` · ${parish} Parish` : ""}
            </p>
          </div>

          {/* Date */}
          {dateNeeded && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3" />When
              </span>
              <p className="flex-1 text-ds-13 text-foreground text-right">
                {formatJobDate(dateNeeded)}
                {isFlexibleSchedule ? " · Flexible" : startTime ? ` · ${startTime}` : ""}
                {estimatedHours ? ` · ${estimatedHours}h est.` : ""}
              </p>
            </div>
          )}

          {/* Recurring schedule */}
          {isRecurring && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
                <Repeat className="w-3 h-3" />Repeats
              </span>
              <p className="flex-1 text-ds-13 text-foreground text-right capitalize">
                {recurrenceInterval}
                {recurrenceEndDate ? ` until ${formatJobDate(recurrenceEndDate)}` : ""}
              </p>
            </div>
          )}

          {/* Photos (thumbnail row) */}
          {imagePreviews.length > 0 && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
                <ImagePlus className="w-3 h-3" />Photos
              </span>
              <div className="flex-1 flex gap-1.5 flex-wrap justify-end">
                {imagePreviews.slice(0, 5).map((src, i) =>
                  isSafeBlobPreviewUrl(src) ? (
                    <img
                      loading="lazy"
                      decoding="async"
                      key={i}
                      src={src}
                      alt=""
                      className="w-10 h-10 rounded-ds-sm object-cover"
                      style={{ border: "0.5px solid hsl(var(--olivewood) / 0.15)" }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          )}

          {/* Special requirements */}
          {specialRequirements && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Notes</span>
              <p className="flex-1 text-ds-13 text-foreground text-right line-clamp-2">
                {specialRequirements}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Two-sided liquidity signal — a quiet confidence cue that the
          helpr side is active before the poster commits to paying.
          The count is helprs who've worked at least one job in this
          parish (from get_parish_activity), so the copy says exactly
          that — never an invented "active this week" figure. Renders
          only when the count is meaningful (>= 3). */}
      {helprActivity && (
        <div
          className="flex items-center gap-2.5 rounded-ds-md px-3 py-2"
          style={{
            background: "hsl(var(--primary) / 0.06)",
            border: "0.5px solid hsl(var(--primary) / 0.22)",
          }}
        >
          <Users className="w-4 h-4 text-primary shrink-0" strokeWidth={2.25} />
          <p className="text-ds-12 leading-snug text-foreground">
            <span className="font-display font-bold tabular-nums">
              {helprActivity.count} Helprs
            </span>{" "}
            <span className="text-muted-foreground">
              have worked jobs in {helprActivity.parish} Parish — your
              job will reach an active community.
            </span>
          </p>
        </div>
      )}

      {/* Payment breakdown card */}
      <div className="rounded-2xl liquid-glass overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Payment breakdown
          </h3>
        </div>
        <div className="p-5 space-y-3">
          {/* What the customer pays */}
          <p className="text-ds-12 font-semibold text-muted-foreground uppercase tracking-wide">Your charges</p>
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Job budget</span>
            <span className="font-medium text-foreground">${formatPriceExact(budgetNum)}</span>
          </div>
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Service fee ({customerFee ?? 12}%)</span>
            <span className="font-medium text-foreground">${formatPriceExact(customerFeeAmount)}</span>
          </div>
          {isUrgent && urgentFeeNum > 0 && (
            <div className="flex justify-between text-ds-13">
              <span className="text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> Urgent bonus (goes to Helpr)</span>
              <span className="font-medium text-foreground">${formatPriceExact(urgentFeeNum)}</span>
            </div>
          )}
          {onboardingFeeAmount > 0 && (
            <div className="flex justify-between text-ds-13">
              <span className="text-muted-foreground">One-time account setup <span className="text-ds-12 italic">(first job only)</span></span>
              <span className="font-medium text-foreground">${formatPriceExact(onboardingFeeAmount)}</span>
            </div>
          )}
          {/* Sales tax — the REAL figure, not a guess.
          
              This row has been wrong twice. It first read "Calculated at
              checkout" with the total below it labelled "excl. tax", so the
              biggest number on the screen excluded part of the charge. The fix
              for that replaced it with a flat "about 9-11% of everything"
              range — which was wrong in the other direction and much worse: it
              taxed lines Stripe never taxes.
          
              create-payment marks the service fee, the urgent tip and the
              one-time setup fee `txcd_00000000` (non-taxable), and marks the
              labor line taxable ONLY for `assembly` (LA R.S. 47:301(14) — see
              `_shared/salesTax.ts`). So for every other category Stripe charges
              exactly $0 sales tax, while this screen was quoting an estimated
              total ~10% above the real charge. That is the "both totals don't
              match" the owner hit: $108.40 charged against $118.16-$120.32
              shown.
          
              The rate itself is no longer invented either. `parish_tax_rates`
              has held all 64 parishes at real rates since 2026-04 and is
              world-readable; the form already resolves the parish from the zip.
              We just never read it. Now we do — and when the parish isn't known
              yet we say so instead of quoting a number we don't have. */}
          {(() => {
            const taxable = hasTaxableLine(category);
            const tax = salesTax;
            // Exempt category (the common case): tax is a known $0, so the
            // total is exact, not an estimate. Don't show a $0.00 tax row —
            // a line that always reads zero is noise; the note carries it.
            if (!taxable) {
              return (
                <>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="text-ds-20 font-bold text-foreground">
                      ${formatPriceExact(totalWithTax)}
                    </span>
                  </div>
                  <p className="text-ds-11 text-muted-foreground leading-snug">
                    No Louisiana sales tax applies to {categoryLabel.toLowerCase()} work —
                    this is the full amount you'll be charged.
                  </p>
                </>
              );
            }
            // Taxable category, parish not resolved yet — say what's missing
            // rather than quoting a rate we don't have.
            if (tax === null) {
              return (
                <>
                  <div className="flex justify-between text-ds-13">
                    <span className="text-muted-foreground">State &amp; parish sales tax</span>
                    <span className="font-medium text-muted-foreground">
                      {parishRateLoading ? "checking…" : "set by your parish"}
                    </span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-foreground">Total before tax</span>
                    <span className="text-ds-20 font-bold text-foreground">
                      ${formatPriceExact(totalCharge)}
                    </span>
                  </div>
                  <p className="text-ds-11 text-muted-foreground leading-snug">
                    {/* `null` covers two different situations and they need
                        different copy: the parish is still being looked up, or
                        there is no parish to look up yet. Telling someone who
                        already typed their ZIP to "add your ZIP" reads as a
                        failure of their input. */}
                    {parishRateLoading
                      ? `Assembly is taxable in Louisiana — looking up ${parish}'s rate. Tax applies to the $${formatPriceExact(budgetNum)} job budget only, never the fees.`
                      : `Assembly is taxable in Louisiana. Add your ZIP and we'll show your parish's exact rate — tax applies to the $${formatPriceExact(budgetNum)} job budget only, never the fees.`}
                  </p>
                </>
              );
            }
            // Taxable category with a known parish rate. This IS an estimate,
            // and the word is load-bearing: we compute from the JOB's parish,
            // but Stripe Tax computes from the billing address the poster
            // enters at checkout (`customer_update: {address: "auto"}`). Those
            // usually agree — you post a job where you live — but a poster
            // billing from another parish gets a different rate, and calling
            // this figure "Total" would be the same overclaim in miniature that
            // the invented 9-11% range was. Only the assembly path can differ:
            // the exempt branch above is an exact, address-independent $0.
            return (
              <>
                <div className="flex justify-between text-ds-13">
                  <span className="text-muted-foreground">
                    Est. sales tax{parish ? ` (${parish} Parish, ${parishTaxRate}%)` : ""}
                  </span>
                  <span className="font-medium text-foreground">${formatPriceExact(tax)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between items-baseline">
                  <span className="font-semibold text-foreground">Estimated total</span>
                  <span className="text-ds-20 font-bold text-foreground">
                    ${formatPriceExact(totalWithTax)}
                  </span>
                </div>
                <p className="text-ds-11 text-muted-foreground leading-snug">
                  Assembly is taxable labor in Louisiana, so tax applies to the
                  ${formatPriceExact(budgetNum)} job budget — never to the fees. The exact
                  rate is set by the billing address you enter at checkout.
                </p>
              </>
            );
          })()}
          {/* Escrow was explained FIVE times on this one screen: this pill and
              its auto-opening popover, the sentence below it, the three-step
              EscrowFlowExplainer panel, the confirmation checkbox, and the
              microline under the pay button. Each was presumably added because
              the previous one wasn't landing — but repeated reassurance stops
              reading as confidence and starts reading as protesting too much.
              The screen sounded nervous about its own payment flow.

              ONE survives (owner decision): the microline under the CTA —
              "Held safely until the job's done." It is the best writing on the
              screen and says the whole thing in six words.

              The three-step EscrowFlowExplainer panel went with the rest. The
              tradeoff is real and was accepted knowingly: a first-time poster
              no longer gets a walkthrough of hold → verify → release before
              paying. If that turns out to cost conversions, the panel is one
              import away — but five explanations of one mechanism read as a
              screen nervous about its own payment flow, and that costs more.

              The confirmation checkbox keeps its escrow wording deliberately:
              that is a consent record, not reassurance, and trimming it would
              weaken what the poster actually agreed to. */}
        </div>
      </div>

      {/* MaterialsPanel ("You might need: …") used to sit right here, between
          the total and the pay button. It has moved to PaymentSuccess.

          It is an AFFILIATE panel — it carries "Helpr may earn a small
          commission on purchases via these links." Putting it between the
          price and the pay button meant the app was selling the poster
          something else at the exact moment they were deciding whether to
          commit to the job. It also pushed the actual payment controls
          further down a screen that already had too much on it.

          After payment it does the same job honestly: the poster has
          committed, and "here's what this kind of job usually needs" is
          genuinely useful prep rather than a distraction from checkout. */}


      {/* "Save card for next time" — optional opt-in passed through to
          the create-payment edge function. Default off, sticky in
          localStorage so a returning poster who turned it on once
          doesn't have to re-tap it every post. */}
      {setSaveCardForFuture && (
        <label
          htmlFor="save-card"
          className="flex items-center justify-between gap-3 rounded-ds-md liquid-glass p-4 cursor-pointer"
        >
          <span className="text-ds-13 text-foreground leading-snug">
            <span className="font-semibold block">Save card for next time</span>
            <span className="text-ds-11 text-muted-foreground">
              Stripe stores it securely so you can one-tap next time you post.
            </span>
          </span>
          <Switch
            id="save-card"
            checked={!!saveCardForFuture}
            onCheckedChange={(checked) => setSaveCardForFuture(!!checked)}
          />
        </label>
      )}


      {/* Preferred helper shortcut — shown when the poster has a trusted
          repeat helper. Lets them route this job to that helper first
          before broadcasting to all. Preference stored in job metadata. */}
      {/* This row used to use a RAW `<input type="checkbox">` with an
          `accent-` colour, inside a plain `<div>`. That made three different
          control types on one checkout screen — a Switch above, a native
          checkbox here, the design-system Checkbox below — for choices that
          are all just "on or off".

          It was also the only one that wasn't accessible: 20×20px with no
          wrapping label, so the tap target was the box itself. The
          confirmation card immediately below already solved exactly this
          (its comment explains the full-card `<label>` trick for WCAG 2.5.5)
          — this row simply never got the same treatment.

          Now a `<label>` + the shared Checkbox, matching that card. Two
          control types remain, and the split is meaningful rather than
          accidental: Switch for a sticky account PREFERENCE ("save card for
          next time"), Checkbox for a per-job CHOICE or consent. */}
      {preferredHelper && onSendToPreferredChange && (
        <label
          htmlFor="send-to-preferred"
          className="rounded-ds-md p-3 flex items-center gap-2.5 cursor-pointer min-h-[44px]"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.15)",
          }}
        >
          <Users className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <div className="flex-1 min-w-0">
            <p
              className="font-sans font-semibold text-ds-13"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Send to {preferredHelper.name ?? "your trusted helper"} first?
            </p>
            <p
              className="font-serif italic text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Your trusted helper from past jobs
            </p>
          </div>
          <Checkbox
            id="send-to-preferred"
            checked={!!sendToPreferred}
            onCheckedChange={(checked) => onSendToPreferredChange(checked === true)}
            className="shrink-0"
          />
        </label>
      )}

      {/* Confirmation Checkbox — the full card is a <label> so tapping
          anywhere on it toggles the checkbox. This makes the tap target
          the full card height (well above 44px) instead of the ~20px
          Checkbox element alone, satisfying WCAG 2.5.5 on SE screens. */}
      <label
        htmlFor="confirm-details"
        className="flex items-start gap-3 rounded-ds-md liquid-glass p-4 cursor-pointer min-h-[44px]"
      >
        <Checkbox
          id="confirm-details"
          checked={confirmed}
          onCheckedChange={(checked) => setConfirmed(checked === true)}
          className="mt-0.5 shrink-0"
        />
        <span className="text-ds-13 text-foreground leading-snug">
          I've reviewed all details above and confirm everything is correct. I understand the Helpr's payout will be released after both parties confirm job completion.
        </span>
      </label>

      {/* Action Buttons */}
      <div className="space-y-3">
        <Button
          variant="primary"
          className="w-full rounded-ds-md"
          size="lg"
          onClick={onSubmit}
          disabled={saving || uploading || !confirmed}
        >
          {saving || uploading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
          ) : confirmed ? (
            <CreditCard className="w-4 h-4 mr-2" />
          ) : (
            <CheckCircle2 className="w-4 h-4 mr-2" />
          )}
          {uploadProgress
            ? `Uploading photo ${uploadProgress.done + 1} of ${uploadProgress.total}…`
            : uploading
              ? "Uploading photos…"
              : saving
                ? "Processing…"
                : !confirmed
                  ? "Confirm details to continue"
                  : "Continue to payment"}
        </Button>
        {/* Escrow-trust microline — sits right under the pay CTA so the
            reassurance lands at the moment of commitment, in the poster's
            voice. This is now the ONLY escrow explanation on the screen (L4);
            it no longer echoes a fuller panel above, because there isn't one. */}
        <p className="flex items-center justify-center gap-1.5 text-ds-11 text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          Held safely until the job's done.
        </p>
        {/* A second "Back to edit" ghost button used to sit under the CTA.
            Removed on owner instruction — the step rail at the top of the
            screen (CheckoutStepIndicator's tappable "Details" step) and the
            page-header arrow already go back, and a back affordance directly
            beneath the pay button competes with the one action this screen
            exists for. It was the only consumer of the edit callback, so that
            prop went with it. */}
      </div>
    </>
  );
}
