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
 * A handful of legacy literal-array shapes (e.g. `["dashboardContext",
 * userId]`) predate this file and are still in use across the cache, so
 * the corresponding factory entries preserve those exact tuples rather
 * than re-prefixing under a shared domain string. Changing the shape
 * would invalidate every existing in-flight cache entry that uses it.
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
  /**
   * Public-facing profile lookup for /user/:userId. Distinct from
   * `profile` (the signed-in user's own row) because the data shape is
   * also different — public view aggregates reviews/jobs/applications.
   */
  userProfile: {
    all: ["user-profile"] as const,
    byId: (userId: string | undefined | null) => ["user-profile", userId] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    open: () => ["jobs", "open"] as const,
    publicDetail: (jobId: string) => ["jobs", "publicDetail", jobId] as const,
  },
  activity: {
    all: ["activity"] as const,
    byUser: (userId: string) => ["activity", userId] as const,
  },
  referral: {
    all: ["referral"] as const,
    byUser: (userId: string) => ["referral", userId] as const,
  },
  /**
   * Messages inbox. `conversations` is the whole enriched thread list the
   * Messages screen renders — cached so re-entering the tab paints the last
   * known inbox instantly instead of blanking to a skeleton on every visit.
   *
   * User-scoped, and the call site sets `meta: { persist: false }`: the rows
   * carry message previews plus short-lived signed attachment URLs, neither of
   * which should sit in IndexedDB for 24h (privacy + expired thumbs). The
   * in-memory cache is what makes the revisit instant.
   */
  messages: {
    all: ["messages"] as const,
    conversations: (userId: string | undefined | null) =>
      ["messages", "conversations", userId] as const,
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
   * payout_transfers ledger — the authoritative record of every
   * stripe.transfers.create() to a helper. User-scoped so a shared
   * device can't surface the prior helper's ledger after sign-out.
   */
  payoutTransfers: {
    all: ["payout-transfers"] as const,
    byHelper: (helperId: string | undefined | null) => ["payout-transfers", helperId] as const,
  },
  /**
   * Helper-side profile credentials (license, insurance). Keyed by
   * userId so two helpers on the same device don't share cached
   * docs/status.
   */
  credentials: {
    all: ["credentials"] as const,
    byUser: (userId: string) => ["credentials", userId] as const,
  },
  /** Customer's saved/favorited helpers for one-tap re-booking. */
  savedHelpers: {
    all: ["savedHelpers"] as const,
    byUser: (userId: string | undefined | null) => ["savedHelpers", userId] as const,
  },
  /**
   * Five-star streak count surfaced on the helper's earnings tab. The
   * value is read out-of-band by useHelperMilestones via the cache, so
   * the key shape MUST stay `[<prefix>, helperId]` for that getQueryData
   * lookup to hit.
   */
  helperStreak: {
    all: ["helper-five-star-streak"] as const,
    byHelper: (helperId: string | undefined | null) => ["helper-five-star-streak", helperId] as const,
  },
  /** Forward-looking 7-day schedule strip on the earnings tab. */
  helperSchedule: {
    all: ["helper-schedule-strip"] as const,
    forWindow: (
      helperId: string | undefined | null,
      startISO: string,
      endISO: string,
    ) => ["helper-schedule-strip", helperId, startISO, endISO] as const,
  },
  /** Projected weekly earnings (accepted/in-progress jobs in window). */
  earningsForecast: {
    all: ["earnings-forecast"] as const,
    forWindow: (
      helperId: string | undefined | null,
      startISO: string,
      endISO: string,
      feeFallbackPercent: number,
    ) => ["earnings-forecast", helperId, startISO, endISO, feeFallbackPercent] as const,
  },
  /** Public review wall rendered on /user/:userId. */
  publicReviewWall: {
    all: ["public-review-wall"] as const,
    byHelper: (helperId: string | undefined | null, limit: number) =>
      ["public-review-wall", helperId, limit] as const,
  },
  /** Landing-page payout ticker — public, no user param. */
  publicPayouts: {
    all: ["public-payouts-ticker"] as const,
    ticker: () => ["public-payouts-ticker"] as const,
  },
  /**
   * Dashboard slices. Each key intentionally keeps the legacy
   * `["dashboardContext", userId]`-style shape rather than re-prefixing
   * under a shared "dashboard" string — Dashboard.tsx's onSettled
   * predicate matches `q.queryKey?.[0]` against those literals, and the
   * cache is already populated with them.
   */
  dashboard: {
    context: (userId: string | undefined | null) => ["dashboardContext", userId] as const,
    jobs: (userId: string | undefined | null) => ["dashboardJobs", userId] as const,
    proTier: (userId: string | undefined | null) => ["proTier", userId] as const,
    savedSearches: (userId: string | undefined | null) => ["savedSearches", userId] as const,
    lastApplication: (userId: string | undefined | null) => ["lastApplication", userId] as const,
    savedJobs: (userId: string | undefined | null) => ["savedJobs", userId] as const,
    guestJobs: () => ["guestDashboardJobs"] as const,
    /** Poster names/avatars/ratings for the guest feed — a SEPARATE key so
     *  the cards can render on the job list alone and let this fill in. */
    guestJobPosters: (posterIds: string[]) =>
      ["guestDashboardJobPosters", [...posterIds].sort().join(",")] as const,
  },
  /**
   * Admin-only queries — keyed by the *admin's* user.id so two admins
   * on the same device don't share cached views, and so the persister
   * doesn't surface admin data to a non-admin who logs in afterwards.
   * These additionally opt out of disk persistence via
   * `meta: { persist: false }` at the call site for extra defense.
   *
   * `helperVerifications` and `helperVerificationActors` are keyed by
   * the AUDITED user (not the admin) because the underlying data is
   * the same regardless of which admin is looking — RLS already gates
   * SELECT, so a same-device admin handoff is the only concern, and
   * the persister's signout sweep handles that.
   */
  admin: {
    all: ["admin"] as const,
    payoutLedger: (adminId: string | undefined | null) =>
      ["admin-payout-ledger", adminId] as const,
    notificationLogs: (
      adminId: string | undefined | null,
      filters: { category: string; status: string; channel: string; page: number },
    ) => ["admin-notification-logs", adminId, filters] as const,
    notificationLogsAll: ["admin-notification-logs"] as const,
    helperVerifications: (userId: string) => ["helper-verifications", userId] as const,
    helperVerificationActors: (actorIdsKey: string) =>
      ["helper-verifications-actors", actorIdsKey] as const,
    support: (filter: string) => ["admin-support", filter] as const,
    fraudFlags: (filter: string, showResolved: boolean) =>
      ["admin-fraud-flags", filter, showResolved] as const,
  },
  /** Per-applicant helper stats computed in PostedJobsTab bulk-fetch queries. */
  helperStats: {
    neighborCount: (helperId: string, lat: number | undefined, lng: number | undefined) =>
      ["neighbor-count", helperId, lat, lng] as const,
    completedCounts: (helperIdsKey: string) =>
      ["helper-completed-counts", helperIdsKey] as const,
    repeatHirePercents: (helperIdsKey: string) =>
      ["helper-repeat-hire-percents", helperIdsKey] as const,
    onTimePercents: (helperIdsKey: string) =>
      ["helper-on-time-percents", helperIdsKey] as const,
    distancesFromJob: (jobId: string | undefined, helperIdsKey: string) =>
      ["helper-distances-from-job", jobId, helperIdsKey] as const,
    jobViewCounts: (jobIdsKey: string) =>
      ["job-view-counts", jobIdsKey] as const,
  },
} as const;
