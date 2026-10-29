export const SEED_THREAD_STATUSES: string[];
export function pickSeedThreadJob<J extends { id: string; status: string }>(pairJobs: J[], ownJobIds: Iterable<string>): J | null;
