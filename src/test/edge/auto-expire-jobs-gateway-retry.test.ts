// @mutate supabase/functions/auto-expire-jobs/index.ts |   if (!isGatewayFailure(first)) return first; |   return first;
// @mutate supabase/functions/auto-expire-jobs/index.ts | return !!res.error && !res.error.code && | return !!res.error &&
// @mutate supabase/functions/auto-expire-jobs/index.ts | await sweepRpc(() => supabase.rpc("expire_unanswered_offers")); | await supabase.rpc("expire_unanswered_offers");
/**
 * GUARD (docs/OPEN.md Q1777): auto-expire-jobs does not file a cron 500 for
 * one slow API-gateway answer.
 *
 * Measured 2026-10-13 04:00Z: expire_unanswered_offers returned "Internal
 * server error." (edge_logs: HTTP 555 from the gateway, text/plain,
 * origin_time 10178 ms; no Postgres error in postgres_logs; the RPC's other 22
 * calls that day answered 200, p50 95 ms, max 608 ms), the run counted a
 * defect and pg_net filed "Cron HTTP failure: auto-expire-jobs returned 500".
 * The sweep RPCs are idempotent, so a code-less (gateway) failure is retried
 * once; a real Postgres error (it always has a SQLSTATE code) still counts at
 * once, and a gateway failure that repeats still counts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-expire";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET });
  return loadEdgeFunction("auto-expire-jobs");
}

function run(fn: EdgeHarness) {
  return fn.fetch(
    fn.request({ method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` }, url: "https://edge.test/auto-expire-jobs" }),
  );
}

/** expire_unanswered_offers answers `errors[i]` on call i (undefined = success). */
function failCalls(errors: Array<{ message: string; code?: string } | undefined>) {
  let call = 0;
  Object.defineProperty(scenario.rpcErrors!, "expire_unanswered_offers", {
    configurable: true,
    enumerable: true,
    get: () => errors[call++],
  });
}

function seedQuiet() {
  scenario.reads.jobs = { rows: [] };
  scenario.reads.applications = { rows: [] };
  scenario.reads.notifications = { rows: [] };
  scenario.rpc.start_underfilled_crews = 0;
  scenario.rpc.expire_unanswered_offers = 0;
  scenario.rpc.expire_pending_direct_offers = 0;
}

const calls = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name).length;
const GATEWAY = { message: "Internal server error." };

describe("auto-expire-jobs · a gateway failure on a sweep RPC is retried once (Q1777)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    seedQuiet();
  });

  it("one gateway failure then success: retried, no defect, 200", async () => {
    const fn = await load();
    failCalls([GATEWAY, undefined]);
    const res = await run(fn);
    expect(calls("expire_unanswered_offers")).toBe(2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defects ?? 0).toBe(0);
  });

  it("a real Postgres error (has a SQLSTATE code) is NOT retried and still counts", async () => {
    const fn = await load();
    failCalls([{ message: "canceling statement due to statement timeout", code: "57014" }, undefined]);
    const res = await run(fn);
    expect(calls("expire_unanswered_offers")).toBe(1);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.defectReasons.join(" ")).toMatch(/expire_unanswered_offers: canceling statement/);
  });

  it("a gateway failure that repeats still counts as a defect", async () => {
    const fn = await load();
    failCalls([GATEWAY, GATEWAY, GATEWAY]);
    const res = await run(fn);
    expect(calls("expire_unanswered_offers")).toBe(2);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.defectReasons.join(" ")).toMatch(/expire_unanswered_offers: Internal server error\./);
  });
});
