#!/usr/bin/env node
/**
 * PGlite proof for 20261102070659_series_release_ineligible_neutral_words.sql (Q2246, words half).
 *
 *   node src/test/pglite/seriesReleaseNeutralWords.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/seriesReleaseNeutralWords.pglite.mjs # RED: the live definition only
 *   PLANT=words node src/test/pglite/seriesReleaseNeutralWords.pglite.mjs        # planted: the reason is never read
 *   PLANT=anon node src/test/pglite/seriesReleaseNeutralWords.pglite.mjs         # planted: Supabase's default anon grant kept
 *
 * charge-recurring-visits releases an under-18 or not-ready holder's dates with p_reason 'holder_ineligible'. The poster
 * now reads "<dates> on "<series>" is/are open again. ..." with nothing about the Helpr; a Helpr who gave dates up
 * ('given_up', 'left_series', 'visit_cancelled') still reads "A Helpr gave up ..." byte for byte as before.
 * World: the live body = 20260927012806's with 20261025203540's fee-words rewrite (md5(prosrc) f77ecc23 on prod, read
 * 2026-11-02), applied here as that restated text.
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const split = readMigration("20260927012806_recurring_split_days.sql");
const at = split.indexOf("CREATE OR REPLACE FUNCTION public.series_release_dates(");
const LIVE = split.slice(at, split.indexOf("$fn$;", split.indexOf("AS $fn$", at)) + 5).replace(
  "or is refunded less the card processing fee if you already paid for it.",
  "or most of it comes back to your card if you already paid for it.",
);
let FIX = readMigration("20261102070659_series_release_ineligible_neutral_words.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (PLANT === "words") FIX = FIX.replaceAll("WHEN p_reason = 'holder_ineligible'", "WHEN false");
if (PLANT === "anon") FIX = FIX.replace("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC;");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the live definition only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);
const { P, A, B } = USERS;
const { check, failures } = checker();
const S = "c0000000-0000-0000-0000-000000002246";

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
for (const f of ["20260927012804_recurring_series_end.sql", "20260927012805_hired_job_schedule_lock.sql"]) await db.exec(readMigration(f));
await db.exec(split);
await db.exec(LIVE);
// Supabase grants EXECUTE on every new public function to anon and authenticated by default; the migration takes it back.
await db.exec(`grant execute on function public.series_release_dates(uuid, uuid, date[], text, text, uuid) to anon, authenticated;`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
check("the migration applies 3x (replay-safe)", true);

const d = (n) => `(now() AT TIME ZONE 'America/Chicago')::date + ${n}`;
const hold = (who, n) => db.exec(`insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${S}', ${d(n)}, '${who}') on conflict do nothing;`);
const release = async (who, days, reason) => {
  await db.exec(`delete from public.notifications;`);
  for (const n of days) await hold(who, n);
  await hold(B, 30);
  const arr = `array[${days.map(d).join(", ")}]::date[]`;
  const r = await db.query(`select public.series_release_dates('${S}', '${who}', ${arr}, '${reason}', 'Mow the yard', '${P}') as v`);
  const toPoster = (await db.query(`select message from public.notifications where user_id = '${P}'`)).rows.map((x) => x.message);
  const toB = (await db.query(`select message from public.notifications where user_id = '${B}'`)).rows.map((x) => x.message);
  return { released: r.rows[0].v, toPoster, toB };
};

await db.exec(`insert into public.jobs (id, customer_id, title, status) values ('${S}', '${P}', 'Mow the yard', 'accepted') on conflict do nothing;`).catch(() => {});

let r = await release(A, [3], "holder_ineligible");
check("an ineligible holder's one date is released", r.released.length === 1, JSON.stringify(r.released));
check("the poster reads a neutral line for one date (no 'gave up', 'is open again')",
  r.toPoster.length === 1 && /^\S+ \S+ \d+ on "Mow the yard" is open again\. Another Helpr on the series can pick it up, or you can offer it to someone new\./.test(r.toPoster[0]) && !/gave up/.test(r.toPoster[0]),
  JSON.stringify(r.toPoster));

r = await release(A, [4, 5], "holder_ineligible");
check("two dates: 'are open again', 'them'", r.toPoster.length === 1 && /on "Mow the yard" are open again\. Another Helpr on the series can pick them up, or you can offer them to someone new\./.test(r.toPoster[0]) && !/gave up/.test(r.toPoster[0]), JSON.stringify(r.toPoster));

for (const reason of ["given_up", "left_series", "visit_cancelled"]) {
  r = await release(A, [6], reason);
  check(`'${reason}' keeps "A Helpr gave up <date> on "<series>". ..." exactly`,
    r.toPoster.length === 1 && /^A Helpr gave up \S+ \S+ \d+ on "Mow the yard"\. Another Helpr on the series can pick it up, or you can offer it to someone new\. A date nobody takes isn't charged, or most of it comes back to your card if you already paid for it\.$/.test(r.toPoster[0]),
    JSON.stringify(r.toPoster));
}
check("the other Helprs' notice is unchanged", r.toB.length === 1 && /is open\. First to pick it up gets it\.$/.test(r.toB[0]), JSON.stringify(r.toB));

const call = `select public.series_release_dates('${S}', '${A}', array[current_date + 9]::date[], 'given_up', 't', '${P}')`;
check("anon cannot call it", refused(await as(db, "anon", null, call), /permission denied/));
check("a signed-in member cannot call it", refused(await as(db, "authenticated", A, call), /permission denied/));

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
