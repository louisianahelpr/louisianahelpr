#!/usr/bin/env node
/**
 * PGlite proof for 20261115001106_single_client_read_failure_no_alert.sql (Q2780, lead 11-14, by recommendation):
 * on the public low-stakes read surfaces (LiveJobsSection, BootWatchdog) a NEW ledger item opens only on a pattern,
 * 3 rows in 24 hours or 2 distinct members. Guests share one guest_fp per message and path on prod, so the guest cases
 * here all use ONE fingerprint. Money, dispute and crash screens still open on first sight; repeats of an open item
 * and the grants are unchanged.
 *
 *   node src/test/pglite/singleClientReadFailureNoAlert.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/singleClientReadFailureNoAlert.pglite.mjs # RED: the state before it
 *
 * "Before" is ops_alert_record_user_error_screen from 20260923092838 (md5 of the live prosrc equal to it, read 11-14).
 * ops_alert_normalise, user_error_screen_title and is_user_error_screen_row are their real newest bodies;
 * ops_alert_record is stubbed to upsert a ledger row by title; user_error_screen_is_real is stubbed true.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(MIGDIR + f, "utf8");
const NEW = read("20261115001106_single_client_read_failure_no_alert.sql");
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
CREATE TABLE public.ops_alert_ledger (source_kind text, source text, title text, first_seen timestamptz, sample_ref jsonb, count int DEFAULT 1);
CREATE FUNCTION public.user_error_screen_is_real(p_user_id uuid, p_tags jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.ops_alert_record(p_kind text, p_source text, p_title text, p_sev text, p_sample text, p_ref jsonb, p_vk text, p_vr text, p_seen timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_alert_ledger WHERE title = public.ops_alert_normalise(p_title)) THEN
    UPDATE public.ops_alert_ledger SET count = count + 1 WHERE title = public.ops_alert_normalise(p_title);
  ELSE
    INSERT INTO public.ops_alert_ledger VALUES (p_kind, p_source, public.ops_alert_normalise(p_title), p_seen, p_ref);
  END IF;
  RETURN gen_random_uuid();
END $$;
`);
await db.exec(cutFn("20260923043402_ops_alert_ledger.sql", "CREATE OR REPLACE FUNCTION public.ops_alert_normalise("));
await db.exec(cutFn("20260923085642_user_error_screens_reach_the_ledger.sql", "CREATE OR REPLACE FUNCTION public.user_error_screen_title("));
// is_user_error_screen_row: prod's live body (pg_get_functiondef, 11-14).
await db.exec(`CREATE OR REPLACE FUNCTION public.is_user_error_screen_row(p_tags jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT coalesce(jsonb_typeof(p_tags) = 'object' AND p_tags ->> 'origin' = 'client'
    AND (p_tags ->> 'kind' = 'user-error-screen' OR p_tags ->> 'source' IN ('ErrorState', 'ErrorBoundary', 'RouteErrorBoundary', 'SectionBoundary', 'BootWatchdog')), false)
$function$;`);
await db.exec(cutFn("20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql", "CREATE OR REPLACE FUNCTION public.ops_alert_record_user_error_screen("));
await db.exec(`REVOKE ALL ON FUNCTION public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz) TO service_role;`);
const acl = async () => (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'ops_alert_record_user_error_screen'`)).rows[0].a;
const aclBefore = await acl();

let applied = 0;
if (!MODE) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", applied === 3, `applied ${applied}`);

/** One client-side error row, recorded the way the AFTER trigger records it. */
async function shown({ user = null, fp = null, source = "LiveJobsSection", message, screen = "/" }) {
  const tags = { kind: "user-error-screen", origin: "client", screen, source, title: message, ...(fp ? { guest_fp: fp } : {}) };
  const id = (await db.query(`INSERT INTO public.error_logs (user_id, message, tags) VALUES ($1, $2, $3) RETURNING id`, [user, `Error screen shown: ${message}`, tags])).rows[0].id;
  await db.query(`SELECT public.ops_alert_record_user_error_screen($1, $2, $3, $4, now())`, [id, user, `Error screen shown: ${message}`, tags]);
}
const items = async (like) => (await db.query(`SELECT title, count FROM public.ops_alert_ledger WHERE title LIKE $1`, [like])).rows;

// Q2780's own shape: three guest rows over five days. guest_fp is per message+path on prod, so all share one.
const FP = "ca3e81cf15b5d841f71c5e907aa4d12d";
const NEWEST = "Couldn't load the newest jobs.";
await db.exec(`INSERT INTO public.error_logs (message, tags, created_at) VALUES
  ('Error screen shown: ${NEWEST.replace("'", "''")}', '{"kind":"user-error-screen","origin":"client","screen":"/","source":"LiveJobsSection","guest_fp":"${FP}"}', now() - interval '5 days')`);
await shown({ fp: FP, message: NEWEST });
await shown({ fp: FP, message: NEWEST });
check("two guest rows of the landing's live-jobs read in 24 hours open no item", (await items("%newest jobs%")).length === 0, JSON.stringify(await items("%newest jobs%")));
await shown({ fp: FP, message: NEWEST });
check("a third row in 24 hours (any visitors, same guest_fp) opens it", (await items("%newest jobs%")).length === 1);
await shown({ fp: FP, message: NEWEST });
check("a repeat of the open item still bumps it", (await items("%newest jobs%"))[0]?.count === 2, JSON.stringify(await items("%newest jobs%")));

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
await shown({ user: U1, source: "BootWatchdog", message: "The app didn't finish loading.", screen: "/home" });
check("one member's boot stall opens no item", (await items("%finish loading%")).length === 0);
await shown({ user: U2, source: "BootWatchdog", message: "The app didn't finish loading.", screen: "/home" });
check("a second member's boot stall opens it", (await items("%finish loading%")).length === 1);

await shown({ user: U1, source: "EarningsTab", message: "We couldn't load your payout data.", screen: "/profile" });
check("a money read failure still opens on first sight, from one member", (await items("%payout data%")).length === 1);
await shown({ fp: "f".repeat(32), source: "ErrorState", message: "Couldn't load this dispute.", screen: "/jobs" });
check("any other read failure still opens on first sight", (await items("%this dispute%")).length === 1);
await shown({ user: U1, source: "ErrorBoundary", message: "Something went wrong.", screen: "/jobs" });
check("a crash screen still opens on first sight, from one client", (await items("%something went wrong%")).length === 1);

const v = (await db.query(`SELECT prosecdef d FROM pg_proc WHERE proname = 'ops_alert_record_user_error_screen'`)).rows[0];
check("still SECURITY DEFINER, grants unchanged (service_role only)", v.d === true && (await acl()) === aclBefore && !aclBefore.includes("anon"), await acl());

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
