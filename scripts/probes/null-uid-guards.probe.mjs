// Probe: 20260915101102 (a NULL auth.uid() is not the service role) and the
// class check scripts/ci/null-uid-trust.sql, in real Postgres (PGlite).
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/null-uid-guards.probe.mjs
//
// Schema: scripts/probes/fixtures/null-uid-guards.live.sql, generated read-only
// from LIVE prod on 2026-09-15 — every column of jobs/profiles/messages/
// disputes/reviews/user_roles, auth.uid()/auth.role() verbatim, and verbatim
// bodies of all 23 NULL-uid guards + the 3 reviewed exemptions + has_role,
// with the live triggers of a representative set attached: jobs (field
// escalation, poster money lock, helper whitelist [SECURITY INVOKER],
// cancellation-requires-RPC), profiles (self-escalation), messages (non-sender
// read-only, read_at stamp), disputes (opener whitelist), reviews (validity).
//
// Every client role holds table grants and no RLS is on: that stands in for the
// door the guards exist for (open_jobs_browse was one — an RLS-bypassing view
// anon could write). Contexts are set exactly as their real callers set them:
//   anon REST      SET LOCAL ROLE anon + request.jwt.claims {"role":"anon"}
//   anon (role)    SET LOCAL ROLE anon, no claims      (proves the SET ROLE half)
//   anon (claim)   claims {"role":"anon"}, no SET ROLE (proves the JWT half)
//   service_role   SET LOCAL ROLE service_role + claims {"role":"service_role"}
//   cron           nothing set (pg_cron / migrations run as postgres)
//   user           SET LOCAL ROLE authenticated + claims {sub, role:authenticated}
//
// 1. BEFORE, live bodies: class check lists exactly the 23; every anon write
//    below LANDS (the bypass), while service_role/cron/party behaviour is as
//    listed. The AFTER expectations must fail here.
// 2. AFTER, the migration applied 3x on top: class check GREEN; anon writes
//    refused or neutralised in all three anon contexts; service_role and cron
//    unchanged; poster/helper/stranger/admin outcomes identical to BEFORE.
//    Grants: PUBLIC/anon hold no EXECUTE on the 23; anon/authenticated can call
//    is_server_context().
// 3. Broken copies, each on a fresh database: each must fail >=1 expectation.
// 4. Exemptions are live: without the NOT IN list the check lists exactly them.
// 5. Replay-safety: the migration runs 3x on a database with none of the tables.
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
const LIVE = read("./fixtures/null-uid-guards.live.sql");
const MIG = read("../../supabase/migrations/20260915101102_null_uid_is_not_server.sql");
const CHECK = read("../ci/null-uid-trust.sql");

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const STRANGER = "5eed0000-0000-4000-8000-00000000abcd";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const JOB = "10000000-0000-4000-8000-000000000001";
const DONE = "10000000-0000-4000-8000-000000000002";
const MSG = "30000000-0000-4000-8000-000000000001";
const DISPUTE = "40000000-0000-4000-8000-000000000001";

const THE_23 = [
  "enforce_application_credential_tier", "enforce_application_job_state", "enforce_audit_log_self_attribution",
  "enforce_banned_profile_text_lock", "enforce_block_on_message_insert", "enforce_cancellation_requires_rpc",
  "enforce_confirm_on_live_job", "enforce_credential_status_server_owned", "enforce_dispute_opener_column_whitelist",
  "enforce_group_roster_award_gate", "enforce_helper_award_gate", "enforce_helper_completion_gates",
  "enforce_helper_jobs_column_whitelist", "enforce_job_funded_before_award", "enforce_jobs_insert_column_lock",
  "enforce_message_non_sender_read_only", "enforce_poster_jobs_money_lock", "enforce_review_validity",
  "prevent_job_field_escalation", "prevent_self_escalation", "reject_new_group_jobs",
  "snapshot_application_job_point", "stamp_message_read_at",
];

