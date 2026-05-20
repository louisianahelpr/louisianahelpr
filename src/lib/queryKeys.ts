/**
 * Centralized React Query key factory.
 *
 * Convention: ['domain', 'entity', ...params]
 *
 * - Every key under a domain shares the same string prefix, so a single
 *   `invalidateQueries({ queryKey: queryKeys.<domain>.all })` invalidates
 *   every related query in one call (React Query uses prefix matching).
 * - All factory functions return `as const` tuples so TypeScript can prove
 *   key shapes are stable across prefetcher / consumer / invalidator sites.
 *   Drift between a prefetcher's key and a consumer hook's key means the
 *   consumer always misses the cache — co-locating keys here removes that
 *   class of bug.
 * - Per-user keys take an explicit `userId` so one user's cache stays out
 *   of another user's on account switch.
 *
 * When adding a key: prefer extending an existing domain over inventing a
 * new top-level entry. Domains map to product areas, not data tables.
 *
 * TODO(follow-up): sweep the remaining call sites that still use literal
 * arrays — admin pages (`helper-verifications`, `admin-payout-ledger`,
 * `admin-notification-logs`), dashboard sub-queries (`dashboardContext`,
 * `dashboardJobs`, `proTier`, `savedSearches`, `lastApplication`,
 * `savedJobs`), profile sub-tabs (`credentials`, `stripe-payouts`,
 * `payout-transfers`), `savedHelpers`, `job-history`, `user-profile`, and
 * `guestDashboardJobs`. This PR intentionally migrates only the
 * highest-traffic sites to establish the pattern.
 */
export const queryKeys = {
  currentUser: {
    /** Domain-wide prefix — invalidates every currentUser-keyed query. */
    all: ["currentUser"] as const,
    byId: (userId: string | undefined | null) => ["currentUser", userId] as const,
  },
  profile: {
    all: ["profile"] as const,
    byId: (userId: string) => ["profile", userId] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    open: () => ["jobs", "open"] as const,
  },
  activity: {
    all: ["activity"] as const,
    byUser: (userId: string) => ["activity", userId] as const,
  },
  referral: {
    all: ["referral"] as const,
    byUser: (userId: string) => ["referral", userId] as const,
  },
  business: {
    /** Catch-all prefix — matches every business-domain key. */
    all: ["business"] as const,
    /**
     * Prefix for myBusiness lookups across users. Invalidating this matches
     * every `mine(userId)` key by React Query's prefix rule.
     */
    allMine: ["myBusiness"] as const,
    /** The current user's primary business membership row. */
    mine: (userId: string | undefined | null) => ["myBusiness", userId] as const,
    /** Member roster for a single business. */
    members: (businessId: string | undefined | null) => ["businessMembers", businessId] as const,
  },
  payoutSetup: {
    all: ["payout-setup"] as const,
    status: () => ["payout-setup", "status"] as const,
    methods: () => ["payout-setup", "methods"] as const,
  },
} as const;
