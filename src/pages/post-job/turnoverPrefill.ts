import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * Q768 (owner, 2026-09-27: "Import as drafts"). str-ical-sync records each
 * upcoming guest checkout in str_processed_events (job_id NULL) and sends the
 * host a notice linking to `/post-job?turnover=<event id>`. Post a Job reads
 * the event and its calendar here and pre-fills a cleaning job; the host pays
 * like any new post, and link_str_turnover_job then points the event at the
 * job so the same checkout is never offered twice.
 *
 * The sync used to INSERT an unpaid jobs row instead: invisible to every
 * Helpr and, since Q767, unfundable. src/test/noJobRowBeforePayment.test.ts.
 */

export interface TurnoverPrefill {
  title: string;
  description: string;
  budget: string;
  location: string;
  dateNeeded: string;
  /** The event already points at a FUNDED job: offer nothing to post. An
   *  unpaid or cancelled one (abandoned checkout) does not count; the next
   *  post re-points the turnover (link_str_turnover_job). */
  alreadyPosted: boolean;
}

interface TurnoverRow {
  id: string;
  checkout_date: string;
  job_id: string | null;
  /** The linked job (the host's own, so RLS lets them read it). */
  jobs?: { status: string; payment_status: string | null } | null;
  str_calendar_connections: {
    property_name: string | null;
    property_address: string | null;
    cleaning_budget: number | null;
    cleaning_notes: string | null;
  } | null;
}

/** The browse surfaces' funded set: a job Helprs can see. */
const FUNDED = new Set(["escrow", "payout_pending", "released"]);

/** public.jobs CHECKs (Q782): title <= 32 and description <= 1000 code points. */
const fit = (s: string, n: number) => Array.from(s).slice(0, n).join("").trim();

/** The cleaning job a turnover pre-fills: the same words the sync used to write. Pure. */
export function buildTurnoverPrefill(row: TurnoverRow): TurnoverPrefill {
  const conn = row.str_calendar_connections;
  const propName = conn?.property_name ?? "property";
  const notes = conn?.cleaning_notes ? conn.cleaning_notes : "Standard turnover clean — please message for door code.";
  return {
    title: fit(`STR clean ${row.checkout_date} ${propName}`, 32),
    description: fit(`Cleaning needed after guest checkout on ${row.checkout_date}. ${notes}`, 1000),
    budget: conn?.cleaning_budget != null ? String(conn.cleaning_budget) : "",
    location: conn?.property_address ?? "",
    dateNeeded: row.checkout_date,
    alreadyPosted: row.job_id != null && !!row.jobs && row.jobs.status !== "cancelled" && FUNDED.has(row.jobs.payment_status ?? ""),
  };
}

/** Read the host's own turnover (RLS: only the calendar's owner can SELECT it). Null when it is not theirs or gone. */
export async function fetchTurnoverPrefill(eventId: string): Promise<TurnoverPrefill | null> {
  const row = unwrap(
    await supabase
      .from("str_processed_events")
      .select("id, checkout_date, job_id, jobs(status, payment_status), str_calendar_connections(property_name, property_address, cleaning_budget, cleaning_notes)")
      .eq("id", eventId)
      .maybeSingle(),
  ) as TurnoverRow | null;
  return row ? buildTurnoverPrefill(row) : null;
}

/**
 * Point the turnover at the job just posted from it. Best effort: the job is
 * posted either way; a failed link only means the notice could be used again,
 * and Post a Job then shows the job is already posted once it is linked.
 */
export async function linkTurnoverJob(eventId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("link_str_turnover_job" as never, { p_event_id: eventId, p_job_id: jobId } as never);
  if (error) throw error;
  return data === true;
}
