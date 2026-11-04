/**
 * Q2485: drive-time estimates for hired Helprs, so "Time to head out" fires at start minus travel time (the owner's
 * Q2483 rule; 30 minutes before with no estimate). helpr_travel_pairs (20261104114456) names who to measure: hired
 * Helprs with a job 35 minutes to 3 hours out, both points known, not left yet, no estimate in the last hour. Each is
 * one Apple Maps /v1/etas call (the Helpr's saved device position to the job's point, by car), with ONE access token
 * per run, at most TRAVEL_CONCURRENCY requests at once; the minutes go to helpr_travel_estimates, which
 * sweep_helpr_start_reminders reads. Never throws; a miss keeps the 30-minute rule for that job.
 *
 * Two kinds of miss (lead review 11-04): a route Apple answered without a usable drive time is an outcome (`missed`);
 * Apple NOT answering (5xx, 429, 401, a timeout: a RouteMiss) is an outage (`unavailable`). The first outage answer
 * sets the shared Apple pause (declutter_route_outage, the one delivery quotes use; helpr_travel_pairs answers no
 * pairs while it holds), stops launching more requests, and makes the run a defect (`stopped`) the cron sweep alerts on.
 */
import { type RouteMiss, ROUTE_OUTAGE_PAUSE_MINUTES, appleAccessToken, appleEtas } from "./appleRoutes.ts";
import type { AppleMapsAccess } from "./geocodeDropoff.ts";

interface TravelPair {
  job_id: string;
  user_id: string;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
}

/** The service-role calls storeTravelEstimates makes (the edge function's admin client satisfies it). */
export interface TravelStore {
  rpc(fn: "helpr_travel_pairs", args: Record<string, never>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(fn: "declutter_route_outage", args: { p_minutes: number }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: "helpr_travel_estimates"): {
    upsert(rows: Record<string, unknown>[], opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}

/** Longer than this is a stale far-away position, not a commute: not stored (the sweep ignores it too). */
export const MAX_TRAVEL_MINUTES = 120;
/** A point Apple can be asked about. appleEtas answers a bad one with a RouteMiss, which here would pause ALL Apple
 * routing for an outage that is not one (lead review 11-04): such a pair is a `missed` leg, never sent. */
const askable = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** At most this many Apple requests in flight at once (up to 50 pairs a run). */
export const TRAVEL_CONCURRENCY = 5;

export interface TravelRun {
  pairs: number;
  stored: number;
  missed: number;
  /** Pairs Apple did not answer (an outage) or that were never asked because an outage came first. */
  unavailable: number;
  /** Why the run is a defect, when it is (pairs read failed, no Apple key, an Apple outage, the store failed). */
  stopped?: string;
}

export async function storeTravelEstimates(
  admin: TravelStore,
  apple: AppleMapsAccess | null,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<TravelRun> {
  const { data, error } = await admin.rpc("helpr_travel_pairs", {});
  if (error) return { pairs: 0, stored: 0, missed: 0, unavailable: 0, stopped: `helpr_travel_pairs: ${String(error.message).slice(0, 200)}` };
  const pairs = (Array.isArray(data) ? data : []) as TravelPair[];
  if (pairs.length === 0) return { pairs: 0, stored: 0, missed: 0, unavailable: 0 };
  if (!apple) return { pairs: pairs.length, stored: 0, missed: 0, unavailable: pairs.length, stopped: "no MapKit key" };

  const outage = async (miss: RouteMiss): Promise<string> => {
    console.error(JSON.stringify({ event: "travel_etas_unavailable", status: miss.status, detail: miss.detail }));
    const { error: pauseErr } = await admin.rpc("declutter_route_outage", { p_minutes: ROUTE_OUTAGE_PAUSE_MINUTES });
    if (pauseErr) console.error(JSON.stringify({ event: "travel_outage_record_failed", detail: String(pauseErr.message).slice(0, 200) }));
    return `Apple Maps unavailable: ${miss.detail}`;
  };

  const access = await appleAccessToken(apple, fetchImpl);
  if (typeof access !== "string") {
    return { pairs: pairs.length, stored: 0, missed: 0, unavailable: pairs.length, stopped: await outage(access) };
  }

  const rows: Record<string, unknown>[] = [];
  let missed = 0;
  let firstMiss: RouteMiss | null = null;
  let next = 0;
  const worker = async () => {
    while (next < pairs.length && !firstMiss) {
      const p = pairs[next++];
      if (!askable(Number(p.from_lat), Number(p.from_lng)) || !askable(Number(p.to_lat), Number(p.to_lng))) {
        missed++;
        continue;
      }
      const answer = await appleEtas(
        { lat: Number(p.from_lat), lng: Number(p.from_lng) },
        [{ lat: Number(p.to_lat), lng: Number(p.to_lng) }],
        apple,
        fetchImpl,
        access,
      );
      if (!Array.isArray(answer)) {
        firstMiss ??= answer;
        continue;
      }
      const leg = answer[0];
      if (!leg || leg.minutes === null || leg.minutes > MAX_TRAVEL_MINUTES) {
        missed++;
        continue;
      }
      rows.push({ job_id: p.job_id, user_id: p.user_id, minutes: leg.minutes, measured_at: now().toISOString() });
    }
  };
  await Promise.all(Array.from({ length: Math.min(TRAVEL_CONCURRENCY, pairs.length) }, worker));
  const unavailable = pairs.length - rows.length - missed;
  const stopped = firstMiss ? await outage(firstMiss) : undefined;
  const run = (stored: number, why?: string): TravelRun =>
    ({ pairs: pairs.length, stored, missed, unavailable, ...(why ? { stopped: why } : {}) });
  if (rows.length === 0) return run(0, stopped);
  const { error: upErr } = await admin.from("helpr_travel_estimates").upsert(rows, { onConflict: "job_id,user_id" });
  if (upErr) return run(0, `store: ${String(upErr.message).slice(0, 200)}`);
  return run(rows.length, stopped);
}
