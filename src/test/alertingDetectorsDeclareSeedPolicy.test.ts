/**
 * CLASS GUARD: every alerting detector says how it treats seed/E2E data.
 *
 * THE BUG (docs/OPEN.md Q2/Q42/Q46, measured on prod 2026-09-23). Tests run
 * against prod by design (no mock mode), so their jobs abandon checkouts,
 * stall and fail payouts exactly like real ones. Detectors that never asked
 * `is_seed` reported them as real: 36 open ops-ledger items, 30 "job stalled",
 * 14 detect_stuck_payments rows — every one an "[E2E DO NOT ACCEPT]" or seed
 * job — and the real-money pages drowned in them. The fix routes seed alerts
 * to the daily digest (public.error_log_is_seed, postSlackOpsAlert `seed`);
 * this guard makes the question impossible to forget for the next detector.
 *
 * THE CLASS, derived from the tree:
 *   SQL  — the LATEST definition of every public function in
 *          supabase/migrations whose code (comments stripped) writes
 *          error_logs or posts to slack-ops-alert AND reads jobs,
 *          payout_transfers or disputes.
 *   Edge — every supabase/functions/**.ts that calls postSlackOpsAlert( or
 *          inserts into error_logs AND reads jobs / payout_transfers /
 *          disputes / job_payments.
 * Each must reference `is_seed` in CODE, or carry a `seed-policy:` comment
 * saying why seed and real are treated alike. A comment that merely mentions
 * is_seed does not count: that is how "No is_seed clause, on purpose" read as
 * handled while its alerts paged for fixtures.
 *
 * RED ON THE ORIGINAL (this file run against origin/main 741e9d3a6):
 * detect_stuck_payments (20260506215934) and 13 edge
 * files had neither.
 *
 * @mutate supabase/migrations/20260926040817_money_sweeps_found_vs_done.sql | coalesce(j.is_seed OR sp.is_seed, false) AS seed | false AS seed
 * @mutate supabase/functions/execute-dispute-split/index.ts | // seed-policy: | // seed policy -
 * @mutate supabase/migrations/20260924130917_lock_seed_read_in_dispute_alert.sql | SELECT j.is_seed INTO v_seed FROM public.jobs j WHERE j.id = _job_id FOR KEY SHARE; | SELECT false INTO v_seed;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const FNS = join(ROOT, "supabase", "functions");

const stripSql = (b: string) => blankSqlComments(b);
const stripTs = (b: string) => blankComments(b);

// ── SQL inventory ──────────────────────────────────────────────────────────
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
const sqlLatest = new Map<string, { body: string; file: string }>();
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, f), "utf8");
  for (const m of sql.matchAll(FN_RE)) sqlLatest.set(m[1].toLowerCase(), { body: m[3], file: f });
}
const SQL_ALERTS = /insert\s+into\s+(?:public\.)?error_logs\b|slack-ops-alert/i;
// …or is HANDED a job: notify_ops_dispute_filed(_job_id, …) reads no table,
// so the read-only pattern missed it and a seed dispute fixture paged
// #ops-alerts critical on 2026-09-24 08:06 (ops ledger 076553f2).
const SQL_MONEY = /\b(?:from|join|update)\s+(?:public\.)?(?:jobs|payout_transfers|disputes)\b|\b(?:_|p_)job_id\b/i;
const sqlDetectors = [...sqlLatest.entries()]
  .filter(([, { body }]) => SQL_ALERTS.test(stripSql(body)) && SQL_MONEY.test(stripSql(body)))
  .map(([name, v]) => ({ name, ...v }));

// ── Edge inventory ─────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const EDGE_ALERTS = /postSlackOpsAlert\(|from\(\s*["']error_logs["']\s*\)\s*\.insert/;
const EDGE_MONEY = /from\(\s*["'](?:jobs|payout_transfers|disputes|job_payments)["']\s*\)/;
const edgeDetectors = walk(FNS)
  .filter((f) => f.endsWith(".ts") && !/\.test\.ts$|\.d\.ts$/.test(f))
  .map((f) => ({ file: relative(ROOT, f), src: readFileSync(f, "utf8") }))
  .filter(({ file, src }) => !file.endsWith("_shared/slack-alerts.ts") && EDGE_ALERTS.test(stripTs(src)) && EDGE_MONEY.test(stripTs(src)));

const declares = (code: string, raw: string) => /\bis_seed\b/.test(code) || /seed-policy:/.test(raw);

describe("alerting detectors state how they treat seed/E2E data", () => {
  it("found the detectors (inventory floor, 2026-09-23: 3 SQL, 18 edge)", () => {
    expect(sqlDetectors.length).toBeGreaterThanOrEqual(3);
    expect(sqlDetectors.map((d) => d.name)).toContain("detect_stuck_payments");
    expect(edgeDetectors.length).toBeGreaterThanOrEqual(18);
    expect(edgeDetectors.map((d) => d.file)).toContain("supabase/functions/stalled-completion-reminder/index.ts");
  });

  it("every SQL detector references is_seed in code or declares a seed-policy", () => {
    const bad = sqlDetectors
      .filter((d) => !declares(stripSql(d.body), d.body))
      .map((d) => `${d.name} (latest: ${d.file})`);
    expect(bad, "add an is_seed branch (seed -> a '-seed' source / tags.seed, see detect_stuck_payments) or a `-- seed-policy: <why>` comment").toEqual([]);
  });

  it("every edge detector references is_seed in code or declares a seed-policy", () => {
    const bad = edgeDetectors.filter((d) => !declares(stripTs(d.src), d.src)).map((d) => d.file);
    expect(bad, "pass `seed:` to postSlackOpsAlert from the subject's is_seed, or add a `// seed-policy: <why>` comment").toEqual([]);
  });

  it("a comment that only MENTIONS is_seed does not count", () => {
    const src = `// No is_seed clause, on purpose\nawait postSlackOpsAlert({})\nsupabase.from("jobs")`;
    expect(declares(stripTs(src), src)).toBe(false);
    expect(declares(stripTs(src + "\n// seed-policy: pages for seed too"), src + "\n// seed-policy: pages for seed too")).toBe(true);
  });
});
