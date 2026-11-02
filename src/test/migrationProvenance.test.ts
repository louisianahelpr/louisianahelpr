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
// @mutate scripts/lib/migrationProvenance.mjs |   const listedLoss = isListedLoss(receipt, lostRuns); |   const listedLoss = false;
// @mutate scripts/lib/migrationProvenance.mjs |   const listedLoss = isListedLoss(receipt, lostRuns); |   const listedLoss = true;
// @mutate scripts/lib/migrationProvenance.mjs | (lostRuns ?? []).some((p) => String(p.version) === String(receipt.version) && String(p.run_id) === String(receipt.run_id)) | (lostRuns ?? []).some((p) => String(p.version) === String(receipt.version))
// @mutate scripts/lib/migrationProvenance.mjs | (lostRuns ?? []).some((p) => String(p.version) === String(receipt.version) && String(p.run_id) === String(receipt.run_id)) | (lostRuns ?? []).some((p) => String(p.run_id) === String(receipt.run_id))
// @mutate scripts/lib/migrationProvenance.mjs | const staleLostRun = lostRuns.filter( | const staleLostRun = [].filter(
// @mutate scripts/check-migration-provenance.mjs |     lostRuns: CONFIG.lostRuns.pairs, |     lostRuns: [],
// @mutate scripts/check-migration-provenance.mjs | f.forged.length \|\| f.staleAck.length \|\| f.staleLostRun.length) return 1; | f.forged.length \|\| f.staleAck.length) return 1;
// @mutate scripts/audit/migration-provenance.json |       { "version": "20261028160637", "run_id": "40738655133" } |       { "version": "20261028160637", "run_id": "40738655134" }
// @mutate scripts/audit/migration-provenance.json |       { "version": "20261028160637", "run_id": "40738655133" } |       { "version": "20261028160637", "run_id": "40738655133" },\n      { "version": "20261030170443", "run_id": "41111832091" }
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

/**
 * db-deploy run 41111832091 went red on 2026-10-30: the lead's own cleanup
 * deleted the completed runs older than 2 days, receipts' runs among them, and
 * the receipts were only 2 days old, so the age test called them forged until
 * about 2026-11-11. The exact pairs are listed; a listed pair skips only that
 * age test.
 */
