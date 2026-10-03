// Q838: the live detector stops reading disabled gates as on.
// @mutate scripts/ci/unconfirmed-email-gate.sql |     OR g.tgenabled::text NOT IN ('O', 'A') |     OR false
// Q838: the live detector exempts one more table than Q807 does.
// @mutate scripts/ci/unconfirmed-email-gate.sql |   VALUES ('analytics_events'), ('error_logs') |   VALUES ('analytics_events'), ('error_logs'), ('jobs')
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q838: EVERY PUBLIC TABLE KEEPS AN ENABLED EMAIL GATE, CHECKED LIVE.
 *
 * Q807 (20260927234313) puts zz_refuse_unconfirmed_email_write on every public
 * table but the two anon-writable telemetry tables, and
 * src/test/unconfirmedEmailWritesRefused.test.ts proves the MIGRATIONS do. It
 * cannot see a table made in the dashboard or inside DO/EXECUTE format(), or a
 * gate disabled outside a migration. scripts/ci/unconfirmed-email-gate.sql
 * reads the catalog: run live by scripts/check-live-privileges.mjs after every
 * db-deploy and nightly (db-drift-detect), and on the replayed schema by
 * db-smoke. This file pins that the detector and Q807 agree on WHICH tables
 * are gated (two-way), that "enabled" means fires-in-normal-operation, and
 * that both runners still run it. Behaviour:
 * src/test/pglite/unconfirmedEmailGateLive.pglite.mjs (ALL PASS: clean on
 * Q807's state; a missing, disabled, replica-only, INSERT-only and
 * wrong-function gate each flagged).
 */

const ROOT = resolve(__dirname, "../..");
const SQL = blankSqlComments(readFileSync(join(ROOT, "scripts/ci/unconfirmed-email-gate.sql"), "utf8"));
const MIG = join(ROOT, "supabase", "migrations");

/** Newest attach_unconfirmed_email_gate() body (comments blanked). */
function attachBody(): string {
  let body = "";
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    const at = sql.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.attach_unconfirmed_email_gate\s*\(/i);
    if (at < 0) continue;
    const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(at))![1];
    const open = sql.indexOf(tag, at);
    body = sql.slice(at, sql.indexOf(tag, open + tag.length));
  }
  return body;
}

const names = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();

describe("Q838: every public table keeps an enabled email gate (live detector)", () => {
  const attach = attachBody();

  it("the inventory is real", () => {
    expect(attach, "attach_unconfirmed_email_gate() not found in the migrations").toMatch(/zz_refuse_unconfirmed_email_write/);
    expect(SQL).toMatch(/tgname\s*=\s*'zz_refuse_unconfirmed_email_write'/);
  });

  it("the detector exempts exactly the tables Q807 leaves ungated (two-way)", () => {
    const q807 = names(/c\.relname\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(attach)?.[1] ?? "");
    const live = names(/gate_exempt\s*\(\s*tbl\s*\)\s*AS\s*\(\s*VALUES\s*([\s\S]*?)\)\s*,\s*tables/i.exec(SQL)?.[1] ?? "");
    expect(q807.length).toBeGreaterThan(0);
    expect(live).toEqual(q807);
    // ...and both scan the same relkinds.
    expect(/c\.relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*\)/i.test(attach)).toBe(true);
    expect(/c\.relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*\)/i.test(SQL)).toBe(true);
  });

  it("'enabled' means fires in normal operation, the right function, on INSERT, UPDATE and DELETE", () => {
    expect(SQL).toMatch(/tgenabled::text\s+NOT\s+IN\s*\(\s*'O'\s*,\s*'A'\s*\)/);
    expect(SQL).toMatch(/to_regprocedure\('public\.refuse_unconfirmed_email_write\(\)'\)/);
    expect(SQL).toMatch(/\(g\.tgtype::int\s*&\s*28\)\s*<>\s*28/);
  });

  it("it runs live after every db-deploy and nightly, and on the replayed schema", () => {
    expect(readFileSync(join(ROOT, "scripts/check-live-privileges.mjs"), "utf8")).toContain(`load("./ci/unconfirmed-email-gate.sql")`);
    expect(readFileSync(join(ROOT, ".github/workflows/db-smoke.yml"), "utf8")).toContain("-f scripts/ci/unconfirmed-email-gate.sql");
  });
});
