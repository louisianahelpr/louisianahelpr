import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q281 parity guard: a banned account is refused on every client write path
 * except a reasoned exemption.
 *
 * The LIVE enforcement is scripts/ci/ban-gate-coverage.sql, run against prod by
 * scripts/check-ban-gate-coverage.mjs after every db-deploy and nightly in
 * db-drift-detect; its red/green proof in real Postgres is
 * scripts/probes/ban-gate-coverage.probe.mjs (RED 43 ungated tables + storage +
 * the missing same-transaction carve-out on prod's pre-Q281 shape, GREEN after
 * the migration 3x, the 3rd-strike rollback RED on the old gate and fixed on
 * the new, 13 planted defects each RED).
 *
 * This fast test is the part CI runs on every push. It ties three things to
 * prod's measured inventory (scripts/probes/fixtures/ban-gate-inventory.live.json,
 * a read-only catalog snapshot taken 2026-09-23, before the migration):
 *   every writable (table, command) = pre-existing gate + the migration's new
 *   gate + an exemption, with no overlap and nothing left over; and every
 *   authenticated-EXECUTE VOLATILE RPC is exempt with a reason, and no
 *   exemption names an RPC prod does not have. Both directions, so neither an
 *   unclassified write nor a stale exemption survives.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const CHECK = blankSqlComments(read("scripts/ci/ban-gate-coverage.sql"));
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const MIG_FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith("_ban_enforcement_everywhere.sql"))!;
const MIG = blankSqlComments(readFileSync(resolve(MIGRATIONS, MIG_FILE), "utf8"));
const SNAP = JSON.parse(read("scripts/probes/fixtures/ban-gate-inventory.live.json")) as {
  writable: { tbl: string; op: string }[];
  gated: { tbl: string; op: string; tgname: string; proname: string }[];
  rpcs: string[];
  captured: string;
};
const RUNNER = read("scripts/check-ban-gate-coverage.mjs");
const PROBE = read("scripts/probes/ban-gate-coverage.probe.mjs");

