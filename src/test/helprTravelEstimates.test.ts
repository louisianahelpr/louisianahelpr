/**
 * Q2485: hired Helprs' drive times (supabase/functions/_shared/travelEstimates.ts, run by the helpr-travel-estimates
 * cron) so "Time to head out" fires at start minus travel time. Pure apart from the fetch and admin client it is
 * handed; Apple is never reached. The SQL side (who is measured, how the sweep reads it) is
 * src/test/pglite/helprHeadOutTravel.pglite.mjs.
 *
 * @mutate supabase/functions/_shared/travelEstimates.ts |     if (!leg \|\| leg.minutes === null \|\| leg.minutes > MAX_TRAVEL_MINUTES) { |     if (!leg \|\| leg.minutes === null) {
 * @mutate supabase/functions/_shared/travelEstimates.ts |     access, |     undefined,
 * @mutate supabase/functions/_shared/travelEstimates.ts |   if (!apple) return { pairs: pairs.length, stored: 0, missed: pairs.length, stopped: "no MapKit key" }; |   if (!apple) return { pairs: pairs.length, stored: 0, missed: pairs.length };
 * @mutate supabase/functions/_shared/travelEstimates.ts |     rows.push({ job_id: pairs[i].job_id, user_id: pairs[i].user_id, minutes: leg.minutes, | rows.push({ job_id: pairs[0].job_id, user_id: pairs[i].user_id, minutes: leg.minutes,
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_TRAVEL_MINUTES, type TravelStore, storeTravelEstimates } from "../../supabase/functions/_shared/travelEstimates";

const apple = { developerToken: async () => "dev-jwt" };
const NOW = () => new Date("2026-11-05T18:00:00Z");
const pair = (n: number, from = { lat: 30.2241, lng: -92.0198 }) => ({
  job_id: `job-${n}`, user_id: `helpr-${n}`, from_lat: from.lat, from_lng: from.lng, to_lat: 30.4 + n / 100, to_lng: -91.1,
});

function store(pairs: unknown, opts: { rpcError?: string; upsertError?: string } = {}) {
  const upserts: { rows: Record<string, unknown>[]; onConflict: string }[] = [];
  const s = {
    rpc: vi.fn(async () => ({ data: opts.rpcError ? null : pairs, error: opts.rpcError ? { message: opts.rpcError } : null })),
    from: () => ({
      upsert: async (rows: Record<string, unknown>[], o: { onConflict: string }) => {
        upserts.push({ rows, onConflict: o.onConflict });
        return { error: opts.upsertError ? { message: opts.upsertError } : null };
      },
    }),
  };
  return { s: s as unknown as TravelStore, upserts, rpc: s.rpc };
}

/** Apple: each destination answers `secs(dest)` seconds of driving. */
function appleAnswering(secs: (lat: number) => number | null) {
  return vi.fn(async (u: string) => {
    if (String(u).endsWith("/v1/token")) return new Response(JSON.stringify({ accessToken: "acc" }), { status: 200 });
    const [lat, lng] = new URL(String(u)).searchParams.get("destinations")!.split(",").map(Number);
    const t = secs(lat);
    return new Response(JSON.stringify({ etas: [{ destination: { latitude: lat, longitude: lng }, distanceMeters: 50000,
      ...(t === null ? {} : { expectedTravelTimeSeconds: t }) }] }), { status: 200 });
  });
}

describe("storeTravelEstimates (Q2485)", () => {
  it("stores each hired Helpr's drive minutes for their job, with ONE access token per run", async () => {
    const { s, upserts, rpc } = store([pair(1), pair(2)]);
    const f = appleAnswering((lat) => (lat < 30.415 ? 2700 : 3330));
    expect(await storeTravelEstimates(s, apple, f as unknown as typeof fetch, NOW)).toEqual({ pairs: 2, stored: 2, missed: 0 });
    expect(rpc).toHaveBeenCalledWith("helpr_travel_pairs", {});
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith("/v1/token"))).toHaveLength(1);
    expect(upserts).toEqual([{ onConflict: "job_id,user_id", rows: [
      { job_id: "job-1", user_id: "helpr-1", minutes: 45, measured_at: "2026-11-05T18:00:00.000Z" },
      { job_id: "job-2", user_id: "helpr-2", minutes: 56, measured_at: "2026-11-05T18:00:00.000Z" },
    ] }]);
  });

  it("a route with no drive time, or longer than the cap (a stale far-away position), is not stored: that job keeps 30 minutes", async () => {
    const { s, upserts } = store([pair(1), pair(2), pair(3)]);
    const f = appleAnswering((lat) => (lat < 30.415 ? null : lat < 30.425 ? (MAX_TRAVEL_MINUTES + 1) * 60 : 600));
    expect(await storeTravelEstimates(s, apple, f as unknown as typeof fetch, NOW)).toEqual({ pairs: 3, stored: 1, missed: 2 });
    expect(upserts[0].rows.map((r) => r.job_id)).toEqual(["job-3"]);
  });

  it("a run that cannot measure anyone says why (a defect for the cron sweep); nothing to measure is a clean run", async () => {
    const none = appleAnswering(() => 60);
    expect(await storeTravelEstimates(store([]).s, apple, none as unknown as typeof fetch)).toEqual({ pairs: 0, stored: 0, missed: 0 });
    expect(none).not.toHaveBeenCalled();
    expect((await storeTravelEstimates(store(null, { rpcError: "boom" }).s, apple, none as unknown as typeof fetch)).stopped).toMatch(/helpr_travel_pairs: boom/);
    expect(await storeTravelEstimates(store([pair(1)]).s, null, none as unknown as typeof fetch)).toMatchObject({ stored: 0, stopped: "no MapKit key" });
    const tokenRefused = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await storeTravelEstimates(store([pair(1)]).s, apple, tokenRefused as unknown as typeof fetch)).toMatchObject({ stored: 0, stopped: "Apple Maps token HTTP 401" });
    expect(await storeTravelEstimates(store([pair(1)], { upsertError: "denied" }).s, apple, none as unknown as typeof fetch)).toMatchObject({ stored: 0, stopped: "store: denied" });
  });
});
