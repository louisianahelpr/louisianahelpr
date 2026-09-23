// @mutate supabase/migrations/20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql | IF v_repeats > v_repeat_cap THEN\n      RETURN NULL; | IF false THEN\n      RETURN NULL;
// @mutate supabase/migrations/20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql | v_repeat_cap := CASE WHEN p_user_id IS NULL THEN 20 ELSE 5 END; | v_repeat_cap := CASE WHEN p_user_id IS NULL THEN 2000 ELSE 500 END;
// @mutate supabase/migrations/20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql | = v_norm\n         LIMIT v_repeat_cap + 1) x;\n    END IF;\n    IF v_repeats | IS NOT NULL\n         LIMIT v_repeat_cap + 1) x;\n    END IF;\n    IF v_repeats
// @mutate supabase/migrations/20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql | \n                   AND coalesce(p_tags ->> 'origin', '') <> 'client' THEN |  THEN
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Q96 + Q97 (docs/OPEN.md), from the authz review of the Q39 path
 * error_logs -> ops_alert_ledger (source_kind 'user-error-screen').
 *
 * Q96: a REPEAT of a known error screen must bump the ledger only up to a cap
 *   per account per fingerprint per hour (5; guests share 20), or one account
 *   looping POST /rest/v1/error_logs grows the item without bound. The close
 *   rule must stay uncapped (it re-asks error_logs), so genuine recurrence
 *   keeps the item open.
 * Q97: error_log_is_seed must NOT trust tags.seed / a '-seed' source on a
 *   client-origin row (a real account could hide its own error screens);
 *   seed status for a client row comes from profiles.is_seed.
 *
 * Reads the NEWEST definition of each function across all migrations (any
 * dollar-quote tag; SQL comments stripped). Behaviour is proven in
 * src/test/pglite/userErrorScreenRepeatCap.pglite.mjs (green on the fix,
 * 10 FAILs on the unfixed chain with NEW_MIGRATION=skip).
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");

function newestFunction(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  for (const file of files) {
    const sql = readFileSync(join(MIG, file), "utf8");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
      if (!tag) continue;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      const close = rest.indexOf(tag[1], open);
      found = { file, body: stripSqlComments(rest.slice(open, close)) };
    }
  }
  return found;
}
const ws = (s: string) => s.replace(/\s+/g, " ");

describe("user-error-screen ledger abuse caps (Q96, Q97)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  describe("Q96: repeats of a known screen are capped per account", () => {
    const f = newestFunction("ops_alert_record_user_error_screen");
    const b = ws(f?.body ?? "");

    it("the newest definition exists", () => {
      expect(f, "public.ops_alert_record_user_error_screen is defined by a migration").not.toBeNull();
    });

    it("the repeat cap lives in the EXISTING-item branch and returns before ops_alert_record", () => {
      const newItemCheck = b.indexOf("IF NOT EXISTS (SELECT 1 FROM public.ops_alert_ledger");
      const elseAt = b.indexOf(" ELSE ", b.indexOf("IF v_screens > 5 OR v_new_in_hour >= 20 THEN"));
      const capAt = b.search(/IF v_repeats > v_repeat_cap THEN RETURN NULL;/);
      const lastRecord = b.lastIndexOf("RETURN public.ops_alert_record(");
      expect(newItemCheck, `${f?.file}: new-item check missing`).toBeGreaterThan(-1);
      expect(elseAt, `${f?.file}: no ELSE (existing item) branch after the new-item caps`).toBeGreaterThan(newItemCheck);
      expect(capAt, `${f?.file}: over the repeat cap must RETURN NULL (no ledger bump)`).toBeGreaterThan(elseAt);
      expect(capAt).toBeLessThan(lastRecord);
    });

    it("the caps mirror the new-item caps: 5 per signed-in account, 20 shared by guests", () => {
      const m = b.match(/v_repeat_cap := CASE WHEN p_user_id IS NULL THEN (\d+) ELSE (\d+) END;/);
      expect(m, `${f?.file}: v_repeat_cap assignment not found`).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(20);
      expect(Number(m![2])).toBeLessThanOrEqual(5);
    });

    it("both counts are per fingerprint (normalised screen+message = v_norm), per account / guest, per hour, bounded", () => {
      const counts = [...b.matchAll(/SELECT count\(\*\) INTO v_repeats FROM \((.*?)\) x;/g)].map((m) => m[1]);
      expect(counts.length, `${f?.file}: expected a guest and an account repeat count`).toBe(2);
      expect(counts.some((c) => c.includes("e.user_id IS NULL"))).toBe(true);
      expect(counts.some((c) => c.includes("e.user_id = p_user_id"))).toBe(true);
      for (const c of counts) {
        expect(c).toContain("public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message)) = v_norm");
        expect(c).toContain("e.created_at > v_seen - interval '1 hour'");
        expect(c).toContain("public.is_user_error_screen_row(e.tags)");
        expect(c).toMatch(/LIMIT v_repeat_cap \+ 1$/);
      }
    });

    it("the close rule is NOT capped: it still re-asks error_logs for a real row in 24h", () => {
      const c = ws(newestFunction("ops_alert_condition")?.body ?? "");
      const at = c.indexOf("p_source = 'user-error-screen'");
      expect(at).toBeGreaterThan(-1);
      const branch = c.slice(at);
      expect(branch).toContain("FROM public.error_logs e WHERE e.created_at > now() - interval '24 hours'");
      expect(branch).not.toContain("v_repeat");
    });

    it("the trigger still swallows failures (the error_logs write never fails)", () => {
      const t = ws(newestFunction("ops_alert_ledger_from_user_error_screen")?.body ?? "");
      expect(t).toMatch(/PERFORM public\.ops_alert_record_user_error_screen\(.*EXCEPTION WHEN OTHERS THEN RAISE WARNING/);
    });
  });

  describe("Q97: a client's seed tag is not trusted", () => {
    it("error_log_is_seed reads the seed tags only for non-client rows", () => {
      const f = newestFunction("error_log_is_seed");
      expect(f).not.toBeNull();
      const b = ws(f!.body);
      const gate = b.search(/coalesce\(p_tags ->> 'origin', ''\) (<>|IS DISTINCT FROM) 'client' THEN/);
      expect(gate, `${f!.file}: error_log_is_seed trusts tags.seed on client rows`).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(b.indexOf("p_tags ->> 'seed'"));
      expect(b).toMatch(/ELSE false END/);
    });

    it("a client row's seed status comes from profiles.is_seed for its user_id", () => {
      const b = ws(newestFunction("user_error_screen_is_real")?.body ?? "");
      expect(b).toContain("p.user_id = p_user_id");
      expect(b).toContain("p.is_seed IS TRUE");
    });
  });
});
