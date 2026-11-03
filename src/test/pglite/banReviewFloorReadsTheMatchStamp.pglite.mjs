#!/usr/bin/env node
/**
 * PGlite proof for 20261103225923_ban_review_floor_reads_the_match_stamp.sql (docs/OPEN.md Q1415 (f1)).
 *
 *   node src/test/pglite/banReviewFloorReadsTheMatchStamp.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/banReviewFloorReadsTheMatchStamp.pglite.mjs   # RED: the live state
 *
 * ban_review_retained_floor and ban_standing_rank are their NEWEST definitions before the migration under test, checked
 * by md5(prosrc) against prod (read 2026-11-03) or the proof refuses to run. Tables carry the prod columns the floor and
 * the trigger read. A "flip" is the exact statement enforce_retained_ban runs (INSERT ... ON CONFLICT (user_id,
 * matched_on, retained_ban_id) DO UPDATE SET auto_banned = true WHERE NOT auto_banned) followed by its
 * UPDATE retained_bans SET reapplied_at = now(), so the live state is modelled as prod writes it.
 *
 *   F1  an old ban match whose retained row ANOTHER account re-applied during the review does not count (the f1 defect)
 *   F2  an old doubt-check this member's sign-in flipped to a ban during the review counts
 *   F3  a match recorded as a ban during the review counts; F4 an old one never re-applied does not
 *   F5  the stamp: set on a ban insert and on the flip, never on a doubt-check insert, never moved by a later update or
 *       a repeat flip, and not writable by hand
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const UNDER_TEST = "20261103225923_ban_review_floor_reads_the_match_stamp.sql";
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
const FIXED = process.env.NEW_MIGRATION !== "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
/** md5(prosrc) on prod, read 2026-11-03 (read-only MCP SELECT). */
const LIVE_MD5 = { ban_review_retained_floor: "b535583ba2415ebd4863efeb3ecf6d43" };

function newestStatement(name, files) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  let found = null;
  for (const f of files) {
    const sql = read(f);
    for (const m of sql.matchAll(head)) {
      const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(m.index))[1];
      const open = sql.indexOf(tag, m.index);
      const close = sql.indexOf(tag, open + tag.length);
      found = { file: f, stmt: `${sql.slice(m.index, close + tag.length)};` };
    }
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}
const before = readdirSync(MIG_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f) && f < UNDER_TEST).sort();

const U = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.retained_bans (id uuid PRIMARY KEY, email_sha256 text NOT NULL DEFAULT 'x', ban_status text NOT NULL, ban_type text,
  reason text NOT NULL DEFAULT 'r', expires_at timestamptz, retained_at timestamptz NOT NULL DEFAULT now(), reapplied_at timestamptz,
  retained_via text);
CREATE TABLE public.ban_evasion_matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, matched_on text, match_sha256 text,
  retained_ban_id uuid, original_ban_status text, original_reason text, original_recorded_at timestamptz, original_expires_at timestamptz,
  auto_banned boolean NOT NULL DEFAULT false, resolved boolean DEFAULT false, cleared_at timestamptz, created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, matched_on, retained_ban_id));
`);
for (const name of ["ban_standing_rank", "ban_review_retained_floor"]) await db.exec(newestStatement(name, before).stmt);
for (const [name, want] of Object.entries(LIVE_MD5)) {
  const got = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1`, [name])).rows[0]?.m;
  if (got !== want) {
    console.log(`REFUSING TO RUN: public.${name} md5 ${got} != prod ${want}`);
    process.exit(1);
  }
}

const floor = async (u, sinceHoursAgo) =>
  (await db.query(`SELECT public.ban_review_retained_floor($1, $2) AS v`, [u, ago(sinceHoursAgo)])).rows[0].v;
