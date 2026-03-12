import { useState, useMemo } from "react";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface UseDashboardFiltersOptions {
  allJobs: EnrichedJob[];
  userId?: string;
  profile: Profile | null;
  helprTier: string | null;
  helperAvailability: { day_of_week: number; is_available: boolean; start_time: string; end_time: string }[];
}

export function useDashboardFilters({ allJobs, userId, profile, helprTier, helperAvailability }: UseDashboardFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [maxBudget, setMaxBudget] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expiresWithin, setExpiresWithin] = useState("");
  const [matchAvailability, setMatchAvailability] = useState(false);

  const activeFilterCount = [selectedCategory, maxBudget, locationFilter, expiresWithin, matchAvailability ? "on" : ""].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0 || !!searchQuery;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
    setMatchAvailability(false);
  };

  const filteredJobs = useMemo(() => allJobs
    .filter((job) => {
      if (userId && job.customer_id === userId) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!job.title.toLowerCase().includes(q) && !job.description.toLowerCase().includes(q)) return false;
      }
      if (selectedCategory && job.category !== selectedCategory) return false;
      if (maxBudget && job.budget > parseFloat(maxBudget)) return false;
      if (locationFilter && !job.location.toLowerCase().includes(locationFilter.toLowerCase())) return false;
      if (expiresWithin && job.expires_at) {
        const hoursLeft = (new Date(job.expires_at).getTime() - Date.now()) / (1000 * 60 * 60);
        if (expiresWithin === "24h" && hoursLeft > 24) return false;
        if (expiresWithin === "3d" && hoursLeft > 72) return false;
        if (expiresWithin === "7d" && hoursLeft > 168) return false;
      }
      if (expiresWithin && !job.expires_at) return false;
      if (profile?.role === "helper") {
        const jobAge = Date.now() - new Date(job.created_at).getTime();
        const earlyMinutes = helprTier === "elite" ? 20 : helprTier === "pro" ? 10 : helprTier === "basic" ? 5 : 0;
        const delayMs = (20 - earlyMinutes) * 60 * 1000;
        if (jobAge < delayMs) return false;
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
      switch (sortBy) {
        case "highest_pay": return b.budget - a.budget;
        case "lowest_pay": return a.budget - b.budget;
        case "ending_soon": return new Date(a.date_needed).getTime() - new Date(b.date_needed).getTime();
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    }), [allJobs, userId, searchQuery, selectedCategory, maxBudget, locationFilter, expiresWithin, profile?.role, helprTier, matchAvailability, helperAvailability, sortBy]);

  const nearbyJobs = useMemo(() => {
    const userLocation = profile?.location?.toLowerCase() || "";
    return userLocation
      ? allJobs.filter((j) => j.location.toLowerCase().includes(userLocation) || userLocation.includes(j.location.toLowerCase())).slice(0, 5)
      : [];
  }, [allJobs, profile?.location]);

  return {
    searchQuery, setSearchQuery,
    selectedCategory, setSelectedCategory,
    maxBudget, setMaxBudget,
    locationFilter, setLocationFilter,
    sortBy, setSortBy,
    filtersOpen, setFiltersOpen,
    searchOpen, setSearchOpen,
    expiresWithin, setExpiresWithin,
    matchAvailability, setMatchAvailability,
    activeFilterCount, hasFilters, clearFilters,
    filteredJobs, nearbyJobs,
  };
}
