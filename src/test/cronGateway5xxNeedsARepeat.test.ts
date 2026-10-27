/**
 * A one-off gateway 502 paged as a cron failure (2026-10-26 18:15Z:
 * "refund-request-sweep returned 502", "declutter-money returned 502").
 * Measured: both 502s were text/html with no function version and no
 * x-served-by: supabase-edge-runtime (function_edge_logs), no boot in
 * function_logs, and both jobs answered 200 on their next runs. The platform's
 * gateway answered; our code never ran.
 *
 * 20261027141932 gives such a 5xx the rule Q1690 gave a first-run 404: a
 * 502/503 that is text/html WITHOUT the edge runtime's stamp (header names in
 * any case; no headers = no proof), on a job listed as a catch-up sweep, is
 * skipped only once a later 2xx of the same job proves the platform answered
 * again; under 30 minutes old it waits for the next sweep; otherwise it is
 * filed. A function's own 5xx, a 504 (a function past its time limit gets one
 * too) and every unlisted job are filed as before.
 *
 * Behaviour: src/test/pglite/cronGateway5xxNeedsARepeat.pglite.mjs (ALL PASS
 * with the migration applied 3x; 5 FAIL on main). This guard pins, from the
 * NEWEST definition, that the grace stays narrow.
 *
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |            (resp.status_code IN (502, 503)\n |           (resp.status_code >= 500\n
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |             AND tag.jobname = ANY (ARRAY['declutter-money', 'refund-request-sweep'])\n |            AND true\n
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |             AND resp.headers IS NOT NULL\n |            AND true\n
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |                          WHERE lower(h.key) = 'content-type' AND lower(h.value) LIKE 'text/html%') |                         WHERE true)
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |             AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(resp.headers) h\n                             WHERE lower(h.key) IN ('x-served-by', 'x-deno-execution-id'))) AS gateway_5xx, |            AND true) AS gateway_5xx,
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |       IF r.gateway_5xx AND r.later_success THEN | IF r.gateway_5xx THEN
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |       ELSIF r.gateway_5xx AND r.created > now() - interval '30 minutes' THEN |       ELSIF r.gateway_5xx THEN
 * @mutate supabase/migrations/20261027141932_cron_gateway_5xx_needs_a_repeat.sql |                             'gateway_5xx_skipped', v_gw, |                             'gateway_5xx_skipped_x', v_gw,
 */
import { describe, it, expect } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { join } from "node:path";

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
const defs = effectiveDefs(MIG);
const body = () => blankSqlComments(defs.get("sweep_cron_http_failures")!.stmt).replace(/\s+/g, " ");

describe("a gateway 5xx that never reached the function needs a repeat to page", () => {
  it("reads the real, newest definition (floor)", () => {
    expect(defs.size).toBeGreaterThan(400);
    expect(defs.get("sweep_cron_http_failures")?.file).toBe("20261027141932_cron_gateway_5xx_needs_a_repeat.sql");
  });

  it("the candidate is a text/html 502/503 WITHOUT the edge runtime's stamp, on a listed catch-up sweep, and nothing wider", () => {
    expect(body()).toContain(
      "(resp.status_code IN (502, 503) AND tag.jobname = ANY (ARRAY['declutter-money', 'refund-request-sweep']) AND resp.headers IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each_text(resp.headers) h WHERE lower(h.key) = 'content-type' AND lower(h.value) LIKE 'text/html%') AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(resp.headers) h WHERE lower(h.key) IN ('x-served-by', 'x-deno-execution-id'))) AS gateway_5xx",
    );
    // Exactly the two jobs measured as catch-up sweeps (every RPC they call is a *_due / *_sweep reader).
    const list = /tag\.jobname = ANY \(ARRAY\[([^\]]*)\]\)/.exec(body())?.[1] ?? "";
    expect(list.split(",").map((x) => x.trim())).toEqual(["'declutter-money'", "'refund-request-sweep'"]);
  });

  it("skipped only after a later success; young ones wait 30 minutes; the rest are filed", () => {
    const b = body();
    expect(b).toMatch(/AND ok\.created > resp\.created AND ok\.status_code BETWEEN 200 AND 299\) AS later_success/);
    expect(b).toMatch(
      /IF r\.gateway_5xx AND r\.later_success THEN v_gw := v_gw \+ 1;[^]*?CONTINUE; ELSIF r\.gateway_5xx AND r\.created > now\(\) - interval '30 minutes' THEN CONTINUE; END IF;/,
    );
    // The skip is counted in the sweep's own result (cron_run_log), never silent.
    expect(b).toContain("'gateway_5xx_skipped', v_gw,");
    expect(b).toContain("'gateway_5xx_jobs', to_jsonb(v_gw_names)");
  });
});
