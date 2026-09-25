// Probe: 20260915055601_revoke_excess_anon_grants.sql and the class check
// scripts/ci/sensitive-anon-grants.sql, in real Postgres (PGlite).
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/anon-table-grants.probe.mjs
//
// Prod shape read 2026-09-15 (H-004 fixture + AUTHZ-02 live probe): the
// default-privilege rule that hands anon/authenticated arwdxm on every relation
// postgres creates in public; public.jobs RLS on with INSERT/UPDATE policies TO
// public and its DELETE policy TO authenticated; the sensitive admin/money/trust
// tables RLS on with no anon read/write path; analytics_events/error_logs RLS on
// with a permissive anon INSERT policy; and open_jobs_browse (security_invoker
// off, owner bypasses RLS) as the guest-browse read path.
//
// 1. BEFORE: class check RED — jobs on DELETE (its only unbacked write), each
//    sensitive table on SELECT + its unbacked writes; analytics/error on
//    SELECT + UPDATE/DELETE but NOT INSERT (that one is policy-backed). An
//    out-of-scope table (saved_jobs) with the same default-priv anon writes is
//    NOT flagged — the WRITE rule is the curated high-value set, not blanket.
//    messages (in scope since Q340) in its pre-Q399 prod shape: INSERT and
//    DELETE flagged by the WRITE rule, UPDATE NOT (its "mark as read" policy is
//    TO public, the exemption Q399 is about) but flagged by the ANON-POLICY
//    rule (Q399, 2026-09-25).
//    The ZERO-POLICY rule (2026-09-19) is the one that is NOT a list: the
//    policy-less notification_dedupe_suppressions is flagged for both client
//    roles on all four privileges, while the equally policy-less
//    edge_rate_limit_log, which holds no client grant, is not.
// 2. AFTER (migration 3x): class check GREEN; anon has nothing on jobs, no
//    SELECT on any sensitive table, INSERT-only on analytics/error; authenticated
//    keeps its explicit grants (reads sensitive, writes jobs); guest browse via
//    open_jobs_browse still returns the row.
// 3. Broken copies of the migration each leave the check red; for messages,
//    the Q399 policy left TO public, and an anon UPDATE re-grant after the fix,
//    are each red.
// 4. Skip path: no tables -> migration runs twice as a no-op.
// 5. PG15 parse-safety: neither the migration nor the check names a bare
//    version-specific privilege keyword (MAINTAIN).
// Exit 1 on any mismatch.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const MIG = read("../../supabase/migrations/20260915055601_revoke_excess_anon_grants.sql");
// The zero-policy rule's own migration: the table that rule was written for.
const MIG_ZP = read("../../supabase/migrations/20260919172735_revoke_client_grants_on_dedupe_suppressions.sql");
const CHECK = read("../ci/sensitive-anon-grants.sql");
// messages: Q340 revokes anon writes, Q399 moves the last TO-public write
// policy to authenticated.
const MIG_Q340 = read("../../supabase/migrations/20260925144708_revoke_anon_writes_on_messages.sql");
const MIG_Q399 = read("../../supabase/migrations/20260925175559_messages_mark_read_policy_to_authenticated.sql");
const RECEIVER = "5b0e0a6c-7a43-4a55-9d8f-0c2b1f7d9e11";
const MSG = "8f3c2d1e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

const OWNER = "vbypass"; // stands in for postgres: BYPASSRLS, not a superuser
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const STRANGER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "e6979a12-ee25-46c9-98f5-c088189849e5";

// The 12 sensitive tables that take no anon write, + the 2 telemetry tables.
const SENSITIVE_NOWRITE = [
  "admin_audit_log", "fraud_flags", "user_bans", "payout_transfers", "instant_payouts",
  "reports", "login_history", "helper_verifications", "gift_cards", "referral_codes",
  "tips", "push_tokens",
];
const TELEMETRY = ["analytics_events", "error_logs"];

const SETUP = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE ${OWNER} NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, ${OWNER};
GRANT CREATE ON SCHEMA public TO ${OWNER};
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, ${OWNER};
GRANT ${OWNER} TO current_user;
-- prod: ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public -> anon/authenticated arwdx
-- (MAINTAIN omitted; PGlite honours the rest and it is not part of this class).
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO anon, authenticated;
SET ROLE ${OWNER};

