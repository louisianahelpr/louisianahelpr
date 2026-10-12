/**
 * GUARD (issue #2685, owner order 2026-10-12): the daily Supabase security
 * advisor routine re-filed 183 findings in four clusters that the repo had
 * ALREADY accepted, each with a reason, because nothing pointed it at the
 * acceptances. scripts/security-advisor-triage.mjs is that pointer: it
 * subtracts every accepted finding and exits 1 only on a NEW finding or a
 * STALE acceptance. This file proves it can fail, in both directions, on the
 * repo's real acceptance files (the advisor run of 2026-10-12 gave
 * "183 finding(s), 183 accepted, 0 NEW, 0 STALE").
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate scripts/ci/security-advisor-accepted.json | "public.open_jobs_browse": | "public.open_jobs_browse_gone":
// @mutate scripts/security-advisor-triage.mjs |     if (!granted) out.add(name); |     out.add(name);
// @mutate scripts/security-advisor-triage.mjs |       if (!seen[role].has(sig)) out.stale.push( |       if (false) out.stale.push(
// @mutate scripts/security-advisor-triage.mjs |         out.unaccepted.push(`${label}: no acceptance exists | out.accepted.push(`${label}: no acceptance exists
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

type Lint = { name: string; level?: string; findings: { metadata: Record<string, unknown> }[] };
type Acc = {
  definerAllow: Record<"anon" | "authenticated", Record<string, string>>;
  accepted: { security_definer_view: Record<string, string> };
  snapshot: { tables: Record<string, { kind?: string; rls?: boolean; policies?: unknown[]; grants?: Record<string, string[]>; columnGrants?: Record<string, unknown> }> };
};
type Result = { accepted: string[]; unaccepted: string[]; stale: string[]; total: number };
type Mod = {
  loadAcceptances: () => Acc;
  triage: (l: Lint[], a: Acc) => Result;
  serverOnlyTables: (s: Acc["snapshot"]) => Set<string>;
  lintsOf: (b: unknown) => Lint[];
};
const load = async () => (await import(/* @vite-ignore */ resolve(__dirname, "../../scripts/security-advisor-triage.mjs"))) as Mod;

/** An advisor run that reports exactly what the repo accepts, built from the acceptance files themselves. */
function runFromAcceptances(m: Mod, acc: Acc): Lint[] {
  const fn = (role: "anon" | "authenticated"): Lint => ({
    name: `${role}_security_definer_function_executable`,
    findings: Object.keys(acc.definerAllow[role]).map((sig) => {
      const args = sig.slice(sig.indexOf("(") + 1, -1);
      return {
        metadata: {
          schema: "public",
          name: sig.slice(0, sig.indexOf("(")),
          arguments: args === "" ? "" : args.split(", ").map((t, i) => `p${i} ${t}`).join(", "),
        },
      };
    }),
  });
  return [
    fn("anon"),
    fn("authenticated"),
    {
      name: "security_definer_view",
      findings: Object.keys(acc.accepted.security_definer_view).map((k) => ({ metadata: { schema: k.split(".")[0], name: k.split(".")[1] } })),
    },
    { name: "rls_enabled_no_policy", findings: [...m.serverOnlyTables(acc.snapshot)].map((t) => ({ metadata: { schema: "public", name: t } })) },
  ];
}

