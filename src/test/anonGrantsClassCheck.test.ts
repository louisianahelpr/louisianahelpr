import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Parity + shape guard for the excess-anon-grant class (H-004 + AUTHZ-02,
 * 2026-09-15). The live red/green PROOF is the PGlite probe
 * scripts/probes/anon-table-grants.probe.mjs; this fast test stops the migration
 * and its class check from drifting apart, and stops the check SQL from silently
 * losing its shape.
 *
 * The class check itself (scripts/ci/sensitive-anon-grants.sql, run live by
 * scripts/check-anon-table-grants.mjs) is what enforces the grant is gone: prod's
 * default privileges re-open it on any CREATE TABLE, so the one-off REVOKE in the
 * migration cannot be the guarantee.
 */
const ROOT = resolve(__dirname, "../..");
const CHECK_SQL = readFileSync(resolve(ROOT, "scripts/ci/sensitive-anon-grants.sql"), "utf8");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const MIG = readFileSync(
  resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.endsWith("_revoke_excess_anon_grants.sql"))!),
  "utf8",
);

/** The sensitive allowlist as declared in the check SQL's VALUES list. */
function sensitiveFromCheck(): string[] {
  const block = CHECK_SQL.match(/sensitive\(tbl\) AS \(([\s\S]*?)\n\),/)?.[1] ?? "";
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("excess-anon-grant class check ↔ migration parity", () => {
  const sensitive = sensitiveFromCheck();

  it("the check declares the 14 sensitive tables the finding named", () => {
    expect(sensitive.length).toBe(14);
    // A spot-check of the highest-sensitivity ones — full list is the source.
    for (const t of ["admin_audit_log", "payout_transfers", "fraud_flags", "user_bans", "gift_cards"]) {
      expect(sensitive, `${t} must be on the sensitive allowlist`).toContain(t);
    }
  });

  it("every sensitive table is revoked in the migration (no read-check-only drift)", () => {
    for (const t of sensitive) {
      expect(MIG.includes(`'${t}'`), `${t} is checked but not named in the migration`).toBe(true);
    }
  });

  it("the migration strips ALL anon+PUBLIC privileges on public.jobs (H-004)", () => {
    expect(MIG).toMatch(/REVOKE ALL ON public\.jobs FROM anon\s*;/);
    expect(MIG).toMatch(/REVOKE ALL ON public\.jobs FROM PUBLIC\s*;/);
  });

  it("the two telemetry tables keep anon INSERT (SELECT/UPDATE/DELETE only revoked)", () => {
    // They must NOT be swept up in a blanket REVOKE ALL, or signed-out analytics
    // and error logging break.
    for (const t of ["analytics_events", "error_logs"]) {
      expect(sensitive).toContain(t);
      expect(MIG).toMatch(/REVOKE SELECT, UPDATE, DELETE ON public\.%I FROM anon/);
      expect(MIG.includes(`REVOKE ALL ON public.${t}`)).toBe(false);
    }
  });

  it("the write rule is scoped to jobs + the sensitive set, and reads the policy table", () => {
    expect(CHECK_SQL).toMatch(/write_scope\(tbl\) AS \(/);
    expect(CHECK_SQL).toContain("SELECT 'jobs'");
    // The whole point of H-004: a grant is only an offender when NO anon/public
    // policy backs that command — this is what keeps analytics_events clean.
    expect(CHECK_SQL).toContain("pg_policies");
    expect(CHECK_SQL).toMatch(/'anon' = ANY\(pol\.roles\) OR 'public' = ANY\(pol\.roles\)/);
  });

  it("the check SQL is a single statement (the shared-query contract)", () => {
    const bare = CHECK_SQL.replace(/--[^\n]*\n/g, "\n").trim().replace(/;\s*$/, "");
    expect(bare.includes(";"), "sensitive-anon-grants.sql must be one SELECT, no inner semicolons").toBe(false);
  });

  it("names no privilege the PG15 replay gate cannot parse (MAINTAIN)", () => {
    // Belt-and-braces with migrationPrivilegeKeywords: MAINTAIN in a REVOKE is
    // the 2026-09-15 trap. It may appear only inside a comment or string.
    for (const [name, sql] of [["migration", MIG], ["check", CHECK_SQL]] as const) {
      const offending = sql
        .split("\n")
        .filter((l) => !l.trim().startsWith("--") && /\bMAINTAIN\b/i.test(l) && !/'[^']*\bMAINTAIN\b[^']*'/i.test(l));
      expect(offending, `${name} names a bare MAINTAIN`).toEqual([]);
    }
  });
});