-- jobs: the H-004 shape. INSERT/UPDATE policies TO public, DELETE TO authenticated.
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid,
  helper_id uuid, status text, payment_status text, title text);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
-- Participant SELECT policy (guests use the view, not base jobs). Needed so a
-- poster's own-row UPDATE can see the row it targets under RLS.
CREATE POLICY "Participants can view their jobs" ON public.jobs FOR SELECT TO authenticated
  USING (auth.uid() = customer_id OR auth.uid() = helper_id);
CREATE POLICY "Customers can create jobs" ON public.jobs FOR INSERT WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Customers can delete their own jobs" ON public.jobs FOR DELETE TO authenticated USING (auth.uid() = customer_id);
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', NULL, 'open', 'escrow', 'Deep clean');

-- Guest-browse view: security_invoker off, owner bypasses RLS. anon reads it,
-- never base jobs.
CREATE VIEW public.open_jobs_browse WITH (security_invoker=false) AS
  SELECT id, customer_id, status, payment_status, title FROM public.jobs
   WHERE payment_status IN ('escrow','payout_pending','released');
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- Sensitive tables with NO anon read/write path (admin SELECT only).
${SENSITIVE_NOWRITE.map((t) => `
CREATE TABLE public.${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;
CREATE POLICY "${t}_admin_read" ON public.${t} FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));`).join("\n")}

-- Telemetry: permissive anon INSERT policy, admin-only SELECT.
${TELEMETRY.map((t) => `
CREATE TABLE public.${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;
CREATE POLICY "${t}_insert" ON public.${t} FOR INSERT WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "${t}_admin_read" ON public.${t} FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));`).join("\n")}

-- ZERO-POLICY fixture: the exact prod shape of notification_dedupe_suppressions
-- before 20260919172735 — RLS on, NO policy at all (service-only, written by a
-- definer trigger), and therefore handed anon+authenticated arwdx by the
-- default-privilege rule above with nobody noticing. The old allowlist rules
-- could not see it: it is not the jobs table and it is not one of the fourteen
-- sensitive names.
CREATE TABLE public.notification_dedupe_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, kind text);
ALTER TABLE public.notification_dedupe_suppressions ENABLE ROW LEVEL SECURITY;

-- Zero-policy CONTROL: same shape, but the client roles were never granted
-- anything (prod's edge_rate_limit_log / retained_bans). Must NOT be flagged,
-- or the rule is a blanket "every policy-less table is an offender".
CREATE TABLE public.edge_rate_limit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket text);
ALTER TABLE public.edge_rate_limit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.edge_rate_limit_log FROM PUBLIC, anon, authenticated;

-- Out-of-scope control: same default-priv anon writes, TO-authenticated policies.
-- Must NOT be flagged — proves the write rule is scoped, not blanket.
CREATE TABLE public.saved_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_jobs_owner_write" ON public.saved_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- messages, the prod policy set before Q399 (roles as pg_policies shows them):
-- SELECT/INSERT/DELETE and the sender edit TO authenticated; "Users can mark
-- messages as read" with no TO clause (20260819060000), i.e. TO public. The
-- default-priv rule above hands anon INSERT/UPDATE/DELETE, as prod had before
-- Q340.
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid,
  receiver_id uuid, content text, read boolean DEFAULT false);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = sender_id OR (SELECT auth.uid()) = receiver_id);
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = sender_id);
CREATE POLICY "Users can edit their own sent messages" ON public.messages FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = sender_id) WITH CHECK ((SELECT auth.uid()) = sender_id);
CREATE POLICY "Users can delete their own sent messages" ON public.messages FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = sender_id);
CREATE POLICY "Users can mark messages as read" ON public.messages FOR UPDATE
  USING ((SELECT auth.uid()) = receiver_id) WITH CHECK ((SELECT auth.uid()) = receiver_id);
INSERT INTO public.messages (id, sender_id, receiver_id, content) VALUES ('${MSG}', '${POSTER}', '${RECEIVER}', 'hi');
RESET ROLE;
`;

async function fresh(migrations = [], times = 1) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) for (const m of migrations) await db.exec(m);
  return db;
}
const checkRows = async (db) => (await db.query(CHECK)).rows;
const priv = async (db, role, tbl, p) =>
  (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${tbl}`, p])).rows[0].ok;

