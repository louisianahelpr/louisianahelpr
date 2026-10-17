/**
 * Q117 — who applied each prod migration. Pure functions; the I/O lives in
 * scripts/check-migration-provenance.mjs. Tested in
 * src/test/migrationProvenance.test.ts and, against a real Postgres, in
 * src/test/pglite/migrationProvenance.pglite.mjs.
 */

export const DEPLOY_WORKFLOW_PATH = ".github/workflows/db-deploy.yml";

/**
 * Versions `supabase db push` says it applied. The CLI prints one
 * "Applying migration <version>_<name>.sql..." line per file. Only these are
 * receipts: a before/after diff of schema_migrations would credit db-deploy
 * with anything another writer applied during the same window.
 */
export function parseAppliedVersions(pushOutput) {
  const out = new Set();
  for (const m of String(pushOutput).matchAll(/Applying migration\s+(\d{14})_[^\s]*\.sql/g)) out.add(m[1]);
  return [...out].sort();
}

/** INSERT for the receipts. Every value is validated, never interpolated raw. */
export function receiptInsertSql(versions, { runId, runAttempt, headSha }) {
  if (!versions.length) return null;
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error(`bad run id: ${runId}`);
  if (!/^[1-9][0-9]*$/.test(String(runAttempt))) throw new Error(`bad run attempt: ${runAttempt}`);
  if (!/^[0-9a-f]{40}$/.test(String(headSha))) throw new Error(`bad sha: ${headSha}`);
  const rows = versions.map((v) => {
    if (!/^[0-9]{14}$/.test(v)) throw new Error(`bad version: ${v}`);
    return `('${v}', ${runId}, ${runAttempt}, '${headSha}')`;
  });
  return (
    "INSERT INTO public.migration_deploy_ledger (version, run_id, run_attempt, head_sha) VALUES " +
    rows.join(", ") +
    " ON CONFLICT (version) DO NOTHING RETURNING version"
  );
}

/**
 * @param {object} a
 * @param {string[]} a.prodVersions   supabase_migrations.schema_migrations.version
 * @param {{version:string, run_id:number|string}[]} a.ledger  migration_deploy_ledger rows
 * @param {string} a.cutoff           versions <= cutoff predate the receipt and are not judged
 * @param {{version:string}[]} a.acknowledged  out-of-band versions a human accepted (exact)
 * @param {Map<string, {path:string, head_branch:string}|null>} a.runs  GitHub run lookups by run id
 * @param {{minAgeDays:number}} [a.expiredRun]  when a receipt's run is gone (see expiredRunVerdict)
 * @param {Map<string, {onMain:boolean, fileAtSha:boolean}>} [a.shaEvidence]  by version, for gone runs
 * @param {Date} [a.now]
 */
export function provenanceFindings({ prodVersions, ledger, cutoff, acknowledged, runs, expiredRun, shaEvidence, now = new Date() }) {
  if (!/^[0-9]{14}$/.test(String(cutoff))) throw new Error(`bad cutoff: ${cutoff}`);
  const prod = new Set(prodVersions.map(String));
  const receipts = new Map(ledger.map((r) => [String(r.version), r]));
  const acked = new Set(acknowledged.map((a) => String(a.version)));

  const unrecorded = [...prod].filter((v) => v > cutoff && !receipts.has(v) && !acked.has(v)).sort();

  // An acknowledgement is exact: it must name a version that IS on prod, newer
  // than the cutoff, and still without a receipt. Anything else is stale.
  const staleAck = [...acked].filter((v) => !(prod.has(v) && v > cutoff && !receipts.has(v))).sort();

  const forged = [];
  const expired = [];
  for (const [v, r] of receipts) {
    if (!prod.has(v)) {
      forged.push({ version: v, why: "receipt for a version that is not in schema_migrations" });
      continue;
    }
    const run = runs.get(String(r.run_id));
    if (!run) {
      const why = expiredRunVerdict(r, shaEvidence?.get(v), { now, minAgeDays: expiredRun?.minAgeDays });
      if (why === null) expired.push({ version: v, run_id: String(r.run_id) });
      else forged.push({ version: v, why: `run ${r.run_id} does not exist in this repository (${why})` });
    }
    else if (run.path !== DEPLOY_WORKFLOW_PATH) forged.push({ version: v, why: `run ${r.run_id} is ${run.path}, not ${DEPLOY_WORKFLOW_PATH}` });
    else if (run.head_branch !== "main") forged.push({ version: v, why: `run ${r.run_id} ran on ${run.head_branch}, not main` });
  }
  forged.sort((a, b) => a.version.localeCompare(b.version));

  expired.sort((a, b) => a.version.localeCompare(b.version));
  return { unrecorded, staleAck, forged, expired, judged: [...prod].filter((v) => v > cutoff).length };
}

/**
 * A receipt whose GitHub run is gone. GitHub does lose runs: every run of
 * every workflow created between 2026-10-01 01:40Z and 2026-10-03 15:54Z
 * answers 404 today (measured 2026-10-17: `actions/runs?created=2026-10-02`
 * total_count 0, against 1685 on 2026-09-30, while the 2026-09-23 receipt
 * runs still exist, so it is not age-based retention), and the 14 receipts
 * from that window turned every db-deploy red. A missing run is no longer, by
 * itself, a forgery. What the receipt still proves on its own decides:
 *   - it is at least minAgeDays old: it was judged against its live run by
 *     every db-deploy and the nightly db-drift-detect in that time, so a run
 *     missing sooner than that is never treated as lost;
 *   - its head_sha is a commit on main, and that commit carries the
 *     version's migration file (db-deploy applies main's migrations).
 * Returns null when all hold, else the reason it is still judged forged.
 */
export function expiredRunVerdict(receipt, evidence, { now, minAgeDays }) {
  if (!Number.isFinite(minAgeDays) || minAgeDays < 1) return "no expired-run rule configured";
  const at = Date.parse(String(receipt.recorded_at ?? ""));
  if (!Number.isFinite(at)) return "the receipt has no recorded_at";
  const ageDays = (now.getTime() - at) / 86_400_000;
  if (ageDays < minAgeDays) return `the receipt is ${Math.floor(ageDays)} day(s) old; a run missing within ${minAgeDays} days is not taken as lost`;
  if (!evidence) return "no commit evidence was read for it";
  if (!evidence.onMain) return `head_sha ${receipt.head_sha} is not a commit on main`;
  if (!evidence.fileAtSha) return `head_sha ${receipt.head_sha} does not carry migration ${receipt.version}`;
  return null;
}
