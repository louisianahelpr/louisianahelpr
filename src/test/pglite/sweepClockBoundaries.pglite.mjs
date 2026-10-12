/**
 * Q1357 PGlite proof: clock-reading sweeps act on a row 1 ms past their cutoff
 * and leave one exactly AT it, at a Central midnight and on both 2026 DST nights.
 *
 *   node src/test/pglite/sweepClockBoundaries.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Sweeps (newest CREATE across the migrations, clock reads pointed at a fixed
 * instant by ./lib/fixedClock.mjs):
 *   sweep_old_error_logs      info/warning > 30 days, error/fatal > 90 days
 *   sweep_old_email_send_log  sent/suppressed/failed/bounced/complained > 90 days
 *   sweep_old_notifications   read > 30 days, unread > 90 days
 *   sweep_signup_leads        purges a finished lead > 30 days old
 *   sweep_expired_auto_bans   lifts a temp ban once auto_suspended_until < now()
 *   sweep_payout_schedule_freezes  re-verify a paused hold > 6 h, kick a stuck
 *                             request > 5 min, page > 30 min, re-page > 6 h
 *   sweep_open_ban_settlement_reviews  page an open review > 24 h, re-page > 24 h
 *   sweep_job_start_reminders a booked job whose Central start is within 35 min
 * Each cutoff is `now() - interval 'N days'`, a strict `<`. Session TimeZone is
 * UTC, as pg_cron's sessions on prod are (database default), so N days is
 * exactly N*24 h even across a DST night; a row 1 ms inside the window stays.
 * The body is each function's newest CREATE (fixedClock.newestFunction), so a
 * later rewrite-only migration (ALTER FUNCTION, no CREATE) would not be seen.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;

await db.exec(`
SET TIME ZONE 'UTC';
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.email_send_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), read boolean,
  user_id uuid, type text, title text, message text, link text, created_at timestamptz DEFAULT now());
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TABLE public.signup_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz,
  completed_at timestamptz, reminder_sent_at timestamptz, unsubscribed_at timestamptz);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, ban_status text,
  auto_suspended_until timestamptz);
CREATE TABLE public.payout_schedule_freezes (helper_id text PRIMARY KEY, freeze_state text, stripe_account_id text,
  verified_at timestamptz, updated_at timestamptz, requested_at timestamptz, attempts int, freeze_error text, alerted_at timestamptz);
CREATE TABLE public._kicks (helper_id text);
CREATE FUNCTION public.kick_payout_schedule_sync(p text) RETURNS boolean LANGUAGE sql
  AS $f$ INSERT INTO public._kicks VALUES (p); SELECT true $f$;
CREATE TABLE public.ban_settlement_queue (id uuid PRIMARY KEY, user_id uuid, matched_on text, review_state text,
  created_at timestamptz, alerted_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text,
  date_needed date, start_time time, start_reminder_sent_at timestamptz, is_group_job boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
ALTER TABLE public.notifications ADD COLUMN job_id uuid;
CREATE TABLE public.user_roles (user_id uuid, role text);
INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-0000000000ad', 'admin');
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);
await installClock(db);

const SWEEPS = ["sweep_old_error_logs", "sweep_old_email_send_log", "sweep_old_notifications", "sweep_signup_leads", "sweep_expired_auto_bans",
  "sweep_payout_schedule_freezes", "sweep_open_ban_settlement_reviews", "sweep_job_start_reminders"];
for (const name of SWEEPS) {
  const { file, stmt } = newestFunction(name);
  const fixed = onFixedClock(stmt);
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x
}

// table, the row's distinguishing column values, retention in days.
const CASES = [
  { sweep: "sweep_old_error_logs", table: "error_logs", col: "severity", val: "info", days: 30 },
  { sweep: "sweep_old_error_logs", table: "error_logs", col: "severity", val: "warning", days: 30 },
  { sweep: "sweep_old_error_logs", table: "error_logs", col: "severity", val: "error", days: 90 },
  { sweep: "sweep_old_error_logs", table: "error_logs", col: "severity", val: "fatal", days: 90 },
  { sweep: "sweep_old_email_send_log", table: "email_send_log", col: "status", val: "sent", days: 90 },
  { sweep: "sweep_old_email_send_log", table: "email_send_log", col: "status", val: "bounced", days: 90 },
  { sweep: "sweep_old_notifications", table: "notifications", col: "read", val: true, days: 30 },
  { sweep: "sweep_old_notifications", table: "notifications", col: "read", val: false, days: 90 },
];

// A Central midnight (00:00 CDT), the fall-back night (01:30 CST, the repeated
// hour's second pass) and the spring-forward night (03:30 CDT, just after the gap).
const INSTANTS = ["2026-10-12T05:00:00Z", "2026-11-01T07:30:00Z", "2026-03-08T08:30:00Z"];
const MS = { before: 1, at: 0, after: -1 }; // ms OLDER than the cutoff

for (const at of INSTANTS) {
  for (const c of CASES) {
    await db.exec(`DELETE FROM public.${c.table};`);
    await setClock(db, at);
    const cutoff = new Date(Date.parse(at) - c.days * 86_400_000);
    for (const [label, older] of Object.entries(MS)) {
      const created = new Date(cutoff.getTime() - older).toISOString();
      await q(`INSERT INTO public.${c.table} (${c.col}, created_at${c.table === "error_logs" ? ", message" : ""}) VALUES ($1, $2::timestamptz${c.table === "error_logs" ? ", $3" : ""})`,
        c.table === "error_logs" ? [c.val, created, label] : [c.val, created]);
    }
    await q(`SELECT public.${c.sweep}()`);
    const left = (await q(`SELECT created_at FROM public.${c.table} WHERE ${c.col} = $1 ORDER BY created_at`, [c.val])).map((r) => new Date(r.created_at).getTime());
    const kept = Object.entries(MS).filter(([, older]) => left.includes(cutoff.getTime() - older)).map(([l]) => l);
    check(`${at} ${c.sweep} ${c.col}=${c.val} (${c.days}d): 1 ms past the cutoff deleted, at and inside kept`, kept.join(",") === "at,after", `kept ${kept.join(",") || "none"}`);
  }
}

// sweep_signup_leads: a finished lead (completed_at set) purged 1 ms past 30 days.
for (const at of INSTANTS) {
  await setClock(db, at);
  await db.exec(`DELETE FROM public.signup_leads;`);
  const cutoff = Date.parse(at) - 30 * 86_400_000;
  for (const [label, older] of Object.entries(MS)) {
    await q(`INSERT INTO public.signup_leads (email, created_at, completed_at) VALUES ($1, $2::timestamptz, $2::timestamptz)`, [`${label}@lead.test`, new Date(cutoff - older).toISOString()]);
  }
  const r = (await q(`SELECT public.sweep_signup_leads() AS r`))[0].r;
  const kept = (await q(`SELECT email FROM public.signup_leads ORDER BY email`)).map((x) => x.email.split("@")[0]).sort();
  check(`${at} sweep_signup_leads (30d): 1 ms past the cutoff purged, at and inside kept`, kept.join(",") === "after,at" && r.purged === 1, `kept ${kept.join(",")}, purged ${r.purged}`);
}

// sweep_expired_auto_bans: a temp ban whose window ended 1 ms ago is lifted; one
// ending exactly now, or 1 ms from now, is not.
for (const at of INSTANTS) {
  await setClock(db, at);
  await db.exec(`DELETE FROM public.profiles; DELETE FROM public.notifications;`);
  const ids = { before: "00000000-0000-0000-0000-00000000000b", at: "00000000-0000-0000-0000-00000000000a", after: "00000000-0000-0000-0000-00000000000c" };
  for (const [label, older] of Object.entries(MS)) {
    await q(`INSERT INTO public.profiles (user_id, email, ban_status, auto_suspended_until) VALUES ($1, $2, 'temp_banned', $3::timestamptz)`, [ids[label], `${label}@ban.test`, new Date(Date.parse(at) - older).toISOString()]);
  }
  const n = (await q(`SELECT public.sweep_expired_auto_bans() AS n`))[0].n;
  const lifted = (await q(`SELECT email FROM public.profiles WHERE ban_status = 'active'`)).map((x) => x.email.split("@")[0]);
  const told = Number((await q(`SELECT count(*)::int AS c FROM public.notifications WHERE user_id = $1`, [ids.before]))[0].c);
  check(`${at} sweep_expired_auto_bans: lifted 1 ms after the window ends, not at or before`, lifted.join(",") === "before" && n === 1 && told === 1, `lifted ${lifted.join(",") || "none"}, returned ${n}, notices ${told}`);
}

// sweep_payout_schedule_freezes: four cutoffs, each 1 ms past (acts) / at (does not).
//   paused row re-verified once COALESCE(verified_at, updated_at) < now() - 6 h
//   a requested pause/restore kicked once updated_at < now() - 5 min
//   paged once requested_at < now() - 30 min and (never alerted or alerted_at < now() - 6 h)
for (const at of INSTANTS) {
  await setClock(db, at);
  await db.exec(`DELETE FROM public.payout_schedule_freezes; DELETE FROM public._kicks; DELETE FROM public.error_logs;`);
  const T = Date.parse(at);
  const ago = (ms) => new Date(T - ms).toISOString();
  const H6 = 6 * 3_600_000, M5 = 5 * 60_000, M30 = 30 * 60_000;
  const rows = [
    // helper, state, verified_at, updated_at, requested_at, alerted_at
    ["v-past", "paused", ago(H6 + 1), ago(0), null, null],
    ["v-at", "paused", ago(H6), ago(H6 + 60_000), null, null],
    ["v-null-past", "paused", null, ago(H6 + 1), null, null],
    ["v-null-at", "paused", null, ago(H6), null, null],
    ["s-past", "pause_requested", null, ago(M5 + 1), ago(M5 + 1), null],
    ["s-at", "restore_requested", null, ago(M5), ago(M30 + 1), null],
    ["p-past", "pause_requested", null, ago(M5 + 1), ago(M30 + 1), null],
    ["p-at", "pause_requested", null, ago(M5 + 1), ago(M30), null],
    ["a-past", "restore_requested", null, ago(M5 + 1), ago(M30 + 1), ago(H6 + 1)],
    ["a-at", "restore_requested", null, ago(M5 + 1), ago(M30 + 1), ago(H6)],
  ];
  for (const [h, st, v, u, rq, al] of rows) {
    await q(`INSERT INTO public.payout_schedule_freezes (helper_id, freeze_state, stripe_account_id, verified_at, updated_at, requested_at, attempts, alerted_at)
             VALUES ($1, $2, 'acct_x', $3::timestamptz, $4::timestamptz, $5::timestamptz, 1, $6::timestamptz)`, [h, st, v, u, rq, al]);
  }
  const r = (await q(`SELECT public.sweep_payout_schedule_freezes() AS r`))[0].r;
  const kicked = (await q(`SELECT helper_id FROM public._kicks ORDER BY helper_id`)).map((x) => x.helper_id).join(",");
  const paged = (await q(`SELECT context->>'helper_id' AS h FROM public.error_logs ORDER BY 1`)).map((x) => x.h).join(",");
  check(`${at} sweep_payout_schedule_freezes: kicks 1 ms past 6 h (verify) and 5 min (stale), not at`,
    kicked === "a-at,a-past,p-at,p-past,s-past,v-null-past,v-past", `kicked ${kicked}`);
  check(`${at} sweep_payout_schedule_freezes: pages 1 ms past 30 min, re-pages 1 ms past 6 h, not at`,
    paged === "a-past,p-past" && r.paged === 2 && r.verify_kicked === 2 && r.stale === 5, `paged ${paged}, ${JSON.stringify(r)}`);
}

// sweep_open_ban_settlement_reviews: pages an open review 1 ms past 24 h, again
// 1 ms past 24 h after its last page; not at either cutoff.
for (const at of INSTANTS) {
  await setClock(db, at);
  await db.exec(`DELETE FROM public.ban_settlement_queue; DELETE FROM public.error_logs; DELETE FROM public.notifications;`);
  const T = Date.parse(at);
  const ago = (ms) => new Date(T - ms).toISOString();
  const H24 = 24 * 3_600_000;
  const rows = [
    // id suffix, review_state, created_at, alerted_at
    ["1", "open", ago(H24 + 1), null], // paged
    ["2", "open", ago(H24), null], // at the cutoff: not yet
    ["3", "open", ago(H24 * 3), ago(H24 + 1)], // re-paged
    ["4", "open", ago(H24 * 3), ago(H24)], // paged exactly 24 h ago: not yet
    ["5", "confirmed", ago(H24 * 3), null], // decided: never
  ];
  for (const [n, st, c, al] of rows) {
    await q(`INSERT INTO public.ban_settlement_queue (id, user_id, matched_on, review_state, created_at, alerted_at)
             VALUES ($1::uuid, $1::uuid, 'phone', $2, $3::timestamptz, $4::timestamptz)`, [`00000000-0000-0000-0000-00000000000${n}`, st, c, al]);
  }
  const r = (await q(`SELECT public.sweep_open_ban_settlement_reviews() AS r`))[0].r;
  const paged = (await q(`SELECT right(context->>'review_id', 1) AS n FROM public.error_logs ORDER BY 1`)).map((x) => x.n).join(",");
  const admins = Number((await q(`SELECT count(*)::int AS c FROM public.notifications WHERE type = 'admin_alert'`))[0].c);
  check(`${at} sweep_open_ban_settlement_reviews: pages 1 ms past 24 h (first and repeat), not at`,
    paged === "1,3" && r.paged === 2 && r.open === 4 && admins === 2, `paged ${paged}, admin notices ${admins}, ${JSON.stringify(r)}`);
}

// sweep_job_start_reminders: a booked job whose Central start is in
// [now(), now() + 35 min] is reminded once; 1 ms either side is not. The start
// is (date_needed + start_time) AT TIME ZONE 'America/Chicago': Postgres reads
// a fall-back night's repeated 01:xx as CST (the second pass) and a
// spring-forward night's missing 02:xx as CDT (an hour later), measured here.
const START_INSTANTS = [
  "2026-10-12T05:00:00Z", // 00:00 CDT, a Central midnight: the window crosses no date change problem
  "2026-11-01T07:30:00Z", // 01:30 CST, the repeated hour's second pass
  "2026-03-08T07:50:00Z", // 01:50 CST, the window runs across the 02:00 -> 03:00 gap
];
const local = async (iso) => (await q(`SELECT to_char(($1::timestamptz AT TIME ZONE 'America/Chicago'), 'YYYY-MM-DD') AS d, to_char(($1::timestamptz AT TIME ZONE 'America/Chicago'), 'HH24:MI:SS.MS') AS t`, [iso]))[0];
for (const at of START_INSTANTS) {
  await setClock(db, at);
  await db.exec(`DELETE FROM public.jobs; DELETE FROM public.notifications;`);
  const T = Date.parse(at), M35 = 35 * 60_000;
  const starts = { early: T - 1, now: T, end: T + M35, late: T + M35 + 1 };
  let i = 0;
  for (const [label, ms] of Object.entries(starts)) {
    const { d, t } = await local(new Date(ms).toISOString());
    await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time)
             VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'accepted', $5::date, $6::time)`,
      [`00000000-0000-0000-0000-0000000000${10 + i}`, label, `00000000-0000-0000-0000-0000000001${10 + i}`, `00000000-0000-0000-0000-0000000002${10 + i}`, d, t]);
    i++;
  }
  const n = (await q(`SELECT public.sweep_job_start_reminders() AS n`))[0].n;
  const reminded = (await q(`SELECT title FROM public.jobs WHERE start_reminder_sent_at IS NOT NULL ORDER BY title`)).map((x) => x.title).join(",");
  check(`${at} sweep_job_start_reminders: [now, now + 35 min] inclusive, 1 ms either side not`, reminded === "end,now" && n === 4, `reminded ${reminded || "none"}, pushed ${n}`);
  const again = (await q(`SELECT public.sweep_job_start_reminders() AS n`))[0].n;
  check(`${at} sweep_job_start_reminders: a second run reminds nobody twice`, again === 0, `pushed ${again}`);
}
// The spring-forward night's missing 02:30 is read as 03:30 CDT (08:30Z): at
// 03:00 CDT (08:00Z) it is 30 minutes out and reminded.
await setClock(db, "2026-03-08T08:00:00Z");
await db.exec(`DELETE FROM public.jobs; DELETE FROM public.notifications;`);
await q(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time)
         VALUES ('00000000-0000-0000-0000-000000000099', 'gap', '00000000-0000-0000-0000-000000000199', '00000000-0000-0000-0000-000000000299', 'accepted', '2026-03-08', '02:30')`);
const gap = (await q(`SELECT public.sweep_job_start_reminders() AS n`))[0].n;
check("a job set for the missing 02:30 on spring-forward night is reminded at 03:00 CDT (read as 03:30 CDT)", gap === 2, `pushed ${gap}`);

// The sweep is not a no-op that keeps everything: a row a day past every cutoff goes.
await setClock(db, INSTANTS[0]);
await db.exec(`DELETE FROM public.notifications; INSERT INTO public.notifications (read, created_at) VALUES (false, '2026-01-01T00:00:00Z');`);
const n = (await q(`SELECT public.sweep_old_notifications() AS n`))[0].n;
check("a row far past the cutoff is deleted and counted", n === 1, `returned ${n}`);

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
