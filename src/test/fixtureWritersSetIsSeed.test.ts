/**
 * CLASS GUARD (docs/OPEN.md Q46, fixture-writer half): test data is seed data
 * from birth.
 *
 * THE BUG. E2E, press, prod-audit, journeys, seed scripts and probes write to
 * prod by design (no mock mode). A row born `is_seed = false` counts as a real
 * job / a real person everywhere: admin money figures, alerting detectors,
 * the seed boundary on notifications, the Q65 purge. Measured 2026-09-26
 * (scan of e2e/, scripts/, tools/, api/ at origin/main cac623e3b):
 * 30 insert sites into an is_seed table; 19 set the flag, 11 did not
 * (e2e/journeys/time-travel.spec.ts's job POST, 7 account creations whose
 * profile row is born false, 3 SQL job INSERTs in the localhost-only
 * race-runner). Live, nothing was mis-flagged yet (0 jobs of a
 * seed poster/helper with is_seed = false; 0 fixture-inbox profiles unflagged),
 * because every one of them was patched or derived AFTER birth, and
 * charge-recurring-visits' child jobs were born false with no fix at all.
 *
 * THE CLASS, from the tree:
 *   tables  every table a migration gives an `is_seed` column (newest state)
 *           must be one the scanner covers (SEED_TABLES), and vice versa.
 *   sites   every INSERT-shaped write into one of them in e2e/, scripts/,
 *           tools/, api/ (src/test/helpers/seedWriterScan.ts: REST POSTs,
 *           REST wrappers, supabase-js insert/upsert, SQL INSERT, and account
 *           creation, which inserts the profiles row). PGlite probes are
 *           excluded (they write an in-process database).
 * Each site must SET `is_seed` in code (in the call or in an initializer it
 * names), or carry a `seed-policy:` comment of one of three kinds:
 *   derived by <trigger or function>  — must be a live trigger whose newest
 *                                       function body assigns NEW.is_seed;
 *   patched …                         — the file writes `is_seed: true` after
 *                                       the site;
 *   not prod …                        — only for NOT_PROD_WRITERS below.
 * The database side (20260926040523_seed_flag_derived_at_birth.sql) marks what
 * no writer can: GoTrue-created fixture accounts and service-role jobs of a
 * seed account; PGlite: src/test/pglite/seedPurge.pglite.mjs.
 *
 * RED ON THE ORIGINAL: with the writer files and the birth migration at
 * cac623e3b, 4 of 6 tests fail: "every site" lists the 11 sites above, the
 * floor reads 19 set (< 20), NOT_PROD_WRITERS has no not-prod site, and the
 * database test finds neither trigger.
 *
 * @mutate scripts/audit/prod-seed.mjs | payment_status: "unpaid", is_seed: true }; | payment_status: "unpaid" };
 * @mutate e2e/journeys/time-travel.spec.ts | is_seed: true, | seeded: true,
 * @mutate scripts/ci/race-runner.mjs | if (!["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST | if (![].includes(process.env.PGHOST
 * @mutate scripts/create-app-review-demo-account.mjs | is_seed: true, | seeded: true,
 * @mutate supabase/migrations/20260926040523_seed_flag_derived_at_birth.sql | EXECUTE FUNCTION public.jobs_seed_from_poster(); | EXECUTE FUNCTION public.some_other_fn();
 * @mutate supabase/migrations/20260926040523_seed_flag_derived_at_birth.sql | IF public.is_server_context() AND public.is_fixture_email(NEW.email) THEN\n    NEW.is_seed := true; | IF public.is_server_context() AND public.is_fixture_email(NEW.email) THEN\n    NULL;
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SEED_TABLES, scanSeedWriters, type SeedSite } from "./helpers/seedWriterScan";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");

/** Files whose writes never reach prod, each with the text that proves it. */
const NOT_PROD_WRITERS: Record<string, RegExp> = {
  "scripts/ci/race-runner.mjs": /\["localhost", "127\.0\.0\.1", "::1"\]\.includes\(process\.env\.PGHOST/,
};

// ── migrations (newest state) ──────────────────────────────────────────────
const migFiles = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const migSql = migFiles.map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

function seedColumnTables(): string[] {
  const has = new Map<string, boolean>();
  for (const { sql } of migSql) {
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?(\w+)"?\s+([^;]*)/gi)) {
      if (/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?is_seed"?\b/i.test(m[2])) has.set(m[1].toLowerCase(), true);
      if (/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?is_seed"?\b/i.test(m[2])) has.set(m[1].toLowerCase(), false);
    }
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\);/gi)) {
      if (/(^|[\s,(])"?is_seed"?\s+boolean/i.test(m[2])) has.set(m[1].toLowerCase(), true);
    }
    for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi)) has.set(m[1].toLowerCase(), false);
  }
  return [...has].filter(([, v]) => v).map(([t]) => t).sort();
}

