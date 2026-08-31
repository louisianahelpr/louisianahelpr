import { Button } from "@/components/ui/button";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { OpenJobLimitNotice } from "./OpenJobLimitNotice";
import { formatPrice } from "@/lib/format";
import type { usePostJobForm } from "./usePostJobForm";

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
  const submitDisabled = atOpenJobLimit || !formReady;

  // Contextual label — names the first unfinished *field* (not just the
  // section) so the poster knows exactly what's blocking the button.
  let submitLabel = "Review & Pay";
  if (!form.detailsComplete) {
    if (!form.title.trim()) submitLabel = "Add a Title to Continue";
    else if (!form.description.trim()) submitLabel = "Add a Description to Continue";
    else if (!form.category) submitLabel = "Pick a Category to Continue";
    else submitLabel = "Replace the [Placeholders] to Continue";
  } else if (!form.logisticsComplete) {
    if (!form.streetAddress.trim() || !form.city.trim() || !form.addrState.trim() || !form.zipCode.trim())
      submitLabel = "Add the Address to Continue";
    else if (!form.dateNeeded) submitLabel = "Pick a Date to Continue";
    else submitLabel = "Pick a Start Time to Continue";
  } else if (!form.budgetComplete) {
    submitLabel = "Set a Budget to Continue";
  }

  return (
    <div key="form-step" className="space-y-5 animate-ds-page-in">
      {form.offerToHelperId && (
        <DirectOfferBanner
          offerToHelperName={form.offerToHelperName}
          onCancel={form.clearOffer}
        />
      )}

      {atOpenJobLimit && <OpenJobLimitNotice />}

      {/* Draft tab, template picker, and AI builder all live on the entry
          step (EntryChoice) now — the form is for filling in details, not
          for re-offering ways to start one. Keeping them here duplicated the
          entry screen and made the "form" step read as a second landing.

          The in-form Details/Logistics/Budget stepper rail was removed too:
          it stacked directly under the whole-flow Entry→Details→Pay stepper
          and re-stated "Details", reading as a duplicate stepper. The
          per-section chapter cards (numbered headers) now carry section
          identity on their own. */}

      <form onSubmit={form.handleReview} className="space-y-4">
        {/* SECTION 1: DETAILS */}
        <div>
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
            scopeVideoUrl={form.scopeVideoPreviewUrl}
            onVideoSelect={form.handleVideoSelect}
            onClearVideo={form.clearVideo}
          />
        </div>

        {/* SECTION 2: LOGISTICS */}
        <div>
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

        {/* SECTION 3: BUDGET */}
        <div>
          <BudgetSection
            stepNumber={3}
            budget={form.budget}
            setBudget={form.setBudget}
            suggested={form.suggested}
            budgetPresets={form.budgetPresets}
            priceStats={form.priceStats}
            priceStatsLoading={form.priceStatsLoading}
            isUrgent={form.isUrgent}
            setIsUrgent={form.setIsUrgent}
            urgentFee={form.urgentFee}
            setUrgentFee={form.setUrgentFee}
            customUrgentFee={form.customUrgentFee}
            setCustomUrgentFee={form.setCustomUrgentFee}
            budgetComplete={form.budgetComplete}
            category={form.category}
          />
        </div>

        {/* Submit — sits at the natural end of the form (not sticky) so it
            never floats over and obscures the section fields above it. The
            poster scrolls the form top-to-bottom and the contextual CTA is
            the last thing they reach. Bottom padding clears the floating
            MobileNav dock so the button is never tucked under it. The label
            is contextual: it names the next unfinished chapter until every
            required field is in, then becomes "Review & Pay". */}
        <div
          className="pt-1"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
        >
          <Button
            variant="primary"
            type="submit"
            className="w-full rounded-ds-md"
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
              {/* `totalCharge`, not `budgetNum`. This showed the bare budget on
                  a button labelled "Review & Pay", so a $100 job read
                  "Review & Pay · $100" and then charged $112 — the platform
                  fee, urgent bonus and first-job onboarding fee were all
                  invisible until the next screen. useJobDerived computes
                  totalCharge through posterServiceFeeCents, the same authority
                  create-payment uses, so this figure equals the Stripe charge
                  (bar sales tax, which resolves on the checkout step). */}
              {formReady && form.totalCharge > 0 && (
                <span
                  className="font-display italic font-bold tabular-nums shrink-0 text-ds-16"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {" "}· ${formatPrice(form.totalCharge)}
                </span>
              )}
            </span>
          </Button>
        </div>
      </form>
    </div>
  );
}