describe("the receipts of the runs deleted on 2026-10-30 (db-deploy red, run 41111832091)", () => {
  const cutoff = "20260923103737";
  const now = new Date("2026-10-30T19:30:00Z");
  const VERSION = "20261028160637";
  const RUN = "40738655133";
  const sha = "d48b6ac027d0208e472308f6e0dd565d7a1e8901";
  const receipt = { version: VERSION, run_id: Number(RUN), head_sha: sha, recorded_at: "2026-10-28T16:30:00Z" };
  const base = {
    prodVersions: [cutoff, VERSION],
    ledger: [receipt],
    cutoff,
    acknowledged: [] as { version: string }[],
    runs: new Map<string, { path: string; head_branch: string } | null>([[RUN, null]]),
    expiredRun: { minAgeDays: 14 },
    shaEvidence: new Map([[VERSION, { onMain: true, fileAtSha: true }]]),
    lostRuns: [{ version: VERSION, run_id: RUN }],
    now,
  };

  it("a listed version + run id is judged by its sha evidence, not its age", () => {
    const f = provenanceFindings(base);
    expect(f.forged).toEqual([]);
    expect(f.expired).toEqual([{ version: VERSION, run_id: RUN, listedLoss: true }]);
    expect(f.staleLostRun).toEqual([]);
  });

  it("RED without the list (what run 41111832091 reported): the same receipt is forged", () => {
    const f = provenanceFindings({ ...base, lostRuns: [] });
    expect(f.expired).toEqual([]);
    expect(f.forged.map((x) => x.version)).toEqual([VERSION]);
    expect(f.forged[0].why).toMatch(/run 40738655133 does not exist in this repository \(the receipt is 2 day\(s\) old/);
  });

  it("RED: an unlisted missing run is still forged, even beside a listed one", () => {
    const other = { version: "20261028170000", run_id: 40800000000, head_sha: sha, recorded_at: "2026-10-28T17:30:00Z" };
    const f = provenanceFindings({
      ...base,
      prodVersions: [...base.prodVersions, other.version],
      ledger: [receipt, other],
      runs: new Map([[RUN, null], ["40800000000", null]]),
      shaEvidence: new Map([[VERSION, { onMain: true, fileAtSha: true }], [other.version, { onMain: true, fileAtSha: true }]]),
    });
    expect(f.expired.map((x) => x.version)).toEqual([VERSION]);
    expect(f.forged.map((x) => x.version)).toEqual([other.version]);
    expect(f.forged[0].why).toMatch(/2 day\(s\) old/);
  });

  it("RED: a listed version whose receipt names a different run id is still forged", () => {
    const f = provenanceFindings({
      ...base,
      ledger: [{ ...receipt, run_id: 40800000000 }],
      runs: new Map([["40800000000", null]]),
    });
    expect(f.expired).toEqual([]);
    expect(f.forged.map((x) => x.version)).toEqual([VERSION]);
    expect(f.forged[0].why).toMatch(/run 40800000000 does not exist/);
  });

  it("RED: a listed pair whose run id belongs to another version is still forged", () => {
    const f = provenanceFindings({ ...base, lostRuns: [{ version: "20261028155329", run_id: RUN }] });
    expect(f.expired).toEqual([]);
    expect(f.forged.map((x) => x.version)).toEqual([VERSION]);
  });

  it("RED: a listed pair with a bad sha is still forged (off main, without the file, or unread)", () => {
    const off = provenanceFindings({ ...base, shaEvidence: new Map([[VERSION, { onMain: false, fileAtSha: true }]]) });
    expect(off.forged[0].why).toMatch(/is not a commit on main/);
    const nofile = provenanceFindings({ ...base, shaEvidence: new Map([[VERSION, { onMain: true, fileAtSha: false }]]) });
    expect(nofile.forged[0].why).toMatch(/does not carry migration 20261028160637/);
    const none = provenanceFindings({ ...base, shaEvidence: new Map() });
    expect(none.forged[0].why).toMatch(/no commit evidence/);
  });

  it("a listed pair skips only the age test: no expired-run rule or no recorded_at still fails closed", () => {
    const lostRuns = base.lostRuns;
    const good = { onMain: true, fileAtSha: true };
    expect(expiredRunVerdict(receipt, good, { now, minAgeDays: 14, lostRuns })).toBeNull();
    expect(expiredRunVerdict(receipt, good, { now, minAgeDays: undefined, lostRuns })).toMatch(/no expired-run rule/);
    expect(expiredRunVerdict({ ...receipt, recorded_at: undefined }, good, { now, minAgeDays: 14, lostRuns })).toMatch(/no recorded_at/);
    // minAgeDays itself is untouched for everything else.
    expect(expiredRunVerdict(receipt, good, { now, minAgeDays: 14 })).toMatch(/2 day\(s\) old/);
  });

  it("a live run is judged as a live run even when listed, and the list entry reads as stale", () => {
    const f = provenanceFindings({ ...base, runs: new Map([[RUN, { path: ".github/workflows/test.yml", head_branch: "main" }]]) });
    expect(f.forged.map((x) => x.version)).toEqual([VERSION]);
    expect(f.expired).toEqual([]);
    expect(f.staleLostRun).toEqual([`${VERSION} ${RUN}`]);
  });

  it("RED: a listed pair no receipt carries is stale (the list is exact, both ways)", () => {
    const wrong = provenanceFindings({ ...base, lostRuns: [...base.lostRuns, { version: VERSION, run_id: "40800000000" }] });
    expect(wrong.staleLostRun).toEqual([`${VERSION} 40800000000`]);
    const absent = provenanceFindings({ ...base, lostRuns: [...base.lostRuns, { version: "20261028170000", run_id: RUN }] });
    expect(absent.staleLostRun).toEqual([`20261028170000 ${RUN}`]);
  });

  // Exactly what was measured gone on 2026-10-30 (GET actions/runs/<id> 404 at
  // about 19:14Z), by run id. 44 came from run 41111832091's log; the last 3
  // (run 40564500215) were deleted after that run looked them up.
  const LOST: Record<string, string[]> = {
    // Added 2026-11-01 7:37 PM (L29): the same 10-30 deletion; db-deploy run 41371592369 listed them.
    "41147292640": ["20261030212051", "20261030212558", "20261030215251", "20261030220537", "20261030221156", "20261030221720", "20261030224733"],
    "41152862549": ["20261030221255", "20261030223154"],
    // Added 2026-11-01 (L29, lead approve): the same 10-30 deletion; db-deploy run 41362419307 listed them.
  "41111832091": ["20261030134231", "20261030141656", "20261030144112", "20261030144615", "20261030150104", "20261030150556", "20261030150630", "20261030150631", "20261030152217", "20261030152601", "20261030153635", "20261030153722", "20261030154707", "20261030154745", "20261030155159", "20261030161617", "20261030170443"],
    "41115469385": ["20261030160851"],
    "41139273387": ["20261030164712", "20261030165438"],
    "41128285951": ["20261030171747", "20261030174314"],
    "40564500215": ["20261027154114", "20261027155019", "20261027155507"],
    "40574724847": ["20261026155251", "20261026155252", "20261027153244", "20261027153245", "20261027154326", "20261027163240", "20261027170717", "20261027171453", "20261027182550"],
    "40582322410": ["20261027183058", "20261027194309", "20261027201034"],
    "40588446067": ["20261027185146"],
    "40597162474": ["20261027220459"],
    "40606137788": ["20261027185147"],
    "40609111505": ["20261027201848"],
    "40610208907": ["20261027200455", "20261027223332"],
    "40612975589": ["20261027165232", "20261027165903", "20261027172503", "20261027174633", "20261027194235", "20261027194426", "20261027200024", "20261027201327", "20261027203030", "20261027204745", "20261027205028", "20261027205327", "20261027213431"],
    "40615032957": ["20261027204500", "20261027233614"],
    "40623012003": ["20261027222743"],
    "40624917778": ["20261027211754", "20261028003604", "20261028022715"],
    "40630560064": ["20261028012406"],
    "40639932058": ["20261028014848", "20261028014849"],
    "40718824063": ["20261028151647"],
    "40734689453": ["20261028151144"],
    "40738655133": ["20261028155329", "20261028160637"],
  };

  it("the checked-in list is exactly the measured pairs, dated and explained, and each names a real migration", () => {
    const cfg = JSON.parse(read("scripts/audit/migration-provenance.json"));
    const got = (cfg.lostRuns.pairs as { version: string; run_id: string }[]).map((p) => `${p.version} ${p.run_id}`).sort();
    const want = Object.entries(LOST).flatMap(([run, vs]) => vs.map((v) => `${v} ${run}`)).sort();
    expect(want.length).toBeGreaterThan(40);
    expect(got).toEqual(want);
    expect(new Set(got).size).toBe(got.length);
    expect(cfg.lostRuns.date).toBe("2026-10-30");
    expect(cfg.lostRuns.reason).toMatch(/deleted/);
    // The list never widens the general rule.
    expect(cfg.expiredRun.minAgeDays).toBe(14);
    const migrations = readdirSync(join(ROOT, "supabase", "migrations"));
    const noFile = got.map((p) => p.slice(0, 14)).filter((v) => !migrations.some((f) => f.startsWith(`${v}_`)));
    expect(noFile).toEqual([]);
  });

  it("the live check wires the list and fails on a stale entry", () => {
    const script = read("scripts/check-migration-provenance.mjs");
    expect(script).toContain("lostRuns: CONFIG.lostRuns.pairs,");
    expect(script).toContain("f.staleLostRun.length");
  });

  it("the list file still re-runs db-deploy when edited", () => {
    expect(read(".github/workflows/db-deploy.yml")).toContain('- "scripts/audit/migration-provenance.json"');
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
