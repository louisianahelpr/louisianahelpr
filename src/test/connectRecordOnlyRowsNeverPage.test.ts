/**
 * Q2368 (lead 11-03): stripe-connect's record-only error_logs rows (tags.kind 'connect-reset' and
 * 'connect-dead-account-close', written by supabase/functions/_shared/connectRecord.ts) are a durable record, never an
 * alert: nothing new may reach the owner. The newest error_logs triggers (20261103203658) return early for them, and
 * the Slack trigger leaves them out of its throttle count so they never mute a real post. The kinds the writer can
 * produce and the kinds the SQL names are the same set, both ways.
 *
 * PGlite: src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs (ALL PASS; RECORD_ONLY_REMOVED=1: 4 FAILED).
 * Edge: src/test/edge/connectChangesLeaveARecord.test.ts.
 *
 * Q2794 (20261115040732): a server 'stale-clear' row tagged money_history exactly false is record-only too (a clear for
 * a member with no money history); untagged, true, or client-written still pages.
 * Edge: src/test/edge/stripeConnectStaleClearMoneyHistory.test.ts.
 *
 * @mutate supabase/migrations/20261103203658_connect_record_only_rows_never_page.sql |   IF public.error_log_is_record_only(NEW.tags) THEN\n    RETURN NEW;\n  END IF; |
 * @mutate supabase/migrations/20261103203658_connect_record_only_rows_never_page.sql |   IF public.error_log_is_record_only(v_tags) THEN\n    RETURN NULL;\n  END IF; |
 * @mutate supabase/migrations/20261103203658_connect_record_only_rows_never_page.sql |     AND NOT public.error_log_is_record_only(e.tags)\n | \n
 * @mutate supabase/migrations/20261115040732_stale_clear_pages_only_with_money_history.sql |      AND coalesce(p_tags ->> 'origin', '') = 'server'\n | \n
 * @mutate supabase/migrations/20261115040732_stale_clear_pages_only_with_money_history.sql | IN ('connect-reset', 'connect-dead-account-close')); | IN ('connect-reset'));
 * @mutate supabase/migrations/20261115040732_stale_clear_pages_only_with_money_history.sql |        (coalesce(p_tags ->> 'kind', '') = 'stale-clear' AND coalesce(p_tags ->> 'money_history', '') = 'false') |        (coalesce(p_tags ->> 'kind', '') = 'stale-clear')
 * @mutate supabase/functions/_shared/connectRecord.ts | export type ConnectRecordKind = "connect-reset" \| "connect-dead-account-close"; | export type ConnectRecordKind = "connect-reset" \| "connect-dead-account-close" \| "connect-other";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`no definition of ${fn}`);
  return { file: d.file, sql: blankSqlComments(d.stmt) };
};

describe("Q2368: record-only connect rows never page and never open a ledger item", () => {
  it("the predicate names exactly the writer's kinds, from the server only", () => {
    const { sql } = body("error_log_is_record_only");
    expect(sql).toContain("coalesce(p_tags ->> 'origin', '') = 'server'");
    expect(sql).toContain("coalesce(p_tags ->> 'source', '') = 'stripe-connect'");
    const sqlKinds = (/IN \(([^)]*)\)\)?;/.exec(sql)?.[1] ?? "").match(/'[^']+'/g)?.map((k) => k.slice(1, -1)).sort() ?? [];
    const ts = blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/connectRecord.ts"), "utf8"));
    const tsKinds = (/export type ConnectRecordKind = ([^;]+);/.exec(ts)?.[1] ?? "").match(/"[^"]+"/g)?.map((k) => k.slice(1, -1)).sort() ?? [];
    expect(tsKinds.length).toBeGreaterThan(1);
    expect(sqlKinds).toEqual(tsKinds);
    expect(ts).toContain('source: "stripe-connect", kind: r.kind');
  });

  it("Q2794: a stale-clear is record-only only when tagged money_history false", () => {
    const { file, sql } = body("error_log_is_record_only");
    expect(file).toBe("20261115040732_stale_clear_pages_only_with_money_history.sql");
    expect(sql.replace(/\s+/g, " ")).toContain(
      "AND ( (coalesce(p_tags ->> 'kind', '') = 'stale-clear' AND coalesce(p_tags ->> 'money_history', '') = 'false') OR coalesce(p_tags ->> 'kind', '') IN ('connect-reset', 'connect-dead-account-close'));",
    );
    // The writer tags every clear; the breaker's source/kind stay the same.
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/stripe-connect/index.ts"), "utf8"));
    expect(fn).toContain('tags: { source: "stripe-connect", kind: STALE_CLEAR_KIND, money_history: moneyHistory,');
    expect(fn).toContain("const moneyHistory = await memberHasMoneyHistory(supabaseAdmin, userId);");
  });

  it("the newest Slack trigger returns before posting and leaves them out of its throttle", () => {
    const { file, sql } = body("notify_slack_on_error_log");
    expect(file).toMatch(/20261103203658/);
    const early = sql.indexOf("IF public.error_log_is_record_only(NEW.tags) THEN\n    RETURN NEW;");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(sql.indexOf("net.http_post"));
    expect(sql).toContain("AND NOT public.error_log_is_record_only(e.tags)");
  });

  it("the newest ledger trigger returns before recording", () => {
    const { file, sql } = body("ops_alert_ledger_from_error_log");
    expect(file).toMatch(/20261103203658/);
    const early = sql.indexOf("IF public.error_log_is_record_only(v_tags) THEN\n    RETURN NULL;");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(sql.indexOf("PERFORM public.ops_alert_record("));
  });

  it("the PGlite proof drives the newest definitions", () => {
    const proof = readFileSync(join(ROOT, "src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs"), "utf8");
    expect(proof).toContain('"notify_slack_on_error_log", "ops_alert_ledger_from_error_log"');
  });
});
