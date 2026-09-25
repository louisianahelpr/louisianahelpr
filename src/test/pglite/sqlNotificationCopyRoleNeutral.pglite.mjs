#!/usr/bin/env node
/**
 * PGlite proof for 20260925143327_notification_copy_names_the_person.
 *
 *   node src/test/pglite/sqlNotificationCopyRoleNeutral.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sqlNotificationCopyRoleNeutral.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Loads each rewritten function from the migration that last defines it (the
 * definitions the guard's effectiveDefs resolves to; none of the eleven has a
 * later rewrite), with check_function_bodies off so the bodies need none of
 * their tables. Then applies the migration 3x through the real
 * pg_get_functiondef + regexp_replace + EXECUTE path and reads prosrc:
 *   - every old role sentence is gone and its replacement is present;
 *   - notify_helper_on_tip (tips lane) is untouched;
 *   - a second and third apply change nothing (replay-safe);
 *   - no function lost or gained a line other than the reworded ones.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20260925143327_notification_copy_names_the_person.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the unfixed state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const RENAME = "20260924220318_rename_tab_addresses.sql";
const SOURCES = {
  notify_on_job_update: RENAME,
  poster_cancel_job: RENAME,
  notify_helper_application_viewed: RENAME,
  notify_helper_on_direct_offer: RENAME,
  track_revision_scope_creep: RENAME,
  expire_pending_direct_offers: RENAME,
  respond_to_direct_offer: RENAME,
  helper_cancel_booking: RENAME,
  helper_abort_job: RENAME,
  check_referral_bonus: "20260923211309_referral_bonus_links_and_apostrophe.sql",
  sweep_no_show_alerts: "20260831193039_cron_sql_error_reporting.sql",
  notify_helper_on_tip: "20260923205635_notification_producers_carry_their_subject.sql",
};

/** The LAST `CREATE [OR REPLACE] FUNCTION public.<fn>(` statement in `sql`, through its closing dollar tag. */
function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let stmt = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    if (!tag) continue;
    const open = tag.index + tag[0].length;
    const close = rest.indexOf(tag[1], open) + tag[1].length;
    stmt = rest.slice(0, close) + ";";
  }
  return stmt;
}

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
SET check_function_bodies = off;
`);
for (const [fn, file] of Object.entries(SOURCES)) {
  const stmt = lastDefinition(mig(file), fn);
  if (!stmt) { check(`${fn} is defined in ${file}`, false); continue; }
  try {
    await db.exec(`SET check_function_bodies = off; ${stmt}`);
  } catch (e) {
    check(`${fn} loads`, false, String(e.message ?? e).slice(0, 200));
  }
}

const bodies = async () => Object.fromEntries(
  (await db.query(`SELECT proname, prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public'`)).rows.map((r) => [r.proname, r.prosrc]));
const before = await bodies();
check("all twelve functions loaded", Object.keys(SOURCES).every((f) => before[f]), Object.keys(before).length);

if (!MODE) {
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
}
const once = await bodies();
if (!MODE) {
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
  await db.exec(`SET check_function_bodies = off; ${NEW}`);
}
const after = await bodies();

const OLD_NEW = [
  ["notify_on_job_update", `" has been cancelled by the poster.`, `" was cancelled by the person who posted it.`],
  ["poster_cancel_job", "cancelled by the poster", "was cancelled by the person who posted it before you accepted it"],
  ["notify_helper_application_viewed", "The poster viewed your application", `'" viewed your application.'`],
  ["notify_helper_on_direct_offer", "'A poster'", "COALESCE(full_name, 'Someone')"],
  ["track_revision_scope_creep", "The poster has requested", "The person who posted this job has requested "],
  ["check_referral_bonus", "as a helper", "You finished your first job and earned a $5 referral credit!"],
  ["check_referral_bonus", "as a helper", "Your referral finished their first job. You earned a $5 credit!"],
  ["expire_pending_direct_offers", "visible to all helpers", "The job is now open to everyone."],
  ["respond_to_direct_offer", "open to all helpers again", "The job is open to everyone again."],
  ["sweep_no_show_alerts", "message the customer", "message the person who posted it if you''re delayed."],
  ["helper_cancel_booking", "Message the poster", "Message the person who posted it or open a dispute."],
  ["helper_cancel_booking", "contact the poster", "contact the person who posted it or support."],
  ["helper_abort_job", "Tell the poster", "Tell the person who posted it why you can''t finish."],
];
for (const [fn, gone, present] of OLD_NEW) {
  const src = after[fn] ?? "";
  check(`${fn}: "${gone}" is gone`, !src.includes(gone));
  check(`${fn}: now says ${present}`, src.includes(present));
}
check("poster_cancel_job: all three sentences reworded",
  (after.poster_cancel_job?.match(/was cancelled by the person who posted it/g) ?? []).length === 3);
check("notify_helper_on_tip is untouched (tips lane)", after.notify_helper_on_tip === before.notify_helper_on_tip);
check("applying it again changes nothing (replay-safe)", JSON.stringify(once) === JSON.stringify(after));

// Only the reworded lines differ.
for (const fn of Object.keys(SOURCES)) {
  const a = (before[fn] ?? "").split("\n");
  const b = (after[fn] ?? "").split("\n");
  const changed = a.filter((line, i) => line !== b[i]);
  const onlyCopy = a.length === b.length && changed.every((l) =>
    /poster|customer|helpers?\b|as a helper/i.test(l));
  check(`${fn}: only copy lines changed (${changed.length})`, onlyCopy);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
