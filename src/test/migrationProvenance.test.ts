// @mutate scripts/lib/migrationProvenance.mjs | .filter((v) => v > cutoff && !receipts.has(v) && !acked.has(v)) | .filter((v) => v > cutoff && !receipts.has(v) && !acked.has(v) && false)
// @mutate scripts/lib/migrationProvenance.mjs | else if (run.path !== DEPLOY_WORKFLOW_PATH) | else if (false)
// @mutate scripts/lib/migrationProvenance.mjs | const staleAck = [...acked].filter((v) => !(prod.has(v) && v > cutoff && !receipts.has(v))).sort(); | const staleAck = [];
// @mutate scripts/lib/migrationProvenance.mjs | /Applying migration\s+(\d{14})_[^\s]*\.sql/g | /Applied migration\s+(\d{14})_[^\s]*\.sql/g
// @mutate .github/workflows/db-deploy.yml | 2>&1 \| tee /tmp/db-push.log | 2>&1
// @mutate .github/workflows/db-deploy.yml |         run: node scripts/check-migration-provenance.mjs check |         run: echo skipped
// @mutate .github/workflows/db-drift-detect.yml | MIGRATION_PROVENANCE: ${{ steps.migration_provenance.outcome }} | MIGRATION_PROVENANCE: success
// @mutate scripts/lib/migrationProvenance.mjs |       if (why === null) expired.push( |       if (true) expired.push(
// @mutate scripts/lib/migrationProvenance.mjs |   if (ageDays < minAgeDays) return | if (false) return
// @mutate scripts/lib/migrationProvenance.mjs |   if (!evidence.onMain) return | if (false) return
// @mutate scripts/lib/migrationProvenance.mjs |   if (!evidence.fileAtSha) return | if (false) return
// @mutate scripts/check-migration-provenance.mjs |     expiredRun: CONFIG.expiredRun, |     expiredRun: undefined,
// @mutate supabase/migrations/20260923103737_migration_deploy_ledger.sql | REVOKE ALL ON TABLE public.migration_deploy_ledger FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.migration_deploy_ledger FROM PUBLIC;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEPLOY_WORKFLOW_PATH,
  expiredRunVerdict,
  parseAppliedVersions,
  provenanceFindings,
  receiptInsertSql,
} from "../../scripts/lib/migrationProvenance.mjs";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * Q117 (docs/OPEN.md): every prod migration must have been applied by
 * db-deploy.yml, the only path through the gates. Measured 2026-09-23: the
 * Supabase GitHub integration applied all 24 migrations of the previous 24h
 * (workflow_run_logs "Applying migration"), including 20260923100454 while its
 * db-deploy run was red at lint.
 *
 * db-deploy writes a receipt per version `supabase db push` printed
 * "Applying migration" for (public.migration_deploy_ledger, created by
 * 20260923103737); scripts/check-migration-provenance.mjs fails db-deploy and
 * the nightly db-drift-detect on any post-cutoff prod version without one.
 * This file: the judging logic, that the workflows actually wire it, and that
 * no migration can write its own receipt. Real-Postgres proof (planted
 * out-of-band version reported): src/test/pglite/migrationProvenance.pglite.mjs.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LEDGER_MIGRATION = "20260923103737_migration_deploy_ledger.sql";
const deployRun = { path: DEPLOY_WORKFLOW_PATH, head_branch: "main" };

describe("provenanceFindings", () => {
  const cutoff = "20260923103737";
  const base = {
    prodVersions: ["20260923100454", "20260923101130", cutoff, "20260924000000"],
    ledger: [{ version: "20260924000000", run_id: 111 }],
    cutoff,
    acknowledged: [] as { version: string }[],
    runs: new Map([["111", deployRun]]),
  };

  it("clean when every post-cutoff version has a db-deploy receipt", () => {
    const f = provenanceFindings(base);
    expect(f).toMatchObject({ unrecorded: [], staleAck: [], forged: [] });
    expect(f.judged).toBe(1);
  });

  it("RED: a post-cutoff version with no receipt (the Q117 shape)", () => {
    const f = provenanceFindings({ ...base, prodVersions: [...base.prodVersions, "20260924000100"] });
    expect(f.unrecorded).toEqual(["20260924000100"]);
  });

  it("an acknowledged out-of-band version passes, and a stale acknowledgement fails", () => {
    const withOob = { ...base, prodVersions: [...base.prodVersions, "20260924000100"] };
    expect(provenanceFindings({ ...withOob, acknowledged: [{ version: "20260924000100" }] }).unrecorded).toEqual([]);
    expect(provenanceFindings({ ...base, acknowledged: [{ version: "20260924000100" }] }).staleAck).toEqual(["20260924000100"]);
    expect(provenanceFindings({ ...base, acknowledged: [{ version: "20260924000000" }] }).staleAck).toEqual(["20260924000000"]);
  });

  it("RED: a receipt from another workflow, another branch, a missing run, or for a version prod lacks", () => {
    const other = provenanceFindings({ ...base, runs: new Map([["111", { path: ".github/workflows/test.yml", head_branch: "main" }]]) });
    expect(other.forged.map((x) => x.version)).toEqual(["20260924000000"]);
    const branch = provenanceFindings({ ...base, runs: new Map([["111", { ...deployRun, head_branch: "feat/x" }]]) });
    expect(branch.forged).toHaveLength(1);
    const gone = provenanceFindings({ ...base, runs: new Map([["111", null]]) });
    expect(gone.forged).toHaveLength(1);
    const phantom = provenanceFindings({ ...base, ledger: [...base.ledger, { version: "20260925000000", run_id: 111 }] });
    expect(phantom.forged.map((x) => x.version)).toEqual(["20260925000000"]);
  });
});

