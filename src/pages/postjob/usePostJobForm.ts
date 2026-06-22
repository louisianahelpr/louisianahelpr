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
import { requireOnline } from "@/lib/requireOnline";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { assertWritable } from "@/hooks/useImpersonation";
import { useCategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { useHelprActivity } from "@/hooks/useHelprActivity";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { geocodeAddress, composeJobAddress } from "@/lib/geocode";
import type { AiGeneratedJob } from "@/components/postjob/AiJobBuilder";
import { categories } from "@/components/postjob/DetailsSection";
import type { SampleJob } from "@/data/sampleJobs";
import { maybeFireFirstPostConfetti } from "./firstPostConfetti";
import { recordJobActionForPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import { buildJobInsertPayload } from "./jobSubmitHelpers";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { validateResult } from "@/lib/validateResult";
import { jobRowSchema } from "@/lib/schemas";
import type { Database } from "@/integrations/supabase/types";
import type { PricingMode } from "@/components/postjob/BudgetSection";
import { getSmartPrice } from "@/lib/pricingGuide";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];

export type Step = "entry" | "form" | "checkout";

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
  const [isInstantBook, setIsInstantBook] = useState(false);
  // Credential tier requirement for the job:
  // 0 = open (anyone), 1 = ID-verified, 2 = licensed, 3 = licensed + insured.
  // Only relevant for trade categories; other categories always use 0.
  const [credentialTier, setCredentialTierRaw] = useState(0);
  const setCredentialTier = (tier: number) => {
    setCredentialTierRaw(tier);
    // High-credential jobs (licensed / licensed+insured) default to accept_bids
    // so the poster sees competitive quotes rather than guessing a rate.
    if (tier >= 2) {
      setPricingModeState("accept_bids");
    }
  };
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
  // Pricing mode — 'set_price' (default), 'accept_bids', 'smart_price'.
  // Default to 'accept_bids' for credentialTier >= 2 (licensed/insured jobs).
  const [pricingMode, setPricingModeState] = useState<PricingMode>("set_price");
  // Accept-bids sub-fields
  const [bidCeiling, setBidCeiling] = useState("");
  const [bidDeadline, setBidDeadline] = useState("");
  const [bidsSealed, setBidsSealed] = useState(false);
  const [platformFee, setPlatformFee] = useState<number | null>(null);
  const [customerFee, setCustomerFee] = useState<number | null>(null);
  // Helper-side commission (deducted from the helpr's payout). Surfaced
  // in the budget-step "We keep X% — helpr sees $Y net" preview chip.
  const [helperFee, setHelperFee] = useState<number | null>(null);
  const salesTaxRate = 10;

  // Wraps the raw state setter to handle smart-price auto-fill and the
  // accept_bids → set_price default-tier logic.
  const setPricingMode = (next: PricingMode) => {
    setPricingModeState(next);
    if (next === "smart_price") {
      const sp = getSmartPrice(category);
      if (sp != null) setBudget(sp.toFixed(2));
    }
  };
  // True once the user has restored the saved draft via loadDraft. The inline
  // "Pick up draft" pill hides after this so an accidental re-tap can't replace
  // the in-progress form with the (autosave-refreshed) snapshot.
  const [draftConsumed, setDraftConsumed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // AI Job Builder state moved into the AiJobBuilder component itself.

  // Image upload state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Scope video — optional 30s clip attached to the job.
  // Stored as a blob URL locally for preview; uploaded to storage on submit.
  const [scopeVideoFile, setScopeVideoFile] = useState<File | null>(null);
  const [scopeVideoPreviewUrl, setScopeVideoPreviewUrl] = useState<string | null>(null);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) return;
    const url = URL.createObjectURL(file);
    setScopeVideoFile(file);
    setScopeVideoPreviewUrl(url);
  };

  const clearVideo = () => {
    setScopeVideoFile(null);
    setScopeVideoPreviewUrl(null);
  };
  // Per-image progress 0..1 keyed by current index in `imageFiles`.
  // Combined view of compression progress (selection time) and upload
  // progress (submit time) — only one phase runs at any given moment.
  const [uploadProgressByIndex, setUploadProgressByIndex] = useState<Record<number, number>>({});

  // Optional "Materials I'll provide" note for material-heavy categories.
  // Stored locally and appended into special_requirements at submit so
  // helprs see it on the job card without a schema migration.
  const [includeMaterials, setIncludeMaterials] = useState(false);
  const [materialsNote, setMaterialsNote] = useState("");

  // Stripe Checkout supports saving a card for future-use via the
  // `setup_future_usage` session option. The toggle is sticky via
  // localStorage so a returning poster who opted in once doesn't have to
  // re-tap it every time. Default off — explicit opt-in only.
  // Job Protection add-on — $3 flat fee that funds Helpr's happiness
  // guarantee. Stored in jobs.protection_opted_in / protection_fee.
  const [protectionOptedIn, setProtectionOptedIn] = useState(false);

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

  useEffect(() => {
    // Auth is already checked by ProtectedRoute — just fetch platform fee via safe RPC.
    // Surface failures explicitly so a grant regression on this RPC (which
    // bricked the dashboard in PR #355) doesn't silently default the poster's
    // service-fee display to 10% with zero observability.
    supabase.rpc("get_public_platform_settings").then(({ data, error }) => {
      if (error) {
        report(error, {
          severity: "error",
          tags: { source: "usePostJobForm.platformFeeFetch" },
        });
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        // Use customer_fee_percent as the poster-facing fee (service fee at checkout)
        const custFee = row.customer_fee_percent ?? 10;
        setPlatformFee(custFee);
        setCustomerFee(custFee);
        const helperPct = (row as { helper_fee_percent?: number }).helper_fee_percent ?? 12;
        setHelperFee(helperPct);
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
      supabase.from("jobs").select("*").eq("id", rebookId).single().then(({ data: raw, error }) => {
        if (error || !raw) {
          toast.error("Couldn't load the previous job for rebooking — please fill in the details manually.");
          return;
        }
        // Runtime Zod check at this Supabase boundary — see validateResult.ts.
        // Logs schema drift to Sentry but still renders so the rebook flow
        // isn't blocked by an additive backend column change. The schema
        // is intentionally partial (.passthrough()) — we re-cast to the
        // full Supabase Row type so downstream setters keep their types.
        validateResult(jobRowSchema, raw, "usePostJobForm.rebookJobLoad");
        const data = raw as JobRow;
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
        toast.info("Details pre-filled — just pick a new date to re-post.");
      });
      return;
    }
  }, [searchParams]);

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
        const prof = Array.isArray(data) ? data[0] : null;
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
    // Compress images before storing. The compressImage pipeline re-
    // encodes through a canvas, which also strips EXIF metadata (GPS,
    // device model, timestamps) — see src/lib/imageCompression.ts.
    // We feed per-image compression progress into the same map the
    // thumbnail progress bar reads from during upload, so the user gets
    // a visible "working on it" signal during the canvas re-encode too.
    const baseIndex = imageFiles.length;
    setUploadProgressByIndex((prev) => {
      const next = { ...prev };
      safeFiles.forEach((_, i) => { next[baseIndex + i] = 0; });
      return next;
    });
    const compressed = await Promise.all(
      safeFiles.map((f, i) =>
        compressImage(f, 1920, 0.8, (p) => {
          setUploadProgressByIndex((prev) => ({ ...prev, [baseIndex + i]: p }));
        }),
      ),
    );
    // Clear the synthetic compression progress entries once compression
    // is done. They get refilled at upload time with real progress.
    setUploadProgressByIndex((prev) => {
      const next = { ...prev };
      safeFiles.forEach((_, i) => { delete next[baseIndex + i]; });
      return next;
    });
    const newFiles = [...imageFiles, ...compressed].slice(0, 5);
    setImageFiles(newFiles);
    const previews = newFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(previews);

    // Trust signal — confirm to the poster that location/device metadata
    // was scrubbed. The canvas re-encode in compressImage drops EXIF
    // regardless of whether the file was compressed (small JPEGs still
    // go through the same path). Only fires when at least one photo was
    // accepted, so a rejected-only batch doesn't show a misleading
    // confirmation. HEIC files are passed through compressImage as-is
    // (most browsers can't canvas-decode HEIC) — those bypass EXIF
    // stripping, so suppress the confirmation when only HEIC landed.
    const heicCount = safeFiles.filter(
      (f) => f.type === "image/heic" || f.type === "image/heif",
    ).length;
    const exifStripped = safeFiles.length - heicCount;
    if (exifStripped > 0) {
      toast.success(
        exifStripped === 1
          ? "Photo added — location data removed"
          : `${exifStripped} photos added — location data removed`,
        {
          description: "Helprs can't see where the photo was taken from.",
        },
      );
    }
  };

  const removeImage = (index: number) => {
    const newFiles = imageFiles.filter((_, i) => i !== index);
    setImageFiles(newFiles);
    setImagePreviews(newFiles.map((f) => URL.createObjectURL(f)));
    setUploadProgressByIndex({});
  };

  /**
   * Reorder photos locally (pre-submit only). `nextOrder` is the new
   * sequence of old indices — e.g. moving photo 2 to position 0 yields
   * `[2, 0, 1]`. Persisted into Supabase Storage in that order at submit.
   */
  const reorderImages = (nextOrder: number[]) => {
    if (nextOrder.length !== imageFiles.length) return;
    const reordered = nextOrder.map((i) => imageFiles[i]);
    setImageFiles(reordered);
    setImagePreviews(reordered.map((f) => URL.createObjectURL(f)));
    // Reset the progress map — the index→progress mapping is now stale.
    setUploadProgressByIndex({});
  };

  // Tracks upload progress so the submit button can show "Uploading 2/3"
  // instead of an opaque spinner. Set back to null after upload completes.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const uploadImages = async (jobId: string): Promise<string[]> => {
    const urls: string[] = [];
    const total = imageFiles.length;
    if (total === 0) return urls;
    setUploadProgress({ done: 0, total });
    // Seed each photo's progress to 0 so the bars render immediately at
    // the start of upload, instead of jumping from absent → 100%.
    setUploadProgressByIndex(() => {
      const next: Record<number, number> = {};
      for (let i = 0; i < total; i++) next[i] = 0;
      return next;
    });
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const ext = file.name.split(".").pop();
      const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      // Supabase storage.upload doesn't expose a fetch-level progress
      // callback, so we report a coarse 0 → 1 transition per file. It's
      // enough for the per-image bar to visibly advance and the user to
      // see which image is currently in flight.
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (error) {
        report(error, { tags: { source: "PostJob.uploadImage" } });
      } else {
        const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
      setUploadProgress({ done: i + 1, total });
      setUploadProgressByIndex((prev) => ({ ...prev, [i]: 1 }));
    }
    setUploadProgress(null);
    return urls;
  };

  /**
   * Scroll the first invalid field into view so the user can see it even
   * on a small screen (SE: 375×667, ~550px usable). Uses the element's
   * native `id` attribute — every form field already has one. Focuses
   * after scrolling when the element is focusable (inputs / textareas);
   * non-focusable targets (divs used as scroll anchors) get scroll-only.
   * `block: "center"` keeps the label visible above the field.
   */
  const scrollToField = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof (el as HTMLInputElement).focus === "function" && el.tagName !== "DIV") {
      setTimeout(() => (el as HTMLInputElement).focus(), 350);
    }
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Task title is required"); scrollToField("title"); return; }
    if (!description.trim()) { toast.error("Description is required"); scrollToField("description"); return; }
    if (hasUnfilledPlaceholders(description)) { toast.error("Replace the [bracketed] placeholders with your own details before posting"); scrollToField("description"); return; }
    if (!category) { toast.error("Category is required"); scrollToField("category-picker"); return; }
    // Photo is optional — a photo dramatically improves applicant count and
    // quote accuracy, so it's strongly nudged in the UI, but tasks like
    // dog-walking or errands have no natural photo and shouldn't be blocked.
    if (!streetAddress.trim()) { toast.error("Street address is required"); scrollToField("streetAddress"); return; }
    if (!city.trim()) { toast.error("City is required"); scrollToField("city"); return; }
    if (!addrState.trim()) { toast.error("State is required"); scrollToField("state"); return; }
    if (!zipCode.trim()) { toast.error("Zip code is required"); scrollToField("zipCode"); return; }
    if (!dateNeeded) { toast.error("Date needed is required"); scrollToField("date"); return; }
    // Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(dateNeeded + "T00:00:00");
    if (selectedDate < today) { toast.error("Date cannot be in the past"); scrollToField("date"); return; }
    if (!isFlexibleSchedule && !startTime) { toast.error("Start time is required (or mark the schedule as flexible)"); scrollToField("flexible"); return; }
    if (!estimatedHours || parseFloat(estimatedHours) < 0.5) { toast.error("Minimum job duration is 30 minutes (0.5 hours)"); scrollToField("hours"); return; }
    // special_requirements is optional — no validation needed
    // In accept_bids mode, budget is optional — helpers set their own price.
    if (pricingMode !== "accept_bids") {
      if (!budget || parseFloat(budget) < 5) { toast.error("Minimum budget is $5"); scrollToField("budget"); return; }
      if (parseFloat(budget) > 5000) { toast.error("Maximum budget is $5,000."); scrollToField("budget"); return; }
    }
    if (isUrgent && (parseFloat(urgentFee) < 5 || isNaN(parseFloat(urgentFee)))) { toast.error("Urgent bonus must be at least $5"); scrollToField("custom-urgent-fee"); return; }
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
      toast.error("You must be logged in");
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

  /**
   * Uploads the selected photos to storage and, if any landed, patches
   * the job row's `photos` column. No-op when there are no images.
   * Toggles the `uploading` flag around the work.
   * Also uploads the scope video if one was selected.
   */
  const uploadAndAttachPhotos = async (jobId: string) => {
    const hasPhotos = imageFiles.length > 0;
    const hasVideo = !!scopeVideoFile;
    if (!hasPhotos && !hasVideo) return;
    setUploading(true);
    const photoUrls = hasPhotos ? await uploadImages(jobId) : [];
    if (photoUrls.length > 0) {
      await supabase.from("jobs").update({ photos: photoUrls }).eq("id", jobId);
    }
    // Upload scope video — PGRST204/42703 safe (column may not exist on prod yet)
    if (hasVideo && scopeVideoFile) {
      try {
        const ext = scopeVideoFile.name.split(".").pop() || "mp4";
        const path = `${jobId}/scope-video.${ext}`;
        const { error: vidErr } = await supabase.storage
          .from("job-photos")
          .upload(path, scopeVideoFile, { upsert: true });
        if (!vidErr) {
          const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
          await supabase
            .from("jobs")
            .update({ scope_video_url: urlData.publicUrl })
            .eq("id", jobId);
        } else {
          report(vidErr, { tags: { source: "PostJob.uploadScopeVideo" } });
        }
      } catch (e) {
        report(e as Error, { tags: { source: "PostJob.uploadScopeVideo" } });
      }
    }
    setUploading(false);
  };

  /**
   * Uploads the scope video (if selected) to the job-photos bucket and
   * patches the job row's scope_video_url column. No-op if no video.
   * PGRST202-safe: if the column doesn't exist yet the update silently fails.
   */
  const uploadAndAttachScopeVideo = async (jobId: string) => {
    if (!scopeVideoFile) return;
    const ext = scopeVideoFile.name.split(".").pop() ?? "mp4";
    const path = `${jobId}/scope-video.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("job-photos")
      .upload(path, scopeVideoFile, { upsert: true });
    if (upErr) return; // non-fatal — video is a nice-to-have
    const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
    if (!data?.publicUrl) return;
    // Non-fatal — the column may not exist on prod yet; ignore any error.
    await supabase
      .from("jobs")
      .update({ scope_video_url: data.publicUrl })
      .eq("id", jobId);
  };

  const handleSubmit = async () => {
    if (!requireOnline()) return;
    const user = await runPreSubmitChecks();
    if (!user) return;

    // When the poster opted into "I'll provide materials", append the
    // note into special_requirements with a tagged prefix so helprs can
    // see it on the job card. Avoids a schema migration for what's
    // effectively a label on a freeform note.
    const composedSpecialRequirements = (() => {
      if (!includeMaterials || !materialsNote.trim()) return specialRequirements;
      const prefix = `Materials I'll provide: ${materialsNote.trim()}`;
      return specialRequirements.trim() ? `${prefix}\n\n${specialRequirements.trim()}` : prefix;
    })();

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
        isInstantBook: opts.withExtras ? isInstantBook : false,
        credentialTier: opts.withExtras ? credentialTier : 0,
        department: opts.withExtras ? department : null,
        initialStatus: opts.withExtras && requiresApproval ? "pending_approval" : undefined,
        requiresW9: opts.withExtras && business ? requiresW9 : false,
        pricingMode: opts.withExtras ? pricingMode : "set_price",
        bidCeiling: opts.withExtras ? (bidCeiling ? parseFloat(bidCeiling) : null) : null,
        bidDeadline: opts.withExtras ? (bidDeadline ? bidDeadline : null) : null,
        bidsSealed: opts.withExtras ? bidsSealed : false,
      });

    // Merge Job Protection opt-in into the payload when enabled.
    // protection_opted_in / protection_fee ship in migration 20260612120000;
    // a pre-push prod (missing the columns) still gets the fallback retry via
    // the PGRST204/42703 error path below.
    const protectionExtras: Partial<JobInsert> = protectionOptedIn
      ? { protection_opted_in: true, protection_fee: 3.0 }
      : {};

    let { data: jobData, error } = await supabase
      .from("jobs")
      .insert({ ...buildPayload({ withExtras: true }), ...protectionExtras })
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
          saveCardForFuture,
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

  const budgetNum = parseFloat(budget) || 0;
  const urgentFeeNum = isUrgent ? (parseFloat(urgentFee) || 0) : 0;
  const customerFeeAmount = budgetNum * ((customerFee ?? 10) / 100);
  const protectionFeeNum = protectionOptedIn ? 3.0 : 0;
  const totalCharge = budgetNum + customerFeeAmount + urgentFeeNum + protectionFeeNum; // + Sales tax at checkout
  const categoryLabel = categories.find((c) => c.value === category)?.label || category;

  // Section completion for the 3-step progress bar. Photos are optional
  // (strongly nudged, never required), so the Details chapter is "done"
  // once title, description, and category are set.
  const detailsComplete = !!(title.trim() && description.trim() && category && !hasUnfilledPlaceholders(description));
  const logisticsComplete = !!(streetAddress.trim() && city.trim() && addrState.trim() && zipCode.trim() && dateNeeded && startTime && estimatedHours && parseFloat(estimatedHours) >= 0.5);
  // In accept_bids mode the budget is optional — helpers set their own price.
  const budgetComplete =
    pricingMode === "accept_bids"
      ? true
      : !!(budget && parseFloat(budget) >= 5);

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

    setDraftConsumed(true);
    toast.success("Draft restored!");
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
    hasDraft,
    draftConsumed,
    loadDraft,
    /** Most recent autosave timestamp (epoch ms). 0 when no autosave has
        landed yet — `DraftSavedIndicator` hides itself in that case. */
    draftSavedAt: draft.savedAt,
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
    /** When true the job is flagged instant-book: a helper who applies is
        auto-confirmed without poster review, reusing the direct-offer accept
        path (helper_confirmed_at set immediately). */
    isInstantBook,
    setIsInstantBook,
    /** Credential tier required to apply (0–3). Only set for trade categories;
        others always use 0. */
    credentialTier,
    setCredentialTier,
    // Pricing mode fields
    pricingMode,
    setPricingMode,
    bidCeiling,
    setBidCeiling,
    bidDeadline,
    setBidDeadline,
    bidsSealed,
    setBidsSealed,
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
    // job protection opt-in (checkout)
    protectionOptedIn,
    setProtectionOptedIn,
    protectionFeeNum,
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
    totalCharge,
    helperFee,
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
