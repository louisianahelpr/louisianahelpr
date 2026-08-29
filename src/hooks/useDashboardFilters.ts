import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useSearchParamMirror } from "@/hooks/useSearchParamMirror";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { Database } from "@/integrations/supabase/types";
import { haversineMiles, parseNearbyFilter } from "@/lib/geo";
import { useUserLocation } from "@/hooks/useUserLocation";
import { sortJobsSmart, compareJobsBySortMode } from "@/lib/smartSort";
import { earlyAccessDelayMs, resolveEarlyAccessTier } from "@/lib/earlyAccess";
import type { MapJobFilterInput } from "@/components/browseMap/mapFilter";

// Persisted browse-feed sort key. Stored in localStorage so a helper's
// pick survives reloads; defaults to "smart" the very first time the
// browse feed is opened so signal-ranked jobs surface before time-only.
const BROWSE_SORT_STORAGE_KEY = "helpr_browse_sort";
const DEFAULT_BROWSE_SORT = "smart";

function readPersistedSort(): string {
  if (typeof window === "undefined") return DEFAULT_BROWSE_SORT;
  try {
    const stored = window.localStorage.getItem(BROWSE_SORT_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : DEFAULT_BROWSE_SORT;
  } catch {
    // localStorage can throw in Safari private mode / sandboxed contexts;
    // fall back to the smart default rather than crash the dashboard.
    return DEFAULT_BROWSE_SORT;
  }
}

function writePersistedSort(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BROWSE_SORT_STORAGE_KEY, value);
  } catch {
    // Same fallback — silently ignore write failures.
  }
}

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface UseDashboardFiltersOptions {
  allJobs: EnrichedJob[];
  userId?: string;
  profile: Profile | null;
  helprTier: string | null;
  helperAvailability: { day_of_week: number; is_available: boolean; start_time: string; end_time: string }[];
  // Skip the subscription-tier "early access" delay entirely. The
  // logged-out guest Browse surface is a conversion preview, not a
  // free-tier helper choosing not to subscribe — so anonymous visitors
  // see every open job immediately rather than waiting out the 20-min
  // no-tier delay that would hide the freshest (most enticing) posts.
  earlyAccessExempt?: boolean;
}

