import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { DraftSavedIndicator } from "./DraftSavedIndicator";
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
  const { business } = useMyBusiness();

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
  let submitLabel = "Review & pay";
  if (!form.detailsComplete) {
    if (!form.title.trim()) submitLabel = "Add a title to continue";
    else if (!form.description.trim()) submitLabel = "Add a description to continue";
    else if (!form.category) submitLabel = "Pick a category to continue";
    else submitLabel = "Replace the [placeholders] to continue";
  } else if (!form.logisticsComplete) {
    if (!form.streetAddress.trim() || !form.city.trim() || !form.addrState.trim() || !form.zipCode.trim())
      submitLabel = "Add the address to continue";
    else if (!form.dateNeeded) submitLabel = "Pick a date to continue";
    else submitLabel = "Pick a start time to continue";
  } else if (!form.budgetComplete) {
    submitLabel = "Set a budget to continue";
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

      {/* "Draft saved Xs ago" reassurance — appears once the autosave
          has actually fired. Sits next to the back arrow visually
          (below the page header, above the tabs) so it answers the
          poster's silent "did my input save?" question before they
          consider navigating away. */}
      {form.draftSavedAt > 0 && (
        <div className="flex justify-start">
          <DraftSavedIndicator savedAt={form.draftSavedAt} />
        </div>
      )}

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
            recurrenceInterval={form.recurrenceInterval}
            setRecurrenceInterval={form.setRecurrenceInterval}
            recurrenceEndDate={form.recurrenceEndDate}
            setRecurrenceEndDate={form.setRecurrenceEndDate}
            isGroupJob={form.isGroupJob}
            setIsGroupJob={form.setIsGroupJob}
            helpersNeeded={form.helpersNeeded}
            setHelpersNeeded={form.setHelpersNeeded}
            budgetNum={form.budgetNum}
            logisticsComplete={form.logisticsComplete}
            category={form.category}
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
            pricingMode={form.pricingMode}
            setPricingMode={form.setPricingMode}
            bidCeiling={form.bidCeiling}
            setBidCeiling={form.setBidCeiling}
            bidDeadline={form.bidDeadline}
            setBidDeadline={form.setBidDeadline}
            bidsSealed={form.bidsSealed}
            setBidsSealed={form.setBidsSealed}
          />
        </div>

        {/* W-9 requirement — only visible when this is a business post.
            See helper_w9_records + the W9CollectionDialog the helper
            sees at acceptance time. */}
        {business?.is_owner && (
          <div data-section="w9" className="rounded-ds-md border border-border p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-ds-sm bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <FileSignature className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-ds-13">Require W-9 from accepted Helpr</p>
                <Switch checked={form.requiresW9} onCheckedChange={form.setRequiresW9} />
              </div>
              <p className="text-ds-11 text-muted-foreground mt-1">
                When this is on, the helper signs a W-9 the moment they accept. We collect a typed signature + IP for the audit trail.
              </p>
            </div>
          </div>
        )}

        {/* The optional "Department / cost center" input used to live here for
            business posters. Removed 2026-08-10 — it was an extra field on the
            longest form in the product, optional, and free-text (so it was
            never reliable for reporting anyway).

            The approval-threshold notice below was NESTED INSIDE that field's
            block and is deliberately kept: it tells a business poster their job
            will go to pending approval instead of straight live, which changes
            what happens after they pay. `jobs.department` still exists in the
            schema and in jobSubmitHelpers, so nothing is dropped server-side
            and the field can come back without a migration. */}
        {form.business &&
          form.business.require_approval_above != null &&
          form.budgetNum > Number(form.business.require_approval_above) && (
            <p className="text-ds-11" style={{ color: "hsl(var(--bark))" }}>
              This post exceeds your team's ${Number(form.business.require_approval_above)} threshold —
              it'll go to pending approval before going live.
            </p>
          )}

        {/* Submit — sits at the natural end of the form (not sticky) so it
            never floats over and obscures the section fields above it. The
            poster scrolls the form top-to-bottom and the contextual CTA is
            the last thing they reach. Bottom padding clears the floating
            MobileNav dock so the button is never tucked under it. The label
            is contextual: it names the next unfinished chapter until every
            required field is in, then becomes "Review & pay". */}
        <div
          className="pt-1"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
        >
          <Button
            variant="bark"
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
              {formReady && form.budgetNum > 0 && (
                <span
                  className="font-display italic font-bold tabular-nums shrink-0"
                  style={{ fontSize: "1rem", letterSpacing: "-0.01em" }}
                >
                  · ${formatPrice(form.budgetNum)}
                </span>
              )}
            </span>
          </Button>
        </div>
      </form>
    </div>
  );
}
