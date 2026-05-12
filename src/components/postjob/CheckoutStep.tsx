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
  Shield,
  DollarSign,
  ChevronLeft,
  CheckCircle2,
} from "lucide-react";

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

      {/* Task Details Card */}
      <div className="rounded-2xl liquid-glass overflow-hidden">
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-foreground text-ds-15">{title}</h2>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-ds-11 font-medium">
                {categoryLabel}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={onEdit} className="text-ds-11 text-muted-foreground">
              <ChevronLeft className="w-3 h-3 mr-1" /> Edit
            </Button>
          </div>
          <p className="text-ds-11 text-muted-foreground">{description}</p>

          {/* Photos */}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {imagePreviews.map((src, i) =>
                isSafeBlobPreviewUrl(src) ? (
                  <img loading="lazy" decoding="async" key={i} src={src} alt="" className="w-16 h-12 rounded-lg object-cover border border-border" />
                ) : (
                  <div key={i} className="w-16 h-12 rounded-lg border border-border bg-muted/40 flex items-center justify-center">
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
            <div className="rounded-lg bg-secondary/30 p-3 mt-2">
              <p className="text-ds-11 text-muted-foreground font-medium mb-1">Special Requirements</p>
              <p className="text-ds-13 text-foreground">{specialRequirements}</p>
            </div>
          )}
          {isRecurring && (
            <div className="rounded-lg bg-primary/5 p-3 mt-2">
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
            <span className="font-semibold text-foreground">Subtotal (before tax)</span>
            <span className="text-ds-20 font-bold text-foreground">${totalCharge.toFixed(2)}</span>
          </div>
          <p className="text-muted-foreground text-ds-11">Sales tax is automatically calculated based on your location at checkout. Payment is held securely until both parties confirm job completion.</p>
        </div>
      </div>

      {/* Trust Signals */}
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <p className="text-ds-13 font-semibold text-foreground">Secure Payment</p>
            <p className="text-ds-11 text-muted-foreground">Your payment is processed securely via Stripe. The helpr is paid only after both parties confirm job completion.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-ds-13 font-semibold text-foreground">Money-Back Guarantee</p>
            <p className="text-ds-11 text-muted-foreground">If the job isn't completed, your payment will be refunded.</p>
          </div>
        </div>
      </div>

      {/* Confirmation Checkbox */}
      <div className="flex items-start gap-3 rounded-ds-md liquid-glass p-4">
        <Checkbox
          id="confirm-details"
          checked={confirmed}
          onCheckedChange={(checked) => setConfirmed(checked === true)}
          className="mt-0.5"
        />
        <label htmlFor="confirm-details" className="text-ds-13 text-foreground cursor-pointer leading-snug">
          I've reviewed all details above and confirm everything is correct. I understand the helpr's payout will be released after both parties confirm job completion.
        </label>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <Button
          className="w-full"
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
                  : `Pay $${totalCharge.toFixed(2)}`}
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={onEdit}
          disabled={saving}
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to edit
        </Button>
      </div>
    </>
  );
}
