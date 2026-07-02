import { useEffect, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lookupParishByZip } from "@/lib/parishLookup";
import { report } from "@/lib/errorLogger";
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
}

export function useJobFormEffects(params: UseJobFormEffectsParams) {
  const {
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
  } = params;

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
      // Whether this poster still owes the one-time setup fee, so the
      // checkout total matches what the edge function will actually charge.
      supabase
        .from("profiles")
        .select("onboarding_fee_paid")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => { setOnboardingFeePaid(data?.onboarding_fee_paid ?? true); });
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
    const location = `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}`;
    if (title || description || streetAddress || budget) {
      saveDraft({ title, description, category, location, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, isFlexibleSchedule, isUrgent, urgentFee, isGroupJob, helpersNeeded });
    }
  }, [title, description, category, streetAddress, city, addrState, zipCode, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, isFlexibleSchedule, isUrgent, urgentFee, isGroupJob, helpersNeeded, saveDraft]);

  useEffect(() => {
    const timer = setTimeout(autoSave, 2000);
    return () => clearTimeout(timer);
  }, [autoSave]);
}
