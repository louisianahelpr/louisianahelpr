import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, LayoutTemplate, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { SampleJobTemplates } from "@/components/postjob/SampleJobTemplates";
import { DirectOfferBanner } from "./DirectOfferBanner";
import { DraftSavedIndicator } from "./DraftSavedIndicator";
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
  const { business } = useMyBusiness();
  // Each section is wrapped in a ref'd anchor so the sticky stepper can
  // scroll-jump to it and an IntersectionObserver can light up the step
  // for whichever section the poster is currently reading.
  const detailsRef = useRef<HTMLDivElement>(null);
  const logisticsRef = useRef<HTMLDivElement>(null);
  const budgetRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<PostJobSectionId>("details");
  // The blank form is the default. Two small tabs sit above it: "Pick up
  // draft" (only when a saved draft exists) restores it in one tap, and
  // "Use a template" reveals the sample-job grid.
  const [showTemplates, setShowTemplates] = useState(false);

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

      {/* Two small tabs above the blank form — a quick way to pull in a
          saved draft or start from a template, without a separate landing
          step. The draft tab only appears when a draft actually exists. */}
      <div className="flex items-center gap-2">
        {form.hasDraft && !form.draftConsumed && (
          <button
            type="button"
            onClick={form.loadDraft}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-sans font-semibold active:scale-95 transition-all"
            style={{
              fontSize: "0.8rem",
              color: "hsl(var(--bark))",
              background: "hsl(var(--parchment) / 0.7)",
              border: "0.5px solid hsl(var(--olivewood) / 0.22)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                "0 1px 2px hsl(var(--olivewood) / 0.06)",
            }}
          >
            <FileText className="w-3.5 h-3.5" aria-hidden />
            Pick up draft
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowTemplates((v) => !v)}
          aria-pressed={showTemplates}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-sans font-semibold active:scale-95 transition-all"
          style={{
            fontSize: "0.8rem",
            color: showTemplates ? "hsl(var(--burnt-sienna))" : "hsl(var(--bark))",
            background: showTemplates
              ? "hsl(var(--burnt-sienna) / 0.12)"
              : "hsl(var(--parchment) / 0.7)",
            border: showTemplates
              ? "0.5px solid hsl(var(--burnt-sienna) / 0.35)"
              : "0.5px solid hsl(var(--olivewood) / 0.22)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06)",
          }}
        >
          <LayoutTemplate className="w-3.5 h-3.5" aria-hidden />
          Use a template
        </button>
      </div>

      {/* Sample-job templates — revealed by the "Use a template" tab.
          Applying one (or hiding) collapses the panel. */}
      <SampleJobTemplates
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
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
            onReorderImages={form.reorderImages}
            uploadProgressByIndex={form.uploadProgressByIndex}
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
            category={form.category}
            includeMaterials={form.includeMaterials}
            setIncludeMaterials={form.setIncludeMaterials}
            materialsNote={form.materialsNote}
            setMaterialsNote={form.setMaterialsNote}
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
            helperFeePercent={form.helperFee}
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
                <p className="font-semibold text-ds-13">Require W-9 from accepted helper</p>
                <Switch checked={form.requiresW9} onCheckedChange={form.setRequiresW9} />
              </div>
              <p className="text-ds-11 text-muted-foreground mt-1">
                When this is on, the helper signs a W-9 the moment they accept. We collect a typed signature + IP for the audit trail.
              </p>
            </div>
          </div>
        )}

        {/* Business-only: department / cost-center field. Only rendered
            when the user is posting under a business membership so we
            don't clutter the form for personal posters. Maps directly
            to jobs.department (migration 20260609170000). */}
        {form.business && (
          <div className="space-y-2">
            <label htmlFor="department" className="text-ds-13 font-medium">
              Department / cost center{" "}
              <span className="text-ds-11 text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="department"
              type="text"
              value={form.department}
              onChange={(e) => form.setDepartment(e.target.value)}
              placeholder="e.g. Marketing, Ops, Q3 events"
              maxLength={64}
              className="w-full rounded-ds-md border border-input bg-background px-3 py-2 text-ds-13"
            />
            {form.business.require_approval_above != null &&
              form.budgetNum > Number(form.business.require_approval_above) && (
                <p
                  className="text-ds-11"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  This post exceeds your team's ${Number(form.business.require_approval_above)} threshold —
                  it'll go to pending approval before going live.
                </p>
              )}
          </div>
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