export function useDashboardFilters({ allJobs, userId, profile, helprTier, helperAvailability, earlyAccessExempt = false }: UseDashboardFiltersOptions) {
  // Browse state lives in the URL, not only in React state.
  //
  // It used to be plain `useState`, which made every history entry for the
  // browse feed IDENTICAL: filter to Yard work near you, open a job, tap back,
  // and the feed rebuilt from scratch with no category, no search, no budget —
  // the "everything is all over the place" report. A history entry has to
  // carry the view it represents, so each durable filter is mirrored into
  // `?…` and re-read when the browser pops back to that entry.
  //
  // The writes are `replace: true`: choosing a filter refines the entry you're
  // already on rather than minting a new one (otherwise Back would step
  // backwards through every chip tap before leaving the page). Sort is
  // deliberately NOT here — it is a lasting preference, persisted in
  // localStorage across sessions, not a property of one history entry.
  const [searchParams] = useSearchParams();
  const param = (key: string) => searchParams.get(key) ?? "";
  const [searchQuery, setSearchQuery] = useState(() => param("q"));
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    () => searchParams.get("cat"),
  );
  const [minBudget, setMinBudget] = useState(() => param("min"));
  const [maxBudget, setMaxBudget] = useState(() => param("max"));
  const [locationFilter, setLocationFilter] = useState(() => param("loc"));
  const [sortBy, setSortByRaw] = useState<string>(() => readPersistedSort());
  const setSortBy = useCallback((next: string) => {
    setSortByRaw(next);
    writePersistedSort(next);
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The search field starts open when the entry carries a query, so a
  // restored search is visible and editable rather than silently applied.
  const [searchOpen, setSearchOpen] = useState(() => !!param("q"));
  const [expiresWithin, setExpiresWithin] = useState(() => param("exp"));
  const [matchAvailability, setMatchAvailability] = useState(() => param("avail") === "1");
  const [boostedOnly, setBoostedOnly] = useState(() => param("boost") === "1");
  const [urgentOnly, setUrgentOnly] = useState(() => param("urgent") === "1");

  // ── URL ⇄ state ─────────────────────────────────────────────────────────
  // See useSearchParamMirror for the rationale: a history entry has to carry
  // the view it represents, or Back rebuilds the feed unfiltered.
  useSearchParamMirror(
    {
      q: searchQuery.trim(),
      cat: selectedCategory ?? "",
      min: minBudget,
      max: maxBudget,
      loc: locationFilter,
      exp: expiresWithin,
      avail: matchAvailability ? "1" : "",
      boost: boostedOnly ? "1" : "",
      urgent: urgentOnly ? "1" : "",
    },
    (read) => {
      setSearchQuery(read("q"));
      if (read("q")) setSearchOpen(true);
      setSelectedCategory(read("cat") || null);
      setMinBudget(read("min"));
      setMaxBudget(read("max"));
      setLocationFilter(read("loc"));
      setExpiresWithin(read("exp"));
      setMatchAvailability(read("avail") === "1");
      setBoostedOnly(read("boost") === "1");
      setUrgentOnly(read("urgent") === "1");
    },
    "dashboard-filters",
  );

  const nearbyMiles = parseNearbyFilter(locationFilter);
  const userLoc = useUserLocation(nearbyMiles !== null);

  // Budget is ONE filter even though it occupies two state slots: the sheet's
  // budget bands ("$50 – $150") write min AND max together, so counting them
  // separately made a single tapped chip report "2 filters active" in the
  // badge, the sheet subtitle, and the "Filtered · N active" eyebrow.
  const activeFilterCount = [selectedCategory, minBudget || maxBudget, locationFilter, expiresWithin, matchAvailability ? "on" : "", boostedOnly ? "on" : "", urgentOnly ? "on" : ""].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0 || !!searchQuery;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMinBudget("");
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
    setMatchAvailability(false);
    setBoostedOnly(false);
    setUrgentOnly(false);
  };

  // Smart-sort proximity input — reuse the helper's coords ONLY when the
  // location filter has already prompted-and-resolved them. We never
  // trigger the OS location prompt just for sort ranking; if coords
  // aren't already known the smart score falls back to recency + budget
  // + urgency, which still ranks well without the proximity bonus.
  const helperLocationForSort = useMemo(
    () => (userLoc.status === "ready" ? { lat: userLoc.lat, lng: userLoc.lng } : null),
    [userLoc],
  );

  // When sorting by Smart we pre-rank the prefiltered list with the
  // composite score so the per-pair comparator below can fall back to
  // "earlier index wins" (i.e. preserve the smart order) on ties. The
  // global priorities (urgent / boost / parish / poster-sub) still
  // override that, which keeps Smart consistent with the other modes.
  const smartIndexByJobId = useMemo(() => {
    if (sortBy !== "smart") return null;
    const ranked = sortJobsSmart(allJobs, helperLocationForSort);
    const map = new Map<string, number>();
    ranked.forEach((j, i) => map.set(j.id, i));
    return map;
  }, [sortBy, allJobs, helperLocationForSort]);

  // The tier the early-access gate runs at — resolved from the PROFILE with
  // the shared resolver (null expiry = active, the tierFeePercent
  // convention), so this client gate and the SQL cutoff in useDashboardData
  // grade the same tier. It used to read `helprTier` (the
  // check-pro-subscription edge result) here while the server layer derived
  // from the profile with the opposite null-expiry rule — two layers, two
  // answers. `helprTier` remains in use only for the Search Priority sort.
  const earlyAccessTier = resolveEarlyAccessTier(
    profile?.subscription_tier,
    profile?.subscription_expires_at,
  );

  // Local "YYYY-MM-DD" for today — used to hide past-dated jobs. Built from
  // local date parts (not toISOString, which is UTC and would flip the day
  // near midnight for US timezones).
  const todayLocalDate = useMemo(() => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }, []);

  const filteredJobs = useMemo(() => allJobs
    .filter((job) => {
      if (userId && job.customer_id === userId) return false;
      // Drop stale posts whose needed date has already passed — a job
      // wanted yesterday is noise in the browse feed. date_needed is a
      // "YYYY-MM-DD" date string, so a lexicographic compare against
      // today's local date is correct and timezone-safe. Unparseable /
      // empty values are kept (better to show than silently hide).
      if (job.date_needed && job.date_needed.slice(0, 10) < todayLocalDate) return false;
      if (boostedOnly && !job.isBoosted) return false;
      if (urgentOnly && !job.is_urgent) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!job.title.toLowerCase().includes(q) && !job.description.toLowerCase().includes(q)) return false;
      }
      if (selectedCategory && job.category !== selectedCategory) return false;
      if (minBudget && job.budget < parseFloat(minBudget)) return false;
      if (maxBudget && job.budget > parseFloat(maxBudget)) return false;
      if (nearbyMiles !== null) {
        const jLat = job.latitude;
        const jLng = job.longitude;
        if (userLoc.status === "ready" && typeof jLat === "number" && typeof jLng === "number") {
          // Precise radius filter when coords are present (e.g. map-sourced jobs).
          if (haversineMiles(userLoc.lat, userLoc.lng, jLat, jLng) > nearbyMiles) return false;
        } else {
          // The browse list is fed by open_jobs_browse, which masks precise
          // coords — so a haversine radius can never match. Honour "Nearby"
          // with a location-string match against the viewer's saved location
          // instead of silently emptying the entire feed. With no saved
          // location we can't judge proximity, so we keep the job rather than
          // hide it.
          const myLoc = profile?.location?.trim().toLowerCase();
          if (myLoc) {
            const jobLoc = (job.location ?? "").toLowerCase().trim();
            const near = jobLoc.length > 0 && (jobLoc.includes(myLoc) || myLoc.includes(jobLoc));
            if (!near) return false;
          }
        }
      }
      if (expiresWithin && job.expires_at) {
        const hoursLeft = (new Date(job.expires_at).getTime() - Date.now()) / (1000 * 60 * 60);
        if (expiresWithin === "24h" && hoursLeft > 24) return false;
        if (expiresWithin === "3d" && hoursLeft > 72) return false;
        if (expiresWithin === "7d" && hoursLeft > 168) return false;
      }
      if (expiresWithin && !job.expires_at) return false;
      // Subscription-tier "early access" perk — applies to ALL users
      // equally, regardless of role. Free/no-tier users see brand-new
      // jobs after a 20-minute delay; Basic shaves 5 min off, Pro 10,
      // Elite the full 20 (so subscribers see jobs immediately while
      // free users wait). Encourages helpers AND posters to subscribe.
      if (!earlyAccessExempt) {
        const jobAge = Date.now() - new Date(job.created_at).getTime();
        if (jobAge < earlyAccessDelayMs(earlyAccessTier)) return false;
      }
      if (matchAvailability && helperAvailability.length > 0) {
        const jobDate = new Date(job.date_needed + "T12:00:00");
        const jobDow = jobDate.getDay();
        const slot = helperAvailability.find(s => s.day_of_week === jobDow);
        if (!slot || !slot.is_available) return false;
        if (job.start_time && job.start_time !== "flexible" && slot.start_time && slot.end_time) {
          if (job.start_time < slot.start_time || job.start_time > slot.end_time) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      const aUrgent = a.is_urgent;
      const bUrgent = b.is_urgent;
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;
      // Parish-proximity priority — jobs in the user's own parish float
      // above jobs in other parishes. Same-parish helpers can drive faster
      // and the marketplace runs faster when posts find local takers.
      // Skipped if the user hasn't set a parish on their profile.
      if (profile?.parish) {
        const aParishMatch = a.parish === profile.parish;
        const bParishMatch = b.parish === profile.parish;
        if (aParishMatch && !bParishMatch) return -1;
        if (!aParishMatch && bParishMatch) return 1;
      }
      // Search Priority: subscribed helpers see jobs from subscribed posters first (Basic+)
      // This doesn't change content, just prioritization — subscribed posters' jobs float up
      if (helprTier) {
        const aPosterSub = a.posterSubscriptionTier;
        const bPosterSub = b.posterSubscriptionTier;
        if (aPosterSub && !bPosterSub) return -1;
        if (!aPosterSub && bPosterSub) return 1;
      }
      switch (sortBy) {
        case "smart": {
          // Use the pre-computed rank map so the comparator stays O(1).
          // Unknown ids (shouldn't happen because the map is built from
          // `allJobs`) fall to the end of the list rather than crashing.
          const ai = smartIndexByJobId?.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const bi = smartIndexByJobId?.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ai - bi;
        }
        default: return compareJobsBySortMode(a, b, sortBy);
      }
    }), [allJobs, userId, searchQuery, selectedCategory, minBudget, maxBudget, locationFilter, nearbyMiles, userLoc, expiresWithin, helprTier, earlyAccessTier, matchAvailability, helperAvailability, sortBy, boostedOnly, urgentOnly, earlyAccessExempt, profile?.parish, profile?.location, smartIndexByJobId, todayLocalDate]);

  // The same filter state, shaped for the Browse map. The map runs its own
  // (unpaginated) fetch against a narrow PII-safe row, so it can't reuse
  // `filteredJobs` — it re-applies the predicate to its own rows. Built here
  // so there is exactly ONE place the filter state is defined; before this
  // the map ignored filters entirely and a tapped category chip changed the
  // list while the pins stayed put.
  const mapFilter = useMemo<MapJobFilterInput>(
    () => ({
      selectedCategory,
      searchQuery,
      minBudget,
      maxBudget,
      urgentOnly,
      boostedOnly,
      expiresWithin,
      matchAvailability,
      nearbyMiles,
      userLoc: userLoc.status === "ready" ? { lat: userLoc.lat, lng: userLoc.lng } : null,
      // Mirrors the list's early-access gate. Without it the map leaked
      // exactly the brand-new jobs the subscription perk exists to hold back.
      earlyAccessDelayMs: earlyAccessExempt ? 0 : earlyAccessDelayMs(earlyAccessTier),
    }),
    [
      selectedCategory, searchQuery, minBudget, maxBudget, urgentOnly, boostedOnly,
      expiresWithin, matchAvailability, nearbyMiles, userLoc, earlyAccessExempt, earlyAccessTier,
    ],
  );

  const nearbyJobs = useMemo(() => {
    const userLocation = profile?.location?.toLowerCase() || "";
    return userLocation
      ? allJobs.filter((j) => j.location.toLowerCase().includes(userLocation) || userLocation.includes(j.location.toLowerCase())).slice(0, 5)
      : [];
  }, [allJobs, profile?.location]);

  return {
    searchQuery, setSearchQuery,
    selectedCategory, setSelectedCategory,
    minBudget, setMinBudget,
    maxBudget, setMaxBudget,
    locationFilter, setLocationFilter,
    sortBy, setSortBy,
    filtersOpen, setFiltersOpen,
    searchOpen, setSearchOpen,
    expiresWithin, setExpiresWithin,
    matchAvailability, setMatchAvailability,
    boostedOnly, setBoostedOnly,
    urgentOnly, setUrgentOnly,
    activeFilterCount, hasFilters, clearFilters,
    filteredJobs, nearbyJobs, mapFilter,
    userLoc, nearbyMiles,
  };
}
