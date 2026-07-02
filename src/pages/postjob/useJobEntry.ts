import { toast } from "sonner";
import { track } from "@/lib/analytics";
import type { AiGeneratedJob } from "@/components/postjob/AiJobBuilder";
import type { SampleJob } from "@/data/sampleJobs";
import type { JobDraft } from "@/hooks/useDraftJob";
import type { Step } from "./postJobFormTypes";
import { parseLocationIntoFields } from "./postJobFormHelpers";

/**
 * useJobEntry — owns the "populate the form from an external source"
 * operations: AI-builder apply, the entry-landing choices (start fresh /
 * load draft / use template), template pre-fill, draft restore, and the
 * direct-offer clear. Pure structural extraction from usePostJobForm; the
 * field setters and draft are passed in so the parent stays the single
 * source of truth. Behavior is unchanged.
 */
export interface UseJobEntryParams {
  draft: JobDraft;
  setStep: (s: Step) => void;
  setDraftConsumed: (v: boolean) => void;
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setCategory: (v: string) => void;
  setStreetAddress: (v: string) => void;
  setCity: (v: string) => void;
  setAddrState: (v: string) => void;
  setZipCode: (v: string) => void;
  setDateNeeded: (v: string) => void;
  setStartTime: (v: string) => void;
  setEstimatedHours: (v: string) => void;
  setBudget: (v: string) => void;
  setSpecialRequirements: (v: string) => void;
  setIsRecurring: (v: boolean) => void;
  setRecurrenceInterval: (v: string) => void;
  setRecurrenceEndDate: (v: string) => void;
  setIsGroupJob: (v: boolean) => void;
  setHelpersNeeded: (v: string) => void;
  setOfferToHelperId: (v: string | null) => void;
  setOfferToHelperName: (v: string) => void;
}

export function useJobEntry(params: UseJobEntryParams) {
  const {
    draft,
    setStep,
    setDraftConsumed,
    setTitle,
    setDescription,
    setCategory,
    setStreetAddress,
    setCity,
    setAddrState,
    setZipCode,
    setDateNeeded,
    setStartTime,
    setEstimatedHours,
    setBudget,
    setSpecialRequirements,
    setIsRecurring,
    setRecurrenceInterval,
    setRecurrenceEndDate,
    setIsGroupJob,
    setHelpersNeeded,
    setOfferToHelperId,
    setOfferToHelperName,
  } = params;

  // Apply AI-generated fields to the form. Pure assignment — caller
  // can revise anything before submit. Empty strings/zero values are
  // preserved so a generated "" doesn't blow away existing user input
  // unless the AI returned a real value.
  const applyAiJob = (data: AiGeneratedJob) => {
    if (data.title) setTitle(data.title);
    if (data.description) setDescription(data.description);
    if (data.category) setCategory(data.category);
    if (data.estimated_hours !== undefined) setEstimatedHours(String(data.estimated_hours));
    const budgetCandidate = data.budget_max ?? data.budget_min;
    if (budgetCandidate !== undefined) setBudget(String(budgetCandidate));
    if (data.special_requirements) setSpecialRequirements(data.special_requirements);
    if (data.is_group_job) {
      setIsGroupJob(true);
      if (data.helpers_needed !== undefined) setHelpersNeeded(String(data.helpers_needed));
    }
  };

  // Restores a previously-saved draft into the form fields.
  const loadDraft = () => {
    setTitle(draft.title); setDescription(draft.description);
    setCategory(draft.category);
    const parsedLoc = parseLocationIntoFields(draft.location);
    if (parsedLoc.city !== undefined) {
      setStreetAddress(parsedLoc.streetAddress);
      setCity(parsedLoc.city);
      setAddrState(parsedLoc.addrState ?? "");
      setZipCode(parsedLoc.zipCode ?? "");
    } else {
      setStreetAddress(draft.location);
    }
    setDateNeeded(draft.dateNeeded); setStartTime(draft.startTime);
    setEstimatedHours(draft.estimatedHours); setBudget(draft.budget);
    setSpecialRequirements(draft.specialRequirements);
    setIsRecurring(draft.isRecurring); setRecurrenceInterval(draft.recurrenceInterval);
    setRecurrenceEndDate(draft.recurrenceEndDate);

    setDraftConsumed(true);
    toast.success("Draft restored!");
  };

  // ── Entry-landing choices ──────────────────────────────────────────────
  // The entry screen offers three ways into the form so the page no longer
  // dumps the full multi-step form on the user at once.

  /** "Start fresh" — current behavior, an empty form. */
  const startFresh = () => {
    track("post_job_entry_choice", { choice: "start_fresh" });
    setStep("form");
  };

  /** "Load draft" — restore the saved draft, then enter the form. */
  const loadDraftAndContinue = () => {
    track("post_job_entry_choice", { choice: "load_draft" });
    loadDraft();
    setStep("form");
  };

  /**
   * "Use a template" — enter the form; the SampleJobTemplates row at the
   * top of the empty form is the template picker. When a specific template
   * is passed (from the entry screen's template cards) it's applied here so
   * the user lands on a pre-filled form.
   */
  const useTemplate = (apply?: () => void) => {
    track("post_job_entry_choice", { choice: "use_template" });
    apply?.();
    setStep("form");
  };

  /**
   * Pre-fills the form from a sample-job template. Mirrors the field
   * mapping in SampleJobTemplates so a template picked on the entry screen
   * lands the user on an identical pre-filled form.
   */
  const applyTemplateFields = (sample: SampleJob) => {
    setCategory(sample.category);
    setTitle(sample.title);
    setDescription(sample.description);
    setBudget(String(sample.typical_price));
    // estimatedHours is stored as a stringified hours number, not minutes.
    setEstimatedHours((sample.typical_duration_minutes / 60).toString());
    track("sample_job_template_selected", { template_id: sample.id });
  };

  const clearOffer = () => {
    setOfferToHelperId(null);
    setOfferToHelperName("");
  };

  return {
    applyAiJob,
    loadDraft,
    startFresh,
    loadDraftAndContinue,
    useTemplate,
    applyTemplateFields,
    clearOffer,
  };
}
