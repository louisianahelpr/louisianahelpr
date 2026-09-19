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

const RUNNER = readFileSync(resolve(ROOT, "scripts/check-anon-table-grants.mjs"), "utf8");
const PROBE = readFileSync(resolve(ROOT, "scripts/probes/anon-table-grants.probe.mjs"), "utf8");

/** The sensitive allowlist as declared in the check SQL's VALUES list. */
function sensitiveFromCheck(): string[] {
  const block = CHECK_SQL.match(/sensitive\(tbl\) AS \(([\s\S]*?)\n\),/)?.[1] ?? "";
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// @mutate scripts/ci/sensitive-anon-grants.sql | FROM zero_policy_offenders\nUNION ALL | FROM write_offenders\nUNION ALL
// @mutate scripts/ci/sensitive-anon-grants.sql | unnest(ARRAY['anon', 'authenticated']) AS r(role) | unnest(ARRAY['anon']) AS r(role)
// @mutate scripts/ci/sensitive-anon-grants.sql | COALESCE(pc.n, 0) = 0 | COALESCE(pc.n, 0) >= 0

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

  /**
   * THE THIRD RULE, and the reason the other two are no longer the whole story.
   *
   * `sensitive(tbl)` is a hand-written VALUES list, so the check could only
   * ever look at fourteen tables plus `jobs`. It therefore never looked at
   * `notification_dedupe_suppressions`, which was found LIVE on prod
   * (fncmgoasalhdgfwzhsqa, 2026-09-19) with RLS on, ZERO policies, and anon
   * SELECT plus authenticated SELECT+INSERT. Not exploitable while RLS denies
   * everything — which is exactly what a missing SECOND line of defence looks
   * like: one `USING (true)` policy turns it into a live anonymous read of who
   * was sent what.
   *
   * The zero-policy rule is DERIVED FROM THE CATALOG: every table with RLS on
   * and no policy at all must hold no client grant, for either client role, on
   * any of the four commands. There is no list to fall behind. The live red
   * (8 rows on prod, both roles × four privileges) and the green after the
   * revoke are proven in real Postgres by
   * scripts/probes/anon-table-grants.probe.mjs; this asserts the shape so the
   * rule cannot be quietly unhooked from the result.
   */
  describe("the zero-policy rule is derived from the catalog, not from a list", () => {
    it("asks the catalog which tables have no policy", () => {
      expect(CHECK_SQL).toMatch(/no_policy AS \(/);
      // The definition of "no policy": a LEFT JOIN onto the policy counts that
      // comes back zero. If this became an inner join the rule would silently
      // only ever look at tables that DO have policies.
      expect(CHECK_SQL).toMatch(/LEFT JOIN policy_counts/);
      expect(CHECK_SQL).toMatch(/COALESCE\(pc\.n, 0\) = 0/);
      expect(CHECK_SQL).toContain("FROM pg_policies GROUP BY 1, 2");
      // …and no table name appears in the rule. A name here would be the
      // allowlist growing back.
      // Comments stripped first: the exception CTE's doc comment shows the
      // FORMAT of an entry (`('some_table', 'why …')`), which a naive scan
      // reads as the rule naming a table.
      const rule = CHECK_SQL.slice(CHECK_SQL.indexOf("no_policy AS ("), CHECK_SQL.indexOf("stale_exceptions AS ("))
        .replace(/^\s*--.*$/gm, "");
      expect(
        [...rule.matchAll(/'([a-z_]{4,})'/g)].map((m) => m[1]).filter((w) => !["anon", "authenticated", "public", "select", "insert", "update", "delete", "zero-policy:client-grant"].includes(w)),
        "the zero-policy rule names specific tables — that is the allowlist growing back",
      ).toEqual([]);
    });

    it("covers BOTH client roles and all four commands", () => {
      expect(
        CHECK_SQL,
        "authenticated must be checked too: notification_dedupe_suppressions held " +
          "authenticated SELECT+INSERT, and an anon-only rule would have reported it half-clean.",
      ).toMatch(/unnest\(ARRAY\['anon', 'authenticated'\]\) AS r\(role\)/);
      expect(CHECK_SQL).toMatch(/unnest\(ARRAY\['SELECT', 'INSERT', 'UPDATE', 'DELETE'\]\) AS p\(priv\)/);
      // Column-level grants count too, but has_any_column_privilege has no
      // DELETE form and raises on one — the guard must stay.
      expect(CHECK_SQL).toMatch(/p\.priv IN \('SELECT', 'INSERT', 'UPDATE'\) AND has_any_column_privilege\(r\.role/);
    });

    it("is actually unioned into the result", () => {
      // The rule can be perfectly written and report nothing if it is not in
      // the final SELECT. That is a one-line edit away at all times.
      expect(CHECK_SQL).toMatch(/FROM zero_policy_offenders\s*\nUNION ALL/);
      expect(CHECK_SQL).toMatch(/FROM stale_exceptions\s*\nORDER BY/);
      expect(CHECK_SQL).toContain("'zero-policy:client-grant'");
    });

    it("its exception list is empty, and cannot rot if it is ever used", () => {
      const block = CHECK_SQL.match(/zero_policy_exempt\(tbl, why\) AS \(([\s\S]*?)\n\),/)?.[1] ?? "";
      expect(block, "zero_policy_exempt must exist as a real relation").not.toBe("");
      // Every declared exception is a (table, why) pair — no reasonless entries.
      const entries = [...block.matchAll(/\('([a-z_]+)'\s*,\s*'([^']+)'\)/g)];
      for (const [, tbl, why] of entries) {
        expect(why.length, `the exception for ${tbl} carries no reason`).toBeGreaterThan(10);
      }
      // …and a declared exception that stops describing a real offender is
      // ITSELF reported, which is what stops the list rotting into an excuse.
      expect(CHECK_SQL).toMatch(/stale_exceptions AS \(/);
      expect(CHECK_SQL).toContain("'stale-exception:zero-policy'");
      expect(CHECK_SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM zero_policy_grants g WHERE g\.tbl = e\.tbl\)/);
    });

    it("the runner reports the ROLE, not a hardcoded anon", () => {
      // Offender rows now carry `authenticated` too. The old message said
      // "anon holds <priv>" for every row, which would have described a live
      // authenticated grant as an anon one.
      expect(RUNNER).toContain("${o.role} holds ${o.priv}");
      expect(RUNNER).toContain("stale-exception:zero-policy");
      // --self-test must be able to fail on the NEW rule too.
      expect(RUNNER).toContain('rule: "zero-policy:client-grant"');
    });

    it("the PGlite probe proves this rule red AND green, on both sides", () => {
      // Parity: the probe is the only place the rule is exercised against real
      // Postgres. A rule added here and never probed is a rule nobody has seen
      // fail.
      expect(PROBE).toContain("zero-policy:client-grant");
      // The positive fixture (a policy-less table WITH client grants)…
      expect(PROBE).toContain("CREATE TABLE public.notification_dedupe_suppressions");
      // …and the negative control (policy-less, no client grant) — without it
      // the rule could be "every table with no policy is an offender" and the
      // probe would not notice.
      expect(PROBE).toContain("CREATE TABLE public.edge_rate_limit_log");
      expect(PROBE).toMatch(/a policy-less table with NO client grant is NOT flagged/);
    });
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
