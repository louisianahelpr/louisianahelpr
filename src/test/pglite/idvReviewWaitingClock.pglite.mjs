#!/usr/bin/env node
/**
 * Fixed-clock PGlite proof for "sweep_idv_review_waiting" (migration
 * 20261021135734_idv_restart_after_manual_review; Q1357 sweepClockProofs).
 *
 *   node src/test/pglite/idvReviewWaitingClock.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The sweep's NEWEST body runs with every now() pointed at public._probe_now()
 * (src/test/pglite/lib/fixedClock.mjs), so each edge is tested 1 ms either side
 * (written and run 2026-10-21: 11 PASS):
 *   - the 24 h wait: a review that began exactly 24 h ago alerts, 24 h - 1 ms
 *     does not (the body skips `since > now() - 24 h`);
 *   - the once-a-day repeat: an alert sent 24 h - 1 ms ago blocks a new one,
 *     one sent exactly 24 h ago does not (`created_at > now() - 24 h`);
 *   - moving the clock 1 ms turns the "not yet" member into an alert.
 * Stubbed, and said so: the profiles / helper_verifications / notifications /
 * user_roles columns the sweep reads; notification_crosses_seed_boundary
 * (never crosses here: no seed subjects); log_cron_defect (records into a table).
 * The behaviour proof (seed skip, history-vs-updated_at, grants) is
 * src/test/pglite/idvRestartAfterManualReview.pglite.mjs.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (ok, name) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1);
const AT24 = U(11), OVER24 = U(12), UNDER24 = U(13), RECENT_ALERT = U(14), OLD_ALERT = U(15), NOHIST = U(16);
const T = "2031-06-10T15:00:00.000Z";
const ms = (iso, d) => new Date(Date.parse(iso) + d).toISOString();
const H = 3600_000;

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;`);
await installClock(db);
await setClock(db, T);
await db.exec(`
  create table public.profiles (user_id uuid primary key, idv_status text, is_seed boolean default false,
    updated_at timestamptz default public._probe_now());
  create table public.helper_verifications (id serial primary key, user_id uuid, changed_at timestamptz,
    field text, old_value text, new_value text);
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text,
    created_at timestamptz default public._probe_now());
  create table public.user_roles (user_id uuid, role text);
  create table public.cron_defects (fn text, ref text, err text);
  create function public.notification_crosses_seed_boundary(p_recipient uuid, p_job_id uuid, p_link text, p_actor uuid default null)
    returns boolean language sql as $$ select false $$;
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_ctx jsonb) returns void language sql as
    $$ insert into public.cron_defects values (p_fn, p_ref, p_err) $$;
`);
await db.exec(newestFunction("idv_review_waiting_since").stmt);
await db.exec(onFixedClock(newestFunction("sweep_idv_review_waiting").stmt));

const TITLE = "Identity verification needs review — waiting over 24 hours";
await db.exec(`
  insert into public.user_roles values ('${ADMIN}', 'admin');
  insert into public.profiles (user_id, idv_status, updated_at) values
    ('${ADMIN}', 'verified', '${T}'),
    ('${AT24}', 'manual_review', '${T}'), ('${OVER24}', 'manual_review', '${T}'),
    ('${UNDER24}', 'manual_review', '${T}'), ('${RECENT_ALERT}', 'manual_review', '${T}'),
    ('${OLD_ALERT}', 'manual_review', '${T}'),
    ('${NOHIST}', 'manual_review', '${ms(T, -25 * H)}');
  insert into public.helper_verifications (user_id, changed_at, field, old_value, new_value) values
    ('${AT24}', '${ms(T, -24 * H)}', 'idv_status', 'pending', 'manual_review'),
    ('${OVER24}', '${ms(T, -24 * H - 1)}', 'idv_status', 'pending', 'manual_review'),
    ('${UNDER24}', '${ms(T, -24 * H + 1)}', 'idv_status', 'pending', 'manual_review'),
    ('${RECENT_ALERT}', '${ms(T, -48 * H)}', 'idv_status', 'pending', 'manual_review'),
    ('${OLD_ALERT}', '${ms(T, -48 * H)}', 'idv_status', 'pending', 'manual_review');
  insert into public.notifications (user_id, title, message, type, link, created_at) values
    ('${ADMIN}', '${TITLE}', 'x', 'admin_alert', '/admin?view=idvreview&user=${RECENT_ALERT}', '${ms(T, -24 * H + 1)}'),
    ('${ADMIN}', '${TITLE}', 'x', 'admin_alert', '/admin?view=idvreview&user=${OLD_ALERT}', '${ms(T, -24 * H)}');
`);

const alertsFor = async (u) =>
  Number((await db.query(`select count(*)::int n from public.notifications where link = $1 and created_at = public._probe_now()`,
    [`/admin?view=idvreview&user=${u}`])).rows[0].n);

const r1 = (await db.query(`select public.sweep_idv_review_waiting() r`)).rows[0].r;
check(r1.alerts === 4, `run at T sends 4 alerts (got ${JSON.stringify(r1)})`);
check((await alertsFor(AT24)) === 1, "a review that began exactly 24 h ago alerts");
check((await alertsFor(OVER24)) === 1, "24 h + 1 ms alerts");
check((await alertsFor(UNDER24)) === 0, "24 h - 1 ms does not alert yet");
check((await alertsFor(RECENT_ALERT)) === 0, "an alert sent 24 h - 1 ms ago blocks a repeat");
check((await alertsFor(OLD_ALERT)) === 1, "an alert sent exactly 24 h ago does not block");
check((await alertsFor(NOHIST)) === 1, "no history row: profiles.updated_at 25 h ago alerts");

await setClock(db, ms(T, 1));
const r2 = (await db.query(`select public.sweep_idv_review_waiting() r`)).rows[0].r;
check((await alertsFor(UNDER24)) === 1, "1 ms later the 24 h - 1 ms member alerts");
check((await alertsFor(RECENT_ALERT)) === 1, "1 ms later the earlier alert is out of the window: a repeat goes");
check(r2.alerts === 2, `run at T + 1 ms sends exactly those 2 (got ${JSON.stringify(r2)}); the 4 sent at T are inside their window`);
check(Number((await db.query(`select count(*)::int n from public.cron_defects`)).rows[0].n) === 0, "no cron defect logged");

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
