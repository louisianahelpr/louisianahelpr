import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { earlyAccessDelayMs } from "@/lib/earlyAccess";

// True total of jobs matching the current Browse filters — NOT "how many
// have loaded into memory so far."
//
// The list feed (useDashboardData) is paginated via useInfiniteQuery, so
// `filteredJobs.length` (useDashboardFilters) only counts rows the
// infinite-scroll has fetched into `allJobs` up to this point. The map
// (BrowseMap.tsx) fetches every open job in ONE unpaginated RPC and reports
// `visibleJobs.length`, which is already a true total — so the two headers
// disagreed (owner: "13 jobs" on the list vs "14 Jobs" on the map). Rather
// than change the map to a paginated-style count, this hook gives the list
// its own true total via a `count: "exact", head: true` query against the
// same `open_jobs_browse` view, reapplying the filters that translate
// cleanly to SQL.
//
// KNOWN GAP (documented, not a bug): a few of useDashboardFilters'
// predicates have no server-side equivalent here and are intentionally NOT
// reproduced —
//   - `matchAvailability` — scores against the helper's saved weekly
//     availability slots, which isn't a column on the view.
//   - the "Nearby" location-string fallback (no precise coords on the
//     masked view) — only the haversine-radius branch is server-expressible,
//     and that needs the viewer's resolved coordinates, so it's skipped here.
//   - excluding jobs the viewer already applied to / is blocked from — the
//     applied/blocked sets live in `useDashboardData`'s per-user context
//     fetch, not on this view, and re-fetching that here to build an
//     `id NOT IN (...)` clause would trade a cheap `head: true` count for a
//     second full context round-trip. The map's own count has this same
//     gap (`get_open_jobs_for_map` doesn't filter applied/blocked either),
//     so this keeps the two headers reading the same class of "true total."
// Net effect: when either gap applies, this count can run slightly HIGH
// (a small over-count), never low — it never reports fewer jobs than are
// actually visible, which was the original bug.
export interface DashboardJobsCountFilters {
  userId?: string | null;
  selectedCategory: string | null;
  searchQuery: string;
  minBudget: string;
  maxBudget: string;
  urgentOnly: boolean;
  boostedOnly: boolean;
  expiresWithin: string;
  /** Same resolver output useDashboardFilters/useDashboardData use — keeps this layer in sync with both. */
  earlyAccessTier: string | null;
}

// Escape the characters that are structurally significant inside a
// PostgREST `.or()`/`ilike` filter string (`%`, `,`, `(`, `)`) so a search
// query containing them can't break the filter syntax or widen the match.
function escapeIlike(raw: string): string {
  return raw.replace(/[%,()]/g, (ch) => `\\${ch}`);
}

export function useDashboardJobsCount(filters: DashboardJobsCountFilters) {
  const {
    userId, selectedCategory, searchQuery, minBudget, maxBudget,
    urgentOnly, boostedOnly, expiresWithin, earlyAccessTier,
  } = filters;

  return useQuery({
    queryKey: [
      "dashboardJobsCount", userId, selectedCategory, searchQuery, minBudget, maxBudget,
      urgentOnly, boostedOnly, expiresWithin, earlyAccessTier,
    ],
    queryFn: async () => {
      const now = new Date();
      const todayLocalDate = (() => {
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        return `${now.getFullYear()}-${m}-${d}`;
      })();

      let query = supabase
        .from("open_jobs_browse")
        .select("id", { count: "exact", head: true })
        .neq("payment_status", "abandoned")
        // Same past-due date_needed cull useDashboardFilters applies
        // unconditionally (no flexible/recurring exemption at this layer —
        // that exemption is applied earlier, in useDashboardData, before
        // useDashboardFilters even sees the row).
        .or(`date_needed.is.null,date_needed.gte.${todayLocalDate}`)
        // …and the EXPIRY cull the list applies too
        // (useDashboardData: `!j.expires_at || new Date(j.expires_at) > now`).
        // This filter was missing here, so the header counted expired
        // listings the feed below it had already dropped — "15 jobs" over 13
        // cards. A count that disagrees with the thing it counts is worse
        // than no count.
        .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

      // Early access applies to EVERY viewer, guests included — there is no
      // exemption any more (owner, 2026-09-01: the guest exemption was the
      // log-out bypass). Redundant with the server gate in
      // `public.early_access_cutoff()`; kept so the count matches the list it
      // counts during the db-deploy window.
      query = query.lte("created_at", new Date(Date.now() - earlyAccessDelayMs(earlyAccessTier)).toISOString());
      if (userId) query = query.neq("customer_id", userId);
      // Cast: `category` is a narrow generated enum; the filter value here
      // is free-text state from the URL/UI, not one of the literal members.
      if (selectedCategory) query = query.eq("category", selectedCategory as never);
      if (minBudget) query = query.gte("budget", parseFloat(minBudget));
      if (maxBudget) query = query.lte("budget", parseFloat(maxBudget));
      if (urgentOnly) query = query.eq("is_urgent", true);
      if (boostedOnly) query = query.gt("boost_expires_at", now.toISOString());
      if (searchQuery.trim()) {
        const q = escapeIlike(searchQuery.trim());
        query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
      }
      if (expiresWithin) {
        const hoursMap: Record<string, number> = { "24h": 24, "3d": 72, "7d": 168 };
        const hours = hoursMap[expiresWithin];
        query = query.not("expires_at", "is", null);
        if (hours) {
          const threshold = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
          query = query.lte("expires_at", threshold);
        }
      }

      // `head: true` requests return no `data` body — only `count` — so this
      // can't go through the usual `unwrap(await …)` shape (it destructures
      // `data`). Check `error` directly instead, per CLAUDE.md's rule that
      // an error must never be silently dropped.
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    // A guest (no userId) never reaches the header this feeds (Dashboard.tsx
    // is an authed-only route), but the RLS-safe view still answers fine
    // without one — no `enabled` gate needed.
    staleTime: 30 * 1000,
  });
}
