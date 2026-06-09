import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ImagePlus,
  MapPin,
  Calendar,
  Clock,
  Briefcase,
  Repeat,
  Zap,
  CreditCard,
  ChevronLeft,
  CheckCircle2,
  Users,
} from "lucide-react";
import type { HelprActivity } from "@/hooks/useHelprActivity";
import { EscrowExplainer } from "@/components/payment/EscrowExplainer";
import { EscrowFlowExplainer } from "@/components/payment/EscrowFlowExplainer";

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
  totalCharge: number;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  saving: boolean;
  uploading: boolean;
  uploadProgress?: { done: number; total: number } | null;
  onEdit: () => void;
  onSubmit: () => void;
}

export function CheckoutStep({
  title,
  description,
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
  totalCharge,
  confirmed,
  setConfirmed,
  saving,
  uploading,
  uploadProgress,
  onEdit,
  onSubmit,
}: CheckoutStepProps) {
  return (
    <>
      <p className="text-muted-foreground text-ds-11">Review your task before paying</p>

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
              {helprActivity.count} helprs
            </span>{" "}
            <span className="text-muted-foreground">
              have worked jobs in {helprActivity.parish} Parish — your
              task will reach an active community.
            </span>
          </p>
        </div>
      )}

      {/* Task Details Card */}
      <div className="rounded-2xl liquid-glass overflow-hidden">
        <div className="p-5 space-y-3">
          <div>
            <h2 className="font-display font-bold text-foreground text-ds-15">{title}</h2>
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-ds-11 font-medium">
              {categoryLabel}
            </span>
          </div>
          <p className="text-ds-11 text-muted-foreground">{description}</p>

          {/* Photos */}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {imagePreviews.map((src, i) =>
                isSafeBlobPreviewUrl(src) ? (
                  <img loading="lazy" decoding="async" key={i} src={src} alt="" className="w-16 h-12 rounded-ds-sm object-cover border border-border" />
                ) : (
                  <div key={i} className="w-16 h-12 rounded-ds-sm border border-border bg-muted/40 flex items-center justify-center">
                    <ImagePlus className="w-4 h-4 text-muted-foreground" />
                  </div>
                ),
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="flex items-center gap-2 text-ds-11 text-muted-foreground">
              <MapPin className="w-4 h-4 text-primary shrink-0" />
              <span>{`${streetAddress}, ${city}, ${addrState} ${zipCode}`}</span>
            </div>
            <div className="flex items-center gap-2 text-ds-11 text-muted-foreground">
              <Calendar className="w-4 h-4 text-primary shrink-0" />
              <span>{new Date(dateNeeded + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{isFlexibleSchedule ? " (flexible)" : ""}</span>
            </div>
            {startTime && (
              <div className="flex items-center gap-2 text-ds-11 text-muted-foreground">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <span>{startTime}{isFlexibleSchedule ? " (flexible)" : ""}</span>
              </div>
            )}
            {estimatedHours && (
              <div className="flex items-center gap-2 text-ds-11 text-muted-foreground">
                <Briefcase className="w-4 h-4 text-primary shrink-0" />
                <span>{estimatedHours}h estimated</span>
              </div>
            )}
          </div>

           {specialRequirements && (
            <div className="rounded-ds-sm bg-secondary/30 p-3 mt-2">
              <p className="text-ds-11 text-muted-foreground font-medium mb-1">Special Requirements</p>
              <p className="text-ds-13 text-foreground">{specialRequirements}</p>
            </div>
          )}
          {isRecurring && (
            <div className="rounded-ds-sm bg-primary/5 p-3 mt-2">
              <p className="text-ds-11 text-primary font-medium mb-1 flex items-center gap-1"><Repeat className="w-3 h-3" /> Recurring Task</p>
              <p className="text-ds-13 text-foreground capitalize">{recurrenceInterval}{recurrenceEndDate ? ` until ${new Date(recurrenceEndDate + "T00:00").toLocaleDateString()}` : ""}</p>
            </div>
          )}
        </div>
      </div>

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
            <span className="text-muted-foreground">Task budget</span>
            <span className="font-medium text-foreground">${budgetNum.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Service fee ({customerFee ?? 10}%)</span>
            <span className="font-medium text-foreground">${customerFeeAmount.toFixed(2)}</span>
          </div>
          {isUrgent && urgentFeeNum > 0 && (
            <div className="flex justify-between text-ds-13">
              <span className="text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> Urgent bonus (goes to helpr)</span>
              <span className="font-medium text-foreground">${urgentFeeNum.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-ds-13">
            <span className="text-muted-foreground">Sales Tax</span>
            <span className="font-medium text-muted-foreground italic">Calculated at checkout</span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex justify-between">
            <span className="font-semibold text-foreground">Estimated total (excl. tax)</span>
            <span className="text-ds-20 font-bold text-foreground">${totalCharge.toFixed(2)}</span>
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

      {/* Trust Signals — replaced the previous two-icon strip ("Secure
          Payment" / "Money-Back Guarantee") with a full inline explainer
          of the hold → verify → release escrow flow. The numbered
          three-step panel does the same reassurance work AND teaches
          first-time posters what their money is actually doing, instead
          of hiding the explanation behind a popover trigger above. */}
      <EscrowFlowExplainer />

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
          I've reviewed all details above and confirm everything is correct. I understand the helpr's payout will be released after both parties confirm job completion.
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