const ROLES = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
`;
const SETUP = `
${ROLES}
${LIVE}
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
-- The door: a client write that reaches the table (no RLS in the way).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
INSERT INTO public.user_roles (id, user_id, role) VALUES (gen_random_uuid(), '${ADMIN}', 'admin');
INSERT INTO public.jobs (id, customer_id, helper_id, status, payment_status, budget, platform_fee_amount, title)
  VALUES ('${JOB}', '${POSTER}', '${HELPER}', 'in_progress', 'escrow', 100, 10, 'Deep clean'),
         ('${DONE}', '${POSTER}', '${HELPER}', 'completed', 'released', 100, 10, 'Yard');
INSERT INTO public.profiles (id, user_id, full_name, bio, ban_status, approval_status, subscription_tier)
  VALUES (gen_random_uuid(), '${STRANGER}', 'Pat', 'hi', 'none', 'pending', 'free');
INSERT INTO public.messages (id, job_id, sender_id, receiver_id, content, read, read_at)
  VALUES ('${MSG}', '${JOB}', '${POSTER}', '${HELPER}', 'see you at 9', false, NULL);
INSERT INTO public.disputes (id, job_id, opener_id, status, reason, decided_at, payout_split)
  VALUES ('${DISPUTE}', '${JOB}', '${POSTER}', 'open', 'no show', NULL, NULL);
