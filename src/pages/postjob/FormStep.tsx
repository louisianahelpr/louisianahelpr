import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { SampleJobTemplates } from "@/components/postjob/SampleJobTemplates";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { DraftPrompt } from "./DraftPrompt";
import { OpenJobLimitNotice } from "./OpenJobLimitNotice";
import { SectionProgress, type PostJobSectionId } from "./SectionProgress";
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
  // Each section is wrapped in a ref'd anchor so the sticky stepper can
  // scroll-jump to it and an IntersectionObserver can light up the step
  // for whichever section the poster is currently reading.
  const detailsRef = useRef<HTMLDivElement>(null);
  const logisticsRef = useRef<HTMLDivElement>(null);
  const budgetRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<PostJobSectionId>("details");

  const refs = useMemo(
    () => ({ details: detailsRef, logistics: logisticsRef, budget: budgetRef }),
    [],
  );

  // Scroll-spy — the topmost section currently inside the spy band (just
  // below the sticky stepper) becomes the active step.
  useEffect(() => {
    const anchors = [detailsRef.current, logisticsRef.current, budgetRef.current].filter(
      (el): el is HTMLDivElement => !!el,
    );
    if (anchors.length === 0) return;

    const order: PostJobSectionId[] = ["details", "logistics", "budget"];
    const visible = new Set<PostJobSectionId>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section as PostJobSectionId;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const top = order.find((id) => visible.has(id));
        if (top) setActiveSection(top);
      },
      // Spy band sits just under the sticky stepper; the negative bottom
      // margin keeps only the upper part of the viewport "active".
      { rootMargin: "-128px 0px -55% 0px", threshold: 0 },
    );
    for (const el of anchors) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleJump = useCallback(
    (id: PostJobSectionId) => {
      setActiveSection(id);
      refs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [refs],
  );

  const atOpenJobLimit = form.openJobCount !== null && form.openJobCount >= 5;
  // The form is "ready" once all three sections' required fields are
  // satisfied. handleReview still runs the full validation pass on
  // submit (past-date, budget ceiling, urgent-fee min) — this only
  // gates the button so it can't be tapped before the basics are in.
  const formReady =
    form.detailsComplete && form.logisticsComplete && form.budgetComplete;
  const submitDisabled = atOpenJobLimit || !formReady;

  // Contextual label — points the poster at the first unfinished
  // section instead of always promising "Review & pay".
  let submitLabel = "Review & pay";
  if (!form.detailsComplete) submitLabel = "Add task details to continue";
  else if (!form.logisticsComplete) submitLabel = "Add when & where to continue";
  else if (!form.budgetComplete) submitLabel = "Set a budget to continue";

  return (
    <div key="form-step" className="space-y-5 animate-ds-page-in">
      {form.offerToHelperId && (
        <DirectOfferBanner
          offerToHelperName={form.offerToHelperName}
          onCancel={form.clearOffer}
        />
      )}

      {form.showDraftPrompt && (
        <DraftPrompt onLoad={form.loadDraft} onDismiss={form.dismissDraftPrompt} />
      )}

      {atOpenJobLimit && <OpenJobLimitNotice />}

      {/* Sample-job templates — a row of pre-filled example jobs for
          first-time customers who don't know what details or budget are
          reasonable. Self-hides the moment the customer starts typing or
          picks a category, so it never tempts mid-flow. */}
      <SampleJobTemplates
        title={form.title}
        category={form.category}
        setTitle={form.setTitle}
        setDescription={form.setDescription}
        setCategory={form.setCategory}
        setBudget={form.setBudget}
        setEstimatedHours={form.setEstimatedHours}
      />

      {/* AI Job Builder — secondary helper, collapsed by default. */}
      <AiJobBuilder
        locationContext={`${form.city}, ${form.addrState}`.trim().replace(/^,\s*/, "")}
        onGenerated={form.applyAiJob}
      />

      {/* Sticky stepper — pins below the page header and reflects which
          of the three chapters the poster is currently in. */}
      <SectionProgress
        detailsComplete={form.detailsComplete}
        logisticsComplete={form.logisticsComplete}
        budgetComplete={form.budgetComplete}
        activeSection={activeSection}
        onJump={handleJump}
      />

      <form onSubmit={form.handleReview} className="space-y-4">
        {/* SECTION 1: DETAILS — scroll-margin clears the sticky stepper
            so a jump lands the header in view, not under the rail. */}
        <div ref={detailsRef} data-section="details" style={{ scrollMarginTop: "120px" }}>
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
            detailsComplete={form.detailsComplete}
          />
        </div>

        {/* SECTION 2: LOGISTICS */}
        <div ref={logisticsRef} data-section="logistics" style={{ scrollMarginTop: "120px" }}>
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
        </div>

        {/* SECTION 3: BUDGET */}
        <div ref={budgetRef} data-section="budget" style={{ scrollMarginTop: "120px" }}>
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
          />
        </div>

        {/* Submit — sticky so it stays reachable while the poster
            scrolls the long form. The sticky bottom offset clears the
            floating MobileNav dock; a parchment gradient backdrop keeps
            form content legible as it scrolls behind. The label is
            contextual: it names the next unfinished chapter until every
            required field is in, then becomes "Review & pay". */}
        <div
          className="sticky z-20 -mx-4 px-4 pt-3 pb-1"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
            // Parchment gradient tokenized so palette tweaks propagate.
            // Was hard-coded `hsla(38, 18%, 97%, ...)` matching the
            // parchment token — using the var directly keeps them in
            // sync if the token ever shifts.
            background:
              "linear-gradient(to top, hsl(var(--parchment) / 0.96) 55%, hsl(var(--parchment) / 0))",
          }}
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
