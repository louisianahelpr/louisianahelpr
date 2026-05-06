/**
 * Centralized React Query keys.
 * Keep keys here so prefetchers and consumer hooks always agree on cache slots.
 */
export const queryKeys = {
  referral: (userId: string) => ["referral", userId] as const,
  activity: (userId: string) => ["activity", userId] as const,
  jobsOpen: () => ["jobs", "open"] as const,
  profile: (userId: string) => ["profile", userId] as const,
};
