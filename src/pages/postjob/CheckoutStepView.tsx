import { CheckoutStep } from "@/components/postjob/CheckoutStep";
import { CheckoutStepIndicator } from "./CheckoutStepIndicator";
import type { usePostJobForm } from "./usePostJobForm";

interface CheckoutStepViewProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * STEP 2: order summary / checkout. Thin wrapper that wires the
 * usePostJobForm state into the existing CheckoutStep component.
 *
 * A two-step rail at the top makes it visible that the form (step 1) is
 * still tappable to go back. Without this, the only way back from the
 * checkout was the page-header arrow, which the user often missed.
 */
export function CheckoutStepView({ form }: CheckoutStepViewProps) {
  return (
    <div key="checkout-step" className="space-y-6 animate-ds-page-in">
      <CheckoutStepIndicator onBackToForm={() => form.setStep("form")} />
      {/* The PostingQualityMeter ("Post quality: Good 73%" + a checklist) used
          to sit here. Removed on owner instruction: this is the pay screen, and
          grading the post at the moment of payment asks the poster to go back
          and rewrite rather than to buy. Advice about a stronger post belongs in
          step 1, next to the fields it is judging — not above the total. The
          component and its usePostingQuality hook had no other callers, so both
          were deleted with it. */}
      <CheckoutStep
        title={form.title}
        description={form.description}
        categoryLabel={form.categoryLabel}
        category={form.category}
        imagePreviews={form.imagePreviews}
        streetAddress={form.streetAddress}
        city={form.city}
        addrState={form.addrState}
        zipCode={form.zipCode}
        dateNeeded={form.dateNeeded}
        startTime={form.startTime}
        estimatedHours={form.estimatedHours}
        isFlexibleSchedule={form.isFlexibleSchedule}
        specialRequirements={form.specialRequirements}
        isRecurring={form.isRecurring}
        recurrenceInterval={form.recurrenceInterval}
        recurrenceEndDate={form.recurrenceEndDate}
        recurrenceDays={form.recurrenceDays}
        recurrenceWeeks={form.recurrenceWeeks}
        isUrgent={form.isUrgent}
        urgentFeeNum={form.urgentFeeNum}
        budgetNum={form.budgetNum}
        helprActivity={form.helprActivity}
        customerFee={form.customerFee}
        customerFeeAmount={form.customerFeeAmount}
        onboardingFeeAmount={form.onboardingFeeAmount}
        totalCharge={form.totalCharge}
        confirmed={form.confirmed}
        setConfirmed={form.setConfirmed}
        saveCardForFuture={form.saveCardForFuture}
        setSaveCardForFuture={form.setSaveCardForFuture}
        saving={form.saving || form.redirecting}
        uploading={form.uploading}
        uploadProgress={form.uploadProgress}
        onSubmit={form.handleSubmit}
        parish={form.parish}
      />
    </div>
  );
}
