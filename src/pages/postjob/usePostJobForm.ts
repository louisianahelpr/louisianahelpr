import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDraftJob } from "@/hooks/useDraftJob";
import { safeStorage } from "@/lib/safeStorage";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useParishTaxRate } from "@/hooks/useParishTaxRate";
import type { Step } from "./postJobFormTypes";
import { useJobMediaUpload } from "./useJobMediaUpload";
import { useJobSubmit } from "./useJobSubmit";
import { useJobEntry } from "./useJobEntry";
import { useJobDerived } from "./useJobDerived";
import { useJobFormEffects } from "./useJobFormEffects";

export type { Step } from "./postJobFormTypes";

/**
 * usePostJobForm — owns all of the Post-a-Task form state, side effects,
 * validation, draft autosave, image upload, and the submit/payment flow.
 *
 * This is a pure structural extraction from PostJob.tsx: behavior is
 * unchanged. The PostJob page component consumes this hook and renders.
 */
export function usePostJobForm() {
  const navigate = useNavigate();
  const { business } = useMyBusiness();
  const { profile } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const { draft, hasDraft, saveDraft, clearDraft } = useDraftJob();
  const [saving, setSaving] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  // Preflight open-job count — checked at mount so the user learns
  // about the 5-job cap before filling the entire form.
  const [openJobCount, setOpenJobCount] = useState<number | null>(null);
  const [idvDialogOpen, setIdvDialogOpen] = useState(false);
  const [idvStatus, setIdvStatus] = useState<string | undefined>(undefined);
  const [idvFailureReason, setIdvFailureReason] = useState<string | undefined>(undefined);
  // Deep-link arrivals (one-tap rebook, direct offer to a saved helpr) come
  // in with the intent already chosen, so they skip the entry landing and
  // drop straight into the pre-filled form. Everyone else sees the
  // start-fresh / draft / template choice first, which declutters the page.
  const skipEntry = !!(searchParams.get("rebook") || searchParams.get("offerTo"));
  const [step, setStep] = useState<Step>(skipEntry ? "form" : "entry");

  // Advance to the form when `rebook`/`offerTo` arrives AFTER mount.
  //
  // The initializer above only runs once per mount. That covers a genuine
  // deep-link arrival, but NOT the entry screen's own "Repost a recent job"
  // tiles: those call `navigate("/post-job?rebook=<id>")` while already on
  // /post-job, so the route never changes, the component never remounts, and
  // `step` stayed "entry" forever.
  //
  // The bug this caused was invisible-looking but not harmless. The rebook
  // effect in useJobFormEffects DOES re-run on searchParams, so tapping a
  // Repost tile silently filled every field of a form the user couldn't see,
  // which tripped the draft autosave — so the only feedback was a "Pick up
  // your draft" card quietly appearing ABOVE the tile they just tapped.
  // The button looked dead and spawned a card that explained nothing.
  //
  // Safe to run unconditionally: when skipEntry is already true at mount the
  // step is "form" and this is a no-op. `handleBack` reads the same flag, so
  // once the URL carries the param, backing out goes to the dashboard rather
  // than to an entry screen the user never came from.
  useEffect(() => {
    if (skipEntry) setStep("form");
  }, [skipEntry]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  // State is locked to LA (Helpr is Louisiana-only) and the field is rendered
  // read-only, so seed it with "LA" — otherwise the empty real value fails the
  // `!addrState.trim()` submit gate while the UI shows "LA", silently blocking
  // the poster with a toast that scrolls to an uneditable field (LH-53).
  const [addrState, setAddrState] = useState("LA");
  const [zipCode, setZipCode] = useState("");
  const [parish, setParish] = useState<string | null>(null);
  const [dateNeeded, setDateNeeded] = useState("");
  // Default to 9:00 AM — a sane working-hours start. Midnight (the old
  // empty-string default rendering as 12:00 AM) was almost never the
  // intended task time. The poster can still change it on the wheel.
  const [startTime, setStartTime] = useState("09:00");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [budget, setBudget] = useState("");
  const [specialRequirements, setSpecialRequirements] = useState("");
  // Recurring is temporarily withdrawn (see the note in LogisticsSection —
  // every visit after the first posted with no payment behind it). The state
  // stays so the rest of the form keeps its shape, but the setter is pinned
  // OFF here rather than only in the UI: a restored draft and a rebook both
  // replay a saved `is_recurring: true` through their own setters, which would
  // create a parent this build cannot fund even though the control is gone.
  const [isRecurring, setIsRecurringRaw] = useState(false);
  const setIsRecurring = (_v: boolean) => setIsRecurringRaw(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState("weekly");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [isGroupJob, setIsGroupJob] = useState(false);
  const [helpersNeeded, setHelpersNeeded] = useState("2");
  // Credential tier requirement for the job:
  // 0 = open (anyone), 1 = ID-verified, 2 = licensed, 3 = licensed + insured.
  // Only relevant for trade categories; other categories always use 0.
  const [credentialTier, setCredentialTierRaw] = useState(0);
  // Setting a credential tier used to silently flip the job into "Accept bids"
  // at tier >= 2, on the theory that a licensed job wants competitive quotes.
  // Bidding is gone (see PRICING_MODE_REMOVED in BudgetSection), so a tier is
  // now just a tier — it no longer changes how the job is priced behind the
  // poster's back.
  const setCredentialTier = setCredentialTierRaw;
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentFee, setUrgentFee] = useState("5");
  const [customUrgentFee, setCustomUrgentFee] = useState(false);
  const [isFlexibleSchedule, setIsFlexibleSchedule] = useState(false);
  // Business posts can opt to require the accepted helper to sign a W-9.
  // See helper_w9_records + the e-sign dialog in W9CollectionDialog.
  const [requiresW9, setRequiresW9] = useState(false);
  // Business-account poster — optional cost-center / department tag.
  // Persisted to jobs.department by the consolidated migration
  // 20260609170000_business_team_roles.sql.
  const [department, setDepartment] = useState("");
  const [platformFee, setPlatformFee] = useState<number | null>(null);
  const [customerFee, setCustomerFee] = useState<number | null>(null);
  // One-time account-setup fee — mirrors the edge function (create-payment
  // action=escrow), which adds a "One-time Account Setup" line item of
  // onboarding_fee_cents the FIRST time a poster funds a job. We must show
  // it here so the displayed total equals the amount Stripe charges. Default
  // to "already paid" so a returning poster never sees a phantom fee; only
  // flip to unpaid once the profile row confirms it's owed.
  const [onboardingFeeCents, setOnboardingFeeCents] = useState(200);
  const [onboardingFeePaid, setOnboardingFeePaid] = useState(true);
  // Sales tax quoted AND persisted from the poster's parish, never a
  // constant. This was `const salesTaxRate = 10` — a flat, invented 10% that
  // buildJobInsertPayload multiplied by the budget and wrote to
  // jobs.sales_tax_rate / jobs.sales_tax_amount on EVERY job. Stripe charges
  // sales tax only on the assembly labor line (see lib/salesTax.ts), so on
  // every other category the DB carried ~10% of the budget in tax that was
  // never collected — and the admin revenue rollups sum that column.
  // `null` (parish not resolved yet) means 0, not a guess.
  const { totalRatePercent: parishTaxRate } = useParishTaxRate(parish);
  const salesTaxRate = parishTaxRate ?? 0;

  // True once the user has restored the saved draft via loadDraft. The inline
  // "Pick up draft" pill hides after this so an accidental re-tap can't replace
  // the in-progress form with the (autosave-refreshed) snapshot.
  const [draftConsumed, setDraftConsumed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // AI Job Builder state moved into the AiJobBuilder component itself.

  // Photo + scope-video upload state and storage flow.
  const {
    imageFiles,
    imagePreviews,
    uploading,
    uploadProgress,
    uploadProgressByIndex,
    scopeVideoPreviewUrl,
    handleVideoSelect,
    clearVideo,
    handleImageSelect,
    removeImage,
    reorderImages,
    uploadAndAttachPhotos,
    uploadAndAttachScopeVideo,
  } = useJobMediaUpload();

  // Optional "Materials I'll provide" note for material-heavy categories.
  // Stored locally and appended into special_requirements at submit so
  // helprs see it on the job card without a schema migration.
  const [includeMaterials, setIncludeMaterials] = useState(false);
  const [materialsNote, setMaterialsNote] = useState("");

  // Stripe Checkout supports saving a card for future-use via the
  // `setup_future_usage` session option. The toggle is sticky via
  // localStorage so a returning poster who opted in once doesn't have to
  // re-tap it every time. Default off — explicit opt-in only.
  const [saveCardForFuture, setSaveCardForFutureState] = useState<boolean>(() => {
    try {
      return safeStorage.getItem("helpr_save_card_pref") === "1";
    } catch { return false; }
  });
  const setSaveCardForFuture = (next: boolean) => {
    setSaveCardForFutureState(next);
    try { safeStorage.setItem("helpr_save_card_pref", next ? "1" : "0"); } catch { /* ignore */ }
  };

  // Preferred helper shortcut — when the poster has a trusted repeat helper,
  // a card at checkout lets them route this job to that helper first.
  // Defaults to true so the opt-in is pre-checked (opt-out, not opt-in).
  const [sendToPreferred, setSendToPreferred] = useState(true);

  // Direct Offer state — set when arriving via /post-job?offerTo=<helperId>
  const [offerToHelperId, setOfferToHelperId] = useState<string | null>(null);
  const [offerToHelperName, setOfferToHelperName] = useState<string>("");

  // Mount/reactive side effects (platform fee, open-job preflight, rebook
  // prefill, LA smart defaults, direct-offer targeting, parish lookup,
  // debounced autosave). Extracted into useJobFormEffects; every effect and
  // dependency array is unchanged.
  useJobFormEffects({
    searchParams,
    profile,
    saveDraft,
    setPlatformFee,
    setCustomerFee,
    setOnboardingFeeCents,
    setOpenJobCount,
    setOnboardingFeePaid,
    setTitle,
    setDescription,
    setCategory,
    setStreetAddress,
    setCity,
    setAddrState,
    setZipCode,
    setBudget,
    setEstimatedHours,
    setSpecialRequirements,
    setIsRecurring,
    setRecurrenceInterval,
    setParish,
    setOfferToHelperId,
    setOfferToHelperName,
    title,
    description,
    category,
    streetAddress,
    city,
    addrState,
    zipCode,
    dateNeeded,
    startTime,
    estimatedHours,
    budget,
    specialRequirements,
    isRecurring,
    recurrenceInterval,
    recurrenceEndDate,
    isFlexibleSchedule,
    isUrgent,
    urgentFee,
    isGroupJob,
    helpersNeeded,
    credentialTier,
    includeMaterials,
    materialsNote,
    department,
    requiresW9,
    offerToHelperId,
  });

  // Form-population operations (AI apply, entry-landing choices, template
  // pre-fill, draft restore, direct-offer clear). Extracted into useJobEntry;
  // field setters + draft are passed through. Behavior is unchanged.
  const {
    applyAiJob,
    loadDraft,
    startFresh,
    loadDraftAndContinue,
    useTemplate,
    applyTemplateFields,
    clearOffer,
  } = useJobEntry({
    draft,
    hasDraft,
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
    setIsFlexibleSchedule,
    setIsUrgent,
    setUrgentFee,
    setCredentialTier,
    setIncludeMaterials,
    setMaterialsNote,
    setDepartment,
    setRequiresW9,
  });

  // Review-gate + pre-submit checks + job-insert/payment flow. Extracted
  // into useJobSubmit; all form state is passed through so this hook stays
  // the single source of truth. Behavior is unchanged.
  const { handleReview, handleSubmit } = useJobSubmit({
    business,
    saving,
    setSaving,
    setRedirecting,
    setStep,
    setConfirmed,
    setIdvStatus,
    setIdvFailureReason,
    setIdvDialogOpen,
    clearDraft,
    title,
    description,
    category,
    streetAddress,
    city,
    addrState,
    zipCode,
    parish,
    dateNeeded,
    startTime,
    isFlexibleSchedule,
    estimatedHours,
    budget,
    specialRequirements,
    isRecurring,
    recurrenceInterval,
    recurrenceEndDate,
    isGroupJob,
    helpersNeeded,
    isUrgent,
    urgentFee,
    platformFee,
    salesTaxRate,
    offerToHelperId,
    credentialTier,
    department,
    requiresW9,
    includeMaterials,
    materialsNote,
    saveCardForFuture,
    pifCreditId: searchParams.get("pif_credit"),
    uploadAndAttachPhotos,
    uploadAndAttachScopeVideo,
  });

  // Derived money math, completion flags, live pricing stats, liquidity
  // signal, and budget presets. Extracted into useJobDerived; every
  // calculation is unchanged.
  const {
    budgetNum,
    urgentFeeNum,
    customerFeeAmount,
    onboardingFeeAmount,
    totalCharge,
    categoryLabel,
    detailsComplete,
    logisticsComplete,
    budgetComplete,
    priceStats,
    priceStatsLoading,
    helprActivity,
    suggested,
    budgetPresets,
  } = useJobDerived({
    budget,
    isUrgent,
    urgentFee,
    customerFee,
    onboardingFeePaid,
    onboardingFeeCents,
    category,
    title,
    description,
    streetAddress,
    city,
    addrState,
    zipCode,
    dateNeeded,
    startTime,
    parish,
  });

  const handlePostJobBack = () => {
    if (step === "checkout") {
      setStep("form");
      // Scroll to top so the user lands on Details (not mid-form) to edit.
      // RAF lets the form re-render before scroll fires, so the target
      // exists. Smooth scroll matches iOS Settings-app feel.
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    } else if (step === "form" && !skipEntry) {
      // Back out of the form to the entry landing — unless the form was
      // reached via a deep link that has no entry screen behind it.
      setStep("entry");
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    } else {
      navigate("/dashboard");
    }
  };

  return {
    // step / nav
    step,
    setStep,
    handlePostJobBack,
    // overlay / status
    saving,
    redirecting,
    uploading,
    uploadProgress,
    // IDV dialog
    idvDialogOpen,
    setIdvDialogOpen,
    idvStatus,
    idvFailureReason,
    // open-job preflight
    openJobCount,
    // direct offer
    offerToHelperId,
    offerToHelperName,
    clearOffer,
    // draft prompt
    hasDraft,
    draftConsumed,
    loadDraft,
    // entry landing
    startFresh,
    loadDraftAndContinue,
    useTemplate,
    applyTemplateFields,
    // details fields
    title,
    setTitle,
    description,
    setDescription,
    category,
    setCategory,
    // logistics fields
    streetAddress,
    setStreetAddress,
    city,
    setCity,
    addrState,
    setAddrState,
    zipCode,
    setZipCode,
    // Resolved from the zip by useJobFormEffects. Exposed because the checkout
    // summary quotes the parish's real sales-tax rate from `parish_tax_rates`
    // (it used to be passed as a hardcoded `null` and the rate was invented).
    parish,
    dateNeeded,
    setDateNeeded,
    startTime,
    setStartTime,
    isFlexibleSchedule,
    setIsFlexibleSchedule,
    estimatedHours,
    setEstimatedHours,
    specialRequirements,
    setSpecialRequirements,
    isRecurring,
    setIsRecurring,
    recurrenceInterval,
    setRecurrenceInterval,
    recurrenceEndDate,
    setRecurrenceEndDate,
    isGroupJob,
    setIsGroupJob,
    helpersNeeded,
    setHelpersNeeded,
    /** Cost-center / department label — exposed only to business posters. */
    department,
    setDepartment,
    /** Business membership row (so the post-job UI can show the
        department field, MFA banner, and approval-threshold notice). */
    business,
    // budget fields
    budget,
    setBudget,
    /** Credential tier required to apply (0–3). Only set for trade categories;
        others always use 0. */
    credentialTier,
    setCredentialTier,
    // Pricing mode fields
    isUrgent,
    setIsUrgent,
    urgentFee,
    setUrgentFee,
    customUrgentFee,
    setCustomUrgentFee,
    // W-9 requirement (business posts only)
    requiresW9,
    setRequiresW9,
    // images
    imageFiles,
    imagePreviews,
    handleImageSelect,
    removeImage,
    reorderImages,
    uploadProgressByIndex,
    // scope video
    scopeVideoPreviewUrl,
    handleVideoSelect,
    clearVideo,
    // materials toggle
    includeMaterials,
    setIncludeMaterials,
    materialsNote,
    setMaterialsNote,
    // save-card opt-in (checkout)
    saveCardForFuture,
    setSaveCardForFuture,
    // checkout state
    confirmed,
    setConfirmed,
    // preferred helper shortcut
    sendToPreferred,
    setSendToPreferred,
    /** The poster's preferred repeat helper, derived from their profile.
     *  Shown as a "Send to [name] first?" card at checkout. */
    preferredHelperId: (profile as unknown as { preferred_helper_id?: string | null })?.preferred_helper_id ?? null,
    // ai builder
    applyAiJob,
    // derived values
    budgetNum,
    urgentFeeNum,
    customerFee,
    customerFeeAmount,
    onboardingFeeAmount,
    totalCharge,
    categoryLabel,
    detailsComplete,
    logisticsComplete,
    budgetComplete,
    priceStats,
    priceStatsLoading,
    helprActivity,
    suggested,
    budgetPresets,
    // handlers
    handleReview,
    handleSubmit,
  };
}