/** Newest body of each public function, any dollar-quote tag. */
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
const fnBody = new Map<string, string>();
for (const { sql } of migSql) for (const m of sql.matchAll(FN_RE)) fnBody.set(m[1].toLowerCase(), m[3]);

/** Live INSERT triggers by name -> the function they run (newest CREATE, minus later DROPs). */
const insertTriggers = new Map<string, { table: string; fn: string }>();
for (const { sql } of migSql) {
  const events: { at: number; apply: () => void }[] = [];
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?\s+BEFORE\s+[^;]*?\bINSERT\b[^;]*?\bON\s+(?:public\.)?"?(\w+)"?[^;]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
    events.push({ at: m.index!, apply: () => insertTriggers.set(m[1].toLowerCase(), { table: m[2].toLowerCase(), fn: m[3].toLowerCase() }) });
  }
  for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?/gi)) {
    events.push({ at: m.index!, apply: () => insertTriggers.delete(m[1].toLowerCase()) });
  }
  events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
}
const assignsIsSeed = (fn: string) => /\bNEW\.is_seed\s*:=\s*(?!OLD\.)/i.test(blankSqlComments(fnBody.get(fn) ?? ""));

/** A trigger (or function) name that marks is_seed on INSERT of `table`. */
function derivesOn(name: string, table: string): boolean {
  const t = insertTriggers.get(name.toLowerCase());
  if (t) return t.table === table && assignsIsSeed(t.fn);
  // a function named directly: some live INSERT trigger on the table must run it
  return [...insertTriggers.values()].some((x) => x.fn === name.toLowerCase() && x.table === table) && assignsIsSeed(name.toLowerCase());
}

// ── the tree ───────────────────────────────────────────────────────────────
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "e2e", "scripts", "tools", "api"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js|cjs|sh)$/.test(f));
const srcOf = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
const sites: SeedSite[] = files.flatMap((f) => scanSeedWriters(f, srcOf.get(f)!));