/**
 * db-deploy went red on every merge from 2026-10-17 (runs 39017276439 and the
 * 05:07Z one): 14 receipts from 2026-10-01..10-03 name runs GitHub no longer
 * has (every run of every workflow created 2026-10-01 01:40Z..10-03 15:54Z
 * answers 404; measured 2026-10-17). A gone run is judged by what the receipt
 * itself proves: old enough, head_sha on main, carrying the migration.
 */
describe("a receipt whose GitHub run is gone (db-deploy red 2026-10-17)", () => {
  const cutoff = "20260923103737";
  const now = new Date("2026-10-17T09:00:00Z");
  const sha = "2e1b8f15762660811baa7557ae504d90e0628429";
  // The real shape: receipt for 20261002060514, run 36987006095 (404 today).
  const receipt = { version: "20261002060514", run_id: 36987006095, head_sha: sha, recorded_at: "2026-10-02 09:07:20.601959+00" };
  const base = {
    prodVersions: [cutoff, "20261002060514"],
    ledger: [receipt],
    cutoff,
    acknowledged: [] as { version: string }[],
    runs: new Map<string, { path: string; head_branch: string } | null>([["36987006095", null]]),
    expiredRun: { minAgeDays: 14 },
    shaEvidence: new Map([["20261002060514", { onMain: true, fileAtSha: true }]]),
    now,
  };

  it("an old receipt whose head_sha is on main and carries the migration is judged by the receipt, not failed", () => {
    const f = provenanceFindings(base);
    expect(f.forged).toEqual([]);
    expect(f.expired).toEqual([{ version: "20261002060514", run_id: "36987006095" }]);
  });

  it("RED without the rule (what main's check did): the expired run reads as a forgery", () => {
    const f = provenanceFindings({ ...base, expiredRun: undefined });
    expect(f.forged.map((x) => x.version)).toEqual(["20261002060514"]);
    expect(f.forged[0].why).toMatch(/run 36987006095 does not exist in this repository/);
  });

  it("RED: a run missing within the window (a receipt naming a run that never existed is caught while young)", () => {
    const young = { ...receipt, recorded_at: "2026-10-10T09:00:00Z" };
    const f = provenanceFindings({ ...base, ledger: [young] });
    expect(f.forged[0].why).toMatch(/7 day\(s\) old; a run missing within 14 days is not taken as lost/);
    expect(f.expired).toEqual([]);
  });

  it("RED: head_sha not on main, or not carrying the migration, or no evidence read", () => {
    const off = provenanceFindings({ ...base, shaEvidence: new Map([["20261002060514", { onMain: false, fileAtSha: true }]]) });
    expect(off.forged[0].why).toMatch(/is not a commit on main/);
    const nofile = provenanceFindings({ ...base, shaEvidence: new Map([["20261002060514", { onMain: true, fileAtSha: false }]]) });
    expect(nofile.forged[0].why).toMatch(/does not carry migration 20261002060514/);
    const none = provenanceFindings({ ...base, shaEvidence: new Map() });
    expect(none.forged[0].why).toMatch(/no commit evidence/);
  });

  it("a live run on another workflow or branch is still a forgery, whatever its age", () => {
    const other = provenanceFindings({ ...base, runs: new Map([["36987006095", { path: ".github/workflows/test.yml", head_branch: "main" }]]) });
    expect(other.forged).toHaveLength(1);
    expect(other.expired).toEqual([]);
  });

  it("expiredRunVerdict fails closed on a missing rule or recorded_at", () => {
    expect(expiredRunVerdict(receipt, { onMain: true, fileAtSha: true }, { now, minAgeDays: undefined })).toMatch(/no expired-run rule/);
    expect(expiredRunVerdict({ ...receipt, recorded_at: undefined }, { onMain: true, fileAtSha: true }, { now, minAgeDays: 14 })).toMatch(/no recorded_at/);
  });

  it("the live check wires the rule: config minAgeDays, ledger reads head_sha + recorded_at, evidence from GitHub", () => {
    const cfg = JSON.parse(read("scripts/audit/migration-provenance.json"));
    expect(cfg.expiredRun.minAgeDays).toBe(14);
    const script = read("scripts/check-migration-provenance.mjs");
    expect(script).toContain("SELECT version, run_id, head_sha, recorded_at FROM public.migration_deploy_ledger");
    expect(script).toContain("expiredRun: CONFIG.expiredRun,");
    expect(script).toContain("compare/${sha}...main");
    expect(script).toContain("contents/supabase/migrations/${encodeURIComponent(file)}?ref=${sha}");
  });
});

