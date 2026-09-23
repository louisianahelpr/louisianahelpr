/*
 * CLASS GUARD (Q52, 2026-09-23): a live check that cannot read, or reads
 * NOTHING, must not exit 0.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * The owner: "nothing is a false positive or going green if it's not truly
 * green". The same night found checks green while checking nothing. Among the
 * scripts that read prod / GitHub / Stripe (measured by this file's own
 * inventory, 2026-09-23):
 *
 *   check-stripe-webhook-events   an EMPTY endpoint list graded "sandbox is
 *                                 off, drift not graded" -> PASS (exit 0).
 *   check-test-account-strikes    1 of 6 accounts returned -> the other 5
 *                                 printed as "not on this project" -> PASS.
 *   audit/write-contract --refresh a catalog of {tables:{}, functions:{}} passed
 *                                 its shape test and would overwrite the
 *                                 committed snapshot.
 *   audit/function-body-drift     a migration parse of zero functions compared
 *                                 nothing -> OK.
 *   audit/cross-account-authz,    printed LEAK / FAILED and exited 0 always.
 *   audit/two-account-journey
 *   audit/prod-seed --verify      a failed anon read counted as zero leaks.
 *   audit/rail-overlap-probe      a signed-out run (rail never open) -> 0.
 *   audit/walk-every-control      an empty or harness-errored walk -> 0.
 *
 * ── How ────────────────────────────────────────────────────────────────────
 * The inventory is DERIVED: every scripts/check-*.mjs and scripts/audit/*.mjs
 * whose CODE (comments stripped) names a live source. Each is then either
 * RUN here against an injected failed read AND an injected empty read — a stub
 * `supabase` / `gh` / `npx` first on PATH, and a local HTTP stub for the REST /
 * Management / Stripe APIs (via LH_SUPABASE_API_BASE, LH_STRIPE_API_BASE,
 * SUPABASE_URL) — and must exit non-zero FOR THAT REASON (its own message, not
 * any crash), or it is in NOT_HERMETIC with a reason. Both lists are two-way.
 */

// @mutate scripts/check-anon-table-grants.mjs | if (!tablesChecked \|\| !Array.isArray(offenders)) { | if (false) {
// @mutate scripts/check-stripe-webhook-events.mjs | fail(\n      `No enabled test-mode endpoint | notes.push(\n      `No enabled test-mode endpoint
// @mutate scripts/check-test-account-strikes.mjs | if (missing.length) { | if (false) {
// @mutate scripts/audit/write-contract.mjs | if (nTables < 20 \|\| nFunctions < 50) { | if (false) {
// @mutate scripts/check-staleness.mjs | if (process.env.CI) throw new Error( | if (false) throw new Error(
// @mutate scripts/audit/function-body-drift.mjs | if (!Array.isArray(rows) \|\| rows.length < 50 \|\| typeof rows[0].prosrc !== "string") throw | if (false) throw
// @mutate scripts/audit/cross-account-authz.mjs | if (leaks) process.exit(1); |
// @mutate scripts/check-migration-provenance.mjs |   if (!state) { |   if (false) {
// @mutate scripts/check-migration-provenance.mjs | could not check migration provenance: ${e.message}`);\n  process.exit(2); | could not check migration provenance: ${e.message}`);\n  process.exit(0);

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

/**
 * Code only: drop whole comment LINES (`//`, `/*`, ` *`). Deliberately line-based
 * rather than a character scanner: with src/test/helpers/blankNonCode's
 * blankComments (which does not model regex literals) this file's inventory
 * silently LOST check-stripe-webhook-events.mjs (measured 2026-09-23) — its live
 * fetch came back blanked. Dropping a whole line can never swallow code on
 * another line.
 */
const stripComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

