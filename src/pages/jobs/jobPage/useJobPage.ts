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
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { readJobsAheadOfDb } from "@/lib/jobColumns";
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
  /** The poster's scope video (A2-B6): a public job-photos URL, or null. */
  scope_video_url?: string | null;
  helper_fee_flat_cents: number | null;
  helper_fee_percent: number | null;
  poster_fee_flat_cents: number | null;
  /** The parties' lifecycle stamps, for the one tracker (jobProgress); absent on the public browse read. */
  helper_confirmed_at?: string | null;
  helper_dayof_confirmed_at?: string | null;
  poster_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  /** The job's point (party read only): the poster's on-the-way map's destination (OnTheWayNow). */
  latitude?: number | null;
  longitude?: number | null;
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  /** When the job was done (stamped by the server); the Helpr Guarantee's 48-hour window starts here. */
  completed_at?: string | null;
  has_active_dispute?: boolean | null;
  /** The photo rule and the photos taken (party read only): the hired Helpr's line and button hang on them, as on
   *  the Working card (audit 2026-10-28 F1/F26: without them every arrived job read "Take the before photo"). */
  require_photo_proof?: boolean | null;
  proof_before_urls?: string[] | null;
  proof_after_urls?: string[] | null;
  /** When a released job's pay goes out (party read only): the poster's page says so (F32). */
  payout_scheduled_at?: string | null;
  /** A Repeats job's terms and its standing Helpr (party read only), for HiredSeriesSection (A2-C42). */
  parent_job_id?: string | null;
  recurrence_days?: number[] | null;
  recurrence_weeks?: number | null;
  recurrence_interval?: string | null;
  recurrence_end_date?: string | null;
  recurring_helper_id?: string | null;
  /** A pending direct offer on this job (party read only); whether it is to the viewer is useOfferedToMe's answer. */
  direct_offer_status?: string | null;
}

const BASE_COLUMNS =
  "id, title, description, scope_video_url, category, budget, date_needed, start_time, is_flexible_schedule, location, customer_id, status, payment_status, urgent_fee, helpers_needed, is_group_job, photos, helper_fee_flat_cents, helper_fee_percent, recurrence_days, recurrence_weeks, recurrence_interval, recurrence_end_date";
const PARTY_COLUMNS =
  "id, title, description, scope_video_url, category, budget, date_needed, start_time, is_flexible_schedule, location, customer_id, status, payment_status, urgent_fee, helpers_needed, is_group_job, photos, helper_fee_flat_cents, helper_fee_percent, helper_id, poster_fee_flat_cents, helper_confirmed_at, helper_dayof_confirmed_at, poster_confirmed_at, helper_on_the_way_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, poster_confirmed_working_at, helper_completed_at, poster_completed_at, completed_at, has_active_dispute, require_photo_proof, proof_before_urls, proof_after_urls, payout_scheduled_at, parent_job_id, recurrence_days, recurrence_weeks, recurrence_interval, recurrence_end_date, recurring_helper_id, direct_offer_status, latitude, longitude";

