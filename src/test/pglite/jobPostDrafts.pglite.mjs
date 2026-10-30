#!/usr/bin/env node
/**
 * PGlite proof for the OPS-3 migration (a half-finished job post kept on the account, one reminder): a member reads and
 * writes only their own draft; a save never earns a second reminder; the sweep sends one notice and one email in its
 * window, by day, to a real member with no job made since; a test, seed or banned member, or one who made a job, gets none.
 *
 *   node src/test/pglite/jobPostDrafts.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobPostDrafts.pglite.mjs # RED: prod before it
 *
 * Stubs: auth.uid, is_caller_banned, is_test_member, net.http_post (records the email) and vault, cron.schedule (records
 * the job). The migration is run up to its export_my_data step: that body needs the whole schema, and its one new section
 * is checked for text below. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = readdirSync(MIG).find((f) => f.endsWith("_job_post_drafts.sql"));
const NEW = readFileSync(MIG + FILE, "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: prod before the migration (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const REAL = U(1), OTHER = U(2), TEST = U(3), SEED = U(4), BANNED = U(5), POSTED = U(6), OLDJOB = U(7), EMPTY = U(8), NIGHT = U(9);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA cron;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, is_seed boolean DEFAULT false);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.ban_status = 'banned') $$;
  CREATE TABLE public.test_members (user_id uuid);
  CREATE FUNCTION public.is_test_member(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.test_members t WHERE t.user_id = p_user_id) $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text);
  CREATE TABLE net.sent (url text, body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO net.sent VALUES (url, body); RETURN 1; END $$;
  CREATE VIEW vault.decrypted_secrets AS SELECT 'supabase_url' AS name, 'https://x' AS decrypted_secret UNION ALL SELECT 'service_role_key', 'k';
  CREATE TABLE cron.jobs (name text PRIMARY KEY, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO cron.jobs VALUES (n, s, c) ON CONFLICT (name) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command; RETURN 1; END $$;
`);
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await db.query("INSERT INTO auth.users VALUES ($1)", [U(n)]);
await db.query("INSERT INTO public.profiles (user_id) SELECT id FROM auth.users");
await db.query("UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = $1", [BANNED]);
await db.query("UPDATE public.profiles SET is_seed = true WHERE user_id = $1", [SEED]);
await db.query("INSERT INTO public.test_members VALUES ($1)", [TEST]);
// export_my_data's body needs the whole schema, so it is cut here; its one new section is read below.
const cut = NEW.indexOf("-- @export-step");
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(cut > 0 ? NEW.slice(0, cut) : NEW);

const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
async function call(uid, sql, args = []) {
  await as(uid);
  try {
    return { ok: (await db.query(sql, args)).rows };
  } catch (e) {
    return { err: e.message };
  }
}
const save = (uid, d) => call(uid, "SELECT public.save_my_job_post_draft($1::jsonb)", [JSON.stringify(d)]);
const mine = async (uid) => (await call(uid, "SELECT public.my_job_post_draft() AS d")).ok?.[0]?.d ?? null;
const row = async (uid) => {
  try {
    return (await db.query("SELECT title, updated_at, reminded_at FROM public.job_post_drafts WHERE user_id = $1", [uid])).rows[0] ?? null;
  } catch {
    return null;
  }
};
/** A draft saved `hours` before NOON. */
const NOON = "2026-10-30T12:00:00-05:00"; // 12:00 in Louisiana (CDT)
async function aged(uid, hours, title = "Mow my lawn") {
  await save(uid, { title, description: "Front and back" });
  await db.query(`UPDATE public.job_post_drafts SET updated_at = $1::timestamptz - make_interval(hours => $2) WHERE user_id = $3`, [NOON, hours, uid]);
}
const sweep = async (at = NOON) => (await call(null, "SELECT public.sweep_job_post_drafts($1::timestamptz) AS n", [at])).ok?.[0]?.n;
const notices = async (uid) => (await db.query("SELECT title, message, type, link FROM public.notifications WHERE user_id = $1", [uid])).rows;
const emails = async (uid) => (await db.query("SELECT url, body FROM net.sent WHERE body ->> 'user_id' = $1", [uid])).rows;
const fails = (r) => r.err ?? "no error";

