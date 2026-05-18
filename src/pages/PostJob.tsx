import { useState, useEffect, useCallback, useRef } from "react";
import PageHeader from "@/components/PageHeader";
import { IDVPromptDialog } from "@/components/IDVPromptDialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { X, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useDraftJob } from "@/hooks/useDraftJob";
import { usePageTitle } from "@/hooks/usePageTitle";
import { categoryPricing } from "@/lib/pricingGuide";
import { track, AhaEvent } from "@/lib/analytics";
import { compressImage } from "@/lib/imageCompression";
import { lookupParishByZip } from "@/lib/parishLookup";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hapticSuccess } from "@/lib/haptics";
import { geocodeAddress, composeJobAddress } from "@/lib/geocode";
import { AiJobBuilder, type AiGeneratedJob } from "@/components/postjob/AiJobBuilder";
import { CheckoutStep } from "@/components/postjob/CheckoutStep";
import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { DetailsSection, categories } from "@/components/postjob/DetailsSection";

// Fires brand-tinted confetti for the user's first 3 successful posts.
// After post #3 the novelty fades back to a quiet checkmark — counter
// kept in safeStorage (per-device, not per-account) so we don't burn
// a DB column on a vibe.
const FIRST_POST_CONFETTI_LIMIT = 3;
async function maybeFireFirstPostConfetti() {
  try {
    const key = "helpr_post_count";
    const current = parseInt(safeStorage.getItem(key) ?? "0", 10) || 0;
    if (current >= FIRST_POST_CONFETTI_LIMIT) return;
    const confetti = (await import("canvas-confetti")).default;
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.4 },
      colors: ["#5E6544", "#8C947D", "#A0613B", "#FAF8F5"],
      scalar: 0.9,
    });
    safeStorage.setItem(key, String(current + 1));
  } catch {
    /* confetti is candy — never break the flow */
  }
}

type Step = "form" | "checkout";

