// @mutate supabase/migrations/20260923130457_remove_bond_credential_type.sql | IF p_user_id IS NULL OR p_type IS NULL OR p_path IS NULL THEN | IF p_user_id IS NULL OR p_path IS NULL THEN
// @mutate supabase/migrations/20260923123701_null_argument_never_allows.sql | IF p_user_id IS NULL OR p_kind IS NULL OR p_path IS NULL THEN | IF p_user_id IS NULL OR p_path IS NULL THEN
// @mutate supabase/migrations/20260923123701_null_argument_never_allows.sql |   SELECT p_user_id IS NOT NULL\n     AND (SELECT count(*) < 3 |   SELECT true\n     AND (SELECT count(*) < 3
// @mutate supabase/migrations/20260923123701_null_argument_never_allows.sql | p_idv_status IS NOT DISTINCT FROM 'verified' | p_idv_status = 'verified'
// @mutate supabase/migrations/20260923123701_null_argument_never_allows.sql |   ), false);\n$fn$; |   ), NULL);\n$fn$;
// @mutate scripts/ci/null-arg-validators.sql |   ('job_is_funded',                 NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),\n |
// @mutate scripts/ci/null-arg-validators.sql |   ('has_role',                      'allow', |   ('has_role',                      'deny',
// @mutate scripts/ci/null-arg-validators.sql |   ('is_seed_email',                 'classify', 'labels an address as a seed account'),\n |
// @mutate scripts/ci/null-arg-validators.sql | IF res IS DISTINCT FROM false THEN | IF res IS TRUE THEN
// @mutate scripts/ci/null-arg-validators.sql | \nROLLBACK;\n | \nCOMMIT;\n
// @mutate .github/workflows/db-smoke.yml | -At -f scripts/ci/null-arg-validators.sql) | -At -f scripts/ci/null-uid-trust.sql)
// @mutate .github/workflows/db-deploy.yml |       - "scripts/ci/null-arg-validators.sql"\n |
// @mutate src/test/pglite/nullArgNeverAllows.pglite.mjs |   "user_may_see_job_address", "is_crew_member_of_job_folder"]; |   "is_crew_member_of_job_folder"];
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q140 (docs/OPEN.md): a NULL argument never makes an allow/validity check say
 * yes.
 *
 * Before (prod, measured 2026-09-23 by calling each function live with NULL for
 * each argument against an otherwise-allowed tuple): helper_credential_document_ok
 * and credential_document_path_ok returned TRUE for another member's real
 * document with the kind NULL (an IF-guard chain plpgsql skips on NULL);
 * check_dispute_velocity(NULL) = TRUE; identity_is_verified(NULL, false) = NULL;
 * job_is_funded(NULL) = NULL. 20260923123701 makes each return exactly false.
 *
 * The BEHAVIOUR is checked by scripts/ci/null-arg-validators.sql, which db-smoke
 * runs on every replay (every public boolean function classified; every `allow`
 * one called on a fixture that makes it TRUE, then with each argument NULL,
 * which must give exactly false). Its PGlite twin
 * src/test/pglite/nullArgNeverAllows.pglite.mjs runs the same file against the
 * newest migration definitions: ALL PASS 17; NEW_MIGRATION=skip -> 6 FAILED,
 * naming exactly the five functions above.
 *
 * This file pins what CI cannot see from the replay alone:
 *   - the classification equals the boolean functions the migrations leave in
 *     public (two-way), and every `allow` function has a NULL case for every
 *     argument (arity read from its newest definition);
 *   - the check counts a NULL result as a failure and never commits its fixture;
 *   - db-smoke runs it and fails on any row, and db-deploy re-runs on its change;
 *   - the five fixed definitions keep their explicit NULL handling (newest
 *     definition, any dollar tag, comments blanked).
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = new Map(files.map((f) => [f, blankSqlComments(readFileSync(join(MIG, f), "utf8"))]));
const ws = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const CHECK = blankSqlComments(read("scripts/ci/null-arg-validators.sql"));
const KINDS = ["allow", "absent", "deny", "classify", "noarg", "action"] as const;
const classRows = [...CHECK.matchAll(/^\s*\('([a-z_0-9]+)',\s*'([a-z]+)',\s*'((?:[^']|'')*)'\)/gm)].map((m) => ({
  fn: m[1],
  kind: m[2],
  why: m[3],
}));
const caseRows = [...CHECK.matchAll(/^\s*\('([a-z_0-9]+)',\s*(NULL|'[0-9a-f-]{36}'),\s*ARRAY\[.*\],\s*ARRAY\[([0-9, ]+)\]\)/gm)].map((m) => ({
  fn: m[1],
  nullAt: m[3].split(",").map((s) => Number(s.trim())),
}));

