import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useDraftJob } from "@/hooks/useDraftJob";
import { categoryPricing } from "@/lib/pricingGuide";
import { track, AhaEvent } from "@/lib/analytics";
import { compressImage } from "@/lib/imageCompression";
import { lookupParishByZip } from "@/lib/parishLookup";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { useHelprActivity } from "@/hooks/useHelprActivity";
import { hapticSuccess } from "@/lib/haptics";
import { geocodeAddress, composeJobAddress } from "@/lib/geocode";
import type { AiGeneratedJob } from "@/components/postjob/AiJobBuilder";
import { categories } from "@/components/postjob/DetailsSection";
import { maybeFireFirstPostConfetti } from "./firstPostConfetti";
import { buildJobInsertPayload } from "./jobSubmitHelpers";

export type Step = "form" | "checkout";

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
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  // Preflight open-job count — checked at mount so the user learns
  // about the 5-job cap before filling the entire form.
  const [openJobCount, setOpenJobCount] = useState<number | null>(null);
  const [idvDialogOpen, setIdvDialogOpen] = useState(false);
  const [idvStatus, setIdvStatus] = useState<string | undefined>(undefined);
  const [idvFailureReason, setIdvFailureReason] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<Step>("form");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
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
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState("weekly");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [isGroupJob, setIsGroupJob] = useState(false);
  const [helpersNeeded, setHelpersNeeded] = useState("2");
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentFee, setUrgentFee] = useState("5");
  const [customUrgentFee, setCustomUrgentFee] = useState(false);
  const [isFlexibleSchedule, setIsFlexibleSchedule] = useState(false);
  const [platformFee, setPlatformFee] = useState<number | null>(null);
  const [customerFee, setCustomerFee] = useState<number | null>(null);
  const salesTaxRate = 10;
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // AI Job Builder state moved into the AiJobBuilder component itself.

  // Image upload state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Direct Offer state — set when arriving via /post-job?offerTo=<helperId>
  const [offerToHelperId, setOfferToHelperId] = useState<string | null>(null);
  const [offerToHelperName, setOfferToHelperName] = useState<string>("");

  useEffect(() => {
    // Auth is already checked by ProtectedRoute — just fetch platform fee via safe RPC
    supabase.rpc("get_public_platform_settings").then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        // Use customer_fee_percent as the poster-facing fee (service fee at checkout)
        const custFee = row.customer_fee_percent ?? 10;
        setPlatformFee(custFee);
        setCustomerFee(custFee);
      }
    });
  }, []);

  // Preflight: check open-job count at mount so the user isn't surprised
  // at submit after filling the whole form.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", user.id)
        .eq("status", "open")
        .then(({ count }) => { setOpenJobCount(count ?? 0); });
    });
  }, []);

  // One-tap rebook: load from query params
  useEffect(() => {
    const rebookId = searchParams.get("rebook");
    if (rebookId) {
      supabase.from("jobs").select("*").eq("id", rebookId).single().then(({ data, error }) => {
        if (error || !data) {
          toast.error("Couldn't load the previous job for rebooking — please fill in the details manually.");
          return;
        }
        setTitle(data.title);
        setDescription(data.description);
        setCategory(data.category);
        // Parse location back into fields if possible
        const locParts = (data.location || "").split(", ");
        if (locParts.length >= 3) {
          setStreetAddress(locParts[0]);
          setCity(locParts[1]);
          const stateZip = locParts[2].split(" ");
          setAddrState(stateZip[0] || "");
          setZipCode(stateZip.slice(1).join(" ") || "");
        } else {
          setStreetAddress(data.location);
        }
        setBudget(data.budget.toString());
        setEstimatedHours(data.estimated_hours?.toString() || "");
        setSpecialRequirements(data.special_requirements || "");
        setIsRecurring(data.is_recurring || false);
        setRecurrenceInterval(data.recurrence_interval || "weekly");
        setDraftLoaded(true);
        toast.info("Job details pre-filled from previous booking!");
      });
      return;
    }

    // Show draft prompt instead of auto-loading
    if (hasDraft && !draftLoaded) {
      setShowDraftPrompt(true);
      setDraftLoaded(true);
    }
  }, [searchParams, hasDraft, draftLoaded]);

  // Smart defaults — prefill the state to LA (every Helpr job is in
  // Louisiana) and the city from the poster's saved profile location.
  // Functional setState guards (prev || ...) mean this never clobbers
  // anything the user already typed or a loaded draft/rebook value.
  useEffect(() => {
    if (!profile) return;
    if (searchParams.get("rebook")) return; // rebook fills its own location
    setAddrState((prev) => prev || "LA");
    const loc = (profile.location || "").trim();
    if (loc) setCity((prev) => prev || loc.split(",")[0].trim());
  }, [profile, searchParams]);

  // Direct Offer: ?offerTo=<helperId> pre-targets the post to a saved helpr
  useEffect(() => {
    const offerTo = searchParams.get("offerTo");
    if (!offerTo) return;
    setOfferToHelperId(offerTo);
    supabase
      .rpc("get_safe_profiles", { user_ids: [offerTo] })
      .then(({ data }) => {
        const prof: any = Array.isArray(data) ? data[0] : null;
        if (prof) setOfferToHelperName(prof.full_name || "this helpr");
      });
  }, [searchParams]);

  // Auto-lookup parish from zip (for Louisiana sales tax)
  useEffect(() => {
    const cleaned = zipCode.replace(/\D/g, "");
    if (cleaned.length !== 5) { setParish(null); return; }
    let cancelled = false;
    lookupParishByZip(cleaned).then((p) => { if (!cancelled) setParish(p); });
    return () => { cancelled = true; };
  }, [zipCode]);

  // Auto-save draft on field changes (debounced)
  const autoSave = useCallback(() => {
    const location = `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}`;
    if (title || description || streetAddress || budget) {
      saveDraft({ title, description, category, location, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, isFlexibleSchedule, isUrgent, urgentFee, isGroupJob, helpersNeeded });
    }
  }, [title, description, category, streetAddress, city, addrState, zipCode, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, isFlexibleSchedule, isUrgent, urgentFee, isGroupJob, helpersNeeded, saveDraft]);

  useEffect(() => {
    const timer = setTimeout(autoSave, 2000);
    return () => clearTimeout(timer);
  }, [autoSave]);

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

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Strict MIME allowlist — keeps the broader `image/*` check honest
    // (a maliciously crafted SVG/AVIF could still be image/*) and gives
    // a precise toast for rejected files.
    const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const safeFiles = files.filter((file) => allowedImageTypes.has(file.type));

    if (safeFiles.length !== files.length) {
      toast.error("Only JPG, PNG, WEBP, and GIF images are allowed");
    }

    if (imageFiles.length + safeFiles.length > 5) {
      toast.error("Maximum 5 images allowed");
      return;
    }
    // Compress images before storing
    const compressed = await Promise.all(safeFiles.map((f) => compressImage(f)));
    const newFiles = [...imageFiles, ...compressed].slice(0, 5);
    setImageFiles(newFiles);
    const previews = newFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(previews);
  };

  const removeImage = (index: number) => {
    const newFiles = imageFiles.filter((_, i) => i !== index);
    setImageFiles(newFiles);
    setImagePreviews(newFiles.map((f) => URL.createObjectURL(f)));
  };

  // Tracks upload progress so the submit button can show "Uploading 2/3"
  // instead of an opaque spinner. Set back to null after upload completes.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const uploadImages = async (jobId: string): Promise<string[]> => {
    const urls: string[] = [];
    const total = imageFiles.length;
    if (total === 0) return urls;
    setUploadProgress({ done: 0, total });
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const ext = file.name.split(".").pop();
      const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (error) {
        report(error, { tags: { source: "PostJob.uploadImage" } });
      } else {
        const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
      setUploadProgress({ done: i + 1, total });
    }
    setUploadProgress(null);
    return urls;
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Task title is required"); return; }
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!category) { toast.error("Category is required"); return; }
    if (!streetAddress.trim()) { toast.error("Street address is required"); return; }
    if (!city.trim()) { toast.error("City is required"); return; }
    if (!addrState.trim()) { toast.error("State is required"); return; }
    if (!zipCode.trim()) { toast.error("Zip code is required"); return; }
    if (!dateNeeded) { toast.error("Date needed is required"); return; }
    // Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(dateNeeded + "T00:00:00");
    if (selectedDate < today) { toast.error("Date cannot be in the past"); return; }
    if (!isFlexibleSchedule && !startTime) { toast.error("Start time is required (or mark the schedule as flexible)"); return; }
    if (!estimatedHours || parseFloat(estimatedHours) < 0.5) { toast.error("Minimum job duration is 30 minutes (0.5 hours)"); return; }
    // special_requirements is optional — no validation needed
    if (!budget || parseFloat(budget) < 5) { toast.error("Minimum budget is $5"); return; }
    if (parseFloat(budget) > 5000) { toast.error("Maximum budget is $5,000."); return; }
    if (isUrgent && (parseFloat(urgentFee) < 5 || isNaN(parseFloat(urgentFee)))) { toast.error("Urgent bonus must be at least $5"); return; }
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
      toast.error("You must be logged in");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }

    // Identity verification gate — required before posting. Same Stripe
    // IDV used at job-acceptance, applied here so posters can't onboard
    // strangers under a fake identity.
    {
      const { data: prof } = await supabase
        .from("profiles")
        .select("idv_status, idv_failure_reason")
        .eq("user_id", user.id)
        .single();
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

    // Check open job limit (server enforces too, but show friendly message)
    const { count: openCount } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", user.id).eq("status", "open");
    if ((openCount ?? 0) >= 5) {
      toast.error("You can have a maximum of 5 open jobs at a time. Close or wait for existing jobs first.");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }

    return user;
  };

  /**
   * Uploads the selected photos to storage and, if any landed, patches
   * the job row's `photos` column. No-op when there are no images.
   * Toggles the `uploading` flag around the work.
   */
  const uploadAndAttachPhotos = async (jobId: string) => {
    if (imageFiles.length === 0) return;
    setUploading(true);
    const photoUrls = await uploadImages(jobId);
    if (photoUrls.length > 0) {
      await supabase.from("jobs").update({ photos: photoUrls }).eq("id", jobId);
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    const user = await runPreSubmitChecks();
    if (!user) return;

    const { data: jobData, error } = await supabase
      .from("jobs")
      .insert(
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
        }),
      )
      .select("id")
      .single();

    if (error || !jobData) {
      toast.error(error?.message || "Failed to create job");
      setSaving(false);
      submittingRef.current = false;
      return;
    }

    // Set cooldown timestamp immediately after successful insert
    safeStorage.setItem(COOLDOWN_KEY, Date.now().toString());

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

    hapticSuccess();
    void maybeFireFirstPostConfetti();
    toast.info("Redirecting to payment…");

    // Geocode the address in the background and patch the job row with
    // lat/lng so it shows up on /browse?view=map. Best-effort — failure
    // doesn't block checkout. The map's RPC rounds these to ~110m
    // before serving so the doorstep is never exposed publicly.
    void (async () => {
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
        body: { action: "escrow", jobId: jobData.id },
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
        toast.error(`Could not start payment: ${errorMsg}. Please try again.`);
        setRedirecting(false);
        setStep("checkout");
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
      // Show the blocking overlay before the redirect so the user can't
      // re-tap submit during the navigation delay on slow networks.
      setRedirecting(true);
      window.location.href = paymentUrl;
    } catch (err: any) {
      report(err, { tags: { source: "PostJob.paymentInvoke" }, context: { job_id: jobData.id } });
      // Delete the job since payment setup failed
      const { error: cleanupError } = await supabase.from("jobs").delete().eq("id", jobData.id);
      if (cleanupError) report(cleanupError, { tags: { source: "PostJob.orphanCleanup" }, context: { job_id: jobData.id } });
      safeStorage.removeItem(COOLDOWN_KEY);
      toast.error("Payment setup failed. Please try again.");
      setSaving(false);
      setRedirecting(false);
      setStep("checkout");
      submittingRef.current = false;
    }
  };

  const budgetNum = parseFloat(budget) || 0;
  const urgentFeeNum = isUrgent ? (parseFloat(urgentFee) || 0) : 0;
  const customerFeeAmount = budgetNum * ((customerFee ?? 10) / 100);
  const totalCharge = budgetNum + customerFeeAmount + urgentFeeNum; // + Sales tax at checkout
  const categoryLabel = categories.find((c) => c.value === category)?.label || category;

  // Section completion for the 3-step progress bar
  const detailsComplete = !!(title.trim() && description.trim() && category);
  const logisticsComplete = !!(streetAddress.trim() && city.trim() && addrState.trim() && zipCode.trim() && dateNeeded && startTime && estimatedHours && parseFloat(estimatedHours) >= 0.5);
  const budgetComplete = !!(budget && parseFloat(budget) >= 5);

  // Smart Pricing Guidance — live budget range from real completed jobs
  // in this category (+ parish), with a graceful fallback to the static
  // categoryPricing table when the RPC is missing or data is thin.
  const { stats: priceStats, loading: priceStatsLoading } = useCategoryPriceStats(category, parish);

  // Two-sided liquidity signal — a conservative count of helprs who've
  // worked in the poster's parish, shown at checkout so they know the
  // other side of the marketplace is active before they pay. Null when
  // the parish is unknown or the count is too thin to be honest.
  const { activity: helprActivity } = useHelprActivity(parish);

  // Budget presets derived from category suggested range. Prefer the
  // live stats range when available so the quick-tap pills track the
  // real market; otherwise fall back to the static guide.
  const suggested = category && categoryPricing[category] ? categoryPricing[category] : null;
  const presetRange = priceStats ?? suggested;
  const budgetPresets = presetRange
    ? Array.from(new Set([
        presetRange.min,
        priceStats?.median ?? Math.round((presetRange.min + presetRange.max) / 2),
        presetRange.max,
      ]))
    : [25, 50, 100];

  const handlePostJobBack = () => {
    if (step === "checkout") {
      setStep("form");
      // Scroll to top so the user lands on Details (not mid-form) to edit.
      // RAF lets the form re-render before scroll fires, so the target
      // exists. Smooth scroll matches iOS Settings-app feel.
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    } else {
      navigate("/dashboard");
    }
  };

  // Restores a previously-saved draft into the form fields.
  const loadDraft = () => {
    setTitle(draft.title); setDescription(draft.description);
    setCategory(draft.category);
    const locParts = (draft.location || "").split(", ");
    if (locParts.length >= 3) {
      setStreetAddress(locParts[0]);
      setCity(locParts[1]);
      const stateZip = locParts[2].split(" ");
      setAddrState(stateZip[0] || "");
      setZipCode(stateZip.slice(1).join(" ") || "");
    } else {
      setStreetAddress(draft.location);
    }
    setDateNeeded(draft.dateNeeded); setStartTime(draft.startTime);
    setEstimatedHours(draft.estimatedHours); setBudget(draft.budget);
    setSpecialRequirements(draft.specialRequirements);
    setIsRecurring(draft.isRecurring); setRecurrenceInterval(draft.recurrenceInterval);
    setRecurrenceEndDate(draft.recurrenceEndDate);

    setShowDraftPrompt(false);
    toast.success("Draft restored!");
  };

  const dismissDraftPrompt = () => {
    clearDraft();
    setShowDraftPrompt(false);
  };

  const clearOffer = () => {
    setOfferToHelperId(null);
    setOfferToHelperName("");
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
    showDraftPrompt,
    loadDraft,
    dismissDraftPrompt,
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
    // budget fields
    budget,
    setBudget,
    isUrgent,
    setIsUrgent,
    urgentFee,
    setUrgentFee,
    customUrgentFee,
    setCustomUrgentFee,
    // images
    imageFiles,
    imagePreviews,
    handleImageSelect,
    removeImage,
    // checkout state
    confirmed,
    setConfirmed,
    // ai builder
    applyAiJob,
    // derived values
    budgetNum,
    urgentFeeNum,
    customerFee,
    customerFeeAmount,
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
