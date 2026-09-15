// Probe: 20260915020258_contact_scan_phone_digit_boundary_and_hidden_copy.sql,
// in real Postgres (docs/OPEN.md queue #1, 2026-09-14). NOT a vitest test
// (pglite is deliberately not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/contact-scan-phone.probe.mjs
//
// Prod-shaped from the LIVE definitions read via pg_get_functiondef on
// 2026-09-14: contact_leak_reason (= 20260913020635), scan_message_content
// (= 20260907005738), apply_message_scan_consequence (= 20260903014624),
// apply_message_violation_consequence and apply_consequence_ladder
// (= 20260829030000, the ladder's notification link as live:
// '/profile?tab=warnings'), and the four live messages triggers.
//
// 1. BEFORE, on the live shape: both bugs reproduce. A message holding the
//    14-digit "20260914215014" is hidden + struck, and a SAVED hidden message
//    is told "That message was blocked". (The three review follow-ups, the
//    glued-digit evasion, the RPC striking text the server does not flag and
//    the edit path never clearing the flag, were each shown FAILING in section
//    3 against the first version of this migration before it was changed.)
// 2. The migration applied verbatim three times (replay-safe).
// 3. AFTER: src/lib/contactLeakPhoneFixtures.json through the real function;
//    the SQL pattern equals PHONE_PATTERN in src/lib/contactLeakRules.ts; the
//    14-digit message is clean (no flag, violation, fraud flag, notification);
//    a saved phone message walks the whole ladder with "hidden" copy and never
//    "blocked"; the client RPC path still says "blocked"; ACLs.
// 4. Deliberately broken copies of the migration, each on a fresh database:
//    every one must FAIL at least one expectation, or this probe cannot fail.
// Exit 1 on any mismatch.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const repo = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const MIG = repo("supabase/migrations/20260915020258_contact_scan_phone_digit_boundary_and_hidden_copy.sql");
const FIXTURES = JSON.parse(repo("src/lib/contactLeakPhoneFixtures.json"));
// `export const PHONE_PATTERN = "..." + "...";` — join the string pieces.
const PHONE_PATTERN = [...repo("src/lib/contactLeakRules.ts").match(/PHONE_PATTERN =((?:\s*"[^"]*"\s*\+?)+);/)[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");

/** `CREATE OR REPLACE FUNCTION public.<name>(` … closing dollar tag + `;`, verbatim. */
function fnFrom(file, name) {
  const sql = repo(`supabase/migrations/${file}`);
  const start = sql.search(new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "m"));
  if (start === -1) throw new Error(`${file} does not define ${name}`);
  const tag = sql.slice(start).match(/AS (\$[a-z]*\$)/)[1];
  const open = sql.indexOf(tag, start);
  const close = sql.indexOf(tag, open + tag.length);
  return sql.slice(start, close + tag.length) + ";";
}

const LIVE = [
  fnFrom("20260829030000_consolidate_consequence_ladders.sql", "apply_consequence_ladder").replace("'/warnings'", "'/profile?tab=warnings'"),
  fnFrom("20260829030000_consolidate_consequence_ladders.sql", "apply_message_violation_consequence"),
  fnFrom("20260913020635_reject_contact_leaks_in_jobs_and_bios.sql", "contact_leak_reason"),
  fnFrom("20260907005738_scan_contact_info_in_applications.sql", "scan_message_content"),
  fnFrom("20260903014624_off_platform_ladder_actually_enforces.sql", "apply_message_scan_consequence"),
].join("\n");

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
-- Supabase's default privileges: every new public function is EXECUTE-able by
-- anon/authenticated/service_role unless a migration revokes it by role name.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid primary key, full_name text, email text, ban_status text default 'active', auto_suspended_until timestamptz);
CREATE TABLE public.user_violations (id uuid primary key default gen_random_uuid(), user_id uuid, violation_type text, description text, job_id uuid, action_taken text, created_at timestamptz default now());
CREATE TABLE public.user_bans (id uuid primary key default gen_random_uuid(), user_id uuid, ban_type text, reason text, banned_by uuid);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, type text, link text, read boolean default false, created_at timestamptz default now());
CREATE TABLE public.fraud_flags (id uuid primary key default gen_random_uuid(), user_id uuid, flag_type text, details text, job_id uuid);
CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), job_id uuid, sender_id uuid not null, receiver_id uuid not null, content text, flagged_hidden boolean default false, flag_reason text, created_at timestamptz default now());
${LIVE}
CREATE TRIGGER messages_scan_content BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION scan_message_content();
CREATE TRIGGER scan_message_on_edit BEFORE UPDATE OF content ON public.messages FOR EACH ROW WHEN ((old.content IS DISTINCT FROM new.content)) EXECUTE FUNCTION scan_message_content();
CREATE TRIGGER messages_scan_consequence AFTER INSERT ON public.messages FOR EACH ROW WHEN (new.flagged_hidden) EXECUTE FUNCTION apply_message_scan_consequence();
CREATE TRIGGER messages_scan_consequence_on_edit AFTER UPDATE OF content ON public.messages FOR EACH ROW WHEN ((new.flagged_hidden AND (old.content IS DISTINCT FROM new.content))) EXECUTE FUNCTION apply_message_scan_consequence();
`;

const uid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADMIN = uid(99), OTHER = uid(98);
const JOB = "e8cabaca-87ac-4fa0-95e4-b33179e05d6e";
const SEED_MSG = "SEED offered-proof 20260914215014";

async function fresh() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  const users = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(uid);
  for (const u of [...users, ADMIN, OTHER]) await db.query("insert into public.profiles (user_id, full_name) values ($1, 'P')", [u]);
  await db.query("insert into public.user_roles values ($1, 'admin')", [ADMIN]);
  return db;
}

function harness(db, { quiet } = {}) {
  let failures = 0;
  const check = (name, ok, detail = "") => {
    if (!quiet || !ok) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const as = async (user, sql, params) => {
    await db.query("select set_config('request.uid', $1, false)", [user ?? ""]);
    try { return await q(sql, params); } finally { await db.query("select set_config('request.uid', '', false)"); }
  };
  const send = (user, content) =>
    as(user, "insert into public.messages (job_id, sender_id, receiver_id, content) values ($1, $2, $3, $4) returning id, flagged_hidden, flag_reason", [JOB, user, OTHER, content]);
  const notes = (user) => q("select title, message from public.notifications where user_id = $1 order by created_at, ctid", [user]);
  const count = async (table, user) => (await q(`select count(*)::int n from public.${table} where user_id = $1`, [user]))[0].n;
  return { check, q, as, send, notes, count, failures: () => failures };
}

// ---------------------------------------------------------------- 1. BEFORE
async function before() {
  const db = await fresh();
  const h = harness(db);
  console.log("\n== 1. BEFORE (live shape): both bugs must reproduce");
  const [row] = await h.send(uid(1), SEED_MSG);
  h.check("BEFORE: the 14-digit timestamp message is hidden as a phone number", row.flagged_hidden === true && row.flag_reason === "Phone number detected", JSON.stringify(row));
  h.check("BEFORE: and the sender is struck (violation + fraud flag)", (await h.count("user_violations", uid(1))) === 1 && (await h.count("fraud_flags", uid(1))) === 1);
  const n = await h.notes(uid(1));
  h.check("BEFORE: the SAVED message's notification says \"blocked\"", n.length === 1 && /blocked/.test(n[0].message), JSON.stringify(n));
  return h.failures();
}

// ------------------------------------------------------ 2 + 3. APPLY, AFTER
async function after(migration, { quiet = false, label = "" } = {}) {
  const db = await fresh();
  const h = harness(db, { quiet });
  if (!quiet) console.log(`\n== 2. apply the migration 3x${label}`);
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); h.check(`migration applies (pass ${i})`, true); }
    catch (e) { h.check(`migration applies (pass ${i})`, false, e.message); return h.failures(); }
  }

  if (!quiet) console.log("\n== 3. AFTER");
  const prosrc = (await h.q("select prosrc from pg_proc where proname = 'contact_leak_reason'"))[0].prosrc;
  h.check("the SQL phone rule is exactly PHONE_PATTERN (src/lib/contactLeakRules.ts)", prosrc.includes(`v_norm ~* '${PHONE_PATTERN}' THEN`));
  let missed = 0, falsePos = 0;
  for (const t of FIXTURES.phone) {
    const r = (await h.q("select public.contact_leak_reason($1) r", [t]))[0].r;
    if (r !== "Phone number detected") { missed++; h.check(`phone fixture flagged: ${JSON.stringify(t)}`, false, `got ${JSON.stringify(r)}`); }
  }
  for (const t of FIXTURES.notPhone) {
    const r = (await h.q("select public.contact_leak_reason($1) r", [t]))[0].r;
    if (r !== null) { falsePos++; h.check(`non-phone fixture clean: ${JSON.stringify(t)}`, false, `got ${JSON.stringify(r)}`); }
  }
  h.check(`all ${FIXTURES.phone.length} phone fixtures flagged by Postgres`, missed === 0, `${missed} missed`);
  h.check(`all ${FIXTURES.notPhone.length} non-phone fixtures clean in Postgres`, falsePos === 0, `${falsePos} flagged`);

  // The original prod message, end to end through the triggers.
  const [seed] = await h.send(uid(2), SEED_MSG);
  h.check("AFTER: the 14-digit timestamp message is saved and NOT hidden", seed.flagged_hidden === false && seed.flag_reason === null, JSON.stringify(seed));
  h.check("AFTER: no violation, fraud flag or notification for it",
    (await h.count("user_violations", uid(2))) === 0 && (await h.count("fraud_flags", uid(2))) === 0 && (await h.count("notifications", uid(2))) === 0);

  // A real phone, SAVED (direct insert): three distinct messages walk the ladder.
  const S = uid(3);
  const texts = ["number is 225-555-0199", "(225) 555 0199 works", "+1 225 555 0199 again"];
  for (const t of texts) {
    const [r] = await h.send(S, t);
    h.check(`saved phone message is hidden: ${JSON.stringify(t)}`, r.flagged_hidden === true && r.flag_reason === "Phone number detected", JSON.stringify(r));
  }
  const acts = (await h.q("select action_taken from public.user_violations where user_id = $1 order by created_at, ctid", [S])).map((r) => r.action_taken);
  h.check("ladder unchanged: warning -> final_warning -> pending_ban_review", JSON.stringify(acts) === JSON.stringify(["warning", "final_warning", "pending_ban_review"]), JSON.stringify(acts));
  const sn = await h.notes(S);
  h.check("three notifications, one per hidden message", sn.length === 3, String(sn.length));
  h.check("no saved-message notification says \"block\"", sn.every((n) => !/block/i.test(n.message) && !/block/i.test(n.title)), JSON.stringify(sn.map((n) => n.message)));
  h.check("every saved-message notification says it was hidden from the other person", sn.every((n) => /hidden from the other person/.test(n.message)));
  h.check("rung titles unchanged", JSON.stringify(sn.map((n) => n.title)) === JSON.stringify(["Warning — keep it on Helpr", "Final warning", "Account restricted for 7 days"]), JSON.stringify(sn.map((n) => n.title)));
  const prof = (await h.q("select ban_status from public.profiles where user_id = $1", [S]))[0];
  h.check("third strike still restricts (temp_banned) pending review", prof.ban_status === "temp_banned", prof.ban_status);
  const adm = await h.notes(ADMIN);
  h.check("admin still gets the ban-review notice", adm.length === 1 && /3 blocked messages/.test(adm[0].message), JSON.stringify(adm));

  // Duplicate inside 24h: the trigger's own 'Message hidden' notice, still no "blocked".
  const D = uid(4);
  await h.send(D, "reach 504.555.0100");
  await h.send(D, "reach 504.555.0100");
  const dn = await h.notes(D);
  h.check("duplicate: one strike, two notices (warning + 'Message hidden')", (await h.count("user_violations", D)) === 1 && dn.length === 2 && dn[1].title === "Message hidden", JSON.stringify(dn));
  h.check("duplicate notices never say \"block\"", dn.every((n) => !/block/i.test(n.message)));

  // Edit path: a clean message edited into a phone number is saved + hidden.
  const E = uid(5);
  const [clean] = await h.send(E, "see you at 10");
  await h.as(E, "update public.messages set content = 'actually 2255550199' where id = $1", [clean.id]);
  const en = await h.notes(E);
  h.check("edit into a phone: hidden, warned with hidden copy", en.length === 1 && /hidden from the other person/.test(en[0].message) && !/block/i.test(en[0].message), JSON.stringify(en));

  // Client RPC path: the app refused the send, nothing saved -> "blocked" is right.
  const C = uid(6);
  const [rpc] = await h.as(C, "select public.apply_message_violation_consequence('Phone number detected', 'call 225-555-0199') r");
  const cn = await h.notes(C);
  h.check("client RPC returns the warning verdict", rpc.r.action === "warning", JSON.stringify(rpc.r));
  h.check("client RPC (refused send) notification still says \"blocked\"", cn.length === 1 && /was blocked/.test(cn[0].message), JSON.stringify(cn));
  h.check("client RPC saved no message", (await h.q("select count(*)::int n from public.messages where sender_id = $1", [C]))[0].n === 0);
  const [dupRpc] = await h.as(C, "select public.apply_message_violation_consequence('Phone number detected', 'call 225-555-0199') r");
  h.check("client RPC dedupe unchanged (same text -> duplicate)", dupRpc.r.action === "duplicate", JSON.stringify(dupRpc.r));

  // The RPC trusts nothing the client decided: it strikes only for text the
  // SERVER rule flags. A stale native build still refuses the 14-digit
  // timestamp and calls the RPC; client-only phrases ("my number") too.
  const N = uid(8);
  const [staleRpc] = await h.as(N, "select public.apply_message_violation_consequence('Phone number detected', $1) r", [SEED_MSG]);
  const [phraseRpc] = await h.as(N, "select public.apply_message_violation_consequence('Off-platform language detected', 'here is my number for updates') r");
  h.check("client RPC on text the server does not flag: no strike (stale-build timestamp, client-only phrase)",
    staleRpc.r.action !== "warning" && phraseRpc.r.action !== "warning" && (await h.count("user_violations", N)) === 0 && (await h.count("notifications", N)) === 0,
    JSON.stringify([staleRpc.r, phraseRpc.r]));
  let anonErr = "";
  try { await h.as(null, "select public.apply_message_violation_consequence('x', $1) r", [SEED_MSG]); } catch (e) { anonErr = e.message; }
  h.check("client RPC without a user still raises not_authenticated, even on clean text", /not_authenticated/.test(anonErr), anonErr || "no error");

  // Edit path: editing a hidden message into clean text un-hides it and adds
  // no second strike (the application scan already clears on edit).
  const G = uid(9);
  const [bad] = await h.send(G, "call 225-555-0199");
  await h.as(G, "update public.messages set content = 'sorry, see you at 10 on Helpr' where id = $1", [bad.id]);
  const fixedRow = (await h.q("select flagged_hidden, flag_reason from public.messages where id = $1", [bad.id]))[0];
  h.check("edit into clean text clears flagged_hidden and flag_reason", fixedRow.flagged_hidden === false && fixedRow.flag_reason === null, JSON.stringify(fixedRow));
  h.check("edit into clean text adds no second strike or notification", (await h.count("user_violations", G)) === 1 && (await h.count("notifications", G)) === 1,
    `${await h.count("user_violations", G)} violations, ${await h.count("notifications", G)} notifications`);
  const [bad2] = await h.send(uid(10), "call 225-555-0199");
  await h.as(uid(10), "update public.messages set content = 'ok then reach 504.555.0100' where id = $1", [bad2.id]);
  const stillRow = (await h.q("select flagged_hidden from public.messages where id = $1", [bad2.id]))[0];
  h.check("edit from one phone number to another stays hidden", stillRow.flagged_hidden === true, JSON.stringify(stillRow));

  // ACLs.
  const priv = async (role, fn) => (await h.q("select has_function_privilege($1, $2, 'EXECUTE') p", [role, fn]))[0].p;
  h.check("message_violation_ladder: authenticated cannot execute", !(await priv("authenticated", "public.message_violation_ladder(text,text,boolean)")));
  h.check("message_violation_ladder: anon cannot execute", !(await priv("anon", "public.message_violation_ladder(text,text,boolean)")));
  h.check("message_violation_ladder: service_role can execute", await priv("service_role", "public.message_violation_ladder(text,text,boolean)"));
  h.check("apply_message_violation_consequence: authenticated yes, anon no", (await priv("authenticated", "public.apply_message_violation_consequence(text,text)")) && !(await priv("anon", "public.apply_message_violation_consequence(text,text)")));
  h.check("contact_leak_reason: authenticated yes, anon no", (await priv("authenticated", "public.contact_leak_reason(text)")) && !(await priv("anon", "public.contact_leak_reason(text)")));
  h.check("apply_message_scan_consequence: authenticated no, anon no", !(await priv("authenticated", "public.apply_message_scan_consequence()")) && !(await priv("anon", "public.apply_message_scan_consequence()")));
  try {
    await db.exec("set role authenticated");
    await db.query("select public.message_violation_ladder('x', 'y', true)");
    h.check("authenticated calling message_violation_ladder is refused", false, "call succeeded");
  } catch (e) {
    h.check("authenticated calling message_violation_ladder is refused", /permission denied/.test(e.message), e.message);
  } finally {
    await db.exec("reset role");
  }
  return h.failures();
}

let total = 0;
total += await before();
total += await after(MIG);

// ------------------------------------------------------------ 4. BROKEN COPIES
console.log("\n== 4. broken copies must each fail at least one expectation");
const broken = [
  ["phone rule unanchored (the old rule)", (s) => s.replace(`'${PHONE_PATTERN}'`, "'[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}'")],
  ["phone rule loses its trailing boundary", (s) => s.replace("[0-9]{4}(?![0-9])|", "[0-9]{4}|")],
  ["glued-digit alternative lets separators be empty", (s) => s.replace("|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}'", "|[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}'")],
  ["glued-digit alternative dropped", (s) => s.replace("|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}'", "'")],
  ["client RPC strikes without the server check", (s) => s.replace("IF public.contact_leak_reason(p_content) IS NULL THEN", "IF false THEN")],
  ["edit into clean text never clears the flag", (s) => s.replace("  ELSE\n    NEW.flagged_hidden := false;\n    NEW.flag_reason := NULL;\n", "")],
  ["phone rule loses the +1 group", (s) => s.replace("(1[^0-9a-zA-Z]{0,4})?", "")],
  ["saved copy says blocked", (s) => s.replace("'Your message was hidden from the other person because it looked", "'That message was blocked because it looked")],
  ["trigger tells the ladder the message was not saved", (s) => s.replace("message_violation_ladder(v_reason, NEW.content, true)", "message_violation_ladder(v_reason, NEW.content, false)")],
  ["client RPC tells the ladder the message was saved", (s) => s.replace("message_violation_ladder(p_description, p_content, false)", "message_violation_ladder(p_description, p_content, true)")],
  ["internal ladder left executable by authenticated", (s) => s.replace("FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.message_violation_ladder", "FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.message_violation_ladder")],
];
for (const [name, mutate] of broken) {
  const m = mutate(MIG);
  if (m === MIG) { console.log(`FAIL  broken copy did not apply: ${name}`); total++; continue; }
  const f = await after(m, { quiet: true, label: ` (${name})` });
  const ok = f > 0;
  console.log(`${ok ? "PASS" : "FAIL"}  broken copy caught: ${name}  (${f} expectation(s) failed)`);
  if (!ok) total++;
}

console.log(`\n${total === 0 ? "ALL PASS" : `${total} FAILURE(S)`}`);
process.exit(total === 0 ? 0 : 1);
