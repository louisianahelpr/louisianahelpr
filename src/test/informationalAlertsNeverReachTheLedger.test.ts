/**
 * Owner order 11-02: three recurring notices are intended, not defects, and must never become ops-alert ledger items
 * (and so never OPEN items through open-sync-trackers). The owner closed Q2543, Q2545 and Q2554; each would reopen on
 * its next occurrence (560, 2 and 26 so far) unless its source stops recording it. Each source, and its exclusion:
 *
 *   Q2543 "New member joined" (edge_slack ops-alert:custom): send-push-notification's admin Slack fallback. An
 *         informational admin title (adminPushSeverity 'info', which also covers the daily new-member summary)
 *         passes `ledger: false`; it still posts to Slack. A critical one is still recorded.
 *   Q2545 "sweep_old_notifications: deleted # rows" (error_logs): the sweeper's info receipt. trg_error_logs_zz_ledger
 *         (ops_alert_ledger_from_error_log, 20261102225216) skips that source; the error_logs row stays.
 *         PGlite: src/test/pglite/ledgerSkipsInformational.pglite.mjs (ALL PASS; LEDGER_SKIP_REMOVED=1: 2 FAILED).
 *   Q2554 "Guest marketplace is empty" (workflow uptime): uptime.yml's empty step is a run warning only, no record.
 *
 * @mutate supabase/migrations/20261102225216_ledger_skips_informational_sources.sql | IF v_source IN ('ops-alert', 'ops-digest', 'sweep_old_notifications') THEN | IF v_source IN ('ops-alert', 'ops-digest') THEN
 * @mutate supabase/functions/send-push-notification/index.ts |             ledger: adminPushSeverity(payload.title) !== 'info',\n |
 * @mutate .github/workflows/uptime.yml |         run: echo "::warning::${SUMMARY}" |         run: node scripts/ops-alert-ledger.mjs record --source uptime --title "Guest marketplace is empty"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { adminPushSeverity } from "../../supabase/functions/_shared/alertPolicy";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`no definition of ${fn}`);
  return blankSqlComments(d.stmt);
};

describe("Q2545: the notifications sweeper's receipt is not a ledger item", () => {
  it("the newest ledger trigger skips the source the newest sweeper writes, and still records the rest", () => {
    const sweeper = body("sweep_old_notifications");
    expect(sweeper).toMatch(/'info',\s*jsonb_build_object\('source', 'sweep_old_notifications'\)/);
    const ledger = body("ops_alert_ledger_from_error_log");
    expect(ledger).toContain("IF v_source IN ('ops-alert', 'ops-digest', 'sweep_old_notifications') THEN\n    RETURN NULL;");
    expect(ledger).toContain("PERFORM public.ops_alert_record(");
    expect(read("src/test/pglite/ledgerSkipsInformational.pglite.mjs")).toContain('newestFunction("ops_alert_ledger_from_error_log")');
  });
});

describe("Q2543: an informational admin notice posts to Slack with no ledger item", () => {
  it("informational titles are 'info' (the daily summary too); an unclassified one stays critical", () => {
    expect(adminPushSeverity("New member joined")).toBe("info");
    expect(adminPushSeverity("New member summary")).toBe("info");
    expect(adminPushSeverity("Transfer failed")).toBe("critical");
  });

  it("send-push-notification's admin fallback passes ledger: false exactly for those", () => {
    const src = blankComments(read("supabase/functions/send-push-notification/index.ts"));
    const call = /await postSlackOpsAlert\(\{\s*kind: 'custom',\s*severity: adminPushSeverity\(payload\.title\),[\s\S]*?\}\)/.exec(src)?.[0];
    expect(call, "the admin Slack fallback call").toBeTruthy();
    expect(call).toContain("ledger: adminPushSeverity(payload.title) !== 'info',");
  });
});

describe("Q2554: the empty pre-launch marketplace is a run warning, never a ledger item", () => {
  it("no workflow records it", () => {
    const dir = join(ROOT, ".github/workflows");
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const recorders = files.filter((f) => /ops-alert-ledger\.mjs record[^\n]*(\\\n[^\n]*)*marketplace is empty/i.test(read(`.github/workflows/${f}`)));
    expect(recorders).toEqual([]);
    expect(read(".github/workflows/uptime.yml")).toContain('run: echo "::warning::${SUMMARY}"');
  });
});