// ---- 1. A member's own draft.
let r = await save(REAL, { title: "Mow my lawn", description: "Front and back", budget: "40" });
check("a member saves their draft", !r.err, fails(r));
check("and reads it back", (await mine(REAL))?.budget === "40", JSON.stringify(await mine(REAL)));
check("another member sees none of it", (await mine(OTHER)) === null);
await save(OTHER, { title: "Other", description: "" });
check("each has their own", (await row(OTHER))?.title === "Other" && (await row(REAL))?.title === "Mow my lawn");
r = await call(null, "SELECT public.save_my_job_post_draft('{}'::jsonb)");
check("signed out can't save", (r.err ?? "").includes("not_authenticated"), fails(r));
check("signed out reads nothing", (await mine(null)) === null);
r = await call(null, "SELECT public.clear_my_job_post_draft()");
check("signed out can't clear", (r.err ?? "").includes("not_authenticated"), fails(r));
r = await save(BANNED, { title: "x", description: "" });
check("a banned member can't save", (r.err ?? "").includes("account_restricted"), fails(r));
r = await save(REAL, { title: "x".repeat(40000) });
check("too large is refused", (r.err ?? "").includes("draft_too_large"), fails(r));
r = await call(REAL, "SELECT public.save_my_job_post_draft('[1]'::jsonb)");
check("not an object is refused", (r.err ?? "").includes("invalid_draft"), fails(r));
await save(EMPTY, { title: "Paint", description: "" });
await save(EMPTY, { title: "  ", description: " " });
check("emptied out, the row goes", (await row(EMPTY)) === null);
await save(OTHER, { title: "Gone", description: "" });
r = await call(OTHER, "SELECT public.clear_my_job_post_draft()");
check("clear removes only theirs", !r.err && (await row(OTHER)) === null && (await row(REAL)) !== null, fails(r));
r = await call(OTHER, "SELECT public.clear_my_job_post_draft()");
check("clearing nothing is quiet", !r.err, fails(r));

// ---- 2. Grants and RLS.
const priv = async (role, what, kind) => {
  try {
    return (await db.query(`SELECT has_${kind}_privilege('${role}', '${what}', '${kind === "table" ? "SELECT" : "EXECUTE"}') AS p`)).rows[0].p;
  } catch {
    return null;
  }
};
check("the table isn't readable by a member", (await priv("authenticated", "public.job_post_drafts", "table")) === false);
check("the table isn't readable by anon", (await priv("anon", "public.job_post_drafts", "table")) === false);
for (const f of ["save_my_job_post_draft(jsonb)", "my_job_post_draft()", "clear_my_job_post_draft()"]) {
  check(`${f}: members yes, anon no`, (await priv("authenticated", `public.${f}`, "function")) === true && (await priv("anon", `public.${f}`, "function")) === false);
}
for (const role of ["authenticated", "anon"]) {
  check(`the sweep: ${role} no`, (await priv(role, "public.sweep_job_post_drafts(timestamptz)", "function")) === false);
}
const rls = (await db.query("SELECT relrowsecurity AS r FROM pg_class WHERE oid = to_regclass('public.job_post_drafts')")).rows[0]?.r;
check("RLS is on", rls === true);
const cronJob = (await db.query("SELECT schedule, command FROM cron.jobs WHERE name = 'job-post-draft-reminder'")).rows[0];
check("cron is scheduled once, by name", cronJob?.schedule === "47 * * * *" && /sweep_job_post_drafts/.test(cronJob?.command ?? ""), JSON.stringify(cronJob));