/** A live source: prod DB / REST / auth, the Management or Stripe API, GitHub, or a minted prod session. */
const LIVE_MARKERS: RegExp[] = [
  /\(\s*["'`]supabase["'`]\s*,\s*\[/, // execFileSync("supabase", [...])
  /\[\s*["'`]supabase["'`]\s*,\s*["'`]gen/, // npx supabase gen types
  /\(\s*["'`]gh["'`]\s*,/, // execFileSync("gh", ...)
  /\(\s*["'`]psql["'`]/,
  /api\.supabase\.com/,
  /api\.stripe\.com/,
  /\.supabase\.co\b/,
  /\/rest\/v1\//,
  /\/auth\/v1\//,
  /test-signin-link\.mjs/,
];

const candidates = [
  ...readdirSync(join(ROOT, "scripts")).filter((f) => /^check-.*\.mjs$/.test(f)).map((f) => `scripts/${f}`),
  ...readdirSync(join(ROOT, "scripts/audit")).filter((f) => f.endsWith(".mjs")).map((f) => `scripts/audit/${f}`),
];
const code = (f: string) => stripComments(readFileSync(join(ROOT, f), "utf8"));
const inventory = candidates.filter((f) => LIVE_MARKERS.some((rx) => rx.test(code(f)))).sort();

/**
 * Cannot be run hermetically here, each with the reason. `mustContain` pins the
 * fail-closed exit that was added for Q52, so deleting it is still caught.
 */
const NOT_HERMETIC: Record<string, { why: string; mustContain?: string[] }> = {
  "scripts/check-deploy-budget.mjs": {
    why: "advisory pre-push WARNING by contract ('exit 0 always', never blocks a push); prints 'not checked' on a failed read, and zero deploys in 24h is a true value, so no floor exists",
  },
  "scripts/check-changed.mjs": {
    why: "pre-push wrapper around a Playwright a11y-prod sweep (build + browser + prod sessions); it hard-fails with no session source and exits with Playwright's own status. 'No changed route' is a true zero, not an empty read",
    mustContain: ["process.exit(r.status ?? 1);"],
  },
  "scripts/audit/pressProdSafety.mjs": {
    why: "a library imported by press-every-control.mjs — no CLI entrypoint and no verdict of its own; its caller's exit code is the check",
  },
  "scripts/audit/cross-account-authz.mjs": {
    why: "mints two real prod sessions through scripts/test-signin-link.mjs (service role) with a hard-coded repo cwd; no stub can stand in for GoTrue",
    mustContain: ["if (leaks) process.exit(1);", "process.exit(2);", "brokenProbes++"],
  },
  "scripts/audit/two-account-journey.mjs": {
    why: "drives two real browser sessions against a local build on the prod backend; not runnable without Playwright + minted sessions",
    mustContain: ["process.exitCode = failed.length ? 1 : steps.length === 0 ? 2 : 0;"],
  },
  "scripts/audit/prod-seed.mjs": {
    why: "reads the repo-root .env for the service-role key (no env override) and --verify needs the seeded prod rows; the failed-anon-read fix is pinned below",
    mustContain: ["if (!r.ok) { leakErr ="],
  },
  "scripts/audit/rail-overlap-probe.mjs": {
    why: "Playwright against a local build with a minted prod session",
    mustContain: ["if (!findings.length || unmeasured.length) {"],
  },
  "scripts/audit/walk-every-control.mjs": {
    why: "Playwright against a local build with a minted prod session",
    mustContain: ["if (!results.length || harnessErrors.length) {"],
  },
  "scripts/audit/a11y-focus-repro.mjs": {
    why: "one-off defect repro that dumps measurements as JSON for a human to read — it states no pass/fail verdict, so it has no green to be false",
  },
  "scripts/audit/complete-profile-icon-clip.mjs": {
    why: "one-off defect repro that dumps measurements and screenshots — no pass/fail verdict",
  },
};

type Case = {
  label: string;
  args?: string[];
  env?: Record<string, string>;
  /** What the stub CLIs (supabase / gh / npx) print, and their exit code. */
  cli?: { out: string; code: number };
  /** Must match stdout+stderr: the script failed for THIS reason, not by crashing. */
  says: RegExp;
};

const CLI_FAIL = { out: "", code: 1 };
const CLI_EMPTY = { out: '{"rows":[]}', code: 0 };
const MGMT = (mode: string) => ({ SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "stub", LH_SUPABASE_API_BASE: `@HTTP@/${mode}` });

const catalogCheck = (readFail: RegExp): Case[] => [
  { label: "CLI read fails", cli: CLI_FAIL, says: readFail },
  { label: "CLI read is empty", cli: CLI_EMPTY, says: /refusing to report clean/ },
  { label: "Management API 500", env: MGMT("fail"), says: readFail },
  { label: "Management API []", env: MGMT("empty"), says: /refusing to report clean/ },
];

const HERMETIC: Record<string, Case[]> = {
  "scripts/check-anon-table-grants.mjs": catalogCheck(/could not read live grant catalog/),
  "scripts/check-jobs-dynamic-writers.mjs": catalogCheck(/could not read live pg_proc/),
  "scripts/check-edge-rpcs-live.mjs": catalogCheck(/could not read the live function catalog/),
  "scripts/check-live-privileges.mjs": catalogCheck(/could not read the live catalog/),
  "scripts/check-unvalidated-constraints.mjs": [
    { label: "CLI read fails", cli: CLI_FAIL, says: /could not read the live catalog/ },
    { label: "CLI read is empty", cli: CLI_EMPTY, says: /refusing to report clean/ },
    { label: "Management API 500", env: MGMT("fail"), says: /could not read the live catalog/ },
    { label: "Management API []", env: MGMT("empty"), says: /refusing to report clean/ },
  ],
  "scripts/check-updatable-views.mjs": catalogCheck(/could not read live view catalog/),
  "scripts/audit/function-body-drift.mjs": [
    { label: "CLI read fails", cli: CLI_FAIL, says: /could not read prod's functions/ },
    { label: "CLI read is empty", cli: CLI_EMPTY, says: /could not read prod's functions: live function list looks wrong \(0 rows\)/ },
  ],
  "scripts/audit/write-contract.mjs": [
    { label: "refresh: CLI read fails", args: ["--refresh"], cli: CLI_FAIL, says: /Command failed: supabase db query/ },
    { label: "refresh: CLI read is empty", args: ["--refresh"], cli: CLI_EMPTY, says: /snapshot query returned no tables\/functions/ },
    {
      label: "refresh: catalog with zero tables",
      args: ["--refresh"],
      cli: { out: '{"rows":[{"snapshot":{"tables":{},"functions":{}}}]}', code: 0 },
      says: /refusing to write a near-empty snapshot/,
    },
  ],
  "scripts/check-types-fresh.mjs": [
    { label: "generated file is empty", args: ["--fresh", "@EMPTYFILE@"], says: /ZERO columns|public.*(schema|block)|no `public/i },
    {
      label: "type generation fails",
      env: { SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "fncmgoasalhdgfwzhsqa" },
      cli: CLI_FAIL,
      says: /Command failed: npx supabase gen types/,
    },
  ],
  "scripts/check-staleness.mjs": [
    { label: "gh read fails in CI", env: { CI: "1" }, cli: CLI_FAIL, says: /gh run list failed in CI .* refusing to report fresh/ },
    { label: "gh returns no successful run", env: { CI: "1" }, cli: { out: "[]", code: 0 }, says: /last passed never/ },
  ],
  "scripts/check-stripe-webhook-events.mjs": [
    { label: "live read fails", env: { STRIPE_TEST_SECRET_KEY: "sk_test_stub", LH_STRIPE_API_BASE: "@HTTP@/fail" }, says: /Could not list Stripe test-mode webhook endpoints/ },
    { label: "live read is empty", env: { STRIPE_TEST_SECRET_KEY: "sk_test_stub", LH_STRIPE_API_BASE: "@HTTP@/empty" }, says: /No enabled test-mode endpoint/ },
    { label: "fixture with no endpoints", args: ["--fixture", "@EMPTYSTRIPE@"], says: /No enabled test-mode endpoint/ },
  ],
  // Q117/Q129: `check` reads schema_migrations + the receipt ledger through the
  // Management API (LH_SUPABASE_API_BASE); `record` is a write, not a verdict.
  "scripts/check-migration-provenance.mjs": [
    { label: "no credentials", args: ["check"], says: /could not check migration provenance: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required/ },
    { label: "Management API 500", args: ["check"], env: MGMT("fail"), says: /could not check migration provenance: Management API query failed: 500/ },
    { label: "Management API []", args: ["check"], env: MGMT("empty"), says: /schema_migrations read returned no rows — refusing to report clean/ },
  ],
  // Q63 / Q72 (quota-monitor.yml). Both read prod through the Management API
  // (LH_SUPABASE_API_BASE); their ledger writes land on the same stub.
  "scripts/check-quota-usage.mjs": [
    { label: "Management API 500", env: MGMT("fail"), says: /could not read the usage SQL: Management API SQL 500/ },
    { label: "Management API []", env: MGMT("empty"), says: /the usage SQL returned no row — refusing to report clean/ },
  ],
  "scripts/check-analytics-freshness.mjs": [
    { label: "no credentials", says: /could not read analytics_events: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required/ },
    { label: "Management API 500", env: MGMT("fail"), says: /could not read analytics_events: Management API SQL 500/ },
    { label: "Management API []", env: MGMT("empty"), says: /expected \d+ rows, got 0 — refusing to report clean/ },
  ],
  "scripts/check-test-account-strikes.mjs": [
    { label: "REST read fails", env: { SUPABASE_URL: "@HTTP@/fail", SUPABASE_SERVICE_ROLE_KEY: "stub" }, says: /could not check: GET profiles → 500/ },
    { label: "REST read is empty", env: { SUPABASE_URL: "@HTTP@/empty", SUPABASE_SERVICE_ROLE_KEY: "stub" }, says: /no shared test account profiles found/ },
    { label: "REST returns 1 of 6 accounts", env: { SUPABASE_URL: "@HTTP@/one", SUPABASE_SERVICE_ROLE_KEY: "stub" }, says: /5 of 6 shared test accounts were not returned/ },
  ],
};

// ── stubs ────────────────────────────────────────────────────────────────────
let server: Server;
let httpBase = "";
let stubDir = "";
const WRITE_CONTRACT_SNAPSHOT = join(ROOT, "scripts/audit/write-contract.snapshot.json");
let snapshotBefore = "";

beforeAll(async () => {
  stubDir = mkdtempSync(join(tmpdir(), "lh-livecheck-"));
  for (const tool of ["supabase", "gh", "npx"]) {
    const p = join(stubDir, tool);
    writeFileSync(p, '#!/bin/sh\nprintf "%s" "$STUB_OUT"\nexit "${STUB_CODE:-0}"\n');
    chmodSync(p, 0o755);
  }
  writeFileSync(join(stubDir, "empty.ts"), "");
  writeFileSync(join(stubDir, "empty-stripe.json"), JSON.stringify({ object: "list", data: [] }));
  server = createServer((req, res) => {
    const [, mode] = (req.url ?? "").split("/");
    res.setHeader("Content-Type", "application/json");
    if (mode === "fail") {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: "stub failure", error: { message: "stub failure" } }));
      return;
    }
    if (req.url?.includes("webhook_endpoints")) return void res.end(JSON.stringify({ object: "list", data: [] }));
    if (mode === "one" && req.url?.includes("/rest/v1/profiles")) {
      return void res.end(JSON.stringify([{ user_id: "00000000-0000-0000-0000-000000000001", email: "helpr-e2e-poster-0902@mailinator.com", ban_status: "active" }]));
    }
    res.end("[]");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  httpBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  snapshotBefore = readFileSync(WRITE_CONTRACT_SNAPSHOT, "utf8");
});

afterAll(async () => {
  // A mutated floor would let --refresh write an empty snapshot: put it back.
  if (readFileSync(WRITE_CONTRACT_SNAPSHOT, "utf8") !== snapshotBefore) writeFileSync(WRITE_CONTRACT_SNAPSHOT, snapshotBefore);
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(stubDir, { recursive: true, force: true });
});

const fill = (s: string) =>
  s.replace("@HTTP@", httpBase).replace("@EMPTYFILE@", join(stubDir, "empty.ts")).replace("@EMPTYSTRIPE@", join(stubDir, "empty-stripe.json"));

function run(script: string, c: Case): Promise<{ code: number; out: string }> {
  // A clean env: no real token or project ref may leak in and reach prod.
  const env: Record<string, string> = {
    PATH: `${stubDir}:${process.env.PATH}`,
    HOME: process.env.HOME ?? tmpdir(),
    STUB_OUT: c.cli?.out ?? "",
    STUB_CODE: String(c.cli?.code ?? 0),
  };
  for (const [k, v] of Object.entries(c.env ?? {})) env[k] = fill(v);
  return new Promise((done) => {
    execFile(process.execPath, [script, ...(c.args ?? []).map(fill)], { cwd: ROOT, env, timeout: 60_000, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      done({ code, out: `${stdout}\n${stderr}` });
    });
  });
}

describe("live check scripts fail closed", () => {
  it("found the live-reading scripts (cannot pass vacuously)", () => {
    expect(inventory.length).toBeGreaterThan(15);
    expect(Object.keys(HERMETIC).length).toBeGreaterThan(8);
  });

  it("every live-reading script is run here or listed with a reason — both ways", () => {
    const unaccounted = inventory.filter((f) => !(f in HERMETIC) && !(f in NOT_HERMETIC));
    expect(unaccounted, `live-reading scripts with no fail-closed proof — add cases to HERMETIC or a reason to NOT_HERMETIC:\n  ${unaccounted.join("\n  ")}`).toEqual([]);
    const stale = [...Object.keys(HERMETIC), ...Object.keys(NOT_HERMETIC)].filter((f) => !inventory.includes(f));
    expect(stale, `listed but no longer a live-reading script — remove: ${stale.join(", ")}`).toEqual([]);
    const both = Object.keys(HERMETIC).filter((f) => f in NOT_HERMETIC);
    expect(both).toEqual([]);
    for (const [f, { why }] of Object.entries(NOT_HERMETIC)) expect(why.length, `${f} needs a real reason`).toBeGreaterThan(40);
  });

  it("the non-hermetic ones still carry their fail-closed exit", () => {
    for (const [f, { mustContain = [] }] of Object.entries(NOT_HERMETIC)) {
      const src = code(f);
      for (const s of mustContain) expect(src.includes(s), `${f} lost its fail-closed exit: ${s}`).toBe(true);
    }
  });

  for (const [script, cases] of Object.entries(HERMETIC)) {
    for (const c of cases) {
      it(`${script}: ${c.label} -> non-zero, for that reason`, async () => {
        const { code: exit, out } = await run(script, c);
        expect(exit, `${script} exited 0 on "${c.label}" — a green that checked nothing.\n${out.slice(-1500)}`).not.toBe(0);
        expect(out, `${script} failed on "${c.label}", but not for the injected reason (a crash is not fail-closed).\n${out.slice(-1500)}`).toMatch(c.says);
      }, 90_000);
    }
  }

  it("left the committed write-contract snapshot untouched", () => {
    expect(readFileSync(WRITE_CONTRACT_SNAPSHOT, "utf8")).toBe(snapshotBefore);
  });
});