`;

async function fresh(extra = [], times = 1) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) for (const m of extra) await db.exec(m);
  return db;
}

const CTX = {
  anon: { role: "anon", claims: { role: "anon" } },
  anonRoleOnly: { role: "anon", claims: null },
  anonClaimOnly: { role: null, claims: { role: "anon" } },
  service: { role: "service_role", claims: { role: "service_role" } },
  cron: { role: null, claims: null },
  poster: { role: "authenticated", claims: { sub: POSTER, role: "authenticated" } },
  helper: { role: "authenticated", claims: { sub: HELPER, role: "authenticated" } },
  stranger: { role: "authenticated", claims: { sub: STRANGER, role: "authenticated" } },
  admin: { role: "authenticated", claims: { sub: ADMIN, role: "authenticated" } },
};

// Runs `sql` (which RETURNs one row with a boolean `forged`) in a rolled-back
// transaction. refused = 42501; landed = forged true; held = forged false.
async function run(db, ctxName, sql) {
  const ctx = CTX[ctxName];
  await db.exec("BEGIN");
  try {
    if (ctx.claims) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(ctx.claims)]);
    if (ctx.role) await db.exec(`SET LOCAL ROLE ${ctx.role}`);
    try {
      const rows = (await db.query(sql)).rows;
      if (!rows.length) return "noop";
      return rows[0].forged ? "landed" : "held";
    } catch (e) {
      return e.code === "42501" ? "refused" : `error ${e.code}: ${e.message}`;
    }
  } finally {
    await db.exec("ROLLBACK");
  }
}

const upd = (table, set, where, forged) => `UPDATE public.${table} SET ${set} WHERE ${where} RETURNING (${forged}) AS forged`;
const J = (set, forged) => upd("jobs", set, `id='${JOB}'`, forged);

// [id, context, sql, BEFORE, AFTER]
const CASES = [
  // jobs — prevent_job_field_escalation (locked_everyone)
  ["anon: jobs.platform_fee_amount := 0", "anon", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "landed", "refused"],
  ["anon (SET ROLE only): jobs.platform_fee_amount := 0", "anonRoleOnly", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "landed", "refused"],
  ["anon (JWT claim only): jobs.platform_fee_amount := 0", "anonClaimOnly", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "landed", "refused"],
  ["service_role: jobs.platform_fee_amount := 0", "service", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "landed", "landed"],
  ["cron/postgres: jobs.platform_fee_amount := 0", "cron", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "landed", "landed"],
  ["stranger: jobs.platform_fee_amount := 0", "stranger", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "refused", "refused"],
  ["admin: jobs.platform_fee_amount := 0", "admin", J("platform_fee_amount = 0", "platform_fee_amount = 0"), "landed", "landed"],
  // jobs — enforce_cancellation_requires_rpc
  ["anon: jobs.status := cancelled", "anon", J("status = 'cancelled'", "status = 'cancelled'"), "landed", "refused"],
  ["anon: jobs.cancellation_fee := 50", "anon", J("cancellation_fee = 50", "cancellation_fee = 50"), "landed", "refused"],
  ["service_role: jobs.status := cancelled", "service", J("status = 'cancelled'", "status = 'cancelled'"), "landed", "landed"],
  ["cron/postgres: jobs.cancellation_fee := 50", "cron", J("cancellation_fee = 50", "cancellation_fee = 50"), "landed", "landed"],
  ["poster: jobs.status := cancelled (must use the RPC)", "poster", J("status = 'cancelled'", "status = 'cancelled'"), "refused", "refused"],
  // jobs — poster money lock / helper whitelist, party behaviour unchanged
  ["poster: jobs.title edit", "poster", J("title = 'Deep clean + windows'", "title = 'Deep clean + windows'"), "landed", "landed"],
  ["poster: jobs.payment_status := released", "poster", J("payment_status = 'released'", "payment_status = 'released'"), "refused", "refused"],
  ["helper: jobs.budget := 900", "helper", J("budget = 900", "budget = 900"), "refused", "refused"],
  ["helper: jobs.helper_on_the_way_at := now()", "helper", J("helper_on_the_way_at = now()", "helper_on_the_way_at IS NOT NULL"), "landed", "landed"],
  // profiles — prevent_self_escalation (resets, does not raise)
  ["anon: profiles.subscription_tier := elite, approval_status := approved", "anon",
    upd("profiles", "subscription_tier = 'elite', approval_status = 'approved'", `user_id='${STRANGER}'`, "subscription_tier = 'elite' OR approval_status = 'approved'"), "landed", "held"],
  ["service_role: profiles.subscription_tier := elite", "service",
    upd("profiles", "subscription_tier = 'elite'", `user_id='${STRANGER}'`, "subscription_tier = 'elite'"), "landed", "landed"],
  ["owner: profiles.subscription_tier := elite", "stranger",
    upd("profiles", "subscription_tier = 'elite'", `user_id='${STRANGER}'`, "subscription_tier = 'elite'"), "held", "held"],
  ["owner: profiles.bio edit", "stranger",
    upd("profiles", "bio = 'new bio'", `user_id='${STRANGER}'`, "bio = 'new bio'"), "landed", "landed"],
  // messages — non-sender read-only + read_at stamp
  ["anon: messages.content := forged", "anon", upd("messages", "content = 'forged'", `id='${MSG}'`, "content = 'forged'"), "landed", "refused"],
  ["anon: messages.read_at := 2000-01-01", "anon",
    upd("messages", "read = true, read_at = '2000-01-01'", `id='${MSG}'`, "read_at = '2000-01-01'"), "landed", "held"],
  ["service_role: messages.read_at := 2000-01-01", "service",
    upd("messages", "read = true, read_at = '2000-01-01'", `id='${MSG}'`, "read_at = '2000-01-01'"), "landed", "landed"],
  ["receiver: messages.read := true stamps read_at (not forgeable)", "helper",
    upd("messages", "read = true, read_at = '2000-01-01'", `id='${MSG}'`, "read_at = '2000-01-01'"), "held", "held"],
  ["receiver: messages.content := forged", "helper", upd("messages", "content = 'forged'", `id='${MSG}'`, "content = 'forged'"), "refused", "refused"],
  // disputes — opener column whitelist
  ["anon: disputes.payout_split := 100% helper", "anon",
    upd("disputes", `payout_split = '{"helper_pct":100}'`, `id='${DISPUTE}'`, "payout_split IS NOT NULL"), "landed", "refused"],
  ["anon: disputes.decided_at := now() (status unchanged)", "anon",
    upd("disputes", "decided_at = now()", `id='${DISPUTE}'`, "decided_at IS NOT NULL"), "landed", "refused"],
  ["anon: withdraw someone's dispute AND stamp decided_at", "anon",
    upd("disputes", "status = 'withdrawn', decided_at = now()", `id='${DISPUTE}'`, "decided_at IS NOT NULL"), "landed", "refused"],
  ["service_role: disputes.payout_split := 100% helper", "service",
    upd("disputes", `payout_split = '{"helper_pct":100}'`, `id='${DISPUTE}'`, "payout_split IS NOT NULL"), "landed", "landed"],
  ["opener: withdraw own open dispute (status + decided_at)", "poster",
    upd("disputes", "status = 'withdrawn', decided_at = now()", `id='${DISPUTE}'`, "status = 'withdrawn' AND decided_at IS NOT NULL"), "landed", "landed"],
  ["other party: disputes.payout_split := 100% helper", "helper",
    upd("disputes", `payout_split = '{"helper_pct":100}'`, `id='${DISPUTE}'`, "payout_split IS NOT NULL"), "refused", "refused"],
  ["admin: disputes.payout_split", "admin",
    upd("disputes", `payout_split = '{"helper_pct":100}'`, `id='${DISPUTE}'`, "payout_split IS NOT NULL"), "landed", "landed"],
  // reviews — server-owned columns on insert
  ...["anon", "service", "poster"].map((ctx) => [
    `${ctx}: reviews INSERT with forged response_text/status/feedback_visible_at`, ctx,
    `INSERT INTO public.reviews (id, job_id, reviewer_id, reviewee_id, rating, response_text, status, feedback_visible_at)
       VALUES (gen_random_uuid(), '${DONE}', '${POSTER}', '${HELPER}', 5, 'forged reply', 'hidden', now())
     RETURNING (response_text IS NOT NULL OR status = 'hidden' OR feedback_visible_at IS NOT NULL) AS forged`,
    ctx === "poster" ? "held" : "landed", ctx === "poster" ? "held" : ctx === "service" ? "landed" : "held"]),
];

let failures = 0;
const expect = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const checkRows = async (db, sql = CHECK) => (await db.query(sql)).rows;

async function runCases(db, phase) {
  let mismatches = 0;
  for (const [id, ctx, sql, before, after] of CASES) {
    const want = phase === "before" ? before : after;
    const got = await run(db, ctx, sql);
    if (got !== want) mismatches++;
    if (phase !== "quiet") expect(got === want, `${got.padEnd(8)} ${id}${got === want ? "" : `  (want ${want})`}`);
  }
  return mismatches;
}

{
  console.log("== 1. BEFORE (live bodies)");
  const db = await fresh();
  const rows = await checkRows(db);
  const names = [...new Set(rows.map((r) => r.function_name))].sort();
  expect(names.join(",") === [...THE_23].sort().join(","), `class check RED: lists exactly the 23 (${names.length})`);
  await runCases(db, "before");
  // The AFTER expectations must not hold on the live bodies.
  let afterMiss = 0;
  for (const [, ctx, sql, , after] of CASES) if ((await run(db, ctx, sql)) !== after) afterMiss++;
  expect(afterMiss >= 10, `AFTER expectations fail on live bodies (${afterMiss} of ${CASES.length} differ)`);
}

{
  console.log("\n== 2. AFTER (20260915101102 applied 3x)");
  const db = await fresh([MIG], 3);
  const rows = await checkRows(db);
  expect(rows.length === 0, `class check GREEN (${rows.length} rows${rows.length ? `: ${rows.map((r) => r.function_name).join(", ")}` : ""})`);
  await runCases(db, "after");
  const g = (await db.query(`
    SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))::int AS anon_exec,
           count(*) FILTER (WHERE aclcontains(coalesce(p.proacl, acldefault('f', p.proowner)), makeaclitem(0, p.proowner, 'EXECUTE', false)))::int AS public_exec,
           count(*)::int AS n
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [THE_23])).rows[0];
  expect(g.n === 23 && g.anon_exec === 0 && g.public_exec === 0, `no PUBLIC/anon EXECUTE on the 23 (n=${g.n}, anon=${g.anon_exec}, public=${g.public_exec})`);
  const h = (await db.query(`SELECT has_function_privilege('anon','public.is_server_context()','EXECUTE') a,
                                    has_function_privilege('authenticated','public.is_server_context()','EXECUTE') b`)).rows[0];
  expect(h.a && h.b, "anon and authenticated can call is_server_context() (4 of the 23 are SECURITY INVOKER)");
  const ctxv = {};
  for (const c of ["anon", "anonRoleOnly", "anonClaimOnly", "service", "cron", "poster"]) {
    await db.exec("BEGIN");
    if (CTX[c].claims) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(CTX[c].claims)]);
    if (CTX[c].role) await db.exec(`SET LOCAL ROLE ${CTX[c].role}`);
    ctxv[c] = (await db.query("SELECT public.is_server_context() v")).rows[0].v;
    await db.exec("ROLLBACK");
  }
  expect(JSON.stringify(ctxv) === JSON.stringify({ anon: false, anonRoleOnly: false, anonClaimOnly: false, service: true, cron: true, poster: false }),
    `is_server_context(): ${JSON.stringify(ctxv)}`);
}

