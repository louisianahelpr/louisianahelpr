import { useQuery } from "@tanstack/react-query";
import { fetchContinueDays, type ContinueDay } from "@/lib/continueDay";

const NONE: Readonly<Record<string, ContinueDay>> = Object.freeze({});

/** The job ids of `rows` under way: only an in-progress job can continue on another day. */
export function inProgressJobIds(jobs: readonly ({ id: string; status?: string | null } | null | undefined)[]): string[] {
  return [...new Set(jobs.filter((j): j is { id: string; status?: string | null } => !!j && j.status === "in_progress").map((j) => j.id))].sort();
}

/**
 * The active continue days (owner 2026-11-01, "continue another day") of the member's jobs under way, by job id.
 * Home and the to-do list share this read (one key), so Next up, Live now, Waiting and Coming up read the same day.
 */
export function useContinueDays(jobIds: readonly string[]): Readonly<Record<string, ContinueDay>> {
  const q = useQuery({
    queryKey: ["job-continue-days", jobIds.join(",")],
    queryFn: () => fetchContinueDays(jobIds),
    enabled: jobIds.length > 0,
    staleTime: 30_000,
  });
  return q.data ?? NONE;
}