/** Why a site is not acceptable, or null. */
function verdict(s: SeedSite): string | null {
  if (s.sets) return null;
  if (!s.policy) return "no is_seed and no `seed-policy:` comment";
  const derived = /^derived by\s+(\w+)/i.exec(s.policy);
  if (derived) return derivesOn(derived[1], s.table) ? null : `seed-policy names ${derived[1]}, which is not a live INSERT trigger on ${s.table} that assigns NEW.is_seed`;
  if (/^patched\b/i.test(s.policy)) {
    const raw = srcOf.get(s.file)!;
    const code = s.file.endsWith(".sh") ? raw : blankComments(raw);
    const after = code.split("\n").slice(s.line).join("\n");
    return /["']?is_seed["']?\s*:\s*true/.test(after) ? null : "seed-policy says patched, but the file writes no `is_seed: true` after the site";
  }
  if (/^not prod\b/i.test(s.policy)) {
    const proof = NOT_PROD_WRITERS[s.file];
    return proof && proof.test(blankComments(srcOf.get(s.file)!)) ? null : "seed-policy says not prod, but the file is not a proven non-prod writer (NOT_PROD_WRITERS)";
  }
  return `unknown seed-policy "${s.policy}" (use: derived by <trigger>, patched, not prod)`;
}

describe("every fixture writer sets is_seed at insert time (Q46)", () => {
  it("the scanner covers exactly the tables that carry is_seed (from the migrations)", () => {
    expect(seedColumnTables()).toEqual([...SEED_TABLES].sort());
  });

  it("found the writers (inventory floor, 2026-09-26: 30 sites, 20 set in code, 10 account/sql by policy)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(30);
    expect(sites.filter((s) => s.sets).length).toBeGreaterThanOrEqual(20);
    expect(sites.filter((s) => s.kind === "account").length).toBeGreaterThanOrEqual(7);
    const where = sites.map((s) => s.file);
    for (const f of ["scripts/audit/prod-seed.mjs", "e2e/prod-audit/fundedOpenJob.ts", "e2e/privacy/privacy-requests.spec.ts", "scripts/probes/mint-funded-seed-jobs.prod.mjs", "scripts/ci/race-runner.mjs"]) {
      expect(where, f).toContain(f);
    }
  });

  it("every site sets is_seed in code or declares a valid seed-policy", () => {
    const bad = sites.map((s) => [s, verdict(s)] as const).filter(([, v]) => v).map(([s, v]) => `${s.file}:${s.line} (${s.kind} ${s.table}): ${v}`);
    expect(bad).toEqual([]);
  });

  it("NOT_PROD_WRITERS is two-way: each entry still has a not-prod site", () => {
    const used = new Set(sites.filter((s) => s.policy && /^not prod\b/i.test(s.policy)).map((s) => s.file));
    expect(Object.keys(NOT_PROD_WRITERS).filter((f) => !used.has(f))).toEqual([]);
  });

  it("the database marks what no writer can: fixture accounts and seed-account jobs from the service role", () => {
    expect(derivesOn("trg_profiles_seed_from_fixture_email", "profiles")).toBe(true);
    expect(derivesOn("trg_jobs_seed_from_poster", "jobs")).toBe(true);
    // the signed-in poster's insert: the lock derives it from the account
    expect(derivesOn("trg_jobs_insert_column_lock", "jobs")).toBe(true);
    // every fixture inbox the backfill keyed on is in the email rule
    const rule = blankSqlComments(fnBody.get("is_fixture_email") ?? "");
    for (const inbox of ["%@mailinator.com", "%@helpr.test", "eli.test.%"]) expect(rule).toContain(`'${inbox}'`);
  });

  it("the scanner: catches each write shape, reads through initializers, ignores comments", () => {
    const scan = (src: string) => scanSeedWriters("x.ts", src);
    const post = scan(`await request.post(\`\${U}/rest/v1/jobs?select=id\`, { data: { title: "t" } });`);
    expect(post.map((s) => [s.kind, s.table, s.sets])).toEqual([["rest", "jobs", false]]);
    expect(scan(`await fetch(\`\${U}/rest/v1/jobs\`, { method: "POST", body: JSON.stringify({ is_seed: true }) });`)[0].sets).toBe(true);
    expect(scan(`await fetch(\`\${U}/rest/v1/jobs?id=eq.1\`, { method: "PATCH", body: "{}" });`)).toEqual([]);
    expect(scan(`await srWrite(request, "POST", "jobs", "", { ...base });\nconst base = { is_seed: true };`)[0].sets).toBe(true);
    expect(scan(`const { body } = make();\nfunction make() { return { body: { is_seed: true } }; }\nawait rest("jobs", { method: "POST", body });`)[0].sets).toBe(true);
    expect(scan(`await upsert("profiles", rows);`)[0]).toMatchObject({ kind: "rest", table: "profiles", sets: false });
    expect(scan(`await sb.from("jobs").insert({ title: "x" });`)[0]).toMatchObject({ kind: "js", sets: false });
    expect(scan(`await q("INSERT INTO public.jobs (title) VALUES ('x')");`)[0]).toMatchObject({ kind: "sql", table: "jobs" });
    expect(scan(`await request.post(\`\${U}/auth/v1/admin/users\`, { data: { email } });`)[0]).toMatchObject({ kind: "account", sets: false });
    // a comment that mentions is_seed is not a write that sets it
    expect(scan(`// is_seed: true\nawait request.post(\`\${U}/rest/v1/jobs\`, { data: {} });`)[0].sets).toBe(false);
    expect(scan(`// seed-policy: patched below\nawait request.post(\`\${U}/rest/v1/jobs\`, { data: {} });`)[0].policy).toBe("patched below");
    // PGlite probes write an in-process database
    expect(scan(`import { PGlite } from "@electric-sql/pglite";\nawait db.query("INSERT INTO public.jobs (t) VALUES (1)");`)).toEqual([]);
  });
});