type Def = { file: string; header: string; params: string[]; body: string };
/** Newest CREATE FUNCTION public.<name>, any dollar tag; null if a later DROP removed it. */
function newestFunction(name: string): Def | null {
  let found: Def | null = null;
  let foundAt = -1;
  let droppedAt = -1;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?"?${name}"?\\s*\\(`, "gi");
  const drop = new RegExp(`DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?"?${name}"?\\s*(?:\\(|;|CASCADE)`, "gi");
  files.forEach((file, fi) => {
    const sql = sqlOf.get(file)!;
    for (const m of sql.matchAll(head)) {
      const start = m.index! + m[0].length;
      let depth = 1;
      let k = start;
      while (k < sql.length && depth > 0) {
        if (sql[k] === "(") depth++;
        else if (sql[k] === ")") depth--;
        k++;
      }
      const paramText = sql.slice(start, k - 1);
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index! + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      const params: string[] = [];
      let cur = "";
      let d = 0;
      for (const ch of paramText) {
        if (ch === "(") d++;
        if (ch === ")") d--;
        if (ch === "," && d === 0) {
          params.push(cur);
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) params.push(cur);
      found = { file, header: ws(rest.slice(0, tag.index!)), params: params.map((p) => ws(p).split(" ")[0]), body: ws(rest.slice(open, close)) };
      foundAt = fi;
    }
    if (drop.test(sql)) droppedAt = fi;
    drop.lastIndex = 0;
  });
  return found && droppedAt <= foundAt ? found : droppedAt > foundAt ? null : found;
}

/** Every function name any migration CREATEs in public. */
const everyName = [
  ...new Set(
    files.flatMap((f) =>
      [...sqlOf.get(f)!.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi)]
        .filter((m) => !/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?!public\.)[a-z_]+\./i.test(m[0]))
        .map((m) => m[1].toLowerCase()),
    ),
  ),
];
const booleanInventory = everyName
  .map((n) => ({ n, d: newestFunction(n) }))
  .filter(({ d }) => d && /\bRETURNS\s+boolean\b/i.test(d.header))
  .map(({ n }) => n)
  .sort();

describe("a NULL argument never makes an allow check say yes (Q140)", () => {
  it("classifies every boolean function the migrations leave in public, exactly", () => {
    // Measured live 2026-09-23: 47 boolean functions in public (pg_proc), the same 47 names.
    expect(booleanInventory.length).toBeGreaterThan(40);
    expect(classRows.length).toBeGreaterThan(40);
    const classified = classRows.map((r) => r.fn).sort();
    expect(new Set(classified).size, "a function classified twice").toBe(classified.length);
    expect(classified.filter((f) => !booleanInventory.includes(f)), "classified but no migration leaves it in public").toEqual([]);
    expect(booleanInventory.filter((f) => !classified.includes(f)), "boolean function with no classification in scripts/ci/null-arg-validators.sql").toEqual([]);
    for (const r of classRows) {
      expect(KINDS as readonly string[], `${r.fn}: unknown kind ${r.kind}`).toContain(r.kind);
      expect(r.why.length, `${r.fn} needs a reason`).toBeGreaterThan(2);
    }
  });

  it("every allow function has a NULL case for every argument, and only allow functions have cases", () => {
    const allow = classRows.filter((r) => r.kind === "allow").map((r) => r.fn);
    expect(allow.length).toBeGreaterThan(15);
    expect(caseRows.length).toBeGreaterThan(15);
    for (const c of caseRows) expect(allow, `${c.fn} has a case but is not classified allow`).toContain(c.fn);
    const missing: string[] = [];
    for (const fn of allow) {
      const def = newestFunction(fn)!;
      expect(def, `${fn}: no definition`).not.toBeNull();
      const covered = new Set(caseRows.filter((c) => c.fn === fn).flatMap((c) => c.nullAt));
      for (let i = 1; i <= def.params.length; i++) if (!covered.has(i)) missing.push(`${fn} argument ${i} (${def.params[i - 1]})`);
      for (const i of covered) expect(i, `${fn}: case NULLs argument ${i} of ${def.params.length}`).toBeLessThanOrEqual(def.params.length);
    }
    expect(missing).toEqual([]);
  });

  it("the check fails on NULL as well as TRUE, and never keeps its fixture", () => {
    const flat = ws(CHECK);
    expect(flat).toContain("IF res IS NOT TRUE THEN INSERT INTO q140_out VALUES (c.fn, 'BASELINE_NOT_TRUE'");
    expect(flat).toContain("IF res IS DISTINCT FROM false THEN INSERT INTO q140_out VALUES (c.fn, 'NULL_ARG_ALLOWS'");
    expect(flat).toMatch(/^\\set ON_ERROR_STOP 1 BEGIN; /);
    expect(flat).toMatch(/ ROLLBACK;$/);
    expect(flat.match(/(?:^|;)\s*COMMIT\s*;/g), "the check must end in ROLLBACK, never COMMIT").toBeNull();
  });

  it("db-smoke runs the check on every replay and fails on any row; its change re-runs the deploy gate", () => {
    const smoke = read(".github/workflows/db-smoke.yml");
    const step = smoke.slice(smoke.indexOf("name: Smoke — no allow check says yes to a NULL argument"));
    expect(step).toMatch(/OUT=\$\(psql -q -v ON_ERROR_STOP=1 -At -f scripts\/ci\/null-arg-validators\.sql\)\n\s+if \[ -n "\$OUT" \]; then[\s\S]{0,600}?exit 1/);
    expect(step.slice(0, step.indexOf("OUT="))).toMatch(/-lt 40 \][\s\S]*exit 1/);
    expect(read(".github/workflows/db-deploy.yml")).toContain('      - "scripts/ci/null-arg-validators.sql"\n');
    expect(smoke).toContain('      - "scripts/ci/null-arg-validators.sql"\n');
  });

  it("the PGlite twin probes exactly the allow list", () => {
    const twin = blankComments(read("src/test/pglite/nullArgNeverAllows.pglite.mjs"));
    const list = twin.match(/const ALLOW = \[([\s\S]*?)\];/)![1];
    const names = [...list.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual(classRows.filter((r) => r.kind === "allow").map((r) => r.fn).sort());
  });

  describe("the five fixed definitions keep their NULL handling (newest definition)", () => {
    it("the plpgsql allow checks open with an IS NULL test of EVERY argument", () => {
      const plpgsqlAllow = classRows
        .filter((r) => r.kind === "allow")
        .map((r) => ({ fn: r.fn, d: newestFunction(r.fn)! }))
        .filter(({ d }) => /LANGUAGE plpgsql/i.test(d.header));
      expect(plpgsqlAllow.map((x) => x.fn).sort()).toEqual(["credential_document_path_ok", "helper_credential_document_ok"]);
      for (const { fn, d } of plpgsqlAllow) {
        const first = d.body.match(/^(?:DECLARE .*?)?BEGIN IF (.+?) THEN RETURN false; END IF;/);
        expect(first, `${fn}: first statement is not IF ... THEN RETURN false`).not.toBeNull();
        const terms = first![1].split(/\s+OR\s+/).map((t) => t.trim());
        for (const p of d.params) expect(terms, `${fn}: ${p} is not tested IS NULL first`).toContain(`${p} IS NULL`);
        expect(d.file >= "20260923123701", `${fn}: newest definition is older than the fix`).toBe(true);
      }
    });
    it("check_dispute_velocity: NULL user is not 'under the limit'", () => {
      const d = newestFunction("check_dispute_velocity")!;
      expect(d.body).toMatch(/^SELECT p_user_id IS NOT NULL AND \(SELECT count\(\*\) < 3 /);
    });
    it("identity_is_verified: never NULL", () => {
      const d = newestFunction("identity_is_verified")!;
      expect(d.body).toBe("SELECT p_idv_status IS NOT DISTINCT FROM 'verified' OR p_stripe_identity_verified IS TRUE;");
    });
    it("job_is_funded: no row / NULL id is false", () => {
      const d = newestFunction("job_is_funded")!;
      expect(d.body).toMatch(/^SELECT COALESCE\(\( SELECT public\.job_payment_is_funded\(j\.payment_status\) FROM public\.jobs j WHERE j\.id = p_job_id \), false\);$/);
    });
  });
});