const PostJob = () => {
  const navigate = useNavigate();
  usePageTitle("Post a Task — Helpr");
  const { business } = useMyBusiness();
  const { profile } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const { draft, hasDraft, saveDraft, clearDraft } = useDraftJob();
  const [saving, setSaving] = useState(false);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
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
  const [salesTaxRate] = useState<number>(10);
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

  

  // One-tap rebook: load from query params
  useEffect(() => {
    const rebookId = searchParams.get("rebook");
    if (rebookId) {
      supabase.from("jobs").select("*").eq("id", rebookId).single().then(({ data }) => {
        if (data) {
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
        }
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
    if (parseFloat(budget) > 5000) { toast.error("Maximum budget is $5,000. For larger projects, split into milestones."); return; }
    if (isUrgent && (parseFloat(urgentFee) < 5 || isNaN(parseFloat(urgentFee)))) { toast.error("Urgent bonus must be at least $5"); return; }
    setConfirmed(false);
    setStep("checkout");
  };

  const submittingRef = useRef(false);
  const COOLDOWN_KEY = "helpr_last_job_submit";
  const COOLDOWN_MS = 30_000; // 30 second cooldown

  const handleSubmit = async () => {
    // Prevent double-click
    if (submittingRef.current || saving) return;

    // Cooldown check
    const lastSubmit = safeStorage.getItem(COOLDOWN_KEY);
    if (lastSubmit && Date.now() - parseInt(lastSubmit) < COOLDOWN_MS) {
      toast.error("Please wait before posting another job. You recently submitted one.");
      return;
    }

    submittingRef.current = true;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You must be logged in");
      setSaving(false);
      submittingRef.current = false;
      return;
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
        return;
      }
    }

    // Check open job limit (server enforces too, but show friendly message)
    const { count: openCount } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", user.id).eq("status", "open");
    if ((openCount ?? 0) >= 5) {
      toast.error("You can have a maximum of 5 open jobs at a time. Close or wait for existing jobs first.");
      setSaving(false);
      submittingRef.current = false;
      return;
    }

    let photoUrls: string[] = [];

    // Expire listing at the job date/time (removed when a helpr is selected or on the day of the job)
    let expiresAt: string | null = null;
    if (startTime && dateNeeded) {
      expiresAt = new Date(`${dateNeeded}T${startTime}`).toISOString();
    } else if (dateNeeded) {
      // If no start_time, expire at end of the scheduled day
      expiresAt = new Date(`${dateNeeded}T23:59:59`).toISOString();
    }

    // Lock platform fee and sales tax at creation time
    const lockedFeePercent = platformFee ?? 0;
    const lockedFeeAmount = parseFloat(budget) * (lockedFeePercent / 100);
    const lockedSalesTaxRate = salesTaxRate;
    const lockedSalesTaxAmount = parseFloat(budget) * (lockedSalesTaxRate / 100);

    const { data: jobData, error } = await supabase.from("jobs").insert({
      customer_id: user.id,
      business_id: business?.business_id ?? null,
      title: title.trim(),
      description: description.trim(),
      // category state is a plain string; the jobs column is the
      // job_category enum — cast at the boundary.
      category: category as Database["public"]["Enums"]["job_category"],
      location: `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}`,
      zip_code: zipCode.replace(/\D/g, "").slice(0, 5) || null,
      parish: parish,
      date_needed: dateNeeded,
      start_time: startTime || null,
      is_flexible_schedule: isFlexibleSchedule,
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
      budget: parseFloat(budget),
      special_requirements: specialRequirements.trim() || null,
      is_recurring: isRecurring,
      recurrence_interval: isRecurring ? recurrenceInterval : null,
      recurrence_end_date: isRecurring && recurrenceEndDate ? recurrenceEndDate : null,
      is_group_job: isGroupJob,
      helpers_needed: isGroupJob ? parseInt(helpersNeeded) || 2 : 1,
      expires_at: expiresAt,
      is_urgent: isUrgent,
      urgent_fee: isUrgent ? parseFloat(urgentFee) || 0 : 0,
      platform_fee_percent: lockedFeePercent,
      platform_fee_amount: lockedFeeAmount,
      sales_tax_rate: lockedSalesTaxRate,
      sales_tax_amount: lockedSalesTaxAmount,
      ...(offerToHelperId
        ? {
            offered_to_helper_id: offerToHelperId,
            direct_offer_status: "pending",
            direct_offer_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }
        : {}),
    }).select("id").single();

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

    if (imageFiles.length > 0) {
      setUploading(true);
      photoUrls = await uploadImages(jobData.id);
      if (photoUrls.length > 0) {
        await supabase.from("jobs").update({ photos: photoUrls }).eq("id", jobData.id);
      }
      setUploading(false);
    }

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
      window.location.href = paymentUrl;
    } catch (err: any) {
      report(err, { tags: { source: "PostJob.paymentInvoke" }, context: { job_id: jobData.id } });
      // Delete the job since payment setup failed
      const { error: cleanupError } = await supabase.from("jobs").delete().eq("id", jobData.id);
      if (cleanupError) report(cleanupError, { tags: { source: "PostJob.orphanCleanup" }, context: { job_id: jobData.id } });
      safeStorage.removeItem(COOLDOWN_KEY);
      toast.error("Payment setup failed. Please try again.");
      setSaving(false);
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

  // Budget presets derived from category suggested range
  const suggested = category && categoryPricing[category] ? categoryPricing[category] : null;
  const budgetPresets = suggested
    ? Array.from(new Set([
        suggested.min,
        Math.round((suggested.min + suggested.max) / 2),
        suggested.max,
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

  return (
    <div className="min-h-screen bg-premium-page relative" style={{ paddingBottom: "calc(11.5rem + env(safe-area-inset-bottom, 0px))" }}>
      <PageHeader
        eyebrow={step === "checkout" ? "Almost there" : "New request"}
        title={step === "checkout" ? "Order summary" : "What do you need done?"}
        meta={step === "checkout" ? "Review and pay to publish" : "The more detail, the better."}
        onBack={handlePostJobBack}
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-6">

          {/* STEP 1: FORM */}
          {step === "form" && (
            <>
              {offerToHelperId && (
                <div className="rounded-ds-md border-2 border-primary/40 bg-primary/5 p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <UserCheck className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-ds-13 font-semibold text-foreground">
                      Direct offer to {offerToHelperName || "your saved helpr"}
                    </p>
                    <p className="text-ds-11 text-muted-foreground">
                      They'll have 24 hours to accept before this task opens to all helprs.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setOfferToHelperId(null);
                      setOfferToHelperName("");
                    }}
                    className="rounded-ds-md h-8 w-8 shrink-0"
                    aria-label="Cancel direct offer"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {/* Draft Prompt — brand-aligned: liquid-glass surface, eyebrow,
                  font-display italic title, font-serif italic description. */}
              {showDraftPrompt && (
                <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                      Picking up where you left off
                    </p>
                    <p className="font-display italic font-bold mt-1" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                      You have a saved draft
                    </p>
                    <p className="font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Pick up where you stopped, or start fresh.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearDraft();
                        setShowDraftPrompt(false);
                      }}
                    >
                      Start fresh
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
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
                      }}
                    >
                      Load draft
                    </Button>
                  </div>
                </div>
              )}

              {/* AI Job Builder — secondary helper, collapsed by default. */}
              <AiJobBuilder
                locationContext={`${city}, ${addrState}`.trim().replace(/^,\s*/, "")}
                onGenerated={applyAiJob}
              />

              {/* Section progress — orients the poster on the 3-part
                  form. Each segment fills bark once its section's
                  required fields are satisfied. */}
              <div className="flex items-end gap-2">
                {[
                  { label: "Details", done: detailsComplete },
                  { label: "Logistics", done: logisticsComplete },
                  { label: "Budget", done: budgetComplete },
                ].map((s) => (
                  <div key={s.label} className="flex-1 space-y-1">
                    <div
                      className="h-1.5 rounded-full transition-colors duration-300"
                      style={{
                        background: s.done
                          ? "hsl(var(--bark))"
                          : "hsl(var(--olivewood) / 0.15)",
                      }}
                    />
                    <span
                      className="block text-[0.62rem] font-sans font-semibold uppercase tracking-wider transition-colors"
                      style={{
                        color: s.done
                          ? "hsl(var(--bark))"
                          : "hsl(var(--olivewood) / 0.5)",
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              <form onSubmit={handleReview} className="space-y-5">
                {/* SECTION 1: DETAILS */}
                <DetailsSection
                  title={title}
                  setTitle={setTitle}
                  description={description}
                  setDescription={setDescription}
                  category={category}
                  setCategory={setCategory}
                  imagePreviews={imagePreviews}
                  imageFiles={imageFiles}
                  onImageSelect={handleImageSelect}
                  onRemoveImage={removeImage}
                  detailsComplete={detailsComplete}
                />

                {/* SECTION 2: LOGISTICS */}
                <LogisticsSection
                  streetAddress={streetAddress}
                  setStreetAddress={setStreetAddress}
                  city={city}
                  setCity={setCity}
                  addrState={addrState}
                  setAddrState={setAddrState}
                  zipCode={zipCode}
                  setZipCode={setZipCode}
                  dateNeeded={dateNeeded}
                  setDateNeeded={setDateNeeded}
                  startTime={startTime}
                  setStartTime={setStartTime}
                  isFlexibleSchedule={isFlexibleSchedule}
                  setIsFlexibleSchedule={setIsFlexibleSchedule}
                  estimatedHours={estimatedHours}
                  setEstimatedHours={setEstimatedHours}
                  specialRequirements={specialRequirements}
                  setSpecialRequirements={setSpecialRequirements}
                  isRecurring={isRecurring}
                  setIsRecurring={setIsRecurring}
                  recurrenceInterval={recurrenceInterval}
                  setRecurrenceInterval={setRecurrenceInterval}
                  recurrenceEndDate={recurrenceEndDate}
                  setRecurrenceEndDate={setRecurrenceEndDate}
                  isGroupJob={isGroupJob}
                  setIsGroupJob={setIsGroupJob}
                  helpersNeeded={helpersNeeded}
                  setHelpersNeeded={setHelpersNeeded}
                  budgetNum={budgetNum}
                  logisticsComplete={logisticsComplete}
                />

                {/* SECTION 3: BUDGET */}
                <BudgetSection
                  budget={budget}
                  setBudget={setBudget}
                  suggested={suggested}
                  budgetPresets={budgetPresets}
                  isUrgent={isUrgent}
                  setIsUrgent={setIsUrgent}
                  urgentFee={urgentFee}
                  setUrgentFee={setUrgentFee}
                  customUrgentFee={customUrgentFee}
                  setCustomUrgentFee={setCustomUrgentFee}
                  budgetComplete={budgetComplete}
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
                  >
                    <span className="inline-flex items-center gap-2">
                      Review &amp; pay
                      {budgetNum > 0 && (
                        <span
                          className="font-display italic font-bold tabular-nums"
                          style={{ fontSize: "1rem", letterSpacing: "-0.01em" }}
                        >
                          · ${budgetNum.toFixed(2)}
                        </span>
                      )}
                    </span>
                  </Button>
                </div>
              </form>
            </>
          )}

          {/* STEP 2: ORDER SUMMARY / CHECKOUT */}

          {step === "checkout" && (
            <CheckoutStep
              title={title}
              description={description}
              categoryLabel={categoryLabel}
              imagePreviews={imagePreviews}
              streetAddress={streetAddress}
              city={city}
              addrState={addrState}
              zipCode={zipCode}
              dateNeeded={dateNeeded}
              startTime={startTime}
              estimatedHours={estimatedHours}
              isFlexibleSchedule={isFlexibleSchedule}
              specialRequirements={specialRequirements}
              isRecurring={isRecurring}
              recurrenceInterval={recurrenceInterval}
              recurrenceEndDate={recurrenceEndDate}
              isUrgent={isUrgent}
              urgentFeeNum={urgentFeeNum}
              budgetNum={budgetNum}
              customerFee={customerFee}
              customerFeeAmount={customerFeeAmount}
              totalCharge={totalCharge}
              confirmed={confirmed}
              setConfirmed={setConfirmed}
              saving={saving}
              uploading={uploading}
              uploadProgress={uploadProgress}
              onEdit={() => setStep("form")}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </main>
      <IDVPromptDialog
        open={idvDialogOpen}
        onOpenChange={setIdvDialogOpen}
        reason="Helpr requires a quick ID + selfie check before you can post a job. This keeps the platform safe for the helprs you'll be hiring."
        status={idvStatus as never}
        failureReason={idvFailureReason}
      />
    </div>
  );
};

export default PostJob;
