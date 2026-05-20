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
    /**
     * User-scoped — the persisted React Query cache (24h IDB) would
     * otherwise rehydrate the prior user's Stripe connect status on a
     * shared device. Same goes for `methods` below.
     */
    status: (userId: string | undefined | null) => ["payout-setup", "status", userId] as const,
    methods: (userId: string | undefined | null) => ["payout-setup", "methods", userId] as const,
  },
  /**
   * Helper job history — every key under this domain is user-scoped.
   * The IDB persister keeps successful queries for 24h, so a literal
   * `["job-history"]` would survive sign-out and rehydrate into the
   * next user's session on a shared device. See removePersistedClient
   * (queryPersister.ts) for the belt-and-suspenders cleanup on signout.
   */
  jobHistory: {
    all: ["job-history"] as const,
    byUser: (userId: string | undefined | null) => ["job-history", userId] as const,
  },
  /**
   * Stripe payouts — auth-sensitive. Must include the helper's user.id
   * so a shared-device sign-out can't leak the prior user's payouts.
   */
  stripePayouts: {
    all: ["stripe-payouts"] as const,
    byUser: (userId: string | undefined | null) => ["stripe-payouts", userId] as const,
  },
  /**
   * Admin-only queries — keyed by the *admin's* user.id so two admins
   * on the same device don't share cached views, and so the persister
   * doesn't surface admin data to a non-admin who logs in afterwards.
   * These additionally opt out of disk persistence via
   * `meta: { persist: false }` at the call site for extra defense.
   */
  admin: {
    all: ["admin"] as const,
    payoutLedger: (adminId: string | undefined | null) =>
      ["admin-payout-ledger", adminId] as const,
    notificationLogs: (
      adminId: string | undefined | null,
      filters: { category: string; status: string; channel: string; page: number },
    ) => ["admin-notification-logs", adminId, filters] as const,
  },
} as const;