/** A match row as enforce_retained_ban / flag_possible_ban_evasion_by_phone insert it, `createdHoursAgo` ago. */
async function seed(u, rid, { auto, createdHoursAgo, st = "permanently_banned" }) {
  await db.query(`INSERT INTO public.retained_bans (id, ban_status) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [rid, st]);
  await db.query(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, retained_ban_id, original_ban_status, auto_banned, created_at)
                  VALUES ($1, 'email', $2, $3, $4, $5)`, [u, rid, st, auto, ago(createdHoursAgo)]);
}
/** enforce_retained_ban's own writes when `u` signs in matching `rid`. */
async function enforce(u, rid, st = "permanently_banned") {
  await db.query(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, retained_ban_id, original_ban_status, auto_banned)
                  VALUES ($1, 'email', $2, $3, true)
                  ON CONFLICT (user_id, matched_on, retained_ban_id) DO UPDATE SET auto_banned = true
                  WHERE NOT public.ban_evasion_matches.auto_banned`, [u, rid, st]);
  await db.query(`UPDATE public.retained_bans SET reapplied_at = now() WHERE id = $1`, [rid]);
}

// Rows from before the migration (as on prod): A's 30-day-old ban match, C's 30-day-old doubt-check, E's old ban match.
await seed(U(1), R(1), { auto: true, createdHoursAgo: 24 * 30 });
await seed(U(3), R(2), { auto: false, createdHoursAgo: 24 * 30 });
await seed(U(5), R(4), { auto: true, createdHoursAgo: 24 * 30 });
if (FIXED) for (let i = 0; i < 3; i++) await db.exec(read(UNDER_TEST));
console.log(FIXED ? `applied ${UNDER_TEST} 3x` : "the live state (migration skipped)");

// F1: member A's old (30 days) ban match on R1; during A's review (opened 2 h ago) member B signs in matching R1.
await enforce(U(2), R(1));
check("F1 another account re-applying the retained row does not harden this member's review", (await floor(U(1), 2)) === null,
  JSON.stringify(await floor(U(1), 2)));
check("F1 control: the other account's own match counts for its own review", (await floor(U(2), 2))?.ban_status === "permanently_banned");

// F2: member C's old doubt-check on R2 (30 days), flipped to a ban by C's own sign-in during the review.
check("F2 before the flip a doubt-check does not count", (await floor(U(3), 2)) === null);
await enforce(U(3), R(2));
check("F2 an old doubt-check flipped to a ban during the review counts", (await floor(U(3), 2))?.ban_status === "permanently_banned",
  JSON.stringify(await floor(U(3), 2)));

// F3 / F4
await seed(U(4), R(3), { auto: true, createdHoursAgo: 1 });
check("F3 a ban match recorded during the review counts", (await floor(U(4), 2))?.ban_status === "permanently_banned");
check("F4 an old ban match never re-applied does not count", (await floor(U(5), 2)) === null);

// F5: the stamp itself (only with the migration: the live table has no such column).
if (FIXED) {
  const stamp = async (u, rid) => (await db.query(`SELECT auto_banned_at FROM public.ban_evasion_matches WHERE user_id = $1 AND retained_ban_id = $2`, [u, rid])).rows[0]?.auto_banned_at;
  const s3 = await stamp(U(4), R(3));
  const s2 = await stamp(U(3), R(2));
  await db.query(`INSERT INTO public.retained_bans (id, ban_status) VALUES ($1, 'banned')`, [R(5)]);
  await db.query(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, retained_ban_id, original_ban_status, auto_banned) VALUES ($1, 'phone', $2, 'banned', false)`, [U(6), R(5)]);
  const sDoubt = await stamp(U(6), R(5));
  await db.query(`UPDATE public.ban_evasion_matches SET cleared_at = now(), auto_banned_at = now() - interval '9 days' WHERE user_id = $1`, [U(3)]);
  const s2After = await stamp(U(3), R(2));
  await enforce(U(3), R(2)); // a repeat flip: WHERE NOT auto_banned skips the update
  const s2Repeat = await stamp(U(3), R(2));
  await db.query(`UPDATE public.ban_evasion_matches SET auto_banned_at = now() WHERE user_id = $1`, [U(6)]);
  const sDoubtHand = await stamp(U(6), R(5));
  check("F5 the stamp is set on a ban insert and on the flip, not on a doubt-check, and nothing else moves it",
    s3 instanceof Date && s2 instanceof Date && sDoubt === null && s2After?.getTime() === s2.getTime()
      && s2Repeat?.getTime() === s2.getTime() && sDoubtHand === null,
    JSON.stringify({ s3, s2, sDoubt, s2After, s2Repeat, sDoubtHand }));
}

console.log(failures ? `\n${failures} FAILED (${FIXED ? "with the fix" : "the live state"})` : `\nALL PASS (${FIXED ? "applied 3x" : "the live state"})`);
process.exit(failures ? 1 : 0);
