/**
 * Q14 — the two Supabase security-advisor classes that are about OUR choices,
 * held to the app's own inventory instead of an advisor screen nobody re-reads.
 *
 * 1. Client-executable SECURITY DEFINER functions (advisor:
 *    anon_/authenticated_security_definer_function_executable). A definer
 *    function runs as its owner and skips RLS, so every one a client may call
 *    must say why. scripts/ci/definer-exec-allowlist.json is the exact live set
 *    (scripts/check-live-privileges.mjs diffs it against prod both ways after
 *    every migration push and nightly). Here each entry's REASON is checked
 *    against the source:
 *      "client"  — src/ (outside tests and generated types) calls it by name;
 *      "policy"  — a CREATE/ALTER POLICY in the migrations calls it (a policy
 *                  runs as the caller, so the caller needs EXECUTE);
 *      otherwise — a written "reviewed <date> (Q..): ..." reason.
 *    2026-10-05: six functions had none of those (four answered about OTHER
 *    people for any id: resolve_auto_tip, is_thread_muted,
 *    user_has_pending_application, helper_award_block_reason);
 *    20261005054927 revoked them.
 *
 * 2. RLS enabled with no policy (advisor: rls_enabled_no_policy). That is
 *    deny-all for clients, which is right only for a server-only table. So no
 *    such table (per the write-contract snapshot of prod) may be read or written
 *    by the client: a `.from("<table>")` in src/ would silently get zero rows.
 *
 * (The third advisor finding, the definer view open_jobs_browse, is deliberate
 * and pinned by src/test/openJobsBrowseStaysDefiner.test.ts.)
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate scripts/ci/definer-exec-allowlist.json | "is_caller_banned()": "policy" | "is_caller_banned()": "client"
// @mutate scripts/ci/definer-exec-allowlist.json | "rpc_group_member_confirm(uuid)": "reviewed | "rpc_group_member_confirm(uuid)": "client", "zz": "reviewed
// @mutate scripts/ci/definer-exec-allowlist.json | "get_job_pets(uuid)": "client" | "get_job_pets(uuid)": "policy"
// @mutate scripts/ci/definer-exec-allowlist.json | "get_parish_for_zip(text)": "reviewed 2026-10-05 (Q1284): | "get_parish_for_zip(text)": "fine:
// @mutate scripts/ci/definer-exec-allowlist.json | "authenticated": { | "authenticated": {\n    "resolve_auto_tip(uuid, numeric)": "client",
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = process.cwd();
const allow = JSON.parse(readFileSync(join(ROOT, "scripts/ci/definer-exec-allowlist.json"), "utf8")) as Record<
  "anon" | "authenticated" | "unscoped",
  Record<string, string>
>;

const clientSource = walkSource([join(ROOT, "src")])
  .filter((f) => !/\/test\/|\.test\.|\/integrations\/supabase\/types/.test(f))
  .map((f) => blankComments(readSource(f) ?? ""))
  .join("\n");

const migrationsDir = join(ROOT, "supabase/migrations");
const policyText = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => blankSqlComments(readFileSync(join(migrationsDir, f), "utf8")))
  .flatMap((sql) => sql.split(";"))
  .filter((stmt) => /\b(CREATE|ALTER)\s+POLICY\b/i.test(stmt))
  .join("\n");

const nameOf = (sig: string) => sig.slice(0, sig.indexOf("("));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const calledByClient = (name: string) => new RegExp(`["'\`]${escape(name)}["'\`]`).test(clientSource);
const calledByPolicy = (name: string) => new RegExp(`\\b${escape(name)}\\s*\\(`).test(policyText);

describe("Q14: every client-executable SECURITY DEFINER function says why", () => {
  const entries = (["anon", "authenticated"] as const).flatMap((role) =>
    Object.entries(allow[role]).map(([sig, why]) => ({ role, sig, why })),
  );

  it("the allowlist is the real inventory, not an empty file", () => {
    expect(Object.keys(allow.authenticated).length).toBeGreaterThan(100);
    expect(Object.keys(allow.anon).length).toBeGreaterThan(5);
    expect(policyText.length, "no CREATE POLICY statement parsed from the migrations").toBeGreaterThan(10_000);
  });

  it('"client" entries are called by name from src/', () => {
    const wrong = entries.filter((e) => e.why === "client" && !calledByClient(nameOf(e.sig)));
    expect(wrong.map((e) => `${e.role} ${e.sig}`)).toEqual([]);
  });

  it('"policy" entries are called inside a CREATE/ALTER POLICY', () => {
    const wrong = entries.filter((e) => e.why === "policy" && !calledByPolicy(nameOf(e.sig)));
    expect(wrong.map((e) => `${e.role} ${e.sig}`)).toEqual([]);
  });

  it("every other entry carries a dated, reviewed reason", () => {
    const wrong = entries.filter(
      (e) => e.why !== "client" && e.why !== "policy" && !/^reviewed \d{4}-\d{2}-\d{2} \(Q\d+\): .{30,}/.test(e.why),
    );
    expect(wrong.map((e) => `${e.role} ${e.sig}: ${e.why}`)).toEqual([]);
  });

  it('"unscoped" entries (Q1284: bodies that never read the caller) are client-callable and carry a dated reason', () => {
    const unscoped = Object.entries(allow.unscoped ?? {});
    expect(unscoped.length).toBeGreaterThan(10);
    const callable = new Set([...Object.keys(allow.anon), ...Object.keys(allow.authenticated)]);
    const wrong = unscoped.filter(([sig, why]) => !callable.has(sig) || !/^reviewed \d{4}-\d{2}-\d{2} \(Q\d+\): .{30,}/.test(why));
    expect(wrong.map(([sig]) => sig)).toEqual([]);
  });

  it("the six functions revoked by 20261005054927 stay out", () => {
    const revoked = ["resolve_auto_tip", "is_thread_muted", "user_has_pending_application", "helper_award_block_reason", "application_cap", "marketing_published_today"];
    const back = entries.filter((e) => revoked.includes(nameOf(e.sig)));
    expect(back.map((e) => `${e.role} ${e.sig}`)).toEqual([]);
    for (const name of revoked) expect(calledByClient(name), `${name} is called from src/ again`).toBe(false);
  });
});

describe("Q14: no client code touches a table whose RLS has no policy", () => {
  const snapshot = JSON.parse(readFileSync(join(ROOT, "scripts/audit/write-contract.snapshot.json"), "utf8")) as {
    tables: Record<string, { kind?: string; policies?: unknown[] }>;
  };
  const deniedTables = Object.entries(snapshot.tables)
    .filter(([, t]) => t.kind === "table" && (t.policies ?? []).length === 0)
    .map(([name]) => name);

  it("the snapshot has server-only tables to check", () => {
    expect(deniedTables.length).toBeGreaterThan(15);
  });

  it("none of them is read or written with .from() in src/", () => {
    const touched = deniedTables.filter((t) => new RegExp(`\\.from\\(\\s*["'\`]${escape(t)}["'\`]`).test(clientSource));
    expect(touched).toEqual([]);
  });
});
