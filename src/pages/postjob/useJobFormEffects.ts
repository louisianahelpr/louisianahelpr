import { useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lookupParishByZip } from "@/lib/parishLookup";
import { report } from "@/lib/errorLogger";
import { pickRequestedProfile } from "@/lib/safeProfiles";
import { posterFeePercentForTier } from "@/lib/posterFees";
import { CUSTOMER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import { validateResult } from "@/lib/validateResult";
import { jobRowSchema } from "@/lib/schemas";
import type { JobRow } from "./postJobFormTypes";
import { parseLocationIntoFields } from "./postJobFormHelpers";

/**
 * useJobFormEffects — owns the mount/reactive side effects that populate
 * and persist the Post-a-Task form: platform-fee RPC, open-job preflight,
 * one-tap rebook prefill, LA smart defaults, direct-offer targeting, parish
 * lookup from zip, and the debounced draft autosave. Structural extraction
 * from usePostJobForm; every effect, dependency array, and Supabase call is
 * unchanged.
 */
export interface UseJobFormEffectsParams {
  searchParams: URLSearchParams;
  profile: { location?: string | null } | null | undefined;
  /** Writes whatever saveDraft has been told, synchronously. See the teardown effect. */
  flushDraft: () => void;
  saveDraft: (draft: {
    title: string;
    description: string;
    category: string;
    location: string;
    dateNeeded: string;
    startTime: string;
    estimatedHours: string;
    budget: string;
    specialRequirements: string;
    isRecurring: boolean;
    recurrenceInterval: string;
    recurrenceEndDate: string;
    isFlexibleSchedule: boolean;
    isUrgent: boolean;
    urgentFee: string;
    isGroupJob: boolean;
    helpersNeeded: string;
    credentialTier: number;
    includeMaterials: boolean;
    materialsNote: string;
    offerToHelperId: string | null;
  }) => void;
  // Setters
  setPlatformFee: (v: number | null) => void;
  setCustomerFee: (v: number | null) => void;
  setOnboardingFeeCents: (v: number) => void;
  setOpenJobCount: (v: number | null) => void;
  setOnboardingFeePaid: (v: boolean) => void;
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setCategory: (v: string) => void;
  setStreetAddress: (v: string) => void;
  setCity: React.Dispatch<React.SetStateAction<string>>;
  setAddrState: React.Dispatch<React.SetStateAction<string>>;
  setZipCode: (v: string) => void;
  setBudget: (v: string) => void;
  setEstimatedHours: (v: string) => void;
  setSpecialRequirements: (v: string) => void;
  setIsRecurring: (v: boolean) => void;
  setRecurrenceInterval: (v: string) => void;
  setParish: (v: string | null) => void;
  setOfferToHelperId: (v: string | null) => void;
  setOfferToHelperName: (v: string) => void;
  // Autosave fields
  title: string;
  description: string;
  category: string;
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  dateNeeded: string;
  startTime: string;
  estimatedHours: string;
  budget: string;
  specialRequirements: string;
  isRecurring: boolean;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  isFlexibleSchedule: boolean;
  isUrgent: boolean;
  urgentFee: string;
  isGroupJob: boolean;
  helpersNeeded: string;
  credentialTier: number;
  includeMaterials: boolean;
  materialsNote: string;
  offerToHelperId: string | null;
}

export function useJobFormEffects(params: UseJobFormEffectsParams) {
  const {
    searchParams,
    profile,
    saveDraft,
    flushDraft,
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
    offerToHelperId,
  } = params;

  // Once the poster's TIER fee has resolved it is the authority — it is the
  // number create-payment actually charges (the global customer_fee_percent
  // is that function's read-failure fallback, nothing more). Without this
  // guard the two mount fetches raced and LAST WRITER WON: the same $12 job
  // previewed $15.44 (tier 12%) on one visit and $15.20 (global 10%) on the
  // next, while Stripe always charged 12%. Caught by the 2026-08-24 two-role
  // E2E — the same order summary quoted two different totals minutes apart.
  const tierFeeLocked = useRef(false);

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
        // Use customer_fee_percent as the poster-facing fee (service fee at
        // checkout) — but ONLY as the provisional value while the tier fetch
        // is in flight. If the tier answer already landed, it wins (see
        // tierFeeLocked above).
        const custFee = row.customer_fee_percent ?? CUSTOMER_FEE_LEGACY_FALLBACK_PERCENT;
        if (!tierFeeLocked.current) {
          setPlatformFee(custFee);
          setCustomerFee(custFee);
        }
        const setupCents = (row as { onboarding_fee_cents?: number }).onboarding_fee_cents;
        if (typeof setupCents === "number") setOnboardingFeeCents(setupCents);
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
      // Whether this poster still owes the one-time setup fee, and their own
      // subscription tier — so the shown service fee (12/11/10/8) and total match
      // what the create-payment edge function will actually charge. The global
      // customer_fee_percent fetched above stays as the fallback if no row.
      supabase
        .from("profiles")
        .select("onboarding_fee_paid, subscription_tier, subscription_expires_at")
        .eq("user_id", user.id)
        .single()
        .then(({ data, error }) => {
          if (error) {
            report(error, {
              severity: "error",
              tags: { source: "usePostJobForm.posterTierFetch" },
            });
            return;
          }
          setOnboardingFeePaid(data?.onboarding_fee_paid ?? true);
          if (data) {
            const tierFee = posterFeePercentForTier(data.subscription_tier, data.subscription_expires_at);
            tierFeeLocked.current = true;
            setPlatformFee(tierFee);
            setCustomerFee(tierFee);
          }
        });
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
        const parsedLoc = parseLocationIntoFields(data.location);
        if (parsedLoc.city !== undefined) {
          setStreetAddress(parsedLoc.streetAddress);
          setCity(parsedLoc.city);
          setAddrState(parsedLoc.addrState ?? "");
          setZipCode(parsedLoc.zipCode ?? "");
        } else {
          // `location` is nullable since 20260901033011 — an anonymised job
          // (poster deleted their account) keeps its financial record but
          // loses its address. Seed the field empty rather than with the
          // string "null"; the rebooking poster fills it in as they would on
          // a fresh post. `parseLocationIntoFields` above already takes null.
          setStreetAddress(data.location ?? "");
        }
        setBudget(data.budget.toString());
        setEstimatedHours(data.estimated_hours?.toString() || "");
        setSpecialRequirements(data.special_requirements || "");
        setIsRecurring(data.is_recurring || false);
        setRecurrenceInterval(data.recurrence_interval || "weekly");
      });
      return;
    }
  }, [searchParams]);

  /*
   * `?budget=<dollars>` is DELIBERATELY NOT CONSUMED. It is not dead code we
   * forgot to wire — not wiring it is the decision.
   *
   * GiftCard's "Use This Gift" navigates to
   * `/post-job?budget=75&pif_credit=…`, where 75 is the GIFT's value. Seeding
   * the budget box with it makes the gift look like the budget: the poster
   * lands on a form that has already decided they are spending exactly $75,
   * and the checkout total then reads $0 for as long as they leave it alone.
   * That is the wrong shape of the feature. The gift is money OFF a job the
   * poster prices themselves — "deducted off the amount they choose to spend"
   * — so a $120 job funded by a $75 gift is a completely normal outcome, and
   * anchoring the field at 75 quietly argues them out of it.
   *
   * The thing the empty field actually failed to do was reassure the
   * recipient the gift survived the trip. That is answered directly instead,
   * by the gift note on the Budget step (BudgetSection's `giftAmount`) and
   * the "Gift applied −$X" line at checkout — both of which say what the gift
   * IS (a deduction) rather than implying what the budget should be.
   */

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
      .then(({ data, error }) => {
        // Not fatal — the offer still targets the right helper id — but a
        // silent drop leaves the form naming nobody while the post is
        // already pointed at someone, so the poster can't confirm who they
        // are offering to. Report it rather than swallow it.
        if (error) {
          report(error, {
            severity: "warning",
            tags: { source: "useJobFormEffects.offerToHelperName" },
            context: { helper_id: offerTo },
          });
        }
        // Re-match rather than trusting row [0]. `get_safe_profiles` matches
        // profiles.user_id OR profiles.id, and one uuid can be person A's
        // user_id and person B's id at once (live on prod: 6bdc1f67-...a6147).
        // Taking [0] blind can name the WRONG helper on a screen whose whole
        // job is confirming who this offer goes to — the post would still
        // target `offerTo` correctly, so the poster gets no chance to notice.
        const rows = (Array.isArray(data) ? data : []) as Array<
          { user_id?: string | null; profile_id?: string | null; full_name?: string | null }
        >;
        const prof = pickRequestedProfile(rows, offerTo);
        if (prof) setOfferToHelperName(prof.full_name || "this Helpr");
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
    const location = `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.replace(/\D/g, "").slice(0, 5)}`;
    if (title || description || streetAddress || budget) {
      saveDraft({ title, description, category, location, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, isFlexibleSchedule, isUrgent, urgentFee, isGroupJob, helpersNeeded, credentialTier, includeMaterials, materialsNote, offerToHelperId });
    }
  }, [title, description, category, streetAddress, city, addrState, zipCode, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, isFlexibleSchedule, isUrgent, urgentFee, isGroupJob, helpersNeeded, credentialTier, includeMaterials, materialsNote, offerToHelperId, saveDraft]);

  useEffect(() => {
    const timer = setTimeout(autoSave, 2000);
    return () => clearTimeout(timer);
  }, [autoSave]);

  // Teardown: push the pending 2s debounce through IMMEDIATELY, then write.
  //
  // useDraftJob already listens for beforeunload / visibilitychange:hidden and
  // says why: "without these, the last few seconds of typing inside the
  // debounce window are lost." But its flush can only write what `saveDraft`
  // has told it, and the debounce directly above delays that by a further 2s —
  // so for the first ~2 seconds of typing the flush ran with an empty pending
  // draft and saved nothing. The safety net had a hole exactly where the outer
  // debounce sat. Measured 2026-09-02 by typing and then hard-reloading after
  // N ms: 300ms and 1000ms lost the draft entirely, 2000ms and beyond kept it.
  //
  // autoSave() populates the pending draft synchronously; flushDraft() then
  // writes it. Both are needed here, and in that order: useDraftJob's own
  // beforeunload listener is registered BEFORE this one (the hook runs higher
  // up in usePostJobForm), so by the time it fires the pending draft is still
  // stale — this handler cannot rely on it and must do the write itself.
  useEffect(() => {
    const flushNow = () => { autoSave(); flushDraft(); };
    const onHide = () => { if (document.visibilityState === "hidden") flushNow(); };
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flushNow);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [autoSave, flushDraft]);
}