async function asRole(db, role, uid, sql) {
  await db.exec("BEGIN");
  try {
    if (uid) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    let rows, err = null;
    try { rows = (await db.query(sql)).rows; } catch (e) { err = e; }
    return { rows, err };
  } finally {
    await db.exec("ROLLBACK");
  }
}
const outcome = (r) => (r.err ? (r.err.code === "42501" ? "refused" : `error ${r.err.code}`) : (r.rows.length ? "applied" : "noop"));

let failures = 0;
const expect = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const has = (rows, tbl, p, rule) => rows.some((r) => r.table === tbl && r.priv === p && r.rule === rule);

{
  console.log("== 1. BEFORE (prod shape, default-priv grants live)");
  const db = await fresh();
  const rows = await checkRows(db);
  expect(rows.length > 0, `class check RED: ${rows.length} offending (table, priv) rows`);
  expect(has(rows, "jobs", "DELETE", "write:no-policy"), "jobs flagged on DELETE (policy is TO authenticated)");
  expect(!has(rows, "jobs", "INSERT", "write:no-policy") && !has(rows, "jobs", "UPDATE", "write:no-policy"),
    "jobs NOT flagged on INSERT/UPDATE (those policies are TO public)");
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    const rule = p === "SELECT" ? "read:sensitive" : "write:no-policy";
    expect(has(rows, "payout_transfers", p, rule), `payout_transfers flagged on ${p}`);
  }
  expect(has(rows, "analytics_events", "SELECT", "read:sensitive"), "analytics_events flagged on SELECT");
  expect(has(rows, "analytics_events", "UPDATE", "write:no-policy") && has(rows, "analytics_events", "DELETE", "write:no-policy"),
    "analytics_events flagged on UPDATE/DELETE");
  expect(!has(rows, "analytics_events", "INSERT", "write:no-policy"),
    "analytics_events NOT flagged on INSERT (permissive anon INSERT policy backs it)");
  expect(!rows.some((r) => r.table === "saved_jobs"), "out-of-scope saved_jobs NOT flagged (rule is scoped, not blanket)");
  // messages, pre-Q340/Q399 shape.
  expect(has(rows, "messages", "INSERT", "write:no-policy") && has(rows, "messages", "DELETE", "write:no-policy"),
    "messages flagged on INSERT/DELETE (Q340: no anon/public policy backs them)");
  expect(!has(rows, "messages", "UPDATE", "write:no-policy"),
    "messages NOT flagged on UPDATE by the WRITE rule (the TO-public read policy exempts it: the Q399 gap)");
  expect(has(rows, "messages", "UPDATE", "write:anon-policy"),
    "messages flagged on UPDATE by the ANON-POLICY rule (Q399)");

  // ── the ZERO-POLICY rule (2026-09-19) ────────────────────────────────────
  // Both client roles, all four privileges, on a table no allowlist names.
  for (const role of ["anon", "authenticated"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(
        rows.some((r) => r.table === "notification_dedupe_suppressions" && r.role === role && r.priv === p
          && r.rule === "zero-policy:client-grant"),
        `notification_dedupe_suppressions flagged for ${role} ${p} (zero-policy)`,
      );
    }
  }
  expect(!rows.some((r) => r.table === "edge_rate_limit_log"),
    "a policy-less table with NO client grant is NOT flagged (the rule is about grants, not about having no policy)");
  // And no stale exception, because the exception list is empty.
  expect(!rows.some((r) => r.rule === "stale-exception:zero-policy"),
    "no stale zero-policy exception (the list is empty)");
}

