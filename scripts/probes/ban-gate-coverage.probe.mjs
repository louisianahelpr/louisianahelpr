// Probe (Q281): 20260923185224_ban_enforcement_everywhere.sql and its class
// check scripts/ci/ban-gate-coverage.sql, in real Postgres (PGlite).
// NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/ban-gate-coverage.probe.mjs
//
// The schema is built from a LIVE snapshot, not from a hand list:
// scripts/probes/fixtures/ban-gate-inventory.live.json holds prod's exact
// authenticated-writable (table, command) pairs (grants x policies), its
// pre-Q281 ban-gate triggers and its authenticated-EXECUTE VOLATILE RPC names
// (read-only catalog query, 2026-09-23). Every table gets those grants and a
// permissive policy per command; every RPC a stub of the same name. So the
// check's exemption lists are proven EXACT against prod's inventory: a list
// entry prod does not have, or a prod object the lists miss, fails here.
//
// 1. BEFORE (prod's pre-Q281 state): class check RED (table:ungated 43 once
//    push_tokens INSERT/UPDATE became exempt, storage:ungated 2, the missing
//    same-transaction carve-out x3: gate, profile lock, marker trigger), and the probe's measured behaviour
//    reproduced: a banned caller edits and deletes their own message, edits
//    their phone, uploads to storage.
// 2. AFTER (migration 3x): class check GREEN; the banned caller is refused on
//    messages UPDATE/DELETE, referral_codes, profiles phone, storage upload;
//    still ALLOWED to report, block, register a push token, delete a saved job,
//    withdraw marketing consent, clear Available now, delete their own file. A
//    NON-banned caller's DELETE still deletes (the old gate returned NEW =
//    NULL on DELETE, which would have silently cancelled every delete).
// 2b. THE 3RD-STRIKE ROLLBACK (lh-authz-rls finding): an RPC shaped like
//    helper_cancel_booking (ladder bans the caller, THEN the RPC writes
//    applications + jobs) raises 42501 and loses the ban on the old gate, and
//    on the new one completes with the ban kept; a caller ALREADY banned
//    before the request is still refused.
// 3. Planted defects each turn the check red with the right rule: a dropped
//    gate trigger, a dropped storage policy, a new ungated RPC, a stale table
//    exemption, a stale RPC exemption, a function writing banned_until, an
//    auth-level ban on a row, a removed carve-out (gate, and profile lock), a
//    dropped marker trigger, a session-level marker, a marker trigger that
//    does not fire on UPDATE OF ban_status.
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
const MIG = read("../../supabase/migrations/20260923185224_ban_enforcement_everywhere.sql");
const CHECK = read("../ci/ban-gate-coverage.sql").replace(/--[^\n]*\n/g, "\n").trim().replace(/;\s*$/, "");
const SNAP = JSON.parse(read("./fixtures/ban-gate-inventory.live.json"));

const A = "0a0a0a0a-0000-4000-8000-00000000000a"; // banned (temp)
const B = "0b0b0b0b-0000-4000-8000-00000000000b"; // active
const C = "0c0c0c0c-0000-4000-8000-00000000000c"; // for sync tests

// prod's live bodies, pre-Q281 (pg_get_functiondef 2026-09-23)
const PRE_FUNCS = `
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid()
     AND ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (ban_status <> 'temp_banned' OR auto_suspended_until IS NULL OR auto_suspended_until > now()));
$f$;
GRANT EXECUTE ON FUNCTION public.is_caller_banned() TO authenticated, anon;
CREATE FUNCTION public.enforce_ban_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $f$;
CREATE FUNCTION public.enforce_banned_profile_text_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    NEW.full_name := OLD.full_name; NEW.bio := OLD.bio;
  END IF;
  RETURN NEW;
END; $f$;
`;

