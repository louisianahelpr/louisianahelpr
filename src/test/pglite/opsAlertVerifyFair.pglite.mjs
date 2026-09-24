#!/usr/bin/env node
/**
 * PGlite proof for 20260924005818_ops_alert_verify_is_fair (docs/OPEN.md Q291).
 *
 *   node src/test/pglite/opsAlertVerifyFair.pglite.mjs
 *   OLD=1 node src/test/pglite/opsAlertVerifyFair.pglite.mjs   # RED: the 20260923050059 verifier
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * The ledger table is created from its own migration; ops_alert_condition and
 * ops_alert_fold_pending are stubbed so the only thing under test is WHICH
 * items the verifier re-asks. Proves, with a burst of fresh still-failing
 * items larger than one batch and one OLD money item whose condition cleared:
 *   - the old item closes within ceil(open / batch) runs (the old verifier
 *     never reaches it while the burst stays fresher);
 *   - an item whose condition can never be answered (NULL) does not keep its
 *     slot: every open item is asked within ceil(open / 200) runs;
 *   - the same for companions items;
 *   - the migration applies 3x (replay-safe) and anon/authenticated cannot run it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ledgerDdl = mig("20260923043402_ops_alert_ledger.sql").match(/CREATE TABLE IF NOT EXISTS public\.ops_alert_ledger \([\s\S]*?\n\);/)[0];
const prev = mig("20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql");
const oldVerify = prev.slice(prev.indexOf("CREATE OR REPLACE FUNCTION public.ops_alert_verify()"), prev.indexOf("REVOKE ALL ON FUNCTION public.ops_alert_verify()"));

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
${ledgerDdl}
CREATE TABLE public.error_logs (id uuid DEFAULT gen_random_uuid(), message text, tags jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.ops_alert_fold_pending() RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.ops_alert_normalise(t text) RETURNS text LANGUAGE sql AS $$ SELECT t $$;
-- Stub close rule: 'burst' still failing, 'old-money' cleared, 'mute' unanswerable.
CREATE FUNCTION public.ops_alert_condition(p_source text, p_sample_ref jsonb, p_since timestamptz, p_probe_only boolean DEFAULT false)
  RETURNS boolean LANGUAGE sql AS $$
  SELECT CASE WHEN p_source = 'old-money' THEN false WHEN p_source = 'mute' THEN NULL ELSE true END $$;
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

if (process.env.OLD) await db.exec(oldVerify);
else for (let i = 1; i <= 3; i++) {
  try { await db.exec(mig("20260924005818_ops_alert_verify_is_fair.sql")); check(`migration apply #${i}`, true); }
  catch (e) { check(`migration apply #${i}`, false, e.message); }
}

// One old money item (cleared), then a burst of 250 fresh still-failing ones.
await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, verify_kind, last_seen)
         VALUES ('old', 'sql_slack', 'old-money', 'stuck payments', 'critical', 'sql_condition', now() - interval '3 days')`);
await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, verify_kind, last_seen)
         SELECT 'b' || g, 'sql_slack', 'burst', 'report ' || g, 'error', 'sql_condition', now() - (g || ' seconds')::interval
           FROM generate_series(1, 250) g`);

for (let i = 0; i < 2; i++) await q(`SELECT public.ops_alert_verify()`);
const [old] = await q(`SELECT status, verify_started_at FROM public.ops_alert_ledger WHERE fingerprint = 'old'`);
check("old cleared money item closes within 2 runs despite 250 fresher items", old.status === "closed", `status=${old.status}`);

// Never-answerable items must not hold slots: 150 'mute' + the 250 burst = 400 open.
await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, verify_kind, last_seen)
         SELECT 'm' || g, 'sql_slack', 'mute', 'mute ' || g, 'error', 'sql_condition', now() + (g || ' seconds')::interval
           FROM generate_series(1, 150) g`);
await q(`UPDATE public.ops_alert_ledger SET verify_started_at = NULL WHERE status <> 'closed'`);
for (let i = 0; i < 2; i++) await q(`SELECT public.ops_alert_verify()`);
const [{ n }] = await q(`SELECT count(*)::int AS n FROM public.ops_alert_ledger WHERE status <> 'closed' AND verify_started_at IS NULL`);
check("every one of 400 open sql_condition items asked within 2 runs (150 of them never answerable)", n === 0, `never asked: ${n}`);

// Companions: 250 posts with no companions (never closable) + 1 old one must all be asked in 2 runs.
await q(`INSERT INTO public.ops_alert_ledger (fingerprint, source_kind, source, title, severity, verify_kind, last_seen)
         SELECT 'c' || g, 'edge_slack', 'ops-alert:x', 'post ' || g, 'error', 'companions', now() - (g || ' minutes')::interval
           FROM generate_series(1, 251) g`);
for (let i = 0; i < 2; i++) await q(`SELECT public.ops_alert_verify()`);
const [{ c }] = await q(`SELECT count(*)::int AS c FROM public.ops_alert_ledger WHERE verify_kind = 'companions' AND verify_started_at IS NULL`);
check("every one of 251 companions items asked within 2 runs", c === 0, `never asked: ${c}`);

if (!process.env.OLD) {
  const [acl] = await q(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'ops_alert_verify'`);
  check("anon/authenticated cannot execute ops_alert_verify", !/(^|[{,])(anon|authenticated|)=X/.test(acl.a), acl.a);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