// ---- 3. The window, and once only.
await aged(REAL, 23);
check("under 24 hours: nothing", (await sweep()) === 0 && (await notices(REAL)).length === 0);
await aged(REAL, 73);
check("past 72 hours: nothing", (await sweep()) === 0 && (await notices(REAL)).length === 0);
await aged(REAL, 30, "Fix my fence");
check("in the window: one", (await sweep()) === 1);
const n = await notices(REAL);
check("the notice's words and link", n.length === 1 && n[0].title === "Finish your job post?" && n[0].message.includes('"Fix my fence"') && n[0].link === "/post-job" && n[0].type === "job_update", JSON.stringify(n));
const e = await emails(REAL);
check("one email, through send-notification-email, type job_update", e.length === 1 && e[0].url.endsWith("/functions/v1/send-notification-email") && e[0].body.type === "job_update" && e[0].body.link === "/post-job", JSON.stringify(e));
check("the same draft is never reminded twice", (await sweep()) === 0 && (await notices(REAL)).length === 1);
await save(REAL, { title: "Fix my fence", description: "and the gate" });
await db.query("UPDATE public.job_post_drafts SET updated_at = $1::timestamptz - interval '30 hours' WHERE user_id = $2", [NOON, REAL]);
check("typing again doesn't earn a second one", (await sweep()) === 0 && (await notices(REAL)).length === 1 && (await row(REAL))?.reminded_at !== null);

// ---- 4. Who never gets one.
await db.exec("DELETE FROM public.notifications; DELETE FROM net.sent;");
await db.query("UPDATE auth.caller SET uid = NULL");
for (const u of [TEST, SEED]) await aged(u, 30);
// A banned member can't save: their row is one from before the ban.
await db.query("UPDATE public.profiles SET ban_status = NULL WHERE user_id = $1", [BANNED]);
await aged(BANNED, 30);
await db.query("UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = $1", [BANNED]);
await aged(POSTED, 30);
await db.query("INSERT INTO public.jobs (customer_id, created_at) VALUES ($1, $2::timestamptz - interval '29 hours')", [POSTED, NOON]);
await aged(OLDJOB, 30);
await db.query("INSERT INTO public.jobs (customer_id, created_at) VALUES ($1, $2::timestamptz - interval '40 hours')", [OLDJOB, NOON]);
const swept = await sweep();
check("test, seed, banned and just-posted members get none; a job from well before doesn't count", swept === 1 && (await notices(OLDJOB)).length === 1, `swept ${swept}`);
for (const [name, u] of [["test", TEST], ["seed", SEED], ["banned", BANNED], ["made a job since", POSTED]]) {
  check(`${name}: no notice, no email`, (await notices(u)).length === 0 && (await emails(u)).length === 0);
}
await db.query("UPDATE public.job_post_drafts SET updated_at = now() WHERE user_id = $1", [POSTED]);
await db.query("UPDATE public.jobs SET created_at = now() WHERE customer_id = $1", [POSTED]);
check("a job made since: another device isn't offered the draft", (await mine(POSTED)) === null);

// ---- 5. Daytime only, and old drafts go.
await aged(NIGHT, 30);
check("7:59 AM Louisiana: nothing", (await sweep("2026-10-30T07:59:00-05:00")) === 0 && (await notices(NIGHT)).length === 0);
check("8 PM Louisiana: nothing", (await sweep("2026-10-30T20:00:00-05:00")) === 0 && (await notices(NIGHT)).length === 0);
check("8 AM Louisiana: sent", (await sweep("2026-10-30T08:00:00-05:00")) === 1 && (await notices(NIGHT)).length === 1);
await db.query("UPDATE public.job_post_drafts SET updated_at = $1::timestamptz - interval '7 days 1 minute' WHERE user_id = $2", [NOON, NIGHT]);
await sweep();
check("over 7 days: deleted, even overnight", (await row(NIGHT)) === null);
await save(EMPTY, { title: "Old", description: "" });
await db.query("UPDATE public.job_post_drafts SET updated_at = now() - interval '8 days' WHERE user_id = $1", [EMPTY]);
check("over 7 days: never offered to a device", (await mine(EMPTY)) === null);
check("Download My Data has a section for it, for the member's own rows only", NEW.includes("jsonb_build_object('job_post_drafts'") && /FROM public\.job_post_drafts t\s+WHERE t\.user_id = v_uid/.test(NEW));

await db.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
