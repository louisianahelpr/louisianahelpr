import { Button } from "@/components/ui/button";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { OpenJobLimitNotice } from "./OpenJobLimitNotice";
// formatPriceExact, not formatPrice: this button quotes the CHARGE. See the
// note at the render site — `formatPrice` rounds to whole dollars, which
// silently understated every total whose fee carried cents.
import { formatPriceExact } from "@/lib/format";
import type { usePostJobForm } from "./usePostJobForm";
import { detailsBlocker } from "./detailsBlocker";
import { useAgeGate } from "@/hooks/useAgeGate";
import { AgeGateNote } from "@/components/AgeGateNote";
import { useEffect, useRef, useState } from "react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { PostJobPreviewCard } from "@/components/postjob/PostJobPreviewCard";
import { PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { sentenceCaseLabel } from "@/lib/jobCategoryGroups";
import { useFeatureStatus } from "@/hooks/useFeature";
import {
  PriceModeChoice,
  QuoteRequestSection,
  type PriceMode,
  type QuoteAskHandle,
} from "@/components/quotes/PostJobQuoteChoice";

interface FormStepProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * STEP 1: the Post-a-Task form. Composes the three section components
 * (Details / Logistics / Budget) with the AI builder, sticky stepper,
 * draft prompt, direct-offer banner, and the contextual submit button.
 *
 * Purely presentational — all state and handlers come from usePostJobForm.
 * The scroll-spy + jump wiring here is local view state only.
 */
export function FormStep({ form }: FormStepProps) {

  const atOpenJobLimit = form.openJobCount !== null && form.openJobCount >= 5;
  // The form is "ready" once all three sections' required fields are
  // satisfied. handleReview still runs the full validation pass on
  // submit (past-date, budget ceiling, urgent-fee min) — this only
  // gates the button so it can't be tapped before the basics are in.
  const formReady =
    form.detailsComplete && form.logisticsComplete && form.budgetComplete;
  // Q1586(c): a saved birthday under 18 greys the button out, and the line at
  // the top says why before any of the form is filled in.
  const { underAge } = useAgeGate();
  // Quotes on jobs (hidden 'quotes' switch): "Get quotes" replaces the budget
  // with a quote window for a one-time job with no direct offer. Without the
  // switch (everyone but testers, owner 2026-10-19) the choice still shows,
  // with "Get quotes" greyed and marked Coming soon; it never opens the quote
  // form (priceMode stays "price", so QuoteRequestSection never mounts).
  const quotes = useFeatureStatus("quotes");
  const quotesOn = quotes.on;
  const [priceModeRaw, setPriceMode] = useState<PriceMode>("price");
  const quotesShape = !form.offerToHelperId && !form.isRecurring && !form.isGroupJob;
  const quotesEligible = quotesOn && quotesShape;
  const priceMode: PriceMode = quotesEligible ? priceModeRaw : "price";
  const quoteAsk = useRef<QuoteAskHandle>(null);
  const [quoteSending, setQuoteSending] = useState(false);
  const askingQuotes = priceMode === "quotes";
  const submitDisabled = askingQuotes
    ? !(form.detailsComplete && form.logisticsComplete) || underAge || quoteSending
    : atOpenJobLimit || !formReady || underAge;

  // Scanned once per render: the screen-2 gate, the back-to-fix button and
  // the submit ladder all read it.
  const detailsBlock = detailsBlocker(form);
  // Contextual label — names the first unfinished *field* (not just the
  // section) so the poster knows exactly what's blocking the button.
  let submitLabel = "Review & pay";
  if (!form.detailsComplete) {
    submitLabel = detailsBlock ?? submitLabel;
  } else if (!form.logisticsComplete) {
    if (!form.streetAddress.trim() || !form.city.trim() || !form.addrState.trim() || !form.zipCode.trim())
      submitLabel = "Add the address to continue";
    else if (!form.dateNeeded) submitLabel = "Pick a date to continue";
    // Only ask for a time when the poster has not said they don't have one.
    // Ticking "Flexible Schedule" IS the answer to this question, so keeping
    // the label here left the CTA demanding a field the form no longer wants.
    else if (!form.startTime && !form.isFlexibleSchedule) submitLabel = "Pick a start time to continue";
    // The schedule is filled in but has already gone by. This branch is why
    // `scheduleInPast` is surfaced separately from `logisticsComplete`: the
    // button used to read "Review & pay · $72" in exactly this state and then
    // refuse the tap with a toast the poster could not see from down here.
    else submitLabel = "That start time has passed";
  } else if (askingQuotes) {
    submitLabel = quoteSending ? "Sending…" : "Ask for quotes";
  } else if (!form.budgetComplete) {
    submitLabel = "Set a budget to continue";
  }

  // ONE QUESTION PER SCREEN (boards 23, 44, 3, 45, 46): What, Details, Price,
  // When and where; the checkout step is screen 5. Every screen stays mounted
  // (hidden when not showing) so nothing typed is lost and the quote form's
  // ref still answers on screen 4. The page lives in usePostJobForm so the
  // header's back arrow steps back through it.
  const page = form.formPage ?? 1;
  const setPage = form.setFormPage;
  const rootRef = useRef<HTMLDivElement>(null);
  // scrollToField (postJobFormHelpers) asks a hidden screen to open when the
  // submit pass refuses a field on it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onShow = (e: Event) => {
      const n = Number((e.target as HTMLElement).dataset.formPage);
      if (n >= 1 && n <= 4) setPage?.(n);
    };
    root.addEventListener("lh:show-form-page", onShow);
    return () => root.removeEventListener("lh:show-form-page", onShow);
  }, [setPage]);

  let pageLabel = "Continue";
  let pageReady = true;
  if (page === 1) {
    pageReady = !!form.category;
    pageLabel = form.category ? `Continue with ${sentenceCaseLabel(jobCategoryLabel(form.category))}` : "Pick a category to continue";
  } else if (page === 2) {
    pageReady = detailsBlock === null;
    pageLabel = detailsBlock ?? "Continue";
  } else if (page === 3) {
    pageReady = askingQuotes || form.budgetComplete;
    pageLabel = pageReady ? "Continue" : "Set a budget to continue";
  }
  // The open-job cap and the age gate stop the flow at screen 1, as the
  // one-page form's button did (their notices sit above every screen).
  if (atOpenJobLimit || underAge) pageReady = false;
  const lastPage = page >= 4;
  // Screen 4 can make an EARLIER screen incomplete: turning on Repeats or
  // Group switches "Get quotes" back to a set price, whose field is on screen
  // 3. The button then takes the poster to that screen instead of sitting
  // disabled over a field they cannot see.
  const backTo = !lastPage
    ? null
    : !form.category
      ? { page: 1, label: "Pick a category to continue" }
      : detailsBlock
        ? { page: 2, label: detailsBlock }
        : !askingQuotes && !form.budgetComplete
          ? { page: 3, label: "Set a budget to continue" }
          : null;

  return (
    // Desktop (board 166): step rail left, the step centred (max 640px), the live
    // "What Helprs will see" card right. The phone is the one centred column.
    <div key="form-step" ref={rootRef} className="mx-auto w-full max-w-2xl lg:max-w-none lg:grid lg:grid-cols-[200px_minmax(0,640px)_280px] lg:justify-center lg:items-start lg:gap-section">
      <PostJobStepRail step={page} onPick={setPage} />
      <div className="min-w-0 space-y-section">
      {form.offerToHelperId && (
        <DirectOfferBanner
          offerToHelperName={form.offerToHelperName}
          onCancel={form.clearOffer}
          responseHours={form.offerResponseHours}
          onResponseHoursChange={form.setOfferResponseHours}
        />
      )}

      {atOpenJobLimit && <OpenJobLimitNotice count={form.openJobCount ?? 5} />}

      {underAge && <AgeGateNote kind="post" />}

      {/* Draft tab, template picker, and AI builder all live on the entry
          step (EntryChoice) now — the form is for filling in details, not
          for re-offering ways to start one. Keeping them here duplicated the
          entry screen and made the "form" step read as a second landing.

          The in-form Details/Logistics/Budget stepper rail was removed too:
          it stacked directly under the whole-flow Entry→Details→Pay stepper
          and re-stated "Details", reading as a duplicate stepper. The
          per-section chapter cards (numbered headers) now carry section
          identity on their own. */}

      <form
        onKeyDown={(e) => {
          // Screens 1-3 render no submit button, so a browser never submits
          // on Enter there: move on by hand (never from a textarea).
          if (lastPage || e.key !== "Enter" || (e.target as HTMLElement).tagName !== "INPUT") return;
          e.preventDefault();
          if (pageReady) setPage?.(page + 1);
        }}
        onSubmit={(e) => {
          if (!lastPage) {
            // Enter in a field on screens 1-3 moves on, never submits.
            e.preventDefault();
            if (pageReady) setPage?.(page + 1);
            return;
          }
          if (backTo) {
            e.preventDefault();
            setPage?.(backTo.page);
            return;
          }
          if (!askingQuotes) return form.handleReview(e);
          e.preventDefault();
          if (submitDisabled) return;
          void quoteAsk.current?.ask({
            title: form.title,
            description: form.description,
            category: form.category,
            streetAddress: form.streetAddress,
            city: form.city,
            addrState: form.addrState,
            zipCode: form.zipCode,
            dateNeeded: form.dateNeeded,
            startTime: form.startTime,
            isFlexibleSchedule: form.isFlexibleSchedule,
            estimatedHours: form.estimatedHours,
            parish: form.parish,
          });
        }}
        className="space-y-4"
      >
        {/* SCREEN 1: WHAT (board 23) */}
        <div data-form-page="1" hidden={page !== 1} className="space-y-section">
          <PostJobStepHeader step={1} question="What do you need?" helper="Search, or pick a group to see what's in it." />
          <JobCategoryGroups category={form.category} setCategory={form.setCategory} />
        </div>

        {/* SCREEN 2: DETAILS (board 44) */}
        <div data-form-page="2" hidden={page !== 2} className="space-y-section">
          <PostJobStepHeader step={2} question="Tell us about it" helper="A few words and a photo help Helprs say yes." />
          <DetailsSection
            stepNumber={1}
            title={form.title}
            setTitle={form.setTitle}
            description={form.description}
            setDescription={form.setDescription}
            category={form.category}
            setCategory={form.setCategory}
            imagePreviews={form.imagePreviews}
            imageFiles={form.imageFiles}
            onImageSelect={form.handleImageSelect}
            onRemoveImage={form.removeImage}
            onReorderImages={form.reorderImages}
            uploadProgressByIndex={form.uploadProgressByIndex}
            detailsComplete={form.detailsComplete}
            credentialTier={form.credentialTier}
            setCredentialTier={form.setCredentialTier}
            requirePhotoProof={form.requirePhotoProof}
            setRequirePhotoProof={form.setRequirePhotoProof}
            scopeVideoUrl={form.scopeVideoPreviewUrl}
            onVideoSelect={form.handleVideoSelect}
            onClearVideo={form.clearVideo}
          />
        </div>


        {/* SCREEN 3: PRICE (board 3), or the quote window with "Get quotes" picked */}
        <div data-form-page="3" hidden={page !== 3} className="space-y-section">
          <PostJobStepHeader step={3} question="What will you pay?" helper={askingQuotes ? "Members near you send quotes. You pay only when you book one." : "Set a fair price. You pay when you post, and we hold it until the job is done."} />
          {quotesShape && quotes.settled && (
            <PriceModeChoice value={priceMode} onChange={setPriceMode} quotesComingSoon={!quotesOn} />
          )}
        {askingQuotes ? (
          <QuoteRequestSection ref={quoteAsk} stepNumber={3} onSendingChange={setQuoteSending} />
        ) : (
        <div>
          <BudgetSection
            stepNumber={3}
            budget={form.budget}
            setBudget={form.setBudget}
            isUrgent={form.isUrgent}
            setIsUrgent={form.setIsUrgent}
            urgentFee={form.urgentFee}
            setUrgentFee={form.setUrgentFee}
            customUrgentFee={form.customUrgentFee}
            setCustomUrgentFee={form.setCustomUrgentFee}
            budgetComplete={form.budgetComplete}
            giftAmount={form.giftCreditAmount}
          />
        </div>
        )}
          {!askingQuotes && (
            // Phone only: on desktop the same card stays in the right column on every screen.
            <div className="lg:hidden"><PostJobPreviewCard
              title={form.title}
              category={form.category}
              photo={form.imagePreviews?.[0]}
              budget={form.budgetNum}
            /></div>
          )}
        </div>

        {/* SCREEN 4: WHEN AND WHERE (board 45) */}
        <div data-form-page="4" hidden={page !== 4} className="space-y-section">
          <PostJobStepHeader step={4} question="When and where?" helper="Helprs see the area now and your street address after you hire." />
          <LogisticsSection
            stepNumber={2}
            streetAddress={form.streetAddress}
            setStreetAddress={form.setStreetAddress}
            city={form.city}
            setCity={form.setCity}
            addrState={form.addrState}
            setAddrState={form.setAddrState}
            zipCode={form.zipCode}
            setZipCode={form.setZipCode}
            dateNeeded={form.dateNeeded}
            setDateNeeded={form.setDateNeeded}
            startTime={form.startTime}
            setStartTime={form.setStartTime}
            scheduleInPast={form.scheduleInPast}
            isFlexibleSchedule={form.isFlexibleSchedule}
            setIsFlexibleSchedule={form.setIsFlexibleSchedule}
            specialRequirements={form.specialRequirements}
            setSpecialRequirements={form.setSpecialRequirements}
            isRecurring={form.isRecurring}
            setIsRecurring={form.setIsRecurring}
            recurrenceDays={form.recurrenceDays}
            setRecurrenceDays={form.setRecurrenceDays}
            recurrenceWeeks={form.recurrenceWeeks}
            setRecurrenceWeeks={form.setRecurrenceWeeks}
            seriesSplitOk={form.seriesSplitOk}
            setSeriesSplitOk={form.setSeriesSplitOk}
            isGroupJob={form.isGroupJob}
            setIsGroupJob={form.setIsGroupJob}
            helpersNeeded={form.helpersNeeded}
            setHelpersNeeded={form.setHelpersNeeded}
            budgetNum={form.budgetNum}
            logisticsComplete={form.logisticsComplete}
            category={form.category}
            selectedPetIds={form.selectedPetIds}
            onTogglePet={form.togglePet}
            includeMaterials={form.includeMaterials}
            setIncludeMaterials={form.setIncludeMaterials}
            materialsNote={form.materialsNote}
            setMaterialsNote={form.setMaterialsNote}
          />
        </div>

        {/* Submit — sits at the natural end of the form (not sticky) so it
            never floats over and obscures the section fields above it. The
            poster scrolls the form top-to-bottom and the contextual CTA is
            the last thing they reach. Bottom padding clears the floating
            MobileNav dock so the button is never tucked under it. The label
            is contextual: it names the next unfinished chapter until every
            required field is in, then becomes "Review & pay". */}
        {/* Sticky action bar (boards 23/44/3/45): rides above the floating
            bottom nav while the screen scrolls, and settles at the end of
            the form. AppPage's own pb-safe-nav gives the last field room;
            bg-premium-page is AppPage's surface, so the bar blends in. The
            column is 2xl (board 167: a flow step centred, about 640px). */}
        <div className="sticky bottom-safe-nav z-10 bg-premium-page pt-3 pb-2">
          {backTo && !atOpenJobLimit && !underAge ? (
            <Button
              variant="primary"
              type="button"
              className="w-full rounded-full text-ds-16"
              size="lg"
              onClick={() => setPage?.(backTo.page)}
            >
              <span className="min-w-0 whitespace-normal text-center leading-tight">{backTo.label}</span>
            </Button>
          ) : !lastPage ? (
            <Button
              variant="primary"
              type="button"
              className="w-full rounded-full text-ds-16"
              size="lg"
              disabled={!pageReady}
              aria-disabled={!pageReady}
              onClick={() => setPage?.(page + 1)}
            >
              <span className="min-w-0 whitespace-normal text-center leading-tight">{pageLabel}</span>
            </Button>
          ) : (
          <Button
            variant="primary"
            type="submit"
            className="w-full rounded-full"
            size="lg"
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
          >
            {/* On 320px phones the long contextual labels ("Add when &
                where to continue") + the trailing budget can overflow.
                Truncate the label and keep the budget chip un-shrunk so
                it always stays readable. */}
            <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
              <span className="truncate min-w-0">{submitLabel}</span>
              {/* The budget the poster typed, the same number as the field
                  and the "Use $X" chip. Owner, 2026-10-01: "Use 65, 55 went
                  in the box and like 61 was in the button. It all needs to be
                  the same number" — they chose "Button shows budget only". This
                  used to show totalCharge (budget + fees), which read as a
                  third, unexplained number; the fee breakdown and the exact
                  charge are on the review screen, which shows them before any
                  payment. `formatPriceExact` so cents typed into the field
                  show here exactly as typed. */}
              {!askingQuotes && formReady && form.budgetNum > 0 && (
                <span
                  className="font-sans font-bold tabular-nums shrink-0 text-ds-16"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {" "}· ${formatPriceExact(form.budgetNum)}
                </span>
              )}
            </span>
          </Button>
          )}
        </div>
      </form>
      </div>
      <aside className="hidden lg:block sticky top-6">
        <PostJobPreviewCard title={form.title} category={form.category} photo={form.imagePreviews?.[0]} budget={askingQuotes ? 0 : form.budgetNum} />
      </aside>
    </div>
  );
}
