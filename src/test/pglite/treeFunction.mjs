/**
 * `--tree` for a PGlite proof written against ONE migration: the text of a
 * function as the WHOLE migrations tree leaves it (the newest CREATE across
 * every file, any dollar-quote tag), so a proof can re-run its AFTER cases on
 * the definition prod will actually hold once every later migration has run.
 *
 * Built for helper_cancel_booking (docs/OPEN.md Q414): 20260925140148 gave it
 * a crew branch, and a later restatement written from an older base would
 * silently drop it; groupRosterDeparture / groupCrewNoLead with --tree are red
 * on that.
 */
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");

export function newestTreeFunction(name) {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(DIR + files[i], "utf8");
    const m = [...sql.matchAll(defRe(name))].at(-1);
    if (!m) continue;
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const bodyStart = m.index + open.index + open[0].length;
    const close = sql.indexOf(open[1], bodyStart);
    return { file: files[i], sql: sql.slice(m.index, sql.indexOf(";", close) + 1) };
  }
  throw new Error(`${name}: not defined in any migration`);
}

/** Load the tree's helper_cancel_booking (and is_late_cancellation if absent) into `db`. */
export async function loadTreeHelperCancel(db) {
  const late = await db.query(`SELECT to_regprocedure('public.is_late_cancellation(boolean,numeric)') AS f`);
  if (!late.rows[0].f) await db.exec(newestTreeFunction("is_late_cancellation").sql);
  const hcb = newestTreeFunction("helper_cancel_booking");
  await db.exec(hcb.sql);
  return hcb.file;
}