function setupSql() {
  const out = [`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY, banned_until timestamptz);
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text), public.is_server_context() TO anon, authenticated;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  full_name text, bio text, phone text, avatar_url text, location text, available_until timestamptz,
  marketing_consent boolean, senior_mode boolean, terms_version_accepted text, terms_accepted_at timestamptz,
  accepted_terms_at timestamptz, updated_at timestamptz DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
CREATE POLICY own_ins ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND coalesce(ban_status,'active') = 'active');
CREATE POLICY own_upd ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY own_sel ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE POLICY up ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner = auth.uid());
CREATE POLICY upd ON storage.objects FOR UPDATE TO authenticated USING (owner = auth.uid());
CREATE POLICY del ON storage.objects FOR DELETE TO authenticated USING (owner = auth.uid());
CREATE POLICY sel ON storage.objects FOR SELECT TO authenticated USING (owner = auth.uid());
`, PRE_FUNCS];
  // every other writable table, with prod's exact authenticated write commands
  const byTbl = new Map();
  for (const w of SNAP.writable) byTbl.set(w.tbl, [...(byTbl.get(w.tbl) ?? []), w.op]);
  for (const [tbl, ops] of byTbl) {
    if (tbl === "profiles") continue;
    out.push(`CREATE TABLE public.${tbl} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;
GRANT SELECT, ${ops.join(", ")} ON public.${tbl} TO authenticated;
CREATE POLICY sel ON public.${tbl} FOR SELECT TO authenticated USING (true);`);
    for (const op of ops) {
      const clause = op === "INSERT" ? "WITH CHECK (true)" : op === "UPDATE" ? "USING (true) WITH CHECK (true)" : "USING (true)";
      out.push(`CREATE POLICY p_${op.toLowerCase()} ON public.${tbl} FOR ${op} TO authenticated ${clause};`);
    }
  }
  // prod's pre-Q281 gate triggers, by their live names
  for (const g of SNAP.gated) {
    out.push(`CREATE TRIGGER ${g.tgname} BEFORE ${g.op} ON public.${g.tbl} FOR EACH ROW EXECUTE FUNCTION public.${g.proname}();`);
  }
  // every authenticated-EXECUTE VOLATILE RPC, by its live name
  for (const fn of SNAP.rpcs) {
    out.push(`CREATE FUNCTION public.${fn}() RETURNS void LANGUAGE plpgsql VOLATILE AS $f$ BEGIN END $f$;
REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.${fn}() TO authenticated;`);
  }
  // functions default to PUBLIC EXECUTE; prod revokes the helpers above from clients
  out.push(`REVOKE ALL ON FUNCTION public.enforce_ban_gate(), public.enforce_banned_profile_text_lock() FROM PUBLIC;`);
  // data: A temp-banned (pre-existing, banned_until NULL as on prod), B active
  out.push(`
INSERT INTO auth.users (id) VALUES ('${A}'), ('${B}'), ('${C}');
INSERT INTO public.profiles (user_id, ban_status, auto_suspended_until, phone, available_until)
  VALUES ('${A}', 'temp_banned', now() + interval '7 days', '+1504', now() + interval '2 hours'),
         ('${B}', 'active', NULL, '+1505', NULL);
INSERT INTO public.messages (id, user_id) VALUES ('11111111-0000-4000-8000-00000000000a', '${A}'), ('11111111-0000-4000-8000-00000000000b', '${B}');
INSERT INTO public.saved_jobs (id, user_id) VALUES ('22222222-0000-4000-8000-00000000000a', '${A}');
INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES ('33333333-0000-4000-8000-00000000000a', 'avatars', 'a/x.png', '${A}');
`);
  return out.join("\n");
}

let failures = 0;
const expect = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`  FAIL ${msg}`); } };

async function fresh(times) {
  const db = new PGlite();
  await db.exec(setupSql());
  for (let i = 0; i < times; i++) await db.exec(MIG);
  return db;
}
const checkRows = async (db) => (await db.query(CHECK)).rows;
const count = (rows, rule) => rows.filter((r) => r.rule === rule).length;
const has = (rows, rule, object, detail) => rows.some((r) => r.rule === rule && r.object === object && (detail == null || r.detail === detail));

/** Run sql as `uid` (authenticated), rolled back. Returns { rows, err }. */
async function as(db, uid, sql) {
  await db.exec("BEGIN");
  let rows, err;
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await db.exec("SET LOCAL ROLE authenticated");
    try { const r = await db.query(sql); rows = r.rows; rows.affected = r.affectedRows; } catch (e) { err = e; }
  } finally {
    await db.exec("ROLLBACK");
  }
  return { rows, err };
}
const refused = (r) => !!r.err && /account_restricted|row-level security/i.test(r.err.message);