{
  console.log("\n== 3. Broken copies (each must fail at least one expectation)");
  const HELPER_FULL = "  SELECT auth.uid() IS NULL\n     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')\n     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')";
  const BROKEN = [
    ["helper is a bare NULL-uid test", MIG.replace(HELPER_FULL, "  SELECT auth.uid() IS NULL")],
    ["helper ignores SET ROLE", MIG.replace("\n     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')", "")],
    ["helper ignores the JWT role claim", MIG.replace("\n     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')", "")],
    ["dispute whitelist without the COALESCE", MIG.replace("  _self_withdrawal := COALESCE(\n", "  _self_withdrawal := (\n").replace("    AND OLD.decided_at IS NULL, false);", "    AND OLD.decided_at IS NULL);")],
    ["prevent_job_field_escalation left on auth.uid() IS NULL", MIG.replace("BEGIN\n  IF public.is_server_context() THEN\n    RETURN NEW;\n  END IF;\n  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN", "BEGIN\n  IF auth.uid() IS NULL THEN\n    RETURN NEW;\n  END IF;\n  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN")],
    ["stamp_message_read_at left on auth.uid() is null", MIG.replace("  if public.is_server_context() then", "  if auth.uid() is null then")],
  ];
  for (const [name, sql] of BROKEN) {
    if (sql === MIG) { expect(false, `mutation did not apply: ${name}`); continue; }
    const db = await fresh([sql]);
    const miss = await runCases(db, "quiet");
    const red = (await checkRows(db)).length;
    expect(miss > 0 || red > 0, `${name}: ${miss} case(s) fail, class check ${red ? `RED (${red})` : "green"}`);
  }
}

