// Q1840 (lh-money-escrow review of 032657f02, should-fix 2): a SQL function
// that prices a Helpr's money from jobs.helper_fee_percent ALONE silently
// prices a flat-model job (F3: 5% + 70c, stamped as jobs.helper_fee_flat_cents
// at funding) on the old percent, 70c too generous, with no error anywhere.
// poster_cancel_job and settle_one_off_jobs_for_banned_account told Helprs
// "about $X" that way, get_helper_earnings_export's no-ledger fallback priced
// the fee that way, and get_helper_analytics handed the client no stamp. The
// edge half of this class is payoutPathsReadFeeStamp.test.ts; this is the SQL
// half, built from every migration's EFFECTIVE (newest) function definition:
//
//   (A) every function that reads helper_fee_percent also reads
//       helper_fee_flat_cents, except an EXACT list of column guards that
//       price nothing (two-way);
//   (B) the notice and export pricers branch on the stamp and price a flat
//       job through public.helpr_flat_fee_cents, and the row they read the
//       stamp from (v_job) selects it;
//   (C) helpr_flat_fee_cents is the TS rule (_shared/helprFlatFee.ts) with
//       the same 10 / 70 defaults (20261025214015), EXECUTE for service_role only;
//   (D) get_helper_analytics carries the stamp in both its jobs list and its
//       not-entitled preview.
// Executed proof (red before, green after, 3x replay, TS parity at every
// share 0..$2,000): src/test/pglite/sqlNoticesFlatFee.pglite.mjs.
//
// @mutate supabase/migrations/20261031015647_poster_cancel_strike_only_inside_24h.sql |          j.status, j.helper_fee_percent, j.helper_fee_flat_cents, j.helper_confirmed_at, |          j.status, j.helper_fee_percent, j.helper_confirmed_at,
// @mutate supabase/migrations/20261018050953_offer_notices_wait_for_funding.sql |           v_cut := CASE WHEN v_job.helper_fee_flat_cents IS NOT NULL |           v_cut := CASE WHEN false
// @mutate supabase/migrations/20261019015304_helpr_fault_earnings_export.sql |              public.helpr_flat_fee_cents(g0.gross_cents, j.helper_fee_percent, j.helper_fee_flat_cents) AS fee_cents |              0::bigint AS fee_cents
// @mutate supabase/migrations/20261017104746_sql_notices_exports_flat_fee.sql | + GREATEST(0, round(COALESCE(p_flat_cents, 70)))) | + GREATEST(0, round(COALESCE(p_flat_cents, 60))))
// @mutate supabase/migrations/20261017104746_sql_notices_exports_flat_fee.sql | ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated; | ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261017104746_sql_notices_exports_flat_fee.sql |             'helper_fee_flat_cents', e->'helper_fee_flat_cents', |             'urgent_fee_again',      e->'urgent_fee',
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { HELPR_FLAT_FEE_CENTS, HELPR_FLAT_FEE_PERCENT } from "../../supabase/functions/_shared/helprFlatFee";

const ROOT = path.resolve(__dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string): string => {
  const d = DEFS.get(name);
  expect(d, `${name} has a definition in the migrations`).toBeTruthy();
  return blankSqlComments(d!.stmt);
};

