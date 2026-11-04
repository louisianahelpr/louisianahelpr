#!/usr/bin/env node
/**
 * Q1930 (WIP): declutter_road_miles answers a stored ROUTED distance for that exact pair, else the straight line x 1.3
 * estimate exactly as before. Runs NEW_FILE VERBATIM (3x) over the REAL helpr_task_distance_m and the previous
 * declutter_road_miles (newest definitions before NEW_FILE, any dollar-quote tag).
 *
 *   node src/test/pglite/declutterRoadMilesRouted.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRoadMilesRouted.pglite.mjs   # RED: the previous definition
 *   MIGRATION_PATH=<planted copy> node ...                                          # RED on a planted defect
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_road_miles_routed.sql"));
if (!NEW_FILE) throw new Error("the Q1930 migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
await db.exec(definitionBefore("helpr_task_distance_m", NEW_FILE));
await db.exec(definitionBefore("declutter_road_miles", NEW_FILE));
const miles = async (a, b, c, d) => (await db.query(`SELECT public.declutter_road_miles($1, $2, $3, $4) AS m`, [a, b, c, d])).rows[0].m;
// Gretna (Westbank, origin rounded to 2 dp as the callers do) -> Lakeview (Eastbank): a river crossing.
const G = [29.91, -90.05], L = [30.0101, -90.1137], M = [30.0026, -90.1777];
const before = { gl: await miles(...G, ...L), gm: await miles(...G, ...M), nul: await miles(null, -90, ...L), br: await miles(30.45, -91.19, 30.5, -91.1) };

if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definition (expect FAILs)");
else {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("the migration applies 3x (replay-safe)", true);
  await db.exec(`INSERT INTO public.declutter_route_miles (o_lat, o_lng, d_lat, d_lng, miles, minutes) VALUES
    (${G[0]}, ${G[1]}, ${L[0]}, ${L[1]}, 14, 24),
    (${G[0]}, ${G[1]}, ${M[0]}, ${M[1]}, 40, 50);
    UPDATE public.declutter_route_miles SET routed_at = now() - interval '200 days' WHERE d_lat = ${M[0]};`);
}

check("a routed pair answers its routed miles (14), not the 1.3x estimate", (await miles(...G, ...L)) === 14, `got ${await miles(...G, ...L)}, estimate ${before.gl}`);
check("the estimate for that pair was lower (the Helpr was underpaid)", before.gl < 14, `estimate ${before.gl}`);
check("a stale routed row (200 days) is ignored: the estimate answers", (await miles(...G, ...M)) === before.gm, `got ${await miles(...G, ...M)} vs ${before.gm}`);
check("an unrouted pair answers exactly the old estimate", (await miles(30.45, -91.19, 30.5, -91.1)) === before.br && before.br > 0, `before ${before.br}`);
check("a missing point is still NULL", (await miles(null, -90, ...L)) === before.nul && before.nul === null);
if (!RED) {
  const g = (await db.query(`SELECT has_table_privilege('authenticated', 'public.declutter_route_miles', 'SELECT') s,
      has_table_privilege('authenticated', 'public.declutter_route_miles', 'INSERT') i,
      has_function_privilege('anon', 'public.declutter_road_miles(numeric,numeric,numeric,numeric)', 'EXECUTE') ax,
      has_function_privilege('authenticated', 'public.declutter_road_miles(numeric,numeric,numeric,numeric)', 'EXECUTE') mx`)).rows[0];
  check("members neither read nor write the routed table (drop-off points are private)", !g.s && !g.i, JSON.stringify(g));
  check("members still execute declutter_road_miles; anon does not", g.mx && !g.ax, JSON.stringify(g));
  await db.exec(`SET ROLE authenticated`);
  check("as a member, the routed answer comes through (SECURITY DEFINER)", (await miles(...G, ...L)) === 14);
  await db.exec(`RESET ROLE`);
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
