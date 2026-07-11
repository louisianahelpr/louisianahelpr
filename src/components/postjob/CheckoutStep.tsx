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
  ChevronLeft,
  CheckCircle2,
  Users,
  BookOpen,
  DollarSign,
  ShieldCheck,
} from "lucide-react";
import type { HelprActivity } from "@/hooks/useHelprActivity";
import { EscrowExplainer } from "@/components/payment/EscrowExplainer";
import { EscrowFlowExplainer } from "@/components/payment/EscrowFlowExplainer";
import { MaterialsPanel } from "@/components/postjob/MaterialsPanel";
import { formatPrice } from "@/lib/format";

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
  /** Raw category value (e.g. "moving") — used to show the materials panel. */
  category: string;
  categoryLabel: string;
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
  onEdit: () => void;
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
  category,
  categoryLabel,
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
  onEdit,
  onSubmit,
  parish,
  preferredHelper,
  sendToPreferred,
  onSendToPreferredChange,
}: CheckoutStepProps) {
  return (
    <>
      <p className="text-muted-foreground text-ds-11">Review your job before paying</p>

      {/* ── Review & Post summary card ─────────────────────────────
          A clean read-only summary of everything the poster set. Shows
          the key fields at a glance so they can catch mistakes before
          committing to payment. The fee breakdown shows both sides:
          "You pay $X · Helper earns $Y" for full transparency. */}
      <div className="rounded-ds-md liquid-glass overflow-hidden">
        <div
          className="px-4 py-2.5 flex items-center gap-2 border-b border-border"
          style={{ background: "hsl(var(--bark) / 0.04)" }}
        >
          <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <p
            className="text-[10px] uppercase tracking-wide font-semibold"
            style={{ color: "hsl(var(--bark))" }}
          >
            Your post at a glance
          </p>
        </div>
        <div className="divide-y divide-border">
          {/* Title + category */}
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5">Job</span>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-ds-13 font-semibold text-foreground truncate">{title}</p>
              <span
                className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[0.65rem] font-semibold capitalize"
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
              <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5">Details</span>
              <p
                className="flex-1 text-ds-11 text-foreground leading-relaxed line-clamp-3"
                style={{ wordBreak: "break-word" }}
              >
                {description}
              </p>
            </div>
          )}

          {/* Budget with fee breakdown */}
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
              <DollarSign className="w-3 h-3" />Budget
            </span>
            <div className="text-right">
              <p className="text-ds-13 font-bold text-foreground">${formatPrice(budgetNum)}</p>
              {budgetNum > 0 && (
                <p className="text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  You pay{" "}
                  <span className="font-semibold text-foreground">
                    ${formatPrice(budgetNum + customerFeeAmount + urgentFeeNum + onboardingFeeAmount)}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Location — full street address (the poster's own job, so
              showing the complete address once at checkout is fine). */}
          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" />Location
            </span>
            <p className="flex-1 text-ds-11 text-foreground text-right">
              {[streetAddress, city, addrState, zipCode].filter(Boolean).join(", ")}
              {parish ? ` · ${parish} Parish` : ""}
            </p>
          </div>

          {/* Date */}
          {dateNeeded && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3" />When
              </span>
              <p className="flex-1 text-ds-11 text-foreground text-right">
                {new Date(dateNeeded + "T00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                {isFlexibleSchedule ? " · Flexible" : startTime ? ` · ${startTime}` : ""}
                {estimatedHours ? ` · ${estimatedHours}h est.` : ""}
              </p>
            </div>
          )}

          {/* Recurring schedule */}
          {isRecurring && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
                <Repeat className="w-3 h-3" />Repeats
              </span>
              <p className="flex-1 text-ds-11 text-foreground text-right capitalize">
                {recurrenceInterval}
                {recurrenceEndDate ? ` until ${new Date(recurrenceEndDate + "T00:00").toLocaleDateString()}` : ""}
              </p>
            </div>
          )}

          {/* Photos (thumbnail row) */}
          {imagePreviews.length > 0 && (
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
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
              <span className="text-ds-11 text-muted-foreground w-20 shrink-0 pt-0.5">Notes</span>
              <p className="flex-1 text-ds-11 text-foreground text-right line-clamp-2">
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
          <p className="text-ds-11 leading-snug text-foreground">
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

      {/* Payment Breakdown Card */}
      <div className="rounded-2xl liquid-glass overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Payment Breakdown
          </h3>
        </div>
        <div className="p-5 space-y-3">
          {/* What the customer pays */}
          <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wide">Your charges</p>
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Job budget</span>
            <span className="font-medium text-foreground">${formatPrice(budgetNum)}</span>
          </div>
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Service fee ({customerFee ?? 12}%)</span>
            <span className="font-medium text-foreground">${formatPrice(customerFeeAmount)}</span>
          </div>
          {isUrgent && urgentFeeNum > 0 && (
            <div className="flex justify-between text-ds-13">
              <span className="text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> Urgent bonus (goes to Helpr)</span>
              <span className="font-medium text-foreground">${formatPrice(urgentFeeNum)}</span>
            </div>
          )}
          {onboardingFeeAmount > 0 && (
            <div className="flex justify-between text-ds-13">
              <span className="text-muted-foreground">One-time account setup <span className="text-ds-11 italic">(first job only)</span></span>
              <span className="font-medium text-foreground">${formatPrice(onboardingFeeAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Sales Tax</span>
            <span className="font-medium text-muted-foreground italic">Calculated at checkout</span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex justify-between">
            <span className="font-semibold text-foreground">Estimated total (excl. tax)</span>
            <span className="text-ds-20 font-bold text-foreground">${formatPrice(totalCharge)}</span>
          </div>
          {/* First-time escrow reassurance — inline pill + info popover.
              The pill stays for everyone (passive reassurance); the
              popover auto-opens once, then suppresses via safeStorage. */}
          <div className="pt-1">
            <EscrowExplainer />
          </div>
          <p className="text-muted-foreground text-ds-11">Sales tax is automatically calculated based on your location at checkout. Payment is held securely until both parties confirm job completion.</p>
        </div>
      </div>

      {/* Shop the Job — category-specific materials panel. Only renders
          when the category has items in categoryMaterials. */}
      <MaterialsPanel category={category} className="mt-4" />

      {/* Trust Signals — replaced the previous two-icon strip ("Secure
          Payment" / "Money-Back Guarantee") with a full inline explainer
          of the hold → verify → release escrow flow. The numbered
          three-step panel does the same reassurance work AND teaches
          first-time posters what their money is actually doing, instead
          of hiding the explanation behind a popover trigger above. */}
      <EscrowFlowExplainer />

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
      {preferredHelper && onSendToPreferredChange && (
        <div
          className="rounded-ds-md p-3 flex items-center gap-2.5"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.15)",
          }}
        >
          <Users className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <div className="flex-1 min-w-0">
            <p
              className="font-display italic font-semibold text-ds-13"
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
          <input
            type="checkbox"
            checked={!!sendToPreferred}
            onChange={(e) => onSendToPreferredChange(e.target.checked)}
            className="w-5 h-5 accent-[hsl(var(--bark))] cursor-pointer"
            aria-label={`Send to ${preferredHelper.name ?? "trusted helper"} first`}
          />
        </div>
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
          variant="bark"
          className="w-full rounded-ds-md"
          size="lg"
          onClick={onSubmit}
          disabled={saving || uploading || !confirmed}
        >
          {confirmed ? <CreditCard className="w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
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
            voice. Echoes the fuller EscrowFlowExplainer above. */}
        <p className="flex items-center justify-center gap-1.5 text-ds-11 text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          Held safely until the job's done.
        </p>
        <Button
          variant="ghost"
          className="w-full rounded-ds-md"
          onClick={onEdit}
          disabled={saving}
          style={{ color: "hsl(var(--bark))" }}
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to edit
        </Button>
      </div>
    </>
  );
}
