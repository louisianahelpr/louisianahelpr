#!/usr/bin/env node
/**
 * PGlite proof for 20261109224343_continue_day_house_date_style (F175, display only).
 *
 *   npx tsx src/test/pglite/continueDayHouseDateStyle.pglite.mjs [--replay] [--before]
 *
 * --before installs the previous definitions (byte-equal to LIVE prosrc on 11-09): L1, L2 and N1 FAIL.
 *
 *   L1 continue_day_label writes the house style ("Wed, Nov 11 at 9:00 AM") for every sample day and time
 *   L2 the client mirror (src/lib/continueDayWords.ts continueDayLabel) returns the SAME words for every sample
 *   N1 propose_job_continue_day names the asker with member_display_name ("First L."), never split_part (first name)
 *   S1 propose_job_continue_day is otherwise its previous body: only the two name expressions changed
 *   G1 grants as live: authenticated + service_role, never PUBLIC/anon
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { continueDayLabel } from "../../lib/continueDayWords.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261109224343_continue_day_house_date_style.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let out = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    const close = rest.indexOf(tag[1], tag.index + tag[0].length);
    out = rest.slice(0, close + tag[1].length) + ";";
  }
  return out;
}
function previousDefinition(fn) {
  let out = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const d = lastDefinition(readFileSync(DIR + f, "utf8"), fn);
    if (d) out = d;
  }
  return out;
}
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
`);
const FNS = ["continue_day_label", "propose_job_continue_day"];
const prev = Object.fromEntries(FNS.map((fn) => [fn, previousDefinition(fn)]));
for (const fn of FNS) if (!prev[fn]) throw new Error(`no previous definition of ${fn}`);
if (BEFORE) for (const fn of FNS) await db.exec(prev[fn]);
else for (let i = 1; i <= (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

const SAMPLES = [
  ["2026-11-11", "09:00"], ["2026-11-05", "13:30"], ["2026-11-08", "00:00"], ["2026-11-08", "12:15"],
  ["2026-12-31", "23:59"], ["2027-01-01", "07:05"], ["2026-02-28", "12:00"],
];
const server = [];
for (const [d, t] of SAMPLES) server.push((await db.query(`SELECT public.continue_day_label($1::date, $2::time) AS l`, [d, t])).rows[0].l);
check("L1 the house style: 'Wed, Nov 11 at 9:00 AM'", server[0] === "Wed, Nov 11 at 9:00 AM" && server[2] === "Sun, Nov 8 at 12:00 AM" && server[6] === "Sat, Feb 28 at 12:00 PM", JSON.stringify(server));
const client = SAMPLES.map(([d, t]) => continueDayLabel(d, t));
check("L2 the client mirror says exactly the same words", JSON.stringify(client) === JSON.stringify(server), `client ${JSON.stringify(client)}`);

const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'propose_job_continue_day'`)).rows[0]?.prosrc ?? "";
check("N1 the asker is named First L. (member_display_name), never split_part", !src.includes("split_part(") && (src.match(/COALESCE\(NULLIF\(public\.member_display_name\(/g) ?? []).length === 2);
const prevBody = (() => { const d = prev.propose_job_continue_day; const tag = d.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/); const s = tag.index + tag[0].length; return d.slice(s, d.indexOf(tag[1], s)); })();
const norm = (x) => x.replace(/NULLIF\(split_part\((public\.member_display_name\([^;]*?NULL\)), ' ', 1\), ''\)/g, "NULLIF($1, '')");
check("S1 otherwise the previous body, byte for byte", norm(prevBody) === src);
if (!BEFORE) {
  for (const fn of FNS) {
    const acl = (await db.query(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE proname = $1`, [fn])).rows[0]?.a ?? "";
    check(`G1 ${fn}: authenticated + service_role, never PUBLIC/anon`, /authenticated=X/.test(acl) && /service_role=X/.test(acl) && !/anon=|[{,]=/.test(acl), acl);
  }
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
