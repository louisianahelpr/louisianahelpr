import { useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { requireOnline } from "@/lib/requireOnline";
import { assertWritable } from "@/hooks/useImpersonation";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { geocodeAddress, composeJobAddress } from "@/lib/geocode";
import { maybeFireFirstPostConfetti } from "./firstPostConfetti";
import { recordJobActionForPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import { buildJobInsertPayload } from "./jobSubmitHelpers";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import type { BusinessMembership } from "@/hooks/useMyBusiness";
import type { Step } from "./postJobFormTypes";
import { composeSpecialRequirements, scrollToField } from "./postJobFormHelpers";
import {
  MIN_JOB_BUDGET_DOLLARS,
  MAX_JOB_BUDGET_DOLLARS,
  URGENT_FEE_FLOOR_DOLLARS,
  formatDollarsWhole,
} from "@/lib/moneyLimits";

/**
 * useJobSubmit — owns the review-gate, pre-submit checks, and the full
 * job-insert → payment-redirect flow. Pure structural extraction from
 * usePostJobForm: every Supabase call, error check, `report()`, and money
 * calculation is unchanged and runs in the same order.
 *
 * All form state, setters, and media-upload callbacks are passed in via a
 * single params object so the parent hook remains the single source of
 * truth — this hook only reads that state and drives the submit behavior.
 */
export interface UseJobSubmitParams {
  // Auth / business
  business: BusinessMembership | null | undefined;
  // Overlay / status setters (parent-owned)
  saving: boolean;
  setSaving: (v: boolean) => void;
  setRedirecting: (v: boolean) => void;
  setStep: (s: Step) => void;
  setConfirmed: (v: boolean) => void;
  // IDV dialog setters
  setIdvStatus: (v: string | undefined) => void;
  setIdvFailureReason: (v: string | undefined) => void;
  setIdvDialogOpen: (v: boolean) => void;
  // Draft
  clearDraft: () => void;
  // Details fields
  title: string;
  description: string;
  category: string;
  // Logistics fields
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  parish: string | null;
  dateNeeded: string;
  startTime: string;
  isFlexibleSchedule: boolean;
  estimatedHours: string;
  // Budget fields
  budget: string;
  specialRequirements: string;
  isRecurring: boolean;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  recurrenceDays: number[];
  recurrenceWeeks: number;
  isGroupJob: boolean;
  helpersNeeded: string;
  isUrgent: boolean;
  urgentFee: string;
  platformFee: number | null;
  salesTaxRate: number;
  offerToHelperId: string | null;
  credentialTier: number;
  department: string;
  requiresW9: boolean;
  // Materials + card
  includeMaterials: boolean;
  materialsNote: string;
  saveCardForFuture: boolean;
  // Pay It Forward — when the poster arrived from a gift redemption, the
  // credit id rides through checkout so create-payment settles it (fully
  // covered → funds from prepaid balance, $0 charge; partial → collect the
  // difference via Stripe). Null for an ordinary post.
  pifCreditId: string | null;
  // Media upload callbacks
  uploadAndAttachPhotos: (jobId: string) => Promise<void>;
  uploadAndAttachScopeVideo: (jobId: string) => Promise<void>;
}

export function useJobSubmit(params: UseJobSubmitParams) {
  const {
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
    recurrenceDays,
    recurrenceWeeks,
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
    pifCreditId,
    uploadAndAttachPhotos,
    uploadAndAttachScopeVideo,
  } = params;

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Give your task a title"); scrollToField("title"); return; }
    if (!description.trim()) { toast.error("Add a description"); scrollToField("description"); return; }
    if (hasUnfilledPlaceholders(description)) { toast.error("Replace the [bracketed] placeholders with your own details before posting"); scrollToField("description"); return; }
    if (!category) { toast.error("Pick a category"); scrollToField("category-picker"); return; }
    // Photo is optional — a photo dramatically improves applicant count and
    // quote accuracy, so it's strongly nudged in the UI, but tasks like
    // dog-walking or errands have no natural photo and shouldn't be blocked.
    if (!streetAddress.trim()) { toast.error("Add a street address"); scrollToField("streetAddress"); return; }
    if (!city.trim()) { toast.error("Add a city"); scrollToField("city"); return; }
    if (!addrState.trim()) { toast.error("Add a state"); scrollToField("state"); return; }
    if (!zipCode.trim()) { toast.error("Add a zip code"); scrollToField("zipCode"); return; }
    if (!dateNeeded) { toast.error("Pick a date for the task"); scrollToField("date"); return; }
    // Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(dateNeeded + "T00:00:00");
    if (selectedDate < today) { toast.error("Date cannot be in the past"); scrollToField("date"); return; }
    if (!isFlexibleSchedule && !startTime) { toast.error("Start time is required (or mark the schedule as flexible)"); scrollToField("flexible"); return; }
    // special_requirements is optional — no validation needed
    // The budget is always required and always bounded now. It used to be
    // skipped entirely in "Accept bids" mode, which is how a bid job reached
    // checkout carrying a stale hidden budget and got charged for it.
    if (!budget || parseFloat(budget) < MIN_JOB_BUDGET_DOLLARS) { toast.error(`Minimum budget is ${formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)}`); scrollToField("budget"); return; }
    if (parseFloat(budget) > MAX_JOB_BUDGET_DOLLARS) { toast.error(`Maximum budget is ${formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}.`); scrollToField("budget"); return; }
    if (isUrgent && (parseFloat(urgentFee) < URGENT_FEE_FLOOR_DOLLARS || isNaN(parseFloat(urgentFee)))) { toast.error(`Urgent bonus must be at least ${formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)}`); scrollToField("custom-urgent-fee"); return; }
    // A series with no days is not a series. The picker seeds the job's own
    // weekday so this should be unreachable from a fresh form, but a restored
    // draft predating the day set would come back empty — and letting it
    // through would create a parent that never spawns a second visit and never
    // says why.
    if (isRecurring && recurrenceDays.length === 0) {
      toast.error("Pick at least one day this job repeats on");
      scrollToField("date");
      return;
    }
    setConfirmed(false);
    setStep("checkout");
  };

  const submittingRef = useRef(false);
  const COOLDOWN_KEY = "helpr_last_job_submit";
  const COOLDOWN_MS = 30_000; // 30 second cooldown

  /**
   * Pre-flight gating before any job INSERT — double-click guard, submit
   * cooldown, auth, identity-verification gate, and the open-job limit.
   *
   * Returns the authenticated `user` when all checks pass, or `null` when
   * a check failed (in which case it has already shown the right toast /
   * dialog and reset `saving` + `submittingRef`). Behavior is identical to
   * the inline checks it replaces — same order, same messages.
   */
  const runPreSubmitChecks = async () => {
    // Prevent double-click
    if (submittingRef.current || saving) return null;
    // Read-only impersonation: admins viewing as another user cannot post.
    if (!assertWritable()) return null;

    // Cooldown check
    const lastSubmit = safeStorage.getItem(COOLDOWN_KEY);
    if (lastSubmit && Date.now() - parseInt(lastSubmit) < COOLDOWN_MS) {
      toast.error("Please wait before posting another job. You recently submitted one.");
      return null;
    }

    submittingRef.current = true;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sign in to post a task");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }

    // Identity verification gate — required before posting. Same Stripe
    // IDV used at job-acceptance, applied here so posters can't onboard
    // strangers under a fake identity.
    {
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("idv_status, idv_failure_reason")
        .eq("user_id", user.id)
        .single();
      // Don't drop this error: on a transient fetch failure `prof` is
      // undefined, which would read as "not verified" and wrongly trap an
      // already-verified poster in the IDV dialog. Surface it and abort.
      if (profErr) {
        report(profErr, { tags: { source: "usePostJobForm.idvGate" } });
        toast.error("Couldn't check your verification status — please try again.");
        setSaving(false);
        submittingRef.current = false;
        return null;
      }
      const profStatus = (prof as { idv_status?: string })?.idv_status;
      if (profStatus !== "verified") {
        setIdvStatus(profStatus);
        setIdvFailureReason((prof as { idv_failure_reason?: string })?.idv_failure_reason);
        setIdvDialogOpen(true);
        setSaving(false);
        submittingRef.current = false;
        return null;
      }
    }

    // Business verification gate — when this post is being attributed to a
    // business (`business_id` will land on the row), the business must be
    // admin-verified (insurance + license reviewed). Mirrors the IDV gate:
    // fresh fetch, fail closed on error, block if not 'verified'. Also
    // enforced server-side by an RLS check on jobs.INSERT so a client-only
    // bypass can't slip past this — this gate is UX so the poster sees the
    // right toast instead of a raw RLS violation.
    if (business?.business_id) {
      const { data: bizRow, error: bizErr } = await supabase
        .from("businesses")
        .select("verification_status")
        .eq("id", business.business_id)
        .single();
      if (bizErr) {
        report(bizErr, { tags: { source: "usePostJobForm.businessVerificationGate" } });
        toast.error("Couldn't check your business verification status — please try again.");
        setSaving(false);
        submittingRef.current = false;
        return null;
      }
      const bizStatus = (bizRow as { verification_status?: string })?.verification_status;
      if (bizStatus !== "verified") {
        const label =
          bizStatus === "pending" ? "still being reviewed by our team"
            : bizStatus === "rejected" ? "was rejected — see the reason on your Business page"
              : "not yet verified";
        toast.error(
          `Your business is ${label}. Businesses must be verified (insurance + license) before posting jobs.`,
        );
        setSaving(false);
        submittingRef.current = false;
        return null;
      }
    }

    // Check open job limit (server enforces too, but show friendly message)
    const { count: openCount, error: openCountErr } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", user.id).eq("status", "open");
    if (openCountErr) {
      report(openCountErr, { tags: { source: "usePostJobForm.openJobLimit" } });
      toast.error("Couldn't check your open job count — please try again.");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }
    if ((openCount ?? 0) >= 5) {
      toast.error("You can have a maximum of 5 open jobs at a time. Close or wait for existing jobs first.");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }

    return user;
  };

  const handleSubmit = async () => {
    if (!requireOnline()) return;
    const user = await runPreSubmitChecks();
    if (!user) return;

    // When the poster opted into "I'll provide materials", append the
    // note into special_requirements with a tagged prefix so helprs can
    // see it on the job card. Avoids a schema migration for what's
    // effectively a label on a freeform note.
    const composedSpecialRequirements = composeSpecialRequirements({
      includeMaterials,
      materialsNote,
      specialRequirements,
    });

    // Approval workflow — if this is a business post and the business
    // has set a `require_approval_above` threshold, route the post to
    // pending_approval instead of straight to open.
    const requiresApproval =
      !!business &&
      business.require_approval_above != null &&
      !!budget &&
      parseFloat(budget) > Number(business.require_approval_above);

    const buildPayload = (opts: { withExtras: boolean }) =>
      buildJobInsertPayload({
        userId: user.id,
        businessId: business?.business_id ?? null,
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
        specialRequirements: composedSpecialRequirements,
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
        credentialTier: opts.withExtras ? credentialTier : 0,
        department: opts.withExtras ? department : null,
        initialStatus: opts.withExtras && requiresApproval ? "pending_approval" : undefined,
        requiresW9: opts.withExtras && business ? requiresW9 : false,
      });

    let { data: jobData, error } = await supabase
      .from("jobs")
      .insert(buildPayload({ withExtras: true }))
      .select("id")
      .single();

    if (error) {
      // jobs.department / pending_approval enum value may not exist on
      // prod yet (migration unapplied). Strip the new fields and retry
      // so the post still lands.
      const code = (error as { code?: string }).code;
      const missingNew = code === "PGRST204" || code === "42703" || code === "22P02";
      if (missingNew) {
        const retry = await supabase
          .from("jobs")
          .insert(buildPayload({ withExtras: false }))
          .select("id")
          .single();
        jobData = retry.data;
        error = retry.error;
      }
    }

    if (error || !jobData) {
      toast.error(error?.message || "Couldn't post your job just yet — give it another try?");
      setSaving(false);
      submittingRef.current = false;
      return;
    }

    // Set cooldown timestamp immediately after successful insert
    safeStorage.setItem(COOLDOWN_KEY, Date.now().toString());

    // Stash the just-posted job id so the post-payment success sheet can
    // show share-this-link / view-applicants / post-another-like-this
    // CTAs without re-querying Supabase. Cheap to write, the success
    // page consumes-and-clears so it doesn't leak across sessions.
    try { safeStorage.setItem("helpr_last_posted_job_id", jobData.id); } catch { /* ignore */ }

    // First job action recorded — gates the deferred notification
    // permission prompt (`useNotificationPermissionPrompt`). Idempotent
    // and fast, safe to call on every post.
    recordJobActionForPermissionPrompt();

    // Funnel: track job posted (and first ever for activation)
    track(AhaEvent.JobPosted, {
      job_id: jobData.id,
      category,
      budget_cents: Math.round(parseFloat(budget) * 100),
      parish,
      is_urgent: isUrgent,
    });
    const { count: postedCount } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", user.id);
    if ((postedCount ?? 0) <= 1) {
      track(AhaEvent.FirstJobPosted, { job_id: jobData.id, category, parish });
    }

    await uploadAndAttachPhotos(jobData.id);
    await uploadAndAttachScopeVideo(jobData.id);

    hapticSuccess();
    void maybeFireFirstPostConfetti();
    toast.info("Redirecting to payment…");

    // Geocode the address and patch the job row with lat/lng so it shows
    // up on /browse?view=map. Kicked off here so it runs concurrently with
    // the create-payment round-trip below, then awaited before the redirect
    // (see geocodePromise await) — previously this was fire-and-forget, but
    // `window.location.href` to Stripe unloads the page and cancelled the
    // in-flight fetch, so most jobs never got coords and never hit the map.
    // The map's RPC rounds these to ~110m so the doorstep is never exposed.
    const geocodePromise = (async () => {
      const composed = composeJobAddress({
        streetAddress,
        city,
        state: addrState,
        zipCode,
      });
      const coords = await geocodeAddress(composed);
      if (coords) {
        await supabase
          .from("jobs")
          .update({ latitude: coords.latitude, longitude: coords.longitude })
          .eq("id", jobData.id);
      }
    })();

    try {
      const { data: paymentData, error: paymentError } = await supabase.functions.invoke("create-payment", {
        body: {
          action: "escrow",
          jobId: jobData.id,
          // Optional opt-in: ask Stripe to save the card for off-session
          // future-use. The edge function decides whether to honor it.
          //
          // FORCED for a recurring series. Every later visit is charged
          // off-session by charge-recurring-visits, and with no saved card
          // that cron can only decline — which means the poster books a
          // 12-week series and silently gets one visit. Saving the card is not
          // a preference here, it is what the series is made of, and the
          // checkout screen says so before they pay.
          saveCardForFuture: saveCardForFuture || isRecurring,
          // Pay It Forward redemption: when present, create-payment settles
          // the gift instead of charging the full escrow (see edge fn).
          ...(pifCreditId ? { pifCreditId } : {}),
        },
      });



      setSaving(false);

      // supabase.functions.invoke wraps errors in `data.error` sometimes
      const paymentUrl = paymentData?.url;
      const hasError = paymentError || paymentData?.error || !paymentUrl;

      if (hasError) {
        // Delete the job since payment setup failed — don't leave orphan jobs.
        const { error: cleanupError } = await supabase.from("jobs").delete().eq("id", jobData.id);
        if (cleanupError) report(cleanupError, { tags: { source: "PostJob.orphanCleanup" }, context: { job_id: jobData.id } });
        safeStorage.removeItem(COOLDOWN_KEY);
        const errorMsg = paymentData?.error || paymentError?.message || "Payment setup failed";
        hapticError();
        toast.error(`Could not start payment: ${errorMsg}. Please try again.`);
        setRedirecting(false);
        setStep("checkout");
        // Reset consent — payment failed, so the user must re-confirm
        // before retrying (avoids a stale confirmation being reused).
        setConfirmed(false);
        submittingRef.current = false;
        return;
      }

      clearDraft();
      // Notify matching helprs now that escrow is set up — done here, not
      // before create-payment, so a failed payment setup (which deletes the
      // job above) never fires ghost notifications for a job that no longer
      // exists. Awaited so it lands before the redirect unloads the page;
      // best-effort — the job is still discoverable via browse if it fails.
      try {
        await supabase.functions.invoke("instant-job-match", { body: { jobId: jobData.id } });
      } catch { /* best-effort */ }
      // Land the geocode write before the redirect unloads the page. It's
      // been running concurrently since job insert, so it's usually already
      // done; cap the wait at 2.5s so a slow/blocked Nominatim never stalls
      // checkout (the job is still usable, it just won't pin on the map).
      try {
        await Promise.race([
          geocodePromise,
          new Promise((resolve) => window.setTimeout(resolve, 2500)),
        ]);
      } catch { /* best-effort — coords are non-critical */ }
      // Show the blocking overlay before the redirect so the user can't
      // re-tap submit during the navigation delay on slow networks.
      setRedirecting(true);
      window.location.href = paymentUrl;
    } catch (err) {
      report(err, { tags: { source: "PostJob.paymentInvoke" }, context: { job_id: jobData.id } });
      // Delete the job since payment setup failed
      const { error: cleanupError } = await supabase.from("jobs").delete().eq("id", jobData.id);
      if (cleanupError) report(cleanupError, { tags: { source: "PostJob.orphanCleanup" }, context: { job_id: jobData.id } });
      safeStorage.removeItem(COOLDOWN_KEY);
      hapticError();
      toast.error("We couldn't set up payment just yet — please try again.");
      setSaving(false);
      setRedirecting(false);
      setStep("checkout");
      // Reset consent — same as the inline error path above.
      setConfirmed(false);
      submittingRef.current = false;
    }
  };

  return { handleReview, handleSubmit };
}
