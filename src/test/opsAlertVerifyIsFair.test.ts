/**
 * GUARD (docs/OPEN.md Q291): ops_alert_verify re-asks a bounded batch of open
 * items per run, so the batch must be taken least-recently-asked first, and
 * every ask must stamp verify_started_at — otherwise a burst of fresh items
 * (or items that can never be answered) starves an old money alert forever.
 *
 * Reads the NEWEST migration that defines ops_alert_verify(): every LIMITed
 * loop orders by verify_started_at NULLS FIRST, and the "could not ask" branch
 * stamps. Behaviour is proven in src/test/pglite/opsAlertVerifyFair.pglite.mjs
 * (ALL PASS on the fix; 3 FAIL with OLD=1, the 20260923050059 verifier).
 *
 * @mutate supabase/migrations/20260924005818_ops_alert_verify_is_fair.sql | WHERE status <> 'closed' AND verify_kind = 'sql_condition'\n            ORDER BY verify_started_at ASC NULLS FIRST, last_seen DESC LIMIT 200 | WHERE status <> 'closed' AND verify_kind = 'sql_condition'\n            ORDER BY last_seen DESC LIMIT 200
 * @mutate supabase/migrations/20260924005818_ops_alert_verify_is_fair.sql | WHERE status <> 'closed' AND verify_kind = 'companions'\n            ORDER BY verify_started_at ASC NULLS FIRST, last_seen DESC LIMIT 200 | WHERE status <> 'closed' AND verify_kind = 'companions'\n            ORDER BY last_seen DESC LIMIT 200
 * @mutate supabase/migrations/20260924005818_ops_alert_verify_is_fair.sql | UPDATE public.ops_alert_ledger SET verify_started_at = v_at, updated_at = now()\n       WHERE id = r.id AND verify_started_at IS DISTINCT FROM v_at;\n      v_unknown | v_unknown
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "../../supabase/migrations");
const newest = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /CREATE OR REPLACE FUNCTION public\.ops_alert_verify\(\)/.test(readFileSync(join(DIR, f), "utf8")))
  .pop()!;
const src = readFileSync(join(DIR, newest), "utf8");
const body = src.slice(src.indexOf("FUNCTION public.ops_alert_verify()"), src.indexOf("REVOKE ALL ON FUNCTION public.ops_alert_verify()"));

describe("ops_alert_verify is fair under volume (Q291)", () => {
  it("every bounded loop takes the least-recently-asked items first", () => {
    const loops = [...body.matchAll(/FOR r IN SELECT[\s\S]*?LOOP/g)].map((m) => m[0]);
    expect(loops.length).toBeGreaterThan(0);
    for (const l of loops.filter((x) => /LIMIT/.test(x))) {
      expect(l, `${newest}: ${l}`).toMatch(/ORDER BY verify_started_at ASC NULLS FIRST/);
    }
  });

  it("the could-not-ask branch still stamps verify_started_at", () => {
    const unknown = body.slice(body.lastIndexOf("ELSE", body.indexOf("v_unknown := v_unknown + 1")), body.indexOf("v_unknown := v_unknown + 1"));
    expect(unknown, newest).toMatch(/verify_started_at = v_at/);
  });
});
