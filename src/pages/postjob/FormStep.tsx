import { Button } from "@/components/ui/button";
import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { DraftPrompt } from "./DraftPrompt";
import { OpenJobLimitNotice } from "./OpenJobLimitNotice";
import { SectionProgress } from "./SectionProgress";
import type { usePostJobForm } from "./usePostJobForm";

interface FormStepProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * STEP 1: the Post-a-Task form. Composes the three section components
 * (Details / Logistics / Budget) with the AI builder, progress bar,
 * draft prompt, direct-offer banner, and the sticky submit button.
 *
 * Purely presentational — all state and handlers come from usePostJobForm.
 */
export function FormStep({ form }: FormStepProps) {
  return (
    <div key="form-step" className="space-y-6 animate-ds-page-in">
      {form.offerToHelperId && (
        <DirectOfferBanner
          offerToHelperName={form.offerToHelperName}
          onCancel={form.clearOffer}
        />
      )}

      {form.showDraftPrompt && (
        <DraftPrompt onLoad={form.loadDraft} onDismiss={form.dismissDraftPrompt} />
      )}

      {form.openJobCount !== null && form.openJobCount >= 5 && <OpenJobLimitNotice />}

      {/* AI Job Builder — secondary helper, collapsed by default. */}
      <AiJobBuilder
        locationContext={`${form.city}, ${form.addrState}`.trim().replace(/^,\s*/, "")}
        onGenerated={form.applyAiJob}
      />

      <SectionProgress
        detailsComplete={form.detailsComplete}
        logisticsComplete={form.logisticsComplete}
        budgetComplete={form.budgetComplete}
      />

      <form onSubmit={form.handleReview} className="space-y-5">
        {/* SECTION 1: DETAILS */}
        <DetailsSection
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
          detailsComplete={form.detailsComplete}
        />

        {/* SECTION 2: LOGISTICS */}
        <LogisticsSection
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
          estimatedHours={form.estimatedHours}
          setEstimatedHours={form.setEstimatedHours}
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
        />

        {/* SECTION 3: BUDGET */}
        <BudgetSection
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
        />

        {/* Submit — sticky so it stays reachable while the
            poster scrolls the long form. The sticky bottom
            offset clears the floating MobileNav dock; a
            parchment gradient backdrop keeps form content
            legible as it scrolls behind. position:sticky
            reserves flow space so it never overlaps the Budget
            section the way the old fixed button did. */}
        <div
          className="sticky z-20 -mx-5 px-5 pt-3 pb-1"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
            background:
              "linear-gradient(to top, hsla(38, 18%, 97%, 0.96) 55%, hsla(38, 18%, 97%, 0))",
          }}
        >
          <Button
            variant="bark"
            type="submit"
            className="w-full rounded-ds-md"
            size="lg"
            disabled={form.openJobCount !== null && form.openJobCount >= 5}
          >
            <span className="inline-flex items-center gap-2">
              Review &amp; pay
              {form.budgetNum > 0 && (
                <span
                  className="font-display italic font-bold tabular-nums"
                  style={{ fontSize: "1rem", letterSpacing: "-0.01em" }}
                >
                  · ${form.budgetNum.toFixed(2)}
                </span>
              )}
            </span>
          </Button>
        </div>
      </form>
    </div>
  );
}
