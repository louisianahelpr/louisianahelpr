/**
 * Q2485: drive-time estimates for hired Helprs, so "Time to head out" fires at start minus travel time (the owner's
 * Q2483 rule; 30 minutes before with no estimate). helpr_travel_pairs (20261104114456) names who to measure: hired
 * Helprs with a job 35 minutes to 3 hours out, both points known, not left yet, no estimate in the last hour. Each is
 * one Apple Maps /v1/etas call (the Helpr's saved device position to the job's point, by car), with ONE access token
 * per run; the minutes go to helpr_travel_estimates, which sweep_helpr_start_reminders reads. Never throws; a miss
 * keeps the 30-minute rule for that job.
 */
import { appleAccessToken, appleEtas } from "./appleRoutes.ts";
import type { AppleMapsAccess } from "./geocodeDropoff.ts";

export interface TravelPair {
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
  from(table: "helpr_travel_estimates"): {
    upsert(rows: Record<string, unknown>[], opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}

/** Longer than this is a stale far-away position, not a commute: not stored (the sweep ignores it too). */
export const MAX_TRAVEL_MINUTES = 120;

export interface TravelRun {
  pairs: number;
  stored: number;
  missed: number;
  /** Why the whole run stopped early, when it did (pairs read failed, no Apple key, token refused). */
  stopped?: string;
}

export async function storeTravelEstimates(
  admin: TravelStore,
  apple: AppleMapsAccess | null,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<TravelRun> {
  const { data, error } = await admin.rpc("helpr_travel_pairs", {});
  if (error) return { pairs: 0, stored: 0, missed: 0, stopped: `helpr_travel_pairs: ${String(error.message).slice(0, 200)}` };
  const pairs = (Array.isArray(data) ? data : []) as TravelPair[];
  if (pairs.length === 0) return { pairs: 0, stored: 0, missed: 0 };
  if (!apple) return { pairs: pairs.length, stored: 0, missed: pairs.length, stopped: "no MapKit key" };
  const access = await appleAccessToken(apple, fetchImpl);
  if (typeof access !== "string") return { pairs: pairs.length, stored: 0, missed: pairs.length, stopped: access.detail };

  const legs = await Promise.all(pairs.map((p) => appleEtas(
    { lat: Number(p.from_lat), lng: Number(p.from_lng) },
    [{ lat: Number(p.to_lat), lng: Number(p.to_lng) }],
    apple,
    fetchImpl,
    access,
  )));
  const rows: Record<string, unknown>[] = [];
  let missed = 0;
  legs.forEach((answer, i) => {
    const leg = Array.isArray(answer) ? answer[0] : null;
    if (!leg || leg.minutes === null || leg.minutes > MAX_TRAVEL_MINUTES) {
      missed++;
      return;
    }
    rows.push({ job_id: pairs[i].job_id, user_id: pairs[i].user_id, minutes: leg.minutes, measured_at: now().toISOString() });
  });
  if (rows.length === 0) return { pairs: pairs.length, stored: 0, missed };
  const { error: upErr } = await admin.from("helpr_travel_estimates").upsert(rows, { onConflict: "job_id,user_id" });
  if (upErr) return { pairs: pairs.length, stored: 0, missed: pairs.length, stopped: `store: ${String(upErr.message).slice(0, 200)}` };
  return { pairs: pairs.length, stored: rows.length, missed };
}
