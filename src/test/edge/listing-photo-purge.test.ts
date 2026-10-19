/**
 * The `listing-photo-purge` cron (Q2211, lead review round 3 #1 + #2): deletes due listing photos THROUGH THE
 * STORAGE API, then tells the database; a Storage refusal leaves the entries queued and fails the run (non-2xx).
 * The queue rules (30 days after a take-down, a lift drops its entries) are proven in
 * src/test/pglite/homesListingPhotos.pglite.mjs. Runs the REAL function source via the edge harness.
 *
 * @mutate supabase/functions/listing-photo-purge/index.ts |         const { error: rmError } = await admin.storage.from(bucket).remove(batch); |         const rmError = null as { message: string } \| null;
 * @mutate supabase/functions/listing-photo-purge/index.ts |     if (error) return cronError(FN, `queue read failed: ${error.message}`, corsHeaders); |     if (false) return cronError(FN, "", corsHeaders);
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  return loadEdgeFunction("listing-photo-purge");
}
const run = (fn: EdgeHarness, auth = "Bearer service-key") => fn.fetch(fn.request({ headers: { Authorization: auth } }));

describe("listing-photo-purge", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
  });

  it("refuses a caller without the cron secret", async () => {
    const fn = await load();
    expect((await run(fn, "Bearer nope")).status).toBe(401);
    expect(scenario.rpcCalls ?? []).toHaveLength(0);
  });

  it("removes due objects through Storage, then marks them done, per bucket", async () => {
    scenario.rpc.rentals_photo_purge_due = [
      { bucket_id: "listing-photos", storage_path: "u/rental-listings/l/a.jpg" },
      { bucket_id: "job-photos", storage_path: "u/rental-listings/l/old.jpg" },
    ];
    scenario.rpc.rentals_photo_purge_done = 1;
    const fn = await load();
    const res = await run(fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, due: 2, removed: 2 });
    // Through the Storage API (never SQL), one call per bucket batch.
    expect(scenario.storage.removeCalls).toEqual([["u/rental-listings/l/a.jpg"], ["u/rental-listings/l/old.jpg"]]);
    const done = (scenario.rpcCalls ?? []).filter((c) => c.name === "rentals_photo_purge_done").map((c) => c.args);
    expect(done).toEqual([
      { p_bucket: "listing-photos", p_paths: ["u/rental-listings/l/a.jpg"] },
      { p_bucket: "job-photos", p_paths: ["u/rental-listings/l/old.jpg"] },
    ]);
  });

  it("an unreadable queue is a failed run, never 'nothing due'", async () => {
    scenario.rpcErrors = { rentals_photo_purge_due: { message: "connection reset", code: "08006" } };
    const fn = await load();
    expect((await run(fn)).status).toBe(500);
  });
});
