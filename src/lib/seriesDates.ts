import { supabase } from "@/integrations/supabase/client";
import { recurringVisitDates } from "@/lib/recurringSchedule";
import { todayYmd } from "@/lib/jobDate";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/**
 * Who holds each visit date of a recurring series (20260925160645,
 * docs/OPEN.md Q407 (5)/(6)).
 *
 * The schedule comes from recurringVisitDates (the cron's own module); each
 * date after visit one is:
 *   - mine      the viewer holds it
 *   - taken     another Helpr holds it, or its visit is booked
 *   - released  nobody holds it and a Helpr gave it up (another Helpr on the
 *               series can pick it up; the poster can offer it)
 *   - open      nobody holds it and nobody gave it up (the first Helpr or an
 *               offered Helpr can pick it; the poster can offer it)
 * A date nobody holds is not charged when it arrives.
 */
type SeriesDateState = "mine" | "taken" | "released" | "open";

export interface SeriesDate {
  date: string;
  state: SeriesDateState;
  /** Who gave it up, when released. */
  releasedBy: string | null;
  /** Who holds it (poster view), when held. */
  holder: string | null;
}

export interface SeriesDatesView {
  dates: SeriesDate[];
  /** The viewer has an offer to pick dates (or is the first hired Helpr). */
  offered: boolean;
  /** Everyone with an offer (the poster sees them all; a Helpr sees their own). */
  offeredTo: string[];
}

/**
 * A relation, column or RPC the database does not have yet (the web deploy ran
 * ahead of db-deploy). The panel renders nothing rather than an error.
 */
export function isNotDeployedYet(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code);
}

/** Pure: fold the reads into per-date states. Exported for tests. */
export function foldSeriesDates(input: {
  schedule: string[];
  firstVisit: string;
  today: string;
  viewer: string | null;
  holds: Array<{ visit_date: string; helper_id: string }>;
  releases: Array<{ visit_date: string; helper_id: string }>;
  bookedDates: string[];
}): SeriesDate[] {
  const holdBy = new Map(input.holds.map((h) => [h.visit_date, h.helper_id]));
  const releaseBy = new Map(input.releases.map((r) => [r.visit_date, r.helper_id]));
  const booked = new Set(input.bookedDates);
  return input.schedule
    .filter((d) => d > input.firstVisit && d > input.today)
    .map((date) => {
      const holder = holdBy.get(date) ?? null;
      if (holder && input.viewer && holder === input.viewer) return { date, state: "mine" as const, releasedBy: null, holder };
      if (holder || booked.has(date)) return { date, state: "taken" as const, releasedBy: null, holder };
      const releasedBy = releaseBy.get(date) ?? null;
      return { date, state: releasedBy ? ("released" as const) : ("open" as const), releasedBy, holder: null };
    });
}

/**
 * Read the series' dates for the viewer. `null` = not deployed yet (render
 * nothing). Any other failure throws (the query shows its error state).
 */
export async function fetchSeriesDates(args: {
  jobId: string;
  dateNeeded: string;
  recurrenceDays: number[];
  recurrenceWeeks: number;
  viewer: string | null;
  firstHelpr: string | null;
}): Promise<SeriesDatesView | null> {
  const [holds, releases, offers, visits] = await Promise.all([
    supabase.from("series_visit_holds").select("visit_date, helper_id").eq("parent_job_id", args.jobId),
    supabase.from("recurring_visit_releases").select("visit_date, helper_id").eq("parent_job_id", args.jobId),
    supabase.from("series_date_offers").select("helper_id").eq("parent_job_id", args.jobId),
    supabase.from("jobs").select("date_needed, status, helper_id").eq("parent_job_id", args.jobId),
  ]);
  for (const r of [holds, releases, offers]) {
    if (r.error) {
      if (isNotDeployedYet(r.error)) return null;
      throw r.error;
    }
  }
  // Visits the viewer cannot read are simply not listed (RLS); a failure here
  // only loses the "booked" marker on dates nobody holds, so it is not fatal.
  const bookedDates = (visits.error ? [] : (visits.data ?? []))
    .filter((v) => v.status !== "cancelled" && !(v.status === "open" && v.helper_id === null))
    .map((v) => v.date_needed as string);
  const offeredTo = (offers.data ?? []).map((o) => o.helper_id as string);
  const dates = foldSeriesDates({
    schedule: recurringVisitDates(args.dateNeeded, args.recurrenceDays, args.recurrenceWeeks),
    firstVisit: args.dateNeeded,
    today: todayYmd(),
    viewer: args.viewer,
    holds: (holds.data ?? []) as Array<{ visit_date: string; helper_id: string }>,
    releases: (releases.data ?? []) as Array<{ visit_date: string; helper_id: string }>,
    bookedDates,
  });
  const offered = !!args.viewer && (offeredTo.includes(args.viewer) || args.firstHelpr === args.viewer);
  return { dates, offered, offeredTo };
}

function seriesRpcError(error: { code?: string | null; message?: string | null }, copy: string | null): Error {
  if (isNotDeployedYet(error)) {
    return new Error("This is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.");
  }
  return new Error(copy ?? error.message ?? "Something went wrong. Please try again.");
}

/** `alreadyYours`: dates the caller already held (a double tap; review LOW-6). */
export interface ClaimResult { claimed: string[]; taken: string[]; refused: string[]; alreadyYours: string[] }

/** Pick visit dates (the first Helpr, an offered Helpr, or a pick-up). */
export async function claimSeriesDates(jobId: string, dates: string[]): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("claim_series_dates", { p_job_id: jobId, p_dates: dates });
  if (error) throw seriesRpcError(error, rpcErrorMessage("claim_series_dates", error));
  const r = (data ?? {}) as { claimed?: string[]; taken?: string[]; refused?: string[]; already_yours?: string[] };
  return { claimed: r.claimed ?? [], taken: r.taken ?? [], refused: r.refused ?? [], alreadyYours: r.already_yours ?? [] };
}

/** Hand dates back to the series. `strike` = one started within 24 hours. */
export async function giveUpSeriesDates(jobId: string, dates: string[]): Promise<{ released: string[]; strike: boolean }> {
  const { data, error } = await supabase.rpc("give_up_series_dates", { p_job_id: jobId, p_dates: dates });
  if (error) throw seriesRpcError(error, rpcErrorMessage("give_up_series_dates", error));
  const r = (data ?? {}) as { released?: string[]; strike?: boolean };
  return { released: r.released ?? [], strike: r.strike === true };
}

/** The poster offers the open dates to someone who applied. */
export async function offerSeriesDates(jobId: string, helperId: string): Promise<{ openDates: number }> {
  const { data, error } = await supabase.rpc("offer_series_dates", { p_job_id: jobId, p_helper_id: helperId });
  if (error) throw seriesRpcError(error, rpcErrorMessage("offer_series_dates", error));
  return { openDates: Number((data as { open_dates?: number } | null)?.open_dates ?? 0) };
}
