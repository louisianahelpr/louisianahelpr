#!/usr/bin/env node
/**
 * PGlite proof for 20261030045905_declutter_helpr_delivery_always (DC-4, owner 2026-10-29: buyers can ALWAYS choose
 * Helpr delivery for what they buy, whatever the seller ticked).
 *
 *   node src/test/pglite/declutterHelprDeliveryAlways.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHelprDeliveryAlways.pglite.mjs # RED: the prod definition before it
 *
 * Baseline = the EFFECTIVE prod declutter_handover_refused (pg_get_functiondef 2026-10-30), loaded verbatim from its
 * newest repo file. The same refusal was measured on prod itself in a rolled-back transaction on a test seller's
 * live item: handovers NULL -> delivery refused = false; handovers {porch} -> delivery refused = true.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261030045905_declutter_helpr_delivery_always.sql";
const NEW = readFileSync(MIG + NEW_FILE, "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: the prod definition before the migration (expect FAILs)");

/** The newest CREATE of a function in the migrations BEFORE `before`, whatever its dollar-quote tag. */
function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG + f, "utf8");
    let at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    while (at >= 0) {
      const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))[1];
      const bodyAt = sql.indexOf(tag, at) + tag.length;
      const end = sql.indexOf(tag, bodyAt) + tag.length;
      found = { file: f, stmt: sql.slice(at, end) + ";" };
      at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`, end);
    }
  }
  if (!found) throw new Error(`no ${name} before ${before}`);
  return found;
}
const BASE = newestBefore("declutter_handover_refused", NEW_FILE);
console.log(`baseline: ${BASE.file}`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.declutter_items (id int PRIMARY KEY, handovers text[], porch_ok boolean NOT NULL DEFAULT true, price_cents int NOT NULL);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, item_id int, price_cents int NOT NULL);
  INSERT INTO public.declutter_items VALUES
    (1, ARRAY['porch'], true, 4000),        -- porch only, paid
    (2, NULL, true, 4000),                  -- an older item: every way
    (3, ARRAY['meetup'], false, 2500),      -- meetup only, paid
    (4, ARRAY['porch'], true, 0),           -- free, porch only
    (5, NULL, false, 3000);                 -- older, porch off
  INSERT INTO public.declutter_cart_items VALUES
    ('00000000-0000-4000-8000-000000000001', 1, 4000),
    ('00000000-0000-4000-8000-000000000002', 2, 4000),
    ('00000000-0000-4000-8000-000000000003', 3, 2500),
    ('00000000-0000-4000-8000-000000000004', 4, 0),
    ('00000000-0000-4000-8000-000000000005', 5, 3000);
`);
await db.exec(BASE.stmt);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const L = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const refused = async (lines, way) =>
  (await db.query("SELECT public.declutter_handover_refused($1::uuid[], $2) AS r", [lines.map(L), way])).rows[0].r;

check("T1 a porch-only paid listing: Helpr delivery is NOT refused", (await refused([1], "delivery")) === false);
check("T2 a meetup-only paid listing: Helpr delivery is NOT refused", (await refused([3], "delivery")) === false);
check("T3 two paid lines that share no way: Helpr delivery still NOT refused", (await refused([1, 3], "delivery")) === false);
check("T4 every other way keeps the rule: porch on a meetup-only line is refused", (await refused([3], "porch")) === true);
check("T5 ... and meetup on a porch-only line is refused", (await refused([1], "meetup")) === true);
check("T6 ... and a shared way is allowed (porch on porch-only)", (await refused([1], "porch")) === false);
check("T7 an older line (NULL) narrows nothing: delivery allowed", (await refused([2], "delivery")) === false);
check("T8 an older porch-off line still narrows porch out", (await refused([1, 5], "porch")) === true);
check("T9 a FREE line keeps today's rule: delivery refused on a porch-only free item", (await refused([4], "delivery")) === true);
check("T10 a mixed free + paid checkout keeps today's rule for delivery", (await refused([1, 4], "delivery")) === true);
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.declutter_handover_refused(uuid[],text)', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.declutter_handover_refused(uuid[],text)', 'EXECUTE') AS b`)).rows[0];
check("T11 still an internal helper: anon and authenticated can't run it", acl.a === false && acl.b === false, JSON.stringify(acl));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL(S)`);
process.exit(failures === 0 ? 0 : 1);
