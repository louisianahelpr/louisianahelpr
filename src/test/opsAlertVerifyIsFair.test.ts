/**
 * Q291 (docs/OPEN.md): ops_alert_verify must not be starved by volume.
 *
 * THE BUG. It re-asked at most 200 open items per loop, newest last_seen first
 * (20260923050059), and stamped nothing on a "could not tell" answer. A burst
 * of fresh items (250 in PGlite) meant an older item such as a stuck payment
 * (detect_stuck_payments) was never re-asked: verify_started_at stayed NULL,
 * and the same 200 were asked every hour.
 *
 * The fix (20260923185332), checked on the NEWEST definition:
 *   - the sql_condition loop ranks items within their source, least recently
 *     asked first (never asked, then oldest last_seen), and takes every
 *     source's first before any source's second;
 *   - every ask stamps verify_started_at, "could not tell" included, so the
 *     rotation always advances; the companions loop rotates the same way;
 *   - nothing is ordered newest-first any more; grants stay service_role only.
 * Behaviour (250 fresh items + one old cleared money item closes on the first
 * run; two runs ask all 250; red on the state before):
 * src/test/pglite/opsAlertCloseRulesAndFairVerify.pglite.mjs.
 *
 * @mutate supabase/migrations/20260923185332_ops_alert_close_rules_and_fair_verify.sql |             ORDER BY x.src_rank, x.verify_started_at ASC NULLS FIRST, x.last_seen ASC, x.id |             ORDER BY x.last_seen DESC
 * @mutate supabase/migrations/20260923185332_ops_alert_close_rules_and_fair_verify.sql |                       ORDER BY l.verify_started_at ASC NULLS FIRST, l.last_seen ASC, l.id) AS src_rank |                       ORDER BY l.last_seen DESC) AS src_rank
 * @mutate supabase/migrations/20260923185332_ops_alert_close_rules_and_fair_verify.sql |       UPDATE public.ops_alert_ledger SET verify_started_at = v_at, updated_at = now() WHERE id = r.id; |       NULL;
 * @mutate supabase/migrations/20260923185332_ops_alert_close_rules_and_fair_verify.sql |             ORDER BY verify_started_at ASC NULLS FIRST, last_seen ASC, id LIMIT 200 |             ORDER BY last_seen DESC LIMIT 200
 * @mutate supabase/migrations/20260923185332_ops_alert_close_rules_and_fair_verify.sql | REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

/** Every definition of public.ops_alert_verify(), in apply order, any dollar tag, comments blanked. */
function definitions(): Array<{ file: string; body: string }> {
  const out: Array<{ file: string; body: string }> = [];
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?ops_alert_verify"?\s*\(\s*\)/gi;
  for (const file of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_]*\$)/);
      if (!tag) continue;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      out.push({ file, body: rest.slice(open, rest.indexOf(tag[1], open)) });
    }
  }
  return out;
}
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Q291: ops_alert_verify is fair under volume", () => {
  const defs = definitions();
  const newest = defs[defs.length - 1];
  const b = ws(newest?.body ?? "");
  const sqlLoop = b.slice(0, b.indexOf("verify_kind = 'companions'"));
  const compLoop = b.slice(b.indexOf("verify_kind = 'companions'"));

  it("reads the history (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(defs.length).toBeGreaterThan(2);
    expect(newest.file >= "20260923185332", newest.file).toBe(true);
  });

  it("ranks sql_condition items within their source, least recently asked first", () => {
    expect(sqlLoop).toContain(
      "row_number() OVER ( PARTITION BY coalesce(l.verify_ref, l.source) ORDER BY l.verify_started_at ASC NULLS FIRST, l.last_seen ASC, l.id) AS src_rank",
    );
    expect(sqlLoop).toMatch(/WHERE l\.status <> 'closed' AND l\.verify_kind = 'sql_condition'\) x ORDER BY x\.src_rank, x\.verify_started_at ASC NULLS FIRST, x\.last_seen ASC, x\.id LIMIT \d+ LOOP/);
  });

  it("every ask stamps verify_started_at, 'could not tell' included", () => {
    expect(sqlLoop).toMatch(/ELSE UPDATE public\.ops_alert_ledger SET verify_started_at = v_at, updated_at = now\(\) WHERE id = r\.id; v_unknown := v_unknown \+ 1; END IF;/);
    expect(compLoop).toMatch(/ORDER BY verify_started_at ASC NULLS FIRST, last_seen ASC, id LIMIT \d+ LOOP/);
    expect(compLoop).toMatch(/ELSE UPDATE public\.ops_alert_ledger SET verify_started_at = v_at, updated_at = now\(\) WHERE id = r\.id; END IF; END LOOP;/);
  });

  it("nothing is ordered newest-first any more", () => {
    expect(b).not.toMatch(/ORDER BY (?:\w+\.)?last_seen DESC/i);
  });

  it("restated from the newest body: the fold and both close paths are kept", () => {
    expect(b).toContain("v_folded := public.ops_alert_fold_pending();");
    expect(b).toContain("v_still := public.ops_alert_condition(coalesce(r.verify_ref, r.source), r.sample_ref, r.last_seen, false);");
    expect(b).toContain("WHERE id = r.id AND last_seen = r.last_seen AND status <> 'closed';");
    expect(b).toMatch(/IF v_comp > 0 AND v_comp_open = 0 THEN/);
  });

  it("grants stay service_role only", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, newest.file), "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.ops_alert_verify() TO service_role;");
    for (const f of files.filter((x) => x >= newest.file)) {
      const s = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
      expect(s, f).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.ops_alert_verify\(\)\s+TO\s+(?:PUBLIC|anon|authenticated)/i);
    }
  });
});
