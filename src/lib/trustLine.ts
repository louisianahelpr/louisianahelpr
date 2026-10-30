import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";

/**
 * The one-line trust record on a Helpr's profile and applicant cards (Q2478, owner decisions 2a and 2b,
 * 2026-10-29 via lead): "12 jobs done · 92% on time · 3 repeat customers", "New" under 3 jobs, and
 * "Usually replies in …" from get_reply_speed's rounded bucket. The four profile tiles stay exactly as
 * they are; this is a line under them, not a fifth tile.
 *
 * Every number is the server's, already floored there: get_public_profile_stats publishes on_time_rate
 * only from 5 timed jobs and repeat_hire_percent only from 3 distinct clients; get_reply_speed publishes a
 * bucket only from 5 poster-opened threads. A missing number is left out, never shown as 0.
 */
const NEW_UNDER_JOBS = 3;

export type ReplyBucket = "under_1h" | "few_hours" | "within_day";

export const REPLY_BUCKET_COPY: Record<ReplyBucket, string> = {
  under_1h: "Usually replies in under an hour",
  few_hours: "Usually replies in a few hours",
  within_day: "Usually replies within a day",
};

export function asReplyBucket(v: unknown): ReplyBucket | null {
  return v === "under_1h" || v === "few_hours" || v === "within_day" ? v : null;
}

export interface TrustInputs {
  /** Jobs completed as the Helpr (get_public_profile_stats.completed_jobs_as_helper). */
  completedJobs: number | null | undefined;
  /** On-time arrival %, NULL below the server's floor. */
  onTimeRate: number | null | undefined;
  /** Share of distinct clients who came back, NULL below 3 clients. */
  repeatHirePercent: number | null | undefined;
  /** Distinct clients behind repeatHirePercent. */
  repeatClientSample: number | null | undefined;
}

/** Returning clients, recovered from the server's whole-number percent and its sample (exact below 100 clients). */
export function repeatCustomers(percent: number | null | undefined, sample: number | null | undefined): number {
  if (percent == null || sample == null || sample < 3) return 0;
  return Math.max(0, Math.round((percent * sample) / 100));
}

/** The trust line's parts, in order. "New" alone under 3 jobs done. */
export function trustLineParts(s: TrustInputs): string[] {
  const done = Math.max(0, Math.floor(s.completedJobs ?? 0));
  if (done < NEW_UNDER_JOBS) return ["New"];
  const parts = [`${done} jobs done`];
  if (s.onTimeRate != null && Number.isFinite(s.onTimeRate)) parts.push(`${Math.round(s.onTimeRate)}% on time`);
  const back = repeatCustomers(s.repeatHirePercent, s.repeatClientSample);
  if (back > 0) parts.push(`${back} repeat customer${back === 1 ? "" : "s"}`);
  return parts;
}

/**
 * Reply-speed buckets for a set of members, keyed by user id. A member with no bucket (under the floor,
 * slower than a day, or hidden) is simply absent. Before the migration reaches prod the RPC answers
 * PGRST202: the map is empty and the line shows no reply speed.
 */
export function useReplySpeed(userIds: string[]): Map<string, ReplyBucket> {
  const ids = [...new Set(userIds.filter(Boolean))].sort();
  const { data } = useQuery({
    queryKey: ["reply-speed", ids],
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const res = await supabase.rpc("get_reply_speed", { p_user_ids: ids });
      if (res.error && isMissingRpcNamed(res.error, "get_reply_speed")) return [];
      return (unwrap(res) ?? []) as Array<{ user_id: string; reply_bucket: string | null }>;
    },
  });
  const out = new Map<string, ReplyBucket>();
  for (const r of data ?? []) {
    const b = asReplyBucket(r.reply_bucket);
    if (b) out.set(r.user_id, b);
  }
  return out;
}

export interface MemberTrust {
  stats: TrustInputs;
  reply: ReplyBucket | null;
}

/**
 * The trust line's inputs for several members at once (applicant cards): get_public_profile_stats (the same
 * public, floored aggregates the profile reads) plus get_reply_speed. A member the server does not return
 * (hidden, banned) has no entry, so no line is drawn for them.
 */
export function useMemberTrust(userIds: string[]): Map<string, MemberTrust> {
  const ids = [...new Set(userIds.filter(Boolean))].sort();
  const replies = useReplySpeed(ids);
  const { data } = useQuery({
    queryKey: ["member-trust-stats", ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (unwrap(await supabase.rpc("get_public_profile_stats", { p_user_ids: ids })) ?? []) as Array<{
        user_id: string;
        completed_jobs_as_helper: number | null;
        on_time_rate: number | null;
        repeat_hire_percent: number | null;
        repeat_client_sample: number | null;
      }>,
  });
  const out = new Map<string, MemberTrust>();
  for (const r of data ?? []) {
    out.set(r.user_id, {
      stats: {
        completedJobs: r.completed_jobs_as_helper,
        onTimeRate: r.on_time_rate,
        repeatHirePercent: r.repeat_hire_percent,
        repeatClientSample: r.repeat_client_sample,
      },
      reply: replies.get(r.user_id) ?? null,
    });
  }
  return out;
}