function toRow(raw: Record<string, unknown>): JobPageRow {
  return {
    helper_id: null,
    helper_fee_percent: null,
    poster_fee_flat_cents: null,
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
    // readJobsAheadOfDb: BASE_COLUMNS names helper_fee_percent, which the view gains in 20261025235701 (Q2400).
    await readJobsAheadOfDb(`${BASE_COLUMNS}, expires_at`, (columns) => supabase.from("open_jobs_browse").select(columns).eq("id", id).maybeSingle<Record<string, unknown>>(), { browseView: true }),
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

/**
 * Whether the viewer is on this crew job's roster (group_job_helpers). A crew job has no one `helper_id` (null), so
 * "hired" cannot be read from it: a member's own job page said "This job is no longer available" and printed the
 * city only (audit 2026-10-28 A2-B8). The member's own roster row is readable to them (RLS "Admins and job
 * participants can view group helpers"), and user_may_see_job_address already gives them the street.
 */
async function fetchOnCrew(jobId: string, userId: string): Promise<boolean> {
  const row = unwrap(
    await supabase.from("group_job_helpers").select("id").eq("job_id", jobId).eq("helper_id", userId).maybeSingle(),
  ) as { id: string } | null;
  return !!row;
}

/** Applicants on the poster's own job: everyone who applied, and those still waiting on a decision. */
async function fetchApplicantCounts(jobId: string): Promise<{ total: number; pending: number }> {
  const rows = unwrap(await supabase.from("applications").select("status").eq("job_id", jobId)) ?? [];
  return { total: rows.length, pending: rows.filter((r) => r.status === "pending").length };
}

/** The job's latest tracking status (Start working lives there, not on the jobs row), or null. RLS: the parties. */
async function fetchTrackingStatus(jobId: string): Promise<string | null> {
  const row = unwrap(
    await supabase.from("job_tracking").select("status").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ) as { status: string | null } | null;
  return row?.status ?? null;
}

/**
 * JOBS-18: this direct offer is to the viewer. offered_to_helper_id is not readable by a client, and a row can reach
 * the party read for other reasons, so the viewer's own offers list answers. Asked only when an offer is pending.
 * The same row carries instant_decline_until (CMP-4): an instant booking is a direct offer with a 2-hour decline window.
 * One read, one query key, for both hooks below.
 */
function myPendingOfferQuery(jobId: string | undefined, enabled: boolean) {
  return {
    queryKey: [...queryKeys.jobs.all, "page-offered-to-me", jobId ?? ""],
    queryFn: async () => {
      const rows = unwrap<Array<{ id: string; instant_decline_until: string | null }> | null>(
        await supabase.rpc("get_my_pending_direct_offers").eq("id", jobId!).select("id, instant_decline_until"),
      );
      return (rows ?? [])[0] ?? null;
    },
    enabled: enabled && !!jobId,
    staleTime: 30 * 1000,
  };
}

export function useOfferedToMe(jobId: string | undefined, enabled: boolean): boolean {
  const q = useQuery(myPendingOfferQuery(jobId, enabled));
  return !!q.data;
}

/**
 * CMP-4: the viewer's instant booking on this job, or null. Once seen it is kept for this job while the page is open,
 * so the card's answer ("You're booked", "Booking declined") stays on screen after the offer row goes away.
 */
export function useMyInstantBooking(jobId: string | undefined, enabled: boolean): string | null {
  const q = useQuery(myPendingOfferQuery(jobId, enabled));
  const live = q.data?.instant_decline_until ?? null;
  const [seen, setSeen] = useState<{ jobId: string; until: string } | null>(null);
  useEffect(() => {
    if (live && jobId && (seen?.jobId !== jobId || seen.until !== live)) setSeen({ jobId, until: live });
  }, [live, jobId, seen]);
  return live ?? (seen && seen.jobId === jobId ? seen.until : null);
}

export function useJobPage(id: string | undefined, userId: string | undefined) {
  const job = useQuery({
    queryKey: [...queryKeys.jobs.all, "page", id ?? "", userId ?? ""],
    queryFn: () => fetchJobPage(id!),
    enabled: !!id && !!userId,
    staleTime: 30 * 1000,
    // A job under way moves while its page is open (the Helpr's photos, Tester 6 10-30); this page has no live channel.
    refetchInterval: (query) => (query.state.data?.party && ["accepted", "in_progress", "revision_requested"].includes(query.state.data.job.status ?? "") ? 30_000 : false),
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
  // The tracking row, for a job someone is hired on (the Working card's own progress input, helperProgress).
  const tracking = useQuery({
    queryKey: [...queryKeys.jobs.all, "page-tracking", id ?? ""],
    queryFn: () => fetchTrackingStatus(id!),
    enabled: !!job.data?.party && !!job.data.job.helper_id,
    staleTime: 30 * 1000,
  });
  const onCrew = useQuery({
    queryKey: [...queryKeys.jobs.all, "page-on-crew", id ?? "", userId ?? ""],
    queryFn: () => fetchOnCrew(id!, userId!),
    enabled: !!job.data && !isPoster && !!userId && job.data.job.is_group_job === true,
    staleTime: 30 * 1000,
  });
  return { job, applicants, isPoster, myApplication, tracking, onCrew: onCrew.data === true };
}
