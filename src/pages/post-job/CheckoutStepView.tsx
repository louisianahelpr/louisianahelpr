import { CheckoutStep } from "@/components/postjob/CheckoutStep";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import type { usePostJobForm } from "./usePostJobForm";
import { useFeature } from "@/hooks/useFeature";

interface CheckoutStepViewProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * STEP 2: order summary / checkout. Thin wrapper that wires the
 * usePostJobForm state into the existing CheckoutStep component.
 *
 * A DETAILS → REVIEW AND PAY step rail (CheckoutStepIndicator) used to sit
 * at the top. Removed on owner instruction (2026-10-01: "Remove detail and
 * review and pay at the top"); the page-header arrow is the way back to the
 * form. It was the indicator's only consumer, so the component went with it.
 *
 * The `gift*` props are load-bearing, not decoration: without them this screen
 * quoted the full budget + service fee + tax while create-payment settled the
 * post from the gift and charged $0. A total that isn't the total is a trust
 * bug even when the surprise is pleasant.
 */
export function CheckoutStepView({ form }: CheckoutStepViewProps) {
  // Q2399 (owner 2026-10-25): with card_hold_at_post the card is HELD when the
  // job posts and charged only at the hire (create-payment). A bank payment
  // cannot be held, so it is still charged when the job posts.
  const cardHoldOn = useFeature("card_hold_at_post");
  return (
    <div key="checkout-step" className="space-y-section">
      {/* Screen 7 of 7 (board 46). The card is charged when the job posts
          (create-payment, automatic capture; design-b handoff), so this
          screen says pay, never "nothing is charged now". Under
          card_hold_at_post (Q2399) the card is held instead, and it says so. */}
      <PostJobStepHeader
        screen="review"
        question="Look good?"
        helper={
          // A post a gift card covers in full charges $0: no "pay" line then.
          form.totalCharge > 0
            ? cardHoldOn
              ? "Check your job. Your card is held when you post, and you're only charged when you hire someone. A bank payment is charged when you post."
              : "Check your job. You're charged when you post, and the money is held until the job is done."
            : "Check your job, then post it."
        }
      />
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
        customerFeeAmount={form.customerFeeAmount}
        urgentCardFeeAmount={form.urgentCardFeeAmount}
        onboardingFeeAmount={form.onboardingFeeAmount}
        totalCharge={form.totalCharge}
        hasGift={form.hasGift}
        giftAppliedAmount={form.giftAppliedAmount}
        giftCreditAmount={form.giftCreditAmount}
        giftLoading={form.giftLoading}
        giftUnavailable={form.giftUnavailable}
        confirmed={form.confirmed}
        setConfirmed={form.setConfirmed}
        saveCardForFuture={form.saveCardForFuture}
        setSaveCardForFuture={form.setSaveCardForFuture}
        saving={form.saving || form.redirecting}
        uploading={form.uploading}
        uploadProgress={form.uploadProgress}
        // Straight to payment: no photo, phone or birthday prompt first
        // (owner, 2026-10-14, "no later prompt").
        onSubmit={form.handleSubmit}
      />
    </div>
  );
}