describe("security advisor triage (#2685): accepted findings are never re-filed, new ones always are", () => {
  it("reads real acceptance inventories, not empty files", async () => {
    const m = await load();
    const acc = m.loadAcceptances();
    expect(Object.keys(acc.definerAllow.authenticated).length).toBeGreaterThan(100);
    expect(Object.keys(acc.definerAllow.anon).length).toBeGreaterThan(5);
    expect(m.serverOnlyTables(acc.snapshot).size).toBeGreaterThan(20);
    for (const why of Object.values(acc.accepted.security_definer_view)) expect(why).toMatch(/^reviewed \d{4}-\d{2}-\d{2} \(Q\d+\): .{30,}/);
  });

  it("a run reporting exactly the accepted set triages clean", async () => {
    const m = await load();
    const acc = m.loadAcceptances();
    const r = m.triage(runFromAcceptances(m, acc), acc);
    expect(r.total).toBeGreaterThan(150);
    expect({ unaccepted: r.unaccepted, stale: r.stale }).toEqual({ unaccepted: [], stale: [] });
  });

  it("open_jobs_browse is the accepted definer view (Q182)", async () => {
    const m = await load();
    expect(Object.keys(m.loadAcceptances().accepted.security_definer_view)).toEqual(["public.open_jobs_browse"]);
  });

  it("NEW: an unlisted definer function, an unknown view, a granted no-policy table, an unknown class", async () => {
    const m = await load();
    const acc = m.loadAcceptances();
    const run = runFromAcceptances(m, acc);
    run[0].findings.push({ metadata: { schema: "public", name: "zz_new_anon_mutation", arguments: "p uuid" } });
    run[2].findings.push({ metadata: { schema: "public", name: "zz_new_view" } });
    // jobs has policies and client grants: never server-only.
    run[3].findings.push({ metadata: { schema: "public", name: "jobs" } });
    run.push({ name: "auth_leaked_password_protection", level: "WARN", findings: [{ metadata: { name: "auth", type: "auth" } }] });
    const r = m.triage(run, acc);
    expect(r.unaccepted).toHaveLength(4);
    expect(r.unaccepted.join("\n")).toMatch(/zz_new_anon_mutation[\s\S]*zz_new_view[\s\S]*public\.jobs[\s\S]*auth_leaked_password_protection/);
  });

  it("NEW: a no-policy table a client role is granted (table or column) is not server-only", async () => {
    const m = await load();
    const acc = m.loadAcceptances();
    const [a, b] = [...m.serverOnlyTables(acc.snapshot)];
    const tables = {
      ...acc.snapshot.tables,
      [a]: { ...acc.snapshot.tables[a], grants: { authenticated: ["SELECT"] } },
      [b]: { ...acc.snapshot.tables[b], columnGrants: { anon: { SELECT: ["id"] } } },
    };
    const r = m.triage(
      [{ name: "rls_enabled_no_policy", findings: [a, b].map((t) => ({ metadata: { schema: "public", name: t } })) }],
      { ...acc, snapshot: { tables } },
    );
    expect(r.unaccepted).toHaveLength(2);
  });

  it("NEW: an allowlisted name with a different argument count (an overload) is not accepted", async () => {
    const m = await load();
    const acc = m.loadAcceptances();
    const r = m.triage(
      [{ name: "anon_security_definer_function_executable", findings: [{ metadata: { schema: "public", name: "get_parish_for_zip", arguments: "p_zip text, p_extra int" } }] }],
      acc,
    );
    expect(r.unaccepted).toEqual([expect.stringContaining("get_parish_for_zip")]);
  });

  it("STALE: an acceptance the run no longer reports fails (both ways)", async () => {
    const m = await load();
    const acc = m.loadAcceptances();
    const run = runFromAcceptances(m, acc);
    const dropped = run[0].findings.shift()!; // one anon function revoked
    run[2].findings = []; // the view turned invoker
    run[3].findings.pop(); // one table gained a policy
    const r = m.triage(run, acc);
    expect(r.unaccepted).toEqual([]);
    expect(r.stale).toHaveLength(3);
    expect(r.stale.join("\n")).toContain(String(dropped.metadata.name));
    expect(r.stale.join("\n")).toContain("open_jobs_browse");
  });

  it("fails closed on input with no lints array", async () => {
    const m = await load();
    expect(() => m.lintsOf({ result: {} })).toThrow(/no lints array/);
    expect(m.lintsOf({ result: { lints: [] } })).toEqual([]);
    expect(m.lintsOf({ lints: [{ name: "x", findings: [] }] })).toHaveLength(1);
  });
});