describe("SQL money readers honour the jobs fee-model stamp (Q1840)", () => {
  it("(A) every function reading helper_fee_percent reads helper_fee_flat_cents too", () => {
    // Column guards that lock or whitelist helper_fee_percent and price
    // nothing (the stamp has its own lock, jobs_fee_model_lock), plus the
    // platform-settings reader, whose helper_fee_percent is a settings key,
    // not a job's. Exact both ways.
    // @two-way src/test/sqlMoneyReadsFeeStamp.test.ts:stale non-pricing entry
    const NON_PRICING = ["enforce_poster_jobs_money_lock", "get_public_platform_settings", "prevent_job_field_escalation"];
    const readers = [...DEFS.keys()].filter((n) => /\bhelper_fee_percent\b/.test(body(n))).sort();
    // Inventory floor: the scan reads the real definitions (8 on 2026-10-17).
    expect(readers.length).toBeGreaterThan(6);
    for (const n of NON_PRICING) expect(readers, `stale non-pricing entry ${n} — remove it`).toContain(n);
    const missing = readers.filter((n) => !NON_PRICING.includes(n) && !/\bhelper_fee_flat_cents\b/.test(body(n)));
    expect(missing).toEqual([]);
    const pricing = readers.filter((n) => !NON_PRICING.includes(n));
    expect(pricing).toEqual(expect.arrayContaining([
      "get_helper_analytics", "get_helper_earnings_export", "get_payout_batches",
      "poster_cancel_job", "settle_one_off_jobs_for_banned_account",
    ]));
  });

  it("(B) the notice and export pricers branch on the stamp through helpr_flat_fee_cents", () => {
    const calls = (b: string) => [...b.matchAll(/\bpublic\.helpr_flat_fee_cents\s*\(/g)].length;
    const gates = (b: string) => [...b.matchAll(/CASE\s+WHEN\s+(?:v_job|j)\.helper_fee_flat_cents\s+IS\s+NOT\s+NULL/gi)].length;
    // poster_cancel_job: the crew loop and the solo notice.
    const pc = body("poster_cancel_job");
    expect(calls(pc)).toBe(2);
    expect(gates(pc)).toBe(2);
    expect(pc).toMatch(/SELECT\s[^;]*?\bj\.helper_fee_flat_cents\b[^;]*?\bINTO\s+v_job\b/);
    const st = body("settle_one_off_jobs_for_banned_account");
    expect(calls(st)).toBe(1);
    expect(gates(st)).toBe(1);
    expect(st).toMatch(/FOR\s+v_job\s+IN\s+SELECT\s[^;]*?\bj\.helper_fee_flat_cents\b/);
    // The export: the three no-ledger columns branch, and the fee is the call.
    const ex = body("get_helper_earnings_export");
    expect(calls(ex)).toBe(1);
    expect([...ex.matchAll(/WHEN\s+j\.helper_fee_flat_cents\s+IS\s+NOT\s+NULL/gi)].length).toBe(3);
    expect(ex).toMatch(/public\.helpr_flat_fee_cents\(g0\.gross_cents,\s*j\.helper_fee_percent,\s*j\.helper_fee_flat_cents\)\s+AS\s+fee_cents/);
  });

  it("(C) helpr_flat_fee_cents is the TS rule with the same defaults, service_role only", () => {
    const h = body("helpr_flat_fee_cents");
    expect(h).toMatch(/\bIMMUTABLE\b/);
    const m = h.match(/LEAST\(s\.share,\s*round\(s\.share \* COALESCE\(p_percent, (\d+)\) \/ 100\.0\) \+ GREATEST\(0, round\(COALESCE\(p_flat_cents, (\d+)\)\)\)\)/);
    expect(m, "the rule: LEAST(share, round(share * pct / 100) + flat)").toBeTruthy();
    expect(Number(m![1])).toBe(HELPR_FLAT_FEE_PERCENT);
    expect(Number(m![2])).toBe(HELPR_FLAT_FEE_CENTS);
    expect(h).toMatch(/WHEN s\.share = 0 THEN 0/);
    // The newest grants on it, across every migration.
    const acl: string[] = [];
    for (const f of migrationFiles(MIG)) {
      const code = blankSqlComments(readFileSync(path.join(MIG, f), "utf8"));
      for (const g of code.matchAll(/\b(?:REVOKE|GRANT)\b[^;]*\bpublic\.helpr_flat_fee_cents\s*\([^;]*;/gi)) acl.push(g[0].replace(/\s+/g, " "));
    }
    expect(acl).toEqual([
      "REVOKE ALL ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;",
      "GRANT EXECUTE ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) TO service_role;",
    ]);
  });

  it("(D) get_helper_analytics carries the stamp in its jobs list and its preview", () => {
    const a = body("get_helper_analytics");
    expect(a).toMatch(/WITH mine AS \(\s*SELECT[^;]*?\bj\.helper_fee_flat_cents,/);
    expect(a).toMatch(/'helper_fee_flat_cents',\s*e->'helper_fee_flat_cents'/);
  });
});
