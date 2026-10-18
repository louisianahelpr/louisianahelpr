#!/usr/bin/env node
/**
 * PGlite proof for 20261017115618_terms_acceptance_never_downgrades
 * (docs/OPEN.md Q?schedule-double-modal).
 *
 *   node src/test/pglite/termsAcceptanceNeverDowngrades.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/termsAcceptanceNeverDowngrades.pglite.mjs   # RED: no trigger
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: public.profiles with the live column types (terms_version_accepted
 * text, terms_accepted_at timestamptz, plus a column nothing guards). The
 * migration is applied 3x (replay-safe), then, as a role WITHOUT EXECUTE on the
 * trigger function (the member's own UPDATE):
 *   D1 "Oct 2026" -> "Sep 2026" keeps "Oct 2026" and the old terms_accepted_at
 *      (the 2026-10-17 09:13:20Z write; RED without the migration);
 *   D2 a downgrade across a year ("Jan 2026" -> "Dec 2025") is kept too;
 *   F1 a FUTURE version ("Dec 2099", later than the current UTC month) is kept
 *      at OLD, from a ranked and from an empty OLD (lh-authz-rls finding 1);
 *   F2 the current UTC month's version is accepted;
 *   U1 "Aug 2026" -> "Sep 2026" moves forward with its new timestamp;
 *   U2 a same-version re-accept is written as sent;
 *   N1 clearing to NULL and setting from NULL are left to the writer;
 *   N2 a legacy non "Mon YYYY" value is not ranked (written as sent);
 *   O1 an UPDATE of another column alone is untouched;
 *   R1 exactly one trigger after 3x replay.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20261017115618_terms_acceptance_never_downgrades.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  terms_version_accepted text,
  terms_accepted_at timestamptz,
  bio text
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

let fails = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) fails++;
};
const T0 = "2026-10-14T19:28:18.598Z";
const T1 = "2026-10-17T09:13:20.000Z";
let n = 0;
async function row(version, at = T0) {
  const uid = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query("INSERT INTO public.profiles (user_id, terms_version_accepted, terms_accepted_at) VALUES ($1, $2, $3)", [uid, version, at]);
  return uid;
}
/** The member's own UPDATE: as `authenticated`, which has no EXECUTE on the trigger function. */
async function asMember(sql, params) {
  await db.exec("SET ROLE authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function accept(uid, version, at = T1) {
  await asMember("UPDATE public.profiles SET terms_version_accepted = $2, terms_accepted_at = $3 WHERE user_id = $1", [uid, version, at]);
  const { rows } = await db.query("SELECT terms_version_accepted v, terms_accepted_at at FROM public.profiles WHERE user_id = $1", [uid]);
  return { v: rows[0].v, at: rows[0].at ? new Date(rows[0].at).toISOString() : null };
}

{
  const u = await row("Oct 2026");
  const r = await accept(u, "Sep 2026");
  check(r.v === "Oct 2026" && r.at === T0, `D1 Oct 2026 -> Sep 2026 keeps Oct 2026 and its time (got ${r.v} @ ${r.at})`);
}
{
  const u = await row("Jan 2026");
  const r = await accept(u, "Dec 2025");
  check(r.v === "Jan 2026" && r.at === T0, `D2 Jan 2026 -> Dec 2025 keeps Jan 2026 (got ${r.v} @ ${r.at})`);
}
{
  const u = await row("Oct 2026");
  const r = await accept(u, "Dec 2099");
  check(r.v === "Oct 2026" && r.at === T0, `F1 Oct 2026 -> Dec 2099 keeps Oct 2026 (got ${r.v} @ ${r.at})`);
  const u2 = await row("");
  const r2 = await accept(u2, "Dec 2099");
  check(r2.v === "", `F1 '' -> Dec 2099 keeps '' (got ${JSON.stringify(r2.v)})`);
}
{
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date();
  const cur = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const u = await row("Jan 2026");
  const r = await accept(u, cur);
  check(r.v === cur && r.at === T1, `F2 the current UTC month (${cur}) is accepted (got ${r.v})`);
}
{
  const u = await row("Aug 2026");
  const r = await accept(u, "Sep 2026");
  check(r.v === "Sep 2026" && r.at === T1, `U1 Aug 2026 -> Sep 2026 moves forward (got ${r.v} @ ${r.at})`);
}
{
  const u = await row("Oct 2026");
  const r = await accept(u, "Oct 2026");
  check(r.v === "Oct 2026" && r.at === T1, `U2 a same-version re-accept is written as sent (got ${r.v} @ ${r.at})`);
}
{
  const u = await row("Oct 2026");
  const r = await accept(u, null, null);
  check(r.v === null, `N1 clearing to NULL is left to the writer (got ${r.v})`);
  const r2 = await accept(u, "Jun 2026");
  check(r2.v === "Jun 2026", `N1 setting from NULL is left to the writer (got ${r2.v})`);
}
{
  const u = await row("1");
  const r = await accept(u, "Sep 2026");
  check(r.v === "Sep 2026", `N2 a legacy unranked value is not compared (got ${r.v})`);
  const u2 = await row("Oct 2026");
  const r2 = await accept(u2, "v2");
  check(r2.v === "v2", `N2 an unranked new value is not compared (got ${r2.v})`);
}
{
  const u = await row("Oct 2026");
  await asMember("UPDATE public.profiles SET bio = 'hi' WHERE user_id = $1", [u]);
  const { rows } = await db.query("SELECT terms_version_accepted v, bio FROM public.profiles WHERE user_id = $1", [u]);
  check(rows[0].v === "Oct 2026" && rows[0].bio === "hi", "O1 an UPDATE of another column alone is untouched");
}
{
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_keep_newest_terms_acceptance' AND tgrelid = 'public.profiles'::regclass",
  );
  check(rows[0].n === 1, `R1 exactly one trigger after 3x replay (got ${rows[0].n})`);
}

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