{
  console.log("\n== 2. AFTER (migration 3x)");
  const db = await fresh([MIG, MIG_ZP, MIG_Q340, MIG_Q399], 3);
  const rows = await checkRows(db);
  expect(rows.length === 0, `class check GREEN (${rows.length} rows)`);
  for (const role of ["anon", "authenticated"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect((await priv(db, role, "notification_dedupe_suppressions", p)) === false,
        `${role} has NO ${p} on notification_dedupe_suppressions`);
    }
  }

  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    expect((await priv(db, "anon", "jobs", p)) === false, `anon has NO ${p} on jobs`);
  }
  expect((await priv(db, "anon", "payout_transfers", "SELECT")) === false, "anon has NO SELECT on payout_transfers");
  expect((await priv(db, "anon", "payout_transfers", "DELETE")) === false, "anon has NO DELETE on payout_transfers");
  // Telemetry: INSERT kept, the rest gone.
  expect((await priv(db, "anon", "analytics_events", "INSERT")) === true, "anon KEEPS INSERT on analytics_events");
  expect((await priv(db, "anon", "analytics_events", "SELECT")) === false, "anon has NO SELECT on analytics_events");
  expect((await priv(db, "anon", "error_logs", "INSERT")) === true, "anon KEEPS INSERT on error_logs");
  // authenticated untouched.
  expect((await priv(db, "authenticated", "payout_transfers", "SELECT")) === true, "authenticated KEEPS SELECT on payout_transfers");
  expect((await priv(db, "authenticated", "jobs", "INSERT")) === true, "authenticated KEEPS INSERT on jobs");
  expect((await priv(db, "authenticated", "jobs", "DELETE")) === true, "authenticated KEEPS DELETE on jobs");

  // Legitimate anon telemetry write still lands; anon write to jobs refused.
  // No RETURNING: anon has (correctly) no SELECT on analytics_events, and the
  // app inserts without it — success = no error.
  const insRes = await asRole(db, "anon", null, `INSERT INTO public.analytics_events (user_id) VALUES (NULL)`);
  expect(insRes.err === null, `anon INSERT analytics_events (must keep working)${insRes.err ? ` — ${insRes.err.code}` : ""}`);
  const del = outcome(await asRole(db, "anon", null, `DELETE FROM public.jobs WHERE id='${JOB}' RETURNING id`));
  expect(del === "refused", `${del.padEnd(8)} anon DELETE jobs (must be refused)`);
  // Guest browse survives.
  const browse = outcome(await asRole(db, "anon", null, `SELECT id FROM public.open_jobs_browse WHERE id='${JOB}'`));
  expect(browse === "applied", `${browse.padEnd(8)} anon SELECT open_jobs_browse (guest browse must still work)`);
  // authenticated poster can still operate their job (RLS-gated).
  const upd = outcome(await asRole(db, "authenticated", POSTER, `UPDATE public.jobs SET title='x' WHERE id='${JOB}' RETURNING id`));
  expect(upd === "applied", `${upd.padEnd(8)} poster UPDATE own job (RLS-gated, must still work)`);

  // messages after Q340 + Q399.
  for (const p of ["INSERT", "UPDATE", "DELETE"]) {
    expect((await priv(db, "anon", "messages", p)) === false, `anon has NO ${p} on messages`);
  }
  const roles = (await db.query(`SELECT roles::text AS r, cmd FROM pg_policies WHERE tablename='messages' AND policyname='Users can mark messages as read'`)).rows;
  expect(roles.length === 1 && roles[0].r === "{authenticated}" && roles[0].cmd === "UPDATE",
    `"Users can mark messages as read" is FOR UPDATE TO authenticated (${JSON.stringify(roles)})`);
  const markRead = outcome(await asRole(db, "authenticated", RECEIVER, `UPDATE public.messages SET read = true WHERE id='${MSG}' RETURNING id`));
  expect(markRead === "applied", `${markRead.padEnd(8)} receiver marks the message read (must still work)`);
  const stranger = outcome(await asRole(db, "authenticated", STRANGER, `UPDATE public.messages SET read = true WHERE id='${MSG}' RETURNING id`));
  expect(stranger === "noop", `${stranger.padEnd(8)} a stranger's mark-read matches no row`);
}

