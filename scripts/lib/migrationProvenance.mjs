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
 */
export function provenanceFindings({ prodVersions, ledger, cutoff, acknowledged, runs }) {
  if (!/^[0-9]{14}$/.test(String(cutoff))) throw new Error(`bad cutoff: ${cutoff}`);
  const prod = new Set(prodVersions.map(String));
  const receipts = new Map(ledger.map((r) => [String(r.version), r]));
  const acked = new Set(acknowledged.map((a) => String(a.version)));

  const unrecorded = [...prod].filter((v) => v > cutoff && !receipts.has(v) && !acked.has(v)).sort();

  // An acknowledgement is exact: it must name a version that IS on prod, newer
  // than the cutoff, and still without a receipt. Anything else is stale.
  const staleAck = [...acked].filter((v) => !(prod.has(v) && v > cutoff && !receipts.has(v))).sort();

  const forged = [];
  for (const [v, r] of receipts) {
    if (!prod.has(v)) {
      forged.push({ version: v, why: "receipt for a version that is not in schema_migrations" });
      continue;
    }
    const run = runs.get(String(r.run_id));
    if (!run) forged.push({ version: v, why: `run ${r.run_id} does not exist in this repository` });
    else if (run.path !== DEPLOY_WORKFLOW_PATH) forged.push({ version: v, why: `run ${r.run_id} is ${run.path}, not ${DEPLOY_WORKFLOW_PATH}` });
    else if (run.head_branch !== "main") forged.push({ version: v, why: `run ${r.run_id} ran on ${run.head_branch}, not main` });
  }
  forged.sort((a, b) => a.version.localeCompare(b.version));

  return { unrecorded, staleAck, forged, judged: [...prod].filter((v) => v > cutoff).length };
}