{
  console.log("\n== 4. The three exemptions are live, not stale");
  const db = await fresh([MIG]);
  const unexempt = CHECK.replace(/AND c\.proname NOT IN \([^)]*\)/, "");
  if (unexempt === CHECK) expect(false, "could not strip the exemption list");
  const names = [...new Set((await checkRows(db, unexempt)).map((r) => r.function_name))].sort();
  expect(names.join(",") === "apply_message_scan_consequence,audit_admin_job_status_change,enforce_ban_gate",
    `without the exemption list the check lists exactly: ${names.join(", ")}`);
}

{
  console.log("\n== 5. Replay-safety: bare public.jobs type, no app_role, 3x");
  const db = new PGlite();
  let ok = true;
  try {
    await db.exec(`${ROLES}
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
      -- One reconciled guard, enforce_job_tracking_arrival_gate (as in
      -- 20260915044137, which first defined it), DECLAREs v_job public.jobs, so
      -- the composite TYPE public.jobs must exist when the function is created.
      -- Every real replay has it: public.jobs is created by a migration long
      -- before this one runs. A bare one-column table stands in for that type
      -- here — the function body is never executed in this step, only compiled.
      CREATE TABLE public.jobs (id uuid);`);
    for (let i = 0; i < 3; i++) await db.exec(MIG);
  } catch (e) { ok = false; console.log(e.message); }
  expect(ok, "migration runs three times on an empty schema");
  const bare = MIG.split("\n").filter((l) => !l.trim().startsWith("--") && /\bMAINTAIN\b/i.test(l));
  expect(bare.length === 0, "no PG17-only MAINTAIN keyword (replay image is PG15)");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL EXPECTATIONS HELD");
process.exit(failures ? 1 : 0);
