import { CheckoutStep } from "@/components/postjob/CheckoutStep";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { PostJobPreviewCard } from "@/components/postjob/PostJobPreviewCard";
import { POST_JOB_DESKTOP_GRID, PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { FORM_PAGE_OF, type PostJobScreen } from "@/components/postjob/postJobScreens";
import { useAskForQuotes } from "@/components/quotes/PostJobQuoteChoice";
import type { ReactNode } from "react";
import type { usePostJobForm } from "./usePostJobForm";

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
type QuoteAsk = { sending: boolean; onAsk: () => void };

/** Review opened from Get quotes (A2-C32): sends the request with the window picked on screen 5. Mounted only
 *  then, so the plain Review never touches the router or query hooks the ask needs. */
function WithQuoteAsk({ form, children }: CheckoutStepViewProps & { children: (ask: QuoteAsk) => ReactNode }) {
  const quotes = useAskForQuotes(form.quoteWindowHours);
  const onAsk = () => void quotes.ask({
    title: form.title, description: form.description, category: form.category, streetAddress: form.streetAddress,
    city: form.city, addrState: form.addrState, zipCode: form.zipCode, dateNeeded: form.dateNeeded,
    startTime: form.startTime, isFlexibleSchedule: form.isFlexibleSchedule, estimatedHours: form.estimatedHours,
    parish: form.parish,
  });
  return <>{children({ sending: quotes.sending, onAsk })}</>;
}

export function CheckoutStepView({ form }: CheckoutStepViewProps) {
  // Q2399 (owner 2026-10-25): with card_hold_at_post (read once in
  // usePostJobForm) the card is HELD when the job posts and charged only at
  // the hire (create-payment). A bank payment cannot be held, so it is still
  // charged when the job posts.
  const cardHoldOn = form.cardHoldOn === true;
  // From Review, a passed form step is tappable too (owner 2026-10-25): the form keeps what was typed.
  // The phone's step bar and the desktop rail share this one rule, as on the form steps.
  const canPick = (s: PostJobScreen) => FORM_PAGE_OF[s] !== undefined && s !== "kind";
  const pick = (s: PostJobScreen) => {
    if (s === "groups") form.setCategoryGroup(null);
    const p = FORM_PAGE_OF[s];
    if (!p) return;
    form.setFormPage(p);
    form.setStep("form");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };
  return (
    // A2-L13 (audit 2026-10-28): Review sits in the same board 166 columns as the form steps. Without
    // them, at 1440 it dropped the step rail and the post preview and its rows ran about 1144px wide.
    <div key="checkout-step" className={POST_JOB_DESKTOP_GRID}>
      <PostJobStepRail screen="review" canPick={canPick} onPick={pick} />
      <div className="min-w-0 space-y-section">
      {/* Screen 7 of 7 (board 46). The card is charged when the job posts
          (create-payment, automatic capture; design-b handoff), so this
          screen says pay, never "nothing is charged now". Under
          card_hold_at_post (Q2399) the card is charged only at the hire, and it says so. */}
      <PostJobStepHeader
        screen="review"
        question="Look good?"
        canPick={canPick}
        onPick={pick}
        helper={
          form.quoteReview
            ? "Check your job, then ask for quotes. Nothing is charged until you book one."
            // A post a gift card covers in full charges $0: no "pay" line then.
            : form.totalCharge > 0
            ? cardHoldOn
              ? "Check your job. Your card isn't charged until you hire someone. A bank payment is charged when you post."
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
      {form.quoteReview ? <WithQuoteAsk form={form}>{(ask) => checkout(ask)}</WithQuoteAsk> : checkout()}
      </div>
      <aside className="hidden xl:block sticky top-6">
        {/* A Get quotes Review shows no price (A2-C32): the preview drops the budget, as on the form steps. */}
        <PostJobPreviewCard title={form.title} category={form.category} photo={form.imagePreviews?.[0]} budget={form.quoteReview ? 0 : form.budgetNum} />
      </aside>
    </div>
  );

  function checkout(quoteAsk?: QuoteAsk) {
    return (
      <CheckoutStep
        quoteAsk={quoteAsk}
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
    );
  }
}