{
  console.log("\n== 3. Broken copies of the migration (each must leave the check red)");
  const BROKEN = [
    ["jobs revoked only FROM PUBLIC (anon keeps its explicit default-priv grant)",
      MIG.replace("REVOKE ALL ON public.jobs FROM anon;", "-- (anon revoke dropped)")],
    ["telemetry section dropped (analytics UPDATE/DELETE stay open)",
      MIG.replace("REVOKE SELECT, UPDATE, DELETE ON public.%I FROM anon", "-- SELECT ONLY placeholder")],
    ["payout_transfers dropped from the sensitive list",
      MIG.replace("'payout_transfers',     -- money: admin + self earnings/payment tabs (authed)", "")],
  ];
  for (const [name, sql] of BROKEN) {
    if (sql === MIG) { expect(false, `mutation did not apply: ${name}`); continue; }
    const db = await fresh([sql, MIG_ZP]);
    const rows = await checkRows(db);
    expect(rows.length > 0, `${name}: check red with ${rows.length} rows`);
  }

  // The zero-policy migration's own broken copies: revoking only from PUBLIC,
  // or only from anon, must each leave the check red. `FROM PUBLIC` alone
  // leaving a role's explicit grant is the repo's own scar
  // (docs/lessons -> revoke-anon), so it is proven here rather than assumed.
  const ZP_BROKEN = [
    ["dedupe: anon revoke dropped", MIG_ZP.replace("REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM anon;", "")],
    ["dedupe: authenticated revoke dropped", MIG_ZP.replace("REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM authenticated;", "")],
    ["dedupe: only FROM PUBLIC", MIG_ZP
      .replace("REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM anon;", "")
      .replace("REVOKE ALL ON TABLE public.notification_dedupe_suppressions FROM authenticated;", "")],
  ];
  // Q399: the policy restated TO public again -> the ANON-POLICY rule is red.
  const q399Public = MIG_Q399.replace("    TO authenticated\n", "");
  if (q399Public === MIG_Q399) expect(false, "mutation did not apply: Q399 TO clause");
  else {
    const db = await fresh([MIG, MIG_ZP, MIG_Q340, q399Public]);
    expect(has(await checkRows(db), "messages", "UPDATE", "write:anon-policy"),
      "Q399 policy left TO public: ANON-POLICY rule red on messages UPDATE");
  }
  // After the fix, an anon UPDATE re-grant (prod's default privileges on any
  // recreation) is caught by the WRITE rule, which the TO-public policy used to
  // exempt.
  {
    const db = await fresh([MIG, MIG_ZP, MIG_Q340, MIG_Q399]);
    await db.exec("GRANT UPDATE ON public.messages TO anon");
    expect(has(await checkRows(db), "messages", "UPDATE", "write:no-policy"),
      "anon UPDATE re-granted on messages after Q399: WRITE rule red");
  }
  // …and the same re-grant WITHOUT Q399 stays invisible to the WRITE rule:
  // the gap, shown rather than asserted.
  {
    const db = await fresh([MIG, MIG_ZP, MIG_Q340]);
    await db.exec("GRANT UPDATE ON public.messages TO anon");
    expect(!has(await checkRows(db), "messages", "UPDATE", "write:no-policy"),
      "without Q399 the same re-grant is exempt from the WRITE rule (why the ANON-POLICY rule exists)");
  }

  for (const [name, sql] of ZP_BROKEN) {
    if (sql === MIG_ZP) { expect(false, `mutation did not apply: ${name}`); continue; }
    const db = await fresh([MIG, sql]);
    const rows = await checkRows(db);
    expect(rows.some((r) => r.rule === "zero-policy:client-grant"),
      `${name}: zero-policy rule still red (${rows.filter((r) => r.rule === "zero-policy:client-grant").length} rows)`);
  }
}

{
  console.log("\n== 4. Skip path (no tables -> migration is a no-op twice)");
  const db = new PGlite();
  let ok = true;
  try {
    await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
    for (let i = 0; i < 2; i++) await db.exec(MIG);
  } catch (e) { ok = false; console.log(e.message); }
  expect(ok, "no tables: migration runs twice as a no-op");
}

{
  console.log("\n== 5. PG15 parse-safety (no bare MAINTAIN keyword)");
  for (const [name, sql] of [["20260915055601", MIG], ["20260919172735", MIG_ZP], ["sensitive-anon-grants.sql", CHECK]]) {
    const bare = sql.split("\n").filter((l) => !l.trim().startsWith("--") && /\bMAINTAIN\b/i.test(l) && !/'[^']*\bMAINTAIN\b[^']*'/i.test(l));
    expect(bare.length === 0, `${name}: no bare MAINTAIN${bare.length ? ` — ${bare.join(" | ")}` : ""}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL EXPECTATIONS HELD");
process.exit(failures ? 1 : 0);
