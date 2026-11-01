/**
 * The `declutter-photo-purge` function (B63, B59 open finding 2): a seller's removed or declined photo that a Helpr
 * uploaded sits in the HELPR's folder, so the seller's app cannot delete it and it stayed public. Every deleted photo
 * row queues its path (trigger, proven in src/test/pglite/declutterPhotoPurge.pglite.mjs); this function removes the
 * queued objects THROUGH THE STORAGE API with the service role. The cron gets everyone's; a member's own call gets
 * ONLY their own (the id from the verified token, never the body). A Storage refusal keeps the entries and fails the
 * run (non-2xx). Runs the REAL function source via the edge harness.
 *
 * @mutate supabase/functions/declutter-photo-purge/index.ts |       seller = auth.user.id; |       seller = null;
 * @mutate supabase/functions/declutter-photo-purge/index.ts |       const { error: rmError } = await admin.storage.from(BUCKET).remove(batch); |       const rmError = null as { message: string } \| null;
 * @mutate supabase/functions/declutter-photo-purge/index.ts |       if (refused) return refused; |       void refused;
 * B67 (lead review 11-01): a claimed path is re-checked right before the remove; one attached again is never removed
 * (SQL side proven in src/test/pglite/declutterPhotoPurgeReattach.pglite.mjs).
 * @mutate supabase/functions/declutter-photo-purge/index.ts |       const batch = ((still ?? []) as { storage_path: string }[]).map((r) => r.storage_path); |       const batch = claimed; void still;
 * @mutate supabase/functions/declutter-photo-purge/index.ts |       if (recheckError) { |       if (recheckError && false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const SELLER = "11111111-1111-1111-1111-111111111111";
const PATH = `22222222-2222-2222-2222-222222222222/declutter/33333333-3333-3333-3333-333333333333/a.jpg`;

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  return loadEdgeFunction("declutter-photo-purge");
}
const run = (fn: EdgeHarness, auth = "Bearer service-key", body: unknown = {}) =>
  fn.fetch(fn.request({ headers: { Authorization: auth }, body }));
const dueCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "declutter_photo_purge_due").map((c) => c.args);
/** The re-check answers "all still due" unless a test says otherwise. */
const recheckAll = () => { scenario.rpc.declutter_photo_purge_recheck = (a?: unknown) => ((a as { p_paths: string[] }).p_paths ?? []).map((storage_path) => ({ storage_path })); };
const declutterOn = () => {
  const base = scenario.rpc.feature_enabled_for_user as (a?: unknown) => unknown;
  scenario.rpc.feature_enabled_for_user = (a?: unknown) =>
    (a as { p_key?: string } | undefined)?.p_key === "declutter" ? true : base(a);
};

describe("declutter-photo-purge", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    recheckAll();
  });

  it("refuses a caller with neither the cron secret nor a valid sign-in, and reads nothing", async () => {
    scenario.authUser = null;
    const fn = await load();
    expect((await run(fn, "Bearer nope")).status).toBe(401);
    expect((await run(fn, "")).status).toBe(401);
    expect(dueCalls()).toHaveLength(0);
  });

  it("the cron removes everyone's due objects through Storage, then marks them done", async () => {
    scenario.rpc.declutter_photo_purge_due = [{ storage_path: PATH }];
    scenario.rpc.declutter_photo_purge_done = 1;
    const fn = await load();
    const res = await run(fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, due: 1, removed: 1 });
    expect(dueCalls()).toEqual([{ p_limit: 500, p_seller: null }]);
    expect(scenario.storage.removeCalls).toEqual([[PATH]]);
    const done = (scenario.rpcCalls ?? []).filter((c) => c.name === "declutter_photo_purge_done").map((c) => c.args);
    expect(done).toEqual([{ p_paths: [PATH] }]);
  });

  it("a member's own call claims ONLY their own paths (the id from the token, never the body)", async () => {
    scenario.authUser = { id: SELLER };
    declutterOn();
    scenario.rpc.declutter_photo_purge_due = [];
    const fn = await load();
    const res = await run(fn, "Bearer user-jwt", { p_seller: "99999999-9999-9999-9999-999999999999" });
    expect(res.status).toBe(200);
    expect(dueCalls()).toEqual([{ p_limit: 500, p_seller: SELLER }]);
  });

  it("a member the declutter switch is off for is refused before any claim", async () => {
    scenario.authUser = { id: SELLER };
    const fn = await load();
    expect((await run(fn, "Bearer user-jwt")).status).toBe(403);
    expect(dueCalls()).toHaveLength(0);
  });

  it("a Storage refusal keeps the entries (no done) and fails the run", async () => {
    scenario.rpc.declutter_photo_purge_due = [{ storage_path: PATH }];
    scenario.storage.removeError = { message: "denied" };
    const fn = await load();
    const res = await run(fn);
    expect(res.status).toBe(500);
    expect((scenario.rpcCalls ?? []).some((c) => c.name === "declutter_photo_purge_done")).toBe(false);
  });

  it("a claimed path attached again since the claim is not removed (re-checked right before the remove)", async () => {
    const other = PATH.replace("a.jpg", "b.jpg");
    scenario.rpc.declutter_photo_purge_due = [{ storage_path: PATH }, { storage_path: other }];
    scenario.rpc.declutter_photo_purge_recheck = [{ storage_path: other }];
    scenario.rpc.declutter_photo_purge_done = 1;
    const fn = await load();
    const res = await run(fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, due: 2, removed: 1 });
    const recheck = (scenario.rpcCalls ?? []).filter((c) => c.name === "declutter_photo_purge_recheck").map((c) => c.args);
    expect(recheck).toEqual([{ p_paths: [PATH, other] }]);
    expect(scenario.storage.removeCalls).toEqual([[other]]);
  });

  it("a failed re-check removes nothing and fails the run", async () => {
    scenario.rpc.declutter_photo_purge_due = [{ storage_path: PATH }];
    scenario.rpcErrors = { declutter_photo_purge_recheck: { message: "connection reset", code: "08006" } };
    const fn = await load();
    expect((await run(fn)).status).toBe(500);
    expect(scenario.storage.removeCalls ?? []).toEqual([]);
  });

  it("an unreadable queue is a failed run, never 'nothing due'", async () => {
    scenario.rpcErrors = { declutter_photo_purge_due: { message: "connection reset", code: "08006" } };
    const fn = await load();
    expect((await run(fn)).status).toBe(500);
  });
});