function block(name: string): string {
  const m = CHECK.match(new RegExp(`${name}\\([^)]*\\) AS \\(\\s*VALUES([\\s\\S]*?)\\n\\),`));
  return m?.[1] ?? "";
}
const tableExempt = [...block("table_exempt").matchAll(/\('([a-z0-9_]+)',\s*'(INSERT|UPDATE|DELETE)',\s*'([^']+)'\)/g)].map(
  ([, tbl, op, why]) => ({ key: `${tbl}:${op}`, why }),
);
const rpcExempt = [...block("rpc_exempt").matchAll(/\('([a-z0-9_]+)',\s*'([^']+)'\)/g)].map(([, fn, why]) => ({ fn, why }));
const migGated = [...(MIG.match(/FOREACH v_pair IN ARRAY ARRAY\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/'([a-z0-9_]+:(?:INSERT|UPDATE|DELETE))'/g)].map(
  (m) => m[1],
);

// @mutate supabase/migrations/20260923185224_ban_enforcement_everywhere.sql | 'messages:UPDATE', 'messages:DELETE', | 'messages:UPDATE',
// @mutate scripts/ci/ban-gate-coverage.sql | ('reports', 'INSERT', 'a banned user can still be a victim; admins see the reporter is banned when triaging'), |
// @mutate scripts/ci/ban-gate-coverage.sql | ('toggle_thread_mute', 'muting is protective and only reduces what the account is sent'), |
// @mutate scripts/ci/ban-gate-coverage.sql | UNION ALL SELECT rule, object, detail FROM stale_rpc | UNION ALL SELECT rule, object, detail FROM rpc_offenders WHERE false
// @mutate supabase/migrations/20260923185224_ban_enforcement_everywhere.sql | IF TG_OP = 'DELETE' THEN | IF false THEN
// @mutate supabase/migrations/20260923185224_ban_enforcement_everywhere.sql |      AND current_setting('app.ban_started_in_txn', true) IS DISTINCT FROM auth.uid()::text THEN\n    RAISE EXCEPTION 'account_restricted' |  THEN\n    RAISE EXCEPTION 'account_restricted'
// @mutate scripts/ci/ban-gate-coverage.sql | UNION ALL SELECT rule, object, detail FROM auth_ban_set\n |
// @mutate scripts/ci/ban-gate-coverage.sql |   ('rpc_settle_dispute_without_payment', 'admin-only (body checks has_role admin)'),\n |
// @mutate supabase/migrations/20260923185224_ban_enforcement_everywhere.sql | NEW.user_id::text, true); | NEW.user_id::text, false);

// RPCs a migration NEWER than the snapshot grants to authenticated, whose
// latest body does not call is_caller_banned(). The snapshot alone could not
// see rpc_settle_dispute_without_payment (20260923205812), so db-deploy went
// red after the push (run 35921603040) instead of CI before it.
const SNAP_VERSION = SNAP.captured.replace(/\D/g, "").slice(0, 14);
function postSnapshotUngatedRpcs(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const lastBody = new Map<string, string>();
  const granted = new Set<string>();
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$[^;]*/gi)) {
      // Whole statement: attributes sit before AS $$ or after the closing $$.
      lastBody.set(m[1], m[0]);
    }
    if (f.slice(0, 14) <= SNAP_VERSION) continue;
    for (const m of sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s+TO\s+([^;]+);/gi)) {
      if (/\bauthenticated\b/i.test(m[2])) granted.add(m[1]);
    }
  }
  // The live check counts VOLATILE functions only; a STABLE/IMMUTABLE one writes nothing.
  const volatile = (fn: string) => !/\b(STABLE|IMMUTABLE)\b/i.test((lastBody.get(fn) ?? "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/, ""));
  return [...granted].filter((fn) => volatile(fn) && !/is_caller_banned\s*\(/.test(lastBody.get(fn) ?? "")).sort();
}

describe("Q281 ban gate: every client write path is gated or exempt with a reason", () => {
  it("parses a real inventory (floors)", () => {
    expect(SNAP.writable.length).toBeGreaterThan(100);
    expect(SNAP.rpcs.length).toBeGreaterThan(40);
    expect(tableExempt.length).toBeGreaterThan(60);
    expect(rpcExempt.length).toBeGreaterThan(40);
    expect(migGated.length).toBeGreaterThan(40);
  });

  it("every writable (table, command) is covered exactly once, and nothing else is listed", () => {
    const writable = new Set(SNAP.writable.map((w) => `${w.tbl}:${w.op}`));
    // Pre-existing gates are the enforce_ban_gate triggers; the old profiles lock
    // only pinned bio/full_name and never called is_caller_banned().
    const preGated = new Set(SNAP.gated.filter((g) => g.proname === "enforce_ban_gate").map((g) => `${g.tbl}:${g.op}`));
    // profiles UPDATE is gated by the rewritten enforce_banned_profile_text_lock,
    // not by a new enforce_ban_gate trigger.
    const newlyGated = new Set([...migGated, "profiles:UPDATE"]);
    const exempt = new Set(tableExempt.map((e) => e.key));

    const seen = new Map<string, string[]>();
    for (const [label, set] of [["pre-gated", preGated], ["migration", newlyGated], ["exempt", exempt]] as const) {
      for (const k of set) seen.set(k, [...(seen.get(k) ?? []), label]);
    }
    const uncovered = [...writable].filter((k) => !seen.has(k));
    const doubled = [...seen].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} (${v.join("+")})`);
    // Pre-existing gates may sit on pairs only definer RPCs write (reviews
    // UPDATE via respond_to_review); what THIS change lists must be writable.
    const extra = [...newlyGated, ...exempt].filter((k) => !writable.has(k));
    expect(uncovered, "writable on prod but neither gated nor exempt").toEqual([]);
    expect(doubled, "listed twice (a gated pair must not also be exempt)").toEqual([]);
    expect(extra, "gated or exempt but not writable by authenticated on prod (stale)").toEqual([]);
  });

  it("the migration adds the Q281 pairs named in docs/OPEN.md", () => {
    for (const k of ["messages:UPDATE", "messages:DELETE", "applications:UPDATE", "applications:DELETE", "referral_codes:INSERT", "helper_w9_records:INSERT"]) {
      expect(migGated, k).toContain(k);
    }
    // Decisions: report and block stay open to a banned account (safety).
    // Q300: a banned account still signs in, so it keeps registering its device.
    for (const k of ["reports:INSERT", "user_blocks:INSERT", "user_blocks:DELETE", "legal_acceptances:INSERT", "push_tokens:INSERT", "push_tokens:UPDATE"]) {
      expect(tableExempt.map((e) => e.key), k).toContain(k);
    }
  });

  it("every live VOLATILE authenticated RPC is exempt with a reason, and no exemption is stale", () => {
    const exempt = new Set(rpcExempt.map((e) => e.fn));
    const universe = new Set([...SNAP.rpcs, ...postSnapshotUngatedRpcs()]);
    expect([...universe].filter((f) => !exempt.has(f)), "RPC with no classification").toEqual([]);
    expect([...exempt].filter((f) => !universe.has(f)), "exemption for an RPC prod does not expose").toEqual([]);
  });

  it("the post-snapshot migration scan reads a real snapshot version", () => {
    expect(SNAP_VERSION).toMatch(/^2026\d{10}$/);
    expect(postSnapshotUngatedRpcs()).toContain("rpc_settle_dispute_without_payment");
  });

  it("every exemption carries a real reason", () => {
    for (const e of [...tableExempt.map((t) => ({ id: t.key, why: t.why })), ...rpcExempt.map((r) => ({ id: r.fn, why: r.why }))]) {
      expect(e.why.length, `${e.id} has no reason`).toBeGreaterThan(12);
    }
  });

  it("the check unions every rule, including both stale-exemption rules", () => {
    for (const cte of ["table_offenders", "stale_table", "rpc_offenders", "stale_rpc", "storage_offenders", "auth_ban_writers", "auth_ban_set", "carveout"]) {
      expect(CHECK, `${cte} is not in the final SELECT`).toMatch(new RegExp(`SELECT rule, object, detail FROM ${cte}\\b`));
    }
    // gated = a BEFORE row trigger whose function calls is_caller_banned(); a
    // trigger function that merely exists is not a gate.
    expect(CHECK).toMatch(/p\.prosrc ILIKE '%is_caller_banned\(\)%'/);
    // column-level grants count (profiles UPDATE is column-granted on prod)
    expect(CHECK).toContain("has_any_column_privilege('authenticated', t.oid, o.op)");
  });

  it("the enforce_ban_gate rewrite returns OLD on DELETE", () => {
    // Returning NEW (NULL) from a BEFORE DELETE trigger cancels the delete for
    // EVERY caller, banned or not.
    expect(MIG).toMatch(/IF TG_OP = 'DELETE' THEN\s+RETURN OLD;/);
  });

  it("a ban started in the request does not roll the request back (the 3rd-strike cancel)", () => {
    // lh-authz-rls on Q281: helper_cancel_booking bans the caller through the
    // ladder and THEN writes jobs/applications; without this carve-out the gate
    // refused those writes and the whole transaction, ban included, rolled back.
    expect(MIG).toMatch(/current_setting\('app\.ban_started_in_txn', true\) IS DISTINCT FROM auth\.uid\(\)::text THEN\s+RAISE EXCEPTION 'account_restricted'/);
    expect(MIG).toMatch(/AFTER UPDATE OF ban_status, auto_suspended_until ON public\.profiles\s+FOR EACH ROW EXECUTE FUNCTION public\.mark_ban_started_in_txn\(\)/);
    // ...the profile lock honours it too, and the marker is TRANSACTION-local:
    // a session-level one would outlive the request on a pooled connection.
    expect(MIG).toMatch(/auth\.uid\(\) = OLD\.user_id AND public\.is_caller_banned\(\)\s+AND current_setting\('app\.ban_started_in_txn', true\) IS DISTINCT FROM auth\.uid\(\)::text THEN/);
    expect(MIG).toContain("PERFORM set_config('app.ban_started_in_txn', NEW.user_id::text, true);");
    expect(CHECK).toMatch(/,\\s\*true\\s\*\\\)/);
    // ...and only when the ban is NEW: an already-banned caller gets no marker.
    expect(MIG).toMatch(/AND NOT \(\s+COALESCE\(OLD\.ban_status, 'active'\) IN/);
  });

  it("nothing sets an Auth-level ban (owner, Q300: a banned account still signs in to delete itself)", () => {
    // The live half is the check's auth-ban:writer / auth-ban:set rules; this is
    // the source half: no edge function, client or migration statement bans at
    // the Auth layer (Admin API ban_duration, or a banned_until write).
    const roots = ["supabase/functions", "src"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (!["node_modules", "test"].includes(e.name)) walk(rel); continue; }
        if (!/\.(ts|tsx|mjs|js)$/.test(e.name) || rel.endsWith("integrations/supabase/types.ts")) continue;
        const code = blankComments(read(rel));
        if (/\bban_duration\b|banned_until\s*[:=]/.test(code)) offenders.push(rel);
      }
    };
    for (const r of roots) walk(r);
    expect(offenders, "sets an Auth-level ban").toEqual([]);
    expect(MIG).not.toMatch(/UPDATE\s+auth\.users/i);
    expect(CHECK).toContain("'auth-ban:writer'");
    expect(CHECK).toContain("'auth-ban:set'");
  });

  it("the runner is wired into db-deploy (post-push) and the nightly drift detector, and can self-test red", () => {
    expect(read(".github/workflows/db-deploy.yml")).toContain("node scripts/check-ban-gate-coverage.mjs");
    expect(read(".github/workflows/db-drift-detect.yml")).toContain("node scripts/check-ban-gate-coverage.mjs");
    expect(RUNNER).toContain("--self-test");
    expect(RUNNER).toContain("refusing to report clean");
    expect(PROBE).toContain("ban-gate-inventory.live.json");
  });
});