describe("receipts come from the CLI's own output", () => {
  it("parses the versions `supabase db push` says it applied, and nothing else", () => {
    const out = [
      "Connecting to remote database...",
      "Do you want to push these migrations to the remote database?",
      " • 20260924000000_a.sql",
      "Applying migration 20260924000000_a.sql...",
      "Applying migration 20260924000100_b_c.sql...",
      "Finished supabase db push.",
    ].join("\n");
    expect(parseAppliedVersions(out)).toEqual(["20260924000000", "20260924000100"]);
    expect(parseAppliedVersions("Remote database is up to date.")).toEqual([]);
  });

  it("the receipt INSERT validates every value", () => {
    const sha = "a".repeat(40);
    expect(receiptInsertSql([], { runId: 1, runAttempt: 1, headSha: sha })).toBeNull();
    expect(receiptInsertSql(["20260924000000"], { runId: 1, runAttempt: 1, headSha: sha })).toContain("ON CONFLICT (version) DO NOTHING");
    expect(() => receiptInsertSql(["2026'; drop"], { runId: 1, runAttempt: 1, headSha: sha })).toThrow();
    expect(() => receiptInsertSql(["20260924000000"], { runId: "1 or 1=1", runAttempt: 1, headSha: sha })).toThrow();
    expect(() => receiptInsertSql(["20260924000000"], { runId: 1, runAttempt: 1, headSha: "main" })).toThrow();
  });
});

describe("the workflows wire it", () => {
  const deploy = read(".github/workflows/db-deploy.yml");
  const drift = read(".github/workflows/db-drift-detect.yml");

  it("db-deploy keeps the push output, records receipts, then checks, in that order", () => {
    const push = deploy.indexOf("supabase db push --linked --include-all --password");
    const tee = deploy.indexOf("2>&1 | tee /tmp/db-push.log", push);
    const rec = deploy.indexOf("run: node scripts/check-migration-provenance.mjs record /tmp/db-push.log");
    const chk = deploy.indexOf("        run: node scripts/check-migration-provenance.mjs check");
    expect(push).toBeGreaterThan(0);
    expect(tee).toBe(deploy.indexOf("\n", push) - "2>&1 | tee /tmp/db-push.log".length);
    expect(rec).toBeGreaterThan(tee);
    expect(chk).toBeGreaterThan(rec);
    expect(deploy).toMatch(/permissions:\n {2}contents: read\n(?: {2}#[^\n]*\n)* {2}actions: read/);
  });

  it("db-drift-detect runs the check and fails the night on its outcome", () => {
    expect(drift).toMatch(/id: migration_provenance\n\s+continue-on-error: true[\s\S]*?run: node scripts\/check-migration-provenance\.mjs check/);
    expect(drift).toContain("MIGRATION_PROVENANCE: ${{ steps.migration_provenance.outcome }}");
    expect(drift).toMatch(/if \[ "\$\{MIGRATION_PROVENANCE:-success\}" = "failure" \]; then[\s\S]*?failed=1/);
    expect(drift).toMatch(/permissions:\n(?: {2}[^\n]*\n)*? {2}actions: read/);
  });
});

describe("the ledger", () => {
  const MIG = join(ROOT, "supabase", "migrations");
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

  it("the cutoff is the migration that creates the ledger (nothing after it is ungraded)", () => {
    const cfg = JSON.parse(read("scripts/audit/migration-provenance.json"));
    expect(files).toContain(LEDGER_MIGRATION);
    expect(cfg.cutoff).toBe(LEDGER_MIGRATION.slice(0, 14));
    expect(Array.isArray(cfg.acknowledged)).toBe(true);
  });

  it("is server-only", () => {
    const sql = read(`supabase/migrations/${LEDGER_MIGRATION}`).replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/ALTER TABLE public\.migration_deploy_ledger ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.migration_deploy_ledger FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT[^;]*migration_deploy_ledger[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("no migration writes a receipt (or otherwise touches the ledger) except the one that creates it", () => {
    expect(files.length).toBeGreaterThan(700);
    const touching = files.filter(
      (f) => f !== LEDGER_MIGRATION && /migration_deploy_ledger/i.test(readFileSync(join(MIG, f), "utf8").replace(/--[^\n]*/g, "")),
    );
    expect(touching).toEqual([]);
  });
});