// ── 1. BEFORE ───────────────────────────────────────────────────────────────
console.log("1. BEFORE (prod pre-Q281 shape): class check RED; banned caller writes");
{
  const db = await fresh(0);
  const rows = await checkRows(db);
  const summary = Object.fromEntries(["table:ungated", "storage:ungated", "gate:no-same-txn-carveout", "auth-ban:writer", "auth-ban:set", "rpc:ungated", "stale-exempt:table", "stale-exempt:rpc"].map((k) => [k, count(rows, k)]));
  console.log("   ", JSON.stringify(summary));
  expect(summary["table:ungated"] === 43, `table:ungated = 43 (live 2026-09-23 run: 45, minus push_tokens INSERT/UPDATE now exempt) — got ${summary["table:ungated"]}`);
  expect(has(rows, "table:ungated", "messages", "UPDATE") && has(rows, "table:ungated", "messages", "DELETE"), "messages UPDATE+DELETE flagged");
  expect(has(rows, "table:ungated", "profiles", "UPDATE"), "profiles UPDATE flagged (old lock never calls is_caller_banned)");
  expect(!has(rows, "table:ungated", "messages", "INSERT"), "messages INSERT (already gated) NOT flagged");
  expect(!has(rows, "table:ungated", "reports", "INSERT"), "reports INSERT (exempt) NOT flagged");
  expect(summary["storage:ungated"] === 2, "storage INSERT + UPDATE flagged");
  expect(summary["gate:no-same-txn-carveout"] === 3, "no same-transaction carve-out: gate, profile lock and marker trigger each flagged");
  expect(summary["auth-ban:writer"] === 0 && summary["auth-ban:set"] === 0, "no auth-level ban before (prod: 0 rows with banned_until)");
  expect(summary["rpc:ungated"] === 0 && summary["stale-exempt:rpc"] === 0, "every live RPC is classified; no stale RPC exemption");
  expect(summary["stale-exempt:table"] === 0, "no stale table exemption against the live inventory");
  const upd = await as(db, A, `UPDATE public.messages SET user_id = user_id WHERE id = '11111111-0000-4000-8000-00000000000a'`);
  expect(!upd.err, "BEFORE: banned A edits own message (the Q205(d) finding)");
  const ph = await as(db, A, `UPDATE public.profiles SET phone = '+1999' WHERE user_id = '${A}' RETURNING phone`);
  expect(!ph.err && ph.rows[0]?.phone === "+1999", "BEFORE: banned A changes phone");
  const st = await as(db, A, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', 'a/y.png', '${A}')`);
  expect(!st.err, "BEFORE: banned A uploads to storage");
}

// ── 2. AFTER ────────────────────────────────────────────────────────────────
console.log("2. AFTER (migration applied 3x): class check GREEN; behaviour");
{
  const db = await fresh(3);
  const rows = await checkRows(db);
  expect(rows.length === 0, `class check GREEN — ${rows.length} offenders ${JSON.stringify(rows.slice(0, 5))}`);

  // refused
  expect(refused(await as(db, A, `UPDATE public.messages SET user_id = user_id WHERE id = '11111111-0000-4000-8000-00000000000a'`)), "banned A: UPDATE own message refused");
  expect(refused(await as(db, A, `DELETE FROM public.messages WHERE id = '11111111-0000-4000-8000-00000000000a'`)), "banned A: DELETE own message refused");
  expect(!(await as(db, A, `INSERT INTO public.push_tokens (user_id) VALUES ('${A}')`)).err, "banned A: INSERT push_tokens allowed (signs in, gets account notices)");
  expect(refused(await as(db, A, `INSERT INTO public.referral_codes (user_id) VALUES ('${A}')`)), "banned A: INSERT referral_codes refused");
  expect(refused(await as(db, A, `UPDATE public.profiles SET phone = '+1999' WHERE user_id = '${A}'`)), "banned A: profiles phone refused");
  expect(refused(await as(db, A, `UPDATE public.profiles SET available_until = now() + interval '4 hours' WHERE user_id = '${A}'`)), "banned A: set Available now refused");
  expect(refused(await as(db, A, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', 'a/y.png', '${A}')`)), "banned A: storage upload refused");
  // A restrictive USING hides the row from UPDATE: no error, zero rows touched.
  const ow = await as(db, A, `UPDATE storage.objects SET name = 'a/z.png' WHERE id = '33333333-0000-4000-8000-00000000000a' RETURNING id`);
  expect(refused(ow) || (!ow.err && ow.rows.length === 0), "banned A: storage overwrite touches nothing");

  // allowed
  expect(!(await as(db, A, `INSERT INTO public.reports (user_id) VALUES ('${A}')`)).err, "banned A: INSERT reports allowed");
  expect(!(await as(db, A, `INSERT INTO public.user_blocks (user_id) VALUES ('${A}')`)).err, "banned A: INSERT user_blocks allowed");
  const dsj = await as(db, A, `DELETE FROM public.saved_jobs WHERE id = '22222222-0000-4000-8000-00000000000a' RETURNING id`);
  expect(!dsj.err && dsj.rows.length === 1, "banned A: DELETE own saved job allowed (and deletes)");
  expect(!(await as(db, A, `UPDATE public.profiles SET marketing_consent = false, updated_at = now() WHERE user_id = '${A}'`)).err, "banned A: withdraw marketing consent allowed");
  expect(!(await as(db, A, `UPDATE public.profiles SET available_until = NULL WHERE user_id = '${A}'`)).err, "banned A: clear Available now allowed");
  const dso = await as(db, A, `DELETE FROM storage.objects WHERE id = '33333333-0000-4000-8000-00000000000a' RETURNING id`);
  expect(!dso.err && dso.rows.length === 1, "banned A: delete own file allowed");

  // non-banned B unaffected, and DELETE still deletes through the new gate
  const dm = await as(db, B, `DELETE FROM public.messages WHERE id = '11111111-0000-4000-8000-00000000000b' RETURNING id`);
  expect(!dm.err && dm.rows.length === 1, "active B: DELETE own message still deletes (gate returns OLD)");
  expect(!(await as(db, B, `UPDATE public.profiles SET phone = '+1777' WHERE user_id = '${B}'`)).err, "active B: profile phone edit allowed");
  expect(!(await as(db, B, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', 'b/y.png', '${B}')`)).err, "active B: storage upload allowed");

  expect((await checkRows(db)).length === 0, "class check still GREEN after the behaviour runs");
}

// ── 2b. the 3rd-strike rollback ─────────────────────────────────────────────
console.log("2b. a ban started inside the request does not roll the request back");
const LADDER_RPC = `
CREATE FUNCTION public.zz_ladder(p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  -- apply_job_denial_consequence -> apply_consequence_ladder, suspend rung
  PERFORM set_config('app.trusted_ladder_write', 'on', true);
  UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '7 days' WHERE user_id = p_user;
END $f$;
REVOKE ALL ON FUNCTION public.zz_ladder(uuid) FROM PUBLIC;
CREATE FUNCTION public.zz_cancel_booking(p_app uuid, p_job uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  -- helper_cancel_booking's order: ladder first, then its own writes
  PERFORM public.zz_ladder(auth.uid());
  UPDATE public.applications SET user_id = user_id WHERE id = p_app;
  UPDATE public.jobs SET user_id = NULL WHERE id = p_job;
END $f$;
GRANT EXECUTE ON FUNCTION public.zz_cancel_booking(uuid, uuid) TO authenticated;
INSERT INTO public.applications (id, user_id) VALUES ('44444444-0000-4000-8000-00000000000b', '${B}');
INSERT INTO public.jobs (id, user_id) VALUES ('55555555-0000-4000-8000-00000000000b', '${B}');`;
async function thirdStrike(db, uid) {
  await db.exec("BEGIN");
  let err, ban, job;
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await db.exec("SAVEPOINT s; SET LOCAL ROLE authenticated");
    try {
      await db.query(`SELECT public.zz_cancel_booking('44444444-0000-4000-8000-00000000000b', '55555555-0000-4000-8000-00000000000b')`);
      await db.exec("RESET ROLE; RELEASE SAVEPOINT s");
    } catch (e) { err = e; await db.exec("ROLLBACK TO SAVEPOINT s; RESET ROLE"); }
    ban = (await db.query(`SELECT ban_status FROM public.profiles WHERE user_id = $1`, [uid])).rows[0].ban_status;
    job = (await db.query(`SELECT user_id FROM public.jobs WHERE id = '55555555-0000-4000-8000-00000000000b'`)).rows[0].user_id;
  } finally {
    await db.exec("ROLLBACK");
  }
  return { err, ban, job };
}
{
  const old = await fresh(0);
  await old.exec(LADDER_RPC);
  const r0 = await thirdStrike(old, B);
  expect(!!r0.err && /account_restricted/.test(r0.err.message) && r0.ban === "active" && r0.job === B,
    `OLD gate: 3rd-strike cancel raises account_restricted and the ban is lost (err=${r0.err?.message}, ban=${r0.ban})`);
  const db = await fresh(3);
  await db.exec(LADDER_RPC);
  const r1 = await thirdStrike(db, B);
  expect(!r1.err && r1.ban === "temp_banned" && r1.job === null,
    `NEW gate: 3rd-strike cancel completes, job updated, ban kept (err=${r1.err?.message}, ban=${r1.ban}, job=${r1.job})`);
  const r2 = await thirdStrike(db, A);
  expect(!!r2.err && /account_restricted/.test(r2.err.message), "NEW gate: a caller banned BEFORE the request is still refused");
}

// ── 3. Planted defects ─────────────────────────────────────────────────────
console.log("3. planted defects each turn it RED with the right rule");
const plant = async (label, sql, rule, object) => {
  const db = await fresh(1);
  await db.exec(sql);
  const rows = await checkRows(db);
  expect(has(rows, rule, object), `${label} -> ${rule} ${object} (${rows.length} rows)`);
};
await plant("drop messages UPDATE gate", `DROP TRIGGER trg_ban_gate_messages_update ON public.messages`, "table:ungated", "messages");
await plant("drop storage upload policy", `DROP POLICY "ban gate: no uploads while banned" ON storage.objects`, "storage:ungated", "storage.objects");
await plant("new ungated RPC", `CREATE FUNCTION public.zz_new_writer() RETURNS void LANGUAGE sql AS $$ SELECT $$; GRANT EXECUTE ON FUNCTION public.zz_new_writer() TO authenticated`, "rpc:ungated", "zz_new_writer");
await plant("gate an exempt table", `CREATE TRIGGER zz BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate()`, "stale-exempt:table", "reports");
await plant("revoke an exempt RPC", `REVOKE EXECUTE ON FUNCTION public.toggle_thread_mute() FROM authenticated`, "stale-exempt:rpc", "toggle_thread_mute");
await plant("a function sets banned_until", `CREATE FUNCTION public.zz_lock_out(p uuid) RETURNS void LANGUAGE sql AS $$ UPDATE auth.users SET banned_until = now() + interval '7 days' WHERE id = p $$; REVOKE ALL ON FUNCTION public.zz_lock_out(uuid) FROM PUBLIC`, "auth-ban:writer", "zz_lock_out");
await plant("an auth-level ban (dashboard)", `UPDATE auth.users SET banned_until = now() + interval '7 days' WHERE id = '${A}'`, "auth-ban:set", A);
await plant("revert the gate (no carve-out)", `CREATE OR REPLACE FUNCTION public.enforce_ban_gate()${PRE_FUNCS.split("CREATE FUNCTION public.enforce_ban_gate()")[1].split("CREATE FUNCTION public.enforce_banned_profile_text_lock()")[0]}`, "gate:no-same-txn-carveout", "public.enforce_ban_gate");
await plant("drop the marker trigger", `DROP TRIGGER trg_mark_ban_started_in_txn ON public.profiles`, "gate:no-same-txn-carveout", "public.profiles");
// lh-authz-rls hardening: a SESSION-level marker (is_local = false) would outlive the request on a pooled connection.
const markerSrc = (await (async () => { const d = await fresh(1); return (await d.query(`SELECT pg_get_functiondef('public.mark_ban_started_in_txn()'::regprocedure) AS d`)).rows[0].d; })());
await plant("marker set session-level (false)", markerSrc.replace("NEW.user_id::text, true)", "NEW.user_id::text, false)"), "gate:no-same-txn-carveout", "public.profiles");
await plant("marker trigger only on auto_suspended_until", `DROP TRIGGER trg_mark_ban_started_in_txn ON public.profiles; CREATE TRIGGER trg_mark_ban_started_in_txn AFTER UPDATE OF auto_suspended_until ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.mark_ban_started_in_txn()`, "gate:no-same-txn-carveout", "public.profiles");
await plant("profile lock without the carve-out", `CREATE OR REPLACE FUNCTION public.enforce_banned_profile_text_lock()${PRE_FUNCS.split("CREATE FUNCTION public.enforce_banned_profile_text_lock()")[1]}`, "gate:no-same-txn-carveout", "public.enforce_banned_profile_text_lock");
await plant("revert the profiles lock", PRE_FUNCS.split("CREATE FUNCTION public.enforce_banned_profile_text_lock()")[1] ? `CREATE OR REPLACE FUNCTION public.enforce_banned_profile_text_lock()${PRE_FUNCS.split("CREATE FUNCTION public.enforce_banned_profile_text_lock()")[1]}` : "", "table:ungated", "profiles");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
