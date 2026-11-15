#!/usr/bin/env node
/**
 * PGlite proof for 20261115073221_user_error_screen_close_matches_open_gate.sql (Q2806, follow-up to Q2780):
 * the close question for an open LiveJobsSection / BootWatchdog error-screen item asks what the open gate
 * (20261115001106) asks. Still failing only on 3 rows of that screen and surface in 24 hours or 2 distinct members;
 * below that the item goes on to the press-probe half (Q94) and closes after a clean pass of its screen. Every other
 * surface and the overflow item still read one real row as failing.
 *
 *   node src/test/pglite/userErrorScreenCloseMatchesOpenGate.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/userErrorScreenCloseMatchesOpenGate.pglite.mjs # RED: the state before it
 *
 * "Before" is ops_alert_condition from 20261012072223 (md5 of the live prosrc equal to it, read 11-15).
 * ops_alert_normalise, user_error_screen_title, ops_route_key and ops_route_probe are their real newest
 * definitions; is_user_error_screen_row is prod's live body; user_error_screen_is_real is stubbed true.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(MIGDIR + f, "utf8");
const NEW = read("20261115073221_user_error_screen_close_matches_open_gate.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state before it (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** The newest `start` statement in `file`, through its closing dollar tag. */
function cutFn(file, start) {
  const sql = read(file);
  const st = sql.lastIndexOf(start);
  const tag = sql.slice(st).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = sql.indexOf(tag, st) + tag.length;
  return sql.slice(st, sql.indexOf(tag, bodyStart) + tag.length) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, message text, tags jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.ops_route_probe (route text PRIMARY KEY, passed_at timestamptz NOT NULL, run_ref text);
CREATE FUNCTION public.user_error_screen_is_real(p_user_id uuid, p_tags jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
await db.exec(cutFn("20260923043402_ops_alert_ledger.sql", "CREATE OR REPLACE FUNCTION public.ops_alert_normalise("));
await db.exec(cutFn("20260923085642_user_error_screens_reach_the_ledger.sql", "CREATE OR REPLACE FUNCTION public.user_error_screen_title("));
await db.exec(cutFn("20260923182022_ops_route_probe_close_rule.sql", "CREATE OR REPLACE FUNCTION public.ops_route_key("));
// is_user_error_screen_row: prod's live body (pg_get_functiondef, 11-14; as in singleClientReadFailureNoAlert.pglite.mjs).
await db.exec(`CREATE OR REPLACE FUNCTION public.is_user_error_screen_row(p_tags jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT coalesce(jsonb_typeof(p_tags) = 'object' AND p_tags ->> 'origin' = 'client'
    AND (p_tags ->> 'kind' = 'user-error-screen' OR p_tags ->> 'source' IN ('ErrorState', 'ErrorBoundary', 'RouteErrorBoundary', 'SectionBoundary', 'BootWatchdog')), false)
$function$;`);
await db.exec(cutFn("20261012072223_stuck_payment_close_needs_money_moved.sql", "CREATE OR REPLACE FUNCTION public.ops_alert_condition("));
await db.exec(`REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;`);
const acl = async () => (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'ops_alert_condition'`)).rows[0].a;
const aclBefore = await acl();

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

const norm = async (screen, message) =>
  (await db.query(`SELECT public.ops_alert_normalise(public.user_error_screen_title($1, $2)) n`, [screen, `Error screen shown: ${message}`])).rows[0].n;
/** One client error row, `ago` before now. */
async function row({ user = null, source, message, screen, ago = "1 hour" }) {
  const tags = { kind: "user-error-screen", origin: "client", screen, source, title: message };
  await db.query(`INSERT INTO public.error_logs (user_id, message, tags, created_at) VALUES ($1, $2, $3, now() - $4::interval)`,
    [user, `Error screen shown: ${message}`, tags, ago]);
}
const reset = () => db.exec(`DELETE FROM public.error_logs; DELETE FROM public.ops_route_probe;`);
/** A clean press-every-control pass of `screen`, after the item's last_seen. */
const cleanPass = (screen) => db.query(`INSERT INTO public.ops_route_probe VALUES (public.ops_route_key($1), now() - interval '5 minutes', 'run') ON CONFLICT (route) DO UPDATE SET passed_at = EXCLUDED.passed_at`, [screen]);
/** ops_alert_condition for an item opened on `surface`/`screen`/`message`, last seen 2 h ago. true = still failing. */
async function failing(surface, screen, message, extra = {}) {
  const ref = { title_norm: await norm(screen, message), screen, surface, ...extra };
  return (await db.query(`SELECT public.ops_alert_condition('user-error-screen', $1, now() - interval '2 hours') f`, [ref])).rows[0].f;
}

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const BOOT = "The app didn't finish loading.";
const NEWEST = "Couldn't load the newest jobs.";

// Q2779/Q2790's shape: an open boot-stall item, one crawler (guest) row in the last 24 h, then a clean press pass.
await reset();
await row({ source: "BootWatchdog", message: BOOT, screen: "/" });
await cleanPass("/");
check("an open BootWatchdog item with ONE guest row in 24 h and a clean press pass reads closed", (await failing("BootWatchdog", "/", BOOT)) === false);
await db.exec(`DELETE FROM public.ops_route_probe`);
check("... and with no clean press pass since, it stays open (the probe half still decides)", (await failing("BootWatchdog", "/", BOOT)) === true);

await reset();
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/" });
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/", ago: "3 hours" });
await cleanPass("/");
check("two guest rows of the live-jobs read in 24 h: not failing (the gate's 3 not reached)", (await failing("LiveJobsSection", "/", NEWEST)) === false);
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/", ago: "20 hours" });
check("a third row in 24 h (any visitors) keeps it failing", (await failing("LiveJobsSection", "/", NEWEST)) === true);

await reset();
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/", ago: "30 hours" });
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/", ago: "26 hours" });
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/" });
await cleanPass("/");
check("rows older than 24 h do not count toward the 3", (await failing("LiveJobsSection", "/", NEWEST)) === false);

await reset();
await row({ user: U1, source: "BootWatchdog", message: BOOT, screen: "/home" });
await row({ user: U2, source: "BootWatchdog", message: BOOT, screen: "/home" });
await cleanPass("/home");
check("two distinct members in 24 h keep it failing", (await failing("BootWatchdog", "/home", BOOT)) === true);

await reset();
await row({ user: U1, source: "BootWatchdog", message: BOOT, screen: "/home" });
await row({ user: U1, source: "BootWatchdog", message: BOOT, screen: "/home", ago: "2 hours" });
await cleanPass("/home");
check("one member twice (2 rows, 1 member): not failing", (await failing("BootWatchdog", "/home", BOOT)) === false);

await reset();
await row({ source: "ErrorState", message: NEWEST, screen: "/" });
await row({ source: "ErrorState", message: NEWEST, screen: "/" });
await row({ source: "BootWatchdog", message: NEWEST, screen: "/" });
await cleanPass("/");
check("rows from another surface with the same title do not count toward a LiveJobsSection item", (await failing("LiveJobsSection", "/", NEWEST)) === false);

await reset();
await row({ user: U1, source: "ErrorState", message: "Couldn't load this dispute.", screen: "/jobs" });
await cleanPass("/jobs");
check("any other surface still reads ONE real row as failing", (await failing("ErrorState", "/jobs", "Couldn't load this dispute.")) === true);

await reset();
await row({ source: "LiveJobsSection", message: NEWEST, screen: "/" });
await cleanPass("/");
check("the overflow item still reads any one real row as failing", (await failing("LiveJobsSection", "/", NEWEST, { overflow: true })) === true);

const v = (await db.query(`SELECT prosecdef d FROM pg_proc WHERE proname = 'ops_alert_condition'`)).rows[0];
check("still SECURITY DEFINER, grants unchanged (service_role only)", v.d === true && (await acl()) === aclBefore && !aclBefore.includes("anon"), await acl());

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
