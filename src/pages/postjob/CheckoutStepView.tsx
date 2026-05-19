import { CheckoutStep } from "@/components/postjob/CheckoutStep";
import type { usePostJobForm } from "./usePostJobForm";

interface CheckoutStepViewProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * STEP 2: order summary / checkout. Thin wrapper that wires the
 * usePostJobForm state into the existing CheckoutStep component.
 */
export function CheckoutStepView({ form }: CheckoutStepViewProps) {
  return (
    <div key="checkout-step" className="space-y-6 animate-ds-page-in">
      <CheckoutStep
        title={form.title}
        description={form.description}
        categoryLabel={form.categoryLabel}
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
        isUrgent={form.isUrgent}
        urgentFeeNum={form.urgentFeeNum}
        budgetNum={form.budgetNum}
        helprActivity={form.helprActivity}
        customerFee={form.customerFee}
        customerFeeAmount={form.customerFeeAmount}
        totalCharge={form.totalCharge}
        confirmed={form.confirmed}
        setConfirmed={form.setConfirmed}
        saving={form.saving || form.redirecting}
        uploading={form.uploading}
        uploadProgress={form.uploadProgress}
        onEdit={() => form.setStep("form")}
        onSubmit={form.handleSubmit}
      />
    </div>
  );
}
