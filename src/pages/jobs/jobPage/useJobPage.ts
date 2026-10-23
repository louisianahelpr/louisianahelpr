/**
 * The data behind the signed-in job page (/jobs/:id, boards 15, 42, 168, 169).
 *
 * TWO READS, IN ORDER, NO NEW DATA MODEL:
 *   1. `jobs` itself. RLS hands a member the row only when they are a party
 *      (their own post, the hired Helpr, a direct-offer target, an admin), so
 *      a row here means "you are on this job" and it carries every status:
 *      accepted, in progress, done, cancelled.
 *   2. `open_jobs_browse` otherwise: the same authority the feed and the guest
 *      preview read, so a job a Helpr can browse resolves here too. It only
 *      holds open, paid jobs, which is exactly what a non-party may see.
 * Neither read selects the street address for display: the page prints the
 * city only (no address before a hire, spec §1.6).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";

export interface JobPageRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  budget: number;
  date_needed: string | null;
  start_time: string | null;
  is_flexible_schedule: boolean | null;
  location: string | null;
  customer_id: string | null;
  helper_id: string | null;
  status: string | null;
  payment_status: string | null;
  urgent_fee: number | null;
  helpers_needed: number | null;
  is_group_job: boolean | null;
  photos: string[] | null;
  helper_fee_flat_cents: number | null;
  helper_fee_percent: number | null;
  /** The parties' lifecycle stamps, for the one tracker (jobProgress); absent on the public browse read. */
  helper_confirmed_at?: string | null;
  helper_dayof_confirmed_at?: string | null;
  poster_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  has_active_dispute?: boolean | null;
}

const BASE_COLUMNS =
  "id, title, description, category, budget, date_needed, start_time, is_flexible_schedule, location, customer_id, status, payment_status, urgent_fee, helpers_needed, is_group_job, photos, helper_fee_flat_cents";
const PARTY_COLUMNS =
  "id, title, description, category, budget, date_needed, start_time, is_flexible_schedule, location, customer_id, status, payment_status, urgent_fee, helpers_needed, is_group_job, photos, helper_fee_flat_cents, helper_id, helper_fee_percent, helper_confirmed_at, helper_dayof_confirmed_at, poster_confirmed_at, helper_on_the_way_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, poster_confirmed_working_at, helper_completed_at, poster_completed_at, has_active_dispute";

function toRow(raw: Record<string, unknown>): JobPageRow {
  return {
    helper_id: null,
    helper_fee_percent: null,
    ...(raw as Partial<JobPageRow>),
    budget: Number(raw.budget ?? 0),
    urgent_fee: raw.urgent_fee == null ? null : Number(raw.urgent_fee),
  } as JobPageRow;
}

async function fetchJobPage(id: string): Promise<{ job: JobPageRow; party: boolean } | null> {
  const own = unwrap<Record<string, unknown> | null>(
    await supabase.from("jobs").select(PARTY_COLUMNS).eq("id", id).maybeSingle(),
  );
  if (own) return { job: toRow(own), party: true };
  const browse = unwrap<Record<string, unknown> | null>(
    await supabase.from("open_jobs_browse").select(`${BASE_COLUMNS}, expires_at`).eq("id", id).maybeSingle(),
  );
  if (browse && !(typeof browse.expires_at === "string" && new Date(browse.expires_at) <= new Date())) {
    return { job: toRow(browse), party: false };
  }
  // An APPLICANT whose job left Browse (filled, closed, expired, cancelled): their own application still
  // reaches it (audit 2026-10-21 #4: a Working card opened "This job isn't available"). The definer RPC hands
  // back only jobs the caller applied to; the page shows them as no longer available, never the address.
  const mine = unwrap(await supabase.rpc("get_jobs_for_my_applications")) as Record<string, unknown>[] | null;
  const applied = (mine ?? []).find((r) => r.id === id);
  if (applied) {
    // Only the browse-safe columns: never the street address or coordinates.
    const safe = Object.fromEntries(BASE_COLUMNS.split(",").map((c) => c.trim()).filter((c) => c !== "location").map((c) => [c, applied[c]]));
    return { job: toRow({ ...safe, helper_id: applied.helper_id ?? null, helper_confirmed_at: applied.helper_confirmed_at ?? null, location: null }), party: false };
  }
  return null;
}

/** The viewer's own application on this job (Helpr side), or null. */
export interface MyApplication {
  status: string;
  closed_reason: string | null;
}
async function fetchMyApplication(jobId: string, userId: string): Promise<MyApplication | null> {
  const row = unwrap(
    await supabase.from("applications").select("status, closed_reason").eq("job_id", jobId).eq("helper_id", userId).maybeSingle(),
  ) as MyApplication | null;
  return row ?? null;
}

/** Applicants on the poster's own job: everyone who applied, and those still waiting on a decision. */
async function fetchApplicantCounts(jobId: string): Promise<{ total: number; pending: number }> {
  const rows = unwrap(await supabase.from("applications").select("status").eq("job_id", jobId)) ?? [];
  return { total: rows.length, pending: rows.filter((r) => r.status === "pending").length };
}

export function useJobPage(id: string | undefined, userId: string | undefined) {
  const job = useQuery({
    queryKey: [...queryKeys.jobs.all, "page", id ?? "", userId ?? ""],
    queryFn: () => fetchJobPage(id!),
    enabled: !!id && !!userId,
    staleTime: 30 * 1000,
  });
  const isPoster = !!job.data && !!userId && job.data.job.customer_id === userId;
  const applicants = useQuery({
    queryKey: [...queryKeys.jobs.all, "page-applicants", id ?? ""],
    queryFn: () => fetchApplicantCounts(id!),
    enabled: isPoster,
    staleTime: 30 * 1000,
  });
  const myApplication = useQuery({
    queryKey: [...queryKeys.jobs.all, "page-my-application", id ?? "", userId ?? ""],
    queryFn: () => fetchMyApplication(id!, userId!),
    enabled: !!job.data && !isPoster && !!userId,
    staleTime: 30 * 1000,
  });
  return { job, applicants, isPoster, myApplication };
}
