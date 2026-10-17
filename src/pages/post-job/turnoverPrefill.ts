import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatJobDate, parseLocalDate } from "@/lib/dateUtils";
import { TITLE_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";

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

/**
 * The turnover's title, built to fit instead of cut (Q1787): "Turnover clean ·
 * Oct 20", plus " · <property>" only when the WHOLE name fits under the cap.
 * Prod e80a4ca9d (2026-10-13) showed "STR clean 2026-10-20 SEED Bywate": an
 * ISO date and a name cut mid-word at 32. A later word-boundary cut still left
 * half a property name ("... SEED"). The date reads the way the app shows
 * dates: month and day, never YYYY-MM-DD. Pure.
 */
export function turnoverTitle(checkoutDate: string, propertyName: string | null | undefined): string {
  const day = parseLocalDate(checkoutDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const base = `Turnover clean · ${day}`;
  const name = (propertyName ?? "").trim().replace(/\s+/g, " ");
  const withName = name ? `${base} · ${name}` : base;
  // TITLE_MAX: Post a Job's title cap, the public.jobs CHECK (Q782).
  return Array.from(withName).length <= TITLE_MAX ? withName : base;
}

/** The cleaning job a turnover pre-fills. Pure. */
export function buildTurnoverPrefill(row: TurnoverRow): TurnoverPrefill {
  const conn = row.str_calendar_connections;
  const notes = conn?.cleaning_notes ? conn.cleaning_notes : "Standard turnover clean — please message for door code.";
  return {
    title: turnoverTitle(row.checkout_date, conn?.property_name),
    // formatJobDate: "Tue, Oct 20", the one job-date format.
    description: fit(`Cleaning needed after guest checkout on ${formatJobDate(row.checkout_date)}. ${notes}`, 1000),
    budget: conn?.cleaning_budget != null ? String(conn.cleaning_budget) : "",
    location: conn?.property_address ?? "",
    dateNeeded: row.checkout_date,
    alreadyPosted: isTurnoverPosted(row),
  };
}

/** The one "already posted" rule: the event points at a FUNDED, live job. Post a
 *  Job and the Ready-to-post list on /str-settings (Q1521) both read it. */
function isTurnoverPosted(row: Pick<TurnoverRow, "job_id" | "jobs">): boolean {
  return row.job_id != null && !!row.jobs && row.jobs.status !== "cancelled" && FUNDED.has(row.jobs.payment_status ?? "");
}

interface ReadyTurnover {
  id: string;
  checkoutDate: string;
  propertyName: string;
}

/**
 * Q1521: the host's imported checkouts still waiting to be posted (today or
 * later in Louisiana, not yet linked to a funded job), soonest first. The
 * notice is the only other way in, and a deleted notice used to lose the
 * checkout for good. RLS: only the calendar's owner reads its events.
 */
export async function fetchReadyTurnovers(todayYmd: string): Promise<ReadyTurnover[]> {
  const rows = (unwrap(
    await supabase
      .from("str_processed_events")
      // Inactive calendars are left out in the query (inner join), and there is
      // no row cap: a cap before the client-side "already posted" filter could
      // drop a pending checkout behind posted ones (Sentry review of Q1521).
      // RLS and the date already bound it to this host's upcoming checkouts.
      .select("id, checkout_date, job_id, jobs(status, payment_status), str_calendar_connections!inner(property_name, is_active)")
      .eq("str_calendar_connections.is_active", true)
      .gte("checkout_date", todayYmd)
      .order("checkout_date", { ascending: true }),
  ) ?? []) as Array<
    Pick<TurnoverRow, "id" | "checkout_date" | "job_id" | "jobs"> & {
      str_calendar_connections: { property_name: string | null; is_active: boolean | null } | null;
    }
  >;
  return rows
    .filter((r) => r.str_calendar_connections?.is_active !== false && !isTurnoverPosted(r))
    .map((r) => ({
      id: r.id,
      checkoutDate: r.checkout_date,
      propertyName: r.str_calendar_connections?.property_name || "Unnamed property",
    }));
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
  const { data, error } = await supabase.rpc("link_str_turnover_job", { p_event_id: eventId, p_job_id: jobId });
  if (error) throw error;
  return data === true;
}
