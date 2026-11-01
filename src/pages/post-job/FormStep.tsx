import { Button } from "@/components/ui/button";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { PriceGuidanceCard } from "@/components/postjob/PriceGuidance";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { SellForMeBlanks, SellForMePriceSuggestion } from "@/components/postjob/SellForMeBlanks";
import { isSellForMeJob } from "@/lib/declutter/sellForMe";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { OpenJobLimitNotice } from "./OpenJobLimitNotice";
// formatPriceExact, not formatPrice: this button quotes the CHARGE. See the
// note at the render site — `formatPrice` rounds to whole dollars, which
// silently understated every total whose fee carried cents.
import { formatPriceExact } from "@/lib/format";
import type { usePostJobForm } from "./usePostJobForm";
import { PLACEHOLDER_BLOCK, detailsBlocker } from "./detailsBlocker";
import { focusFirstPlaceholder } from "./focusFirstPlaceholder";
import { useAgeGate } from "@/hooks/useAgeGate";
import { usePrefillOpensDetails } from "./usePrefillOpensDetails";
import { AgeGateNote } from "@/components/AgeGateNote";
import { useEffect, useRef, useState } from "react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { PostJobPreviewCard } from "@/components/postjob/PostJobPreviewCard";
import { POST_JOB_DESKTOP_GRID, PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { FORM_PAGE_OF, screenOfFormPage, type PostJobScreen } from "@/components/postjob/postJobScreens";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { JOB_CATEGORY_GROUPS, sentenceCaseLabel, type JobCategoryGroupId } from "@/lib/jobCategoryGroups";
import { useFeatureStatus } from "@/hooks/useFeature";
import {
  PriceModeChoice,
  QuoteRequestSection,
  type PriceMode,
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
  const priceModeRaw = form.priceMode;
  const setPriceMode = form.setPriceMode;
  const quotesShape = !form.offerToHelperId && !form.isRecurring && !form.isGroupJob;
  const quotesEligible = quotesOn && quotesShape;
  const priceMode: PriceMode = quotesEligible ? priceModeRaw : "price";
  const askingQuotes = priceMode === "quotes";
  const submitDisabled = askingQuotes
    ? !(form.detailsComplete && form.logisticsComplete) || underAge
    : atOpenJobLimit || !formReady || underAge;

  // Scanned once per render: the screen-2 gate, the back-to-fix button and
  // the submit ladder all read it.
  const detailsBlock = detailsBlocker(form);
  // Contextual label — names the first unfinished *field* (not just the
  // section) so the poster knows exactly what's blocking the button.
  // Owner 2026-10-21 (friction 2): say what happens next; the charge happens on a secure page after review.
  let submitLabel = "Review, then pay";
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
    else submitLabel = "Pick a later start to continue";
  } else if (askingQuotes) {
    // A2-C32 (lead option A): Get quotes has a Review too (7 of 7); "Ask for quotes" is on it.
    submitLabel = "Review";
  } else if (!form.budgetComplete) {
    submitLabel = "Set a budget to continue";
  }

  // ONE QUESTION PER SCREEN (boards 23, 44, 3, 45, 46): What, Details, Price,
  // When and where; the checkout step is Review (7 of 7, postJobScreens.ts). Every page stays mounted
  // (hidden when not showing) so nothing typed is lost; Get quotes' window lives in usePostJobForm so
  // Review reads it (A2-C32). The page lives in usePostJobForm so the
  // header's back arrow steps back through it.
  const page = form.formPage ?? 1;
  const setPage = form.setFormPage;
  // A3-3: a link whose pre-fill already picked the category (Declutter "Add a Helpr") goes on to Details, as a tap does.
  usePrefillOpensDetails({
    deepLink: !!form.prefillOpensDetails,
    category: form.category,
    onFirstPage: page === 1,
    blocked: atOpenJobLimit || underAge,
    goOn: () => setPage?.(2),
  });
  // Q2471 #3: "Book <Helpr> again" copied the whole job (and never its date) and made it a direct offer, so it
  // opens at When and where (6 of 7) and asks only for the date. Same once-only and the same gates as above.
  usePrefillOpensDetails({
    deepLink: !!form.prefillOpensWhen,
    category: form.category,
    onFirstPage: page === 1,
    blocked: atOpenJobLimit || underAge,
    goOn: () => setPage?.(4),
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const [placeholdersRefused, setPlaceholdersRefused] = useState(false);
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

  const openGroup = form.categoryGroup ? JOB_CATEGORY_GROUPS.find((g) => g.id === form.categoryGroup) ?? null : null;
  let pageLabel = "Continue";
  let pageReady = true;
  // POST-H15 (lead 10-31): with only [placeholders] left, Details' Continue can be pressed. It does not move on: the
  // description then says so in red and the first placeholder gets the focus (before that, a neutral hint).
  const placeholdersOnly = page === 2 && detailsBlock === PLACEHOLDER_BLOCK;
  if (page === 1) {
    pageReady = !!form.category;
    pageLabel = form.category ? `Continue with ${sentenceCaseLabel(jobCategoryLabel(form.category))}` : "Pick a category to continue";
  } else if (page === 2) {
    pageReady = detailsBlock === null;
    pageLabel = placeholdersOnly ? "Continue" : detailsBlock ?? "Continue";
  } else if (page === 3) {
    pageReady = askingQuotes || form.budgetComplete;
    pageLabel = pageReady ? "Continue" : "Set a budget to continue";
  }
  // The open-job cap and the age gate stop the flow at screen 1, as the
  // one-page form's button did (their notices sit above every screen).
  if (atOpenJobLimit || underAge) pageReady = false;
  const pagePressable = pageReady || (placeholdersOnly && !atOpenJobLimit && !underAge);
  const refusePlaceholders = () => {
    setPlaceholdersRefused(true);
    // After the refused state renders (and Details is showing): the first placeholder.
    requestAnimationFrame(() => focusFirstPlaceholder(form.description, rootRef.current ?? document));
  };
  const goOn = () => {
    if (pageReady) setPage?.(page + 1);
    else if (placeholdersOnly && pagePressable) refusePlaceholders();
  };
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

  // The action bar floats over the form only while its button does something.
  const barFloats = backTo && !atOpenJobLimit && !underAge ? true : !lastPage ? pagePressable : !submitDisabled;

  // Reopen a passed step: the desktop rail and the phone's step bar share one rule (owner 2026-10-25).
  const canPickStep = (s: PostJobScreen) => FORM_PAGE_OF[s] !== undefined && !(s === "kind");
  const pickStep = (s: PostJobScreen) => {
    if (s === "groups") {
      form.setCategoryGroup(null);
      // JA-41: the groups are the first screen (EntryChoice); the form's own copy is only for deep links.
      if (!form.skipEntry) {
        form.setStep("entry");
        return;
      }
    }
    const p = FORM_PAGE_OF[s];
    if (p) setPage?.(p);
  };

  return (
    // Desktop (board 166): step rail left, the step centred (max 640px), the live
    // "What Helprs will see" card right. The phone is the one centred column.
    // The card joins at xl, not lg (lead, 2026-10-25): beside the 248px app rail
    // the three columns left the form about 215px at 1024 and 370px at 1180
    // (measured), so from lg to xl it is the step list and the form only.
    <div key="form-step" ref={rootRef} className={POST_JOB_DESKTOP_GRID}>
      <PostJobStepRail screen={screenOfFormPage(page, !!openGroup)} canPick={canPickStep} onPick={pickStep} />
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
          goOn();
        }}
        onSubmit={(e) => {
          if (!lastPage) {
            // Enter in a field on screens 1-3 moves on, never submits.
            e.preventDefault();
            goOn();
            return;
          }
          if (backTo) {
            e.preventDefault();
            setPage?.(backTo.page);
            if (backTo.label === PLACEHOLDER_BLOCK) refusePlaceholders();
            return;
          }
          form.setQuoteReview(askingQuotes);
          if (!askingQuotes) return form.handleReview(e);
          if (submitDisabled) { e.preventDefault(); return; }
          form.handleReview(e, { quotes: true });
        }}
        className="space-y-4"
      >
        {/* PAGE 1: WHAT, screens 2 and 3 of 7 (board 23) */}
        <div data-form-page="1" hidden={page !== 1} className="space-y-section">
          {openGroup ? (
            <PostJobStepHeader screen="kind" question={groupQuestion(openGroup.id, openGroup.label)} helper="Tap one to keep going." canPick={canPickStep} onPick={pickStep} />
          ) : (
            <PostJobStepHeader screen="groups" question="What do you need done?" helper="Search, or pick a category." canPick={canPickStep} onPick={pickStep} />
          )}
          <JobCategoryGroups
            category={form.category}
            setCategory={form.setCategory}
            group={form.categoryGroup}
            setGroup={form.setCategoryGroup}
            onPicked={() => {
              // The open-job cap and the age gate stop the flow at screen 1 (their notices sit above it).
              if (atOpenJobLimit || underAge) return;
              form.setCategoryGroup(null);
              setPage?.(2);
            }}
          />
        </div>

        {/* PAGE 2: DETAILS, screen 4 of 7 (board 44) */}
        <div data-form-page="2" hidden={page !== 2} className="space-y-section">
          <PostJobStepHeader screen="details" question="Tell us about it" helper="A few words and a photo help Helprs say yes." canPick={canPickStep} onPick={pickStep} />
          {/* JOBS-10: a copy was silent, and it leaves these out (useJobFormEffects' rebook load). */}
          {form.isRepost && (
            <p data-testid="repost-line" className="rounded-[20px] liquid-glass p-card text-sm">
              We copied your last job. Add your photos again, and check the crew size, start time and repeat days.
            </p>
          )}
          {form.haulAwayItemIds && form.haulAwayItemIds.length > 0 && (
            <p data-testid="haul-away-line" className="rounded-[20px] liquid-glass p-card text-sm">
              Haul-away for {form.haulAwayItemIds.length} {form.haulAwayItemIds.length === 1 ? "item" : "items"} from your Declutter listings. Check the details, then set the pay.
            </p>
          )}
          {/* POST-H15: the Helpr-list-it job's three blanks, each its own field (they write into the description). */}
          {isSellForMeJob(form.category) && <SellForMeBlanks description={form.description} setDescription={form.setDescription} refused={placeholdersRefused} />}
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
            placeholdersRefused={placeholdersRefused}
          />
        </div>


        {/* PAGE 3: PRICE, screen 5 of 7 (board 3), or the quote window with "Get quotes" picked */}
        <div data-form-page="3" hidden={page !== 3} className="space-y-section">
          <PostJobStepHeader screen="price" question="What will you pay?" helper={askingQuotes ? "Choose how long Helprs near you can send quotes." : form.hasGift ? "Your gift card pays first. Anything left is charged when you post, and held until the job is done." : form.cardHoldOn ? "Your card isn't charged until a Helpr accepts your offer. The money is then held until the job is done." : "You're charged when you post. The money is held until the job is done."} canPick={canPickStep} onPick={pickStep} />
          {quotesShape && quotes.settled && (
            <PriceModeChoice value={priceMode} onChange={setPriceMode} quotesComingSoon={!quotesOn} />
          )}
        {askingQuotes ? (
          <QuoteRequestSection stepNumber={3} windowHours={form.quoteWindowHours} onWindowChange={form.setQuoteWindowHours} />
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
          {/* POST-H2 (owner 10-31): a Have-a-Helpr-list-it job suggests a range from its item count; still editable. */}
          {isSellForMeJob(form.category) && (
            <div className="mt-4">
              <SellForMePriceSuggestion description={form.description} budget={form.budgetNum} onUse={(d) => form.setBudget(String(d))} />
            </div>
          )}
          {/* Board 190: what most real jobs in this category paid; nothing without 30+ real jobs. */}
          {form.category && (
            <div className="mt-4">
              <PriceGuidanceCard category={form.category} budget={form.budgetNum} onUse={(d) => form.setBudget(String(d))} />
            </div>
          )}
        </div>
        )}
          {!askingQuotes && (
            // Below xl only: from xl the same card stays in the right column on every screen.
            <div className="xl:hidden"><PostJobPreviewCard
              title={form.title}
              category={form.category}
              photo={form.imagePreviews?.[0]}
              budget={form.budgetNum}
            /></div>
          )}
        </div>

        {/* PAGE 4: WHEN AND WHERE, screen 6 of 7 (board 45) */}
        <div data-form-page="4" hidden={page !== 4} className="space-y-section">
          <PostJobStepHeader screen="where" question="When and where?" helper="Helprs see the area now and your street address after you hire." canPick={canPickStep} onPick={pickStep} />
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
            savedAddress={form.savedAddress}
            otherSavedAddresses={form.otherSavedAddresses}
          />
        </div>

        {/* Submit — sits at the natural end of the form (not sticky) so it
            never floats over and obscures the section fields above it. The
            poster scrolls the form top-to-bottom and the contextual CTA is
            the last thing they reach. Bottom padding clears the floating
            MobileNav dock so the button is never tucked under it. The label
            is contextual: it names the next unfinished chapter until every
            required field is in, then becomes "Review, then pay". */}
        {/* Sticky action bar (boards 23/44/3/45): rides above the floating
            bottom nav while the screen scrolls, and settles at the end of
            the form. AppPage's own pb-safe-nav gives the last field room;
            bg-premium-page is AppPage's surface, so the bar blends in. The
            column is 2xl (board 167: a flow step centred, about 640px). */}
        {/* Not on screen 1 (owner 2026-10-21): a tap on a category IS the choice, so no floating
            "Pick a category" / "Continue" button sits over the tiles. */}
        {/* It floats only once it can be pressed (lead, 2026-10-25): a greyed "Add the
            address to continue" riding over the screen covered the very calendar and
            time picker it was asking for. Until then it sits at the end of the form,
            still naming what is missing. Guard: postJobFitsItsColumn.test.ts. */}
        {page !== 1 && (
        <div data-testid="post-job-action-bar" className={`${barFloats ? "sticky bottom-safe-nav" : "relative"} z-10 bg-premium-page pt-3 pb-2`}>
          {backTo && !atOpenJobLimit && !underAge ? (
            <Button
              variant="primary"
              type="button"
              className="w-full rounded-full text-ds-16"
              size="lg"
              onClick={() => { setPage?.(backTo.page); if (backTo.label === PLACEHOLDER_BLOCK) refusePlaceholders(); }}
            >
              <span className="min-w-0 whitespace-normal text-center leading-tight">{backTo.label}</span>
            </Button>
          ) : !lastPage ? (
            <Button
              variant="primary"
              type="button"
              className="w-full rounded-full text-ds-16"
              size="lg"
              disabled={!pagePressable}
              aria-disabled={!pagePressable}
              onClick={goOn}
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
          {/* The floating bar rides `safe-nav` above the scroller's padding,
              which is itself `pb-safe-nav` (AppPage), so it sat TWO safe-navs
              above the screen's bottom edge (2 x (16px + the iPhone safe area)
              on this screen, where no dock shows; measured 32px at 375 in
              WebKit), and the form used to show through that strip: a
              calendar row could peek out UNDER the bar, in the zone above
              Safari's toolbar and the home indicator where a tap is not
              reliable (owner 2026-10-27: a tapped day did nothing). This band
              fills the strip with the page's own ground, so what is visible is
              always above the bar, and anything under it scrolls clear (the
              bar is sticky, so at the end of the form it settles below the
              last field). Guard: e2e/journeys/post-job-day-tap.spec.ts. */}
          {barFloats && <div aria-hidden data-testid="post-job-bar-band" className="absolute inset-x-0 top-full h-[calc(theme(spacing.safe-nav)*2)] bg-premium-page" />}
        </div>
        )}
      </form>
      </div>
      <aside className="hidden xl:block sticky top-6">
        <PostJobPreviewCard title={form.title} category={form.category} photo={form.imagePreviews?.[0]} budget={askingQuotes ? 0 : form.budgetNum} />
      </aside>
    </div>
  );
}

/** Screen 1b's question (mock-up: "What kind of home job?"). Sentence case; "Something else" never opens 1b. */
function groupQuestion(id: JobCategoryGroupId, label: string): string {
  if (id === "moving_errands") return "What kind of moving or errand?";
  if (id === "events") return "What kind of event help?";
  if (id === "trades") return "What kind of trade job?";
  return `What kind of ${label.toLowerCase()} job?`;
}
