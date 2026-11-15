#!/usr/bin/env node
/**
 * PGlite proof for 20261115014233_export_my_data_timeout.sql: export_my_data carries its own 60 s statement_timeout
 * (the REST API applies it to the call), the migration is a no-op before the function exists (a rebuild), and it
 * is safe to apply three times.
 *
 *   node src/test/pglite/exportMyDataTimeout.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/exportMyDataTimeout.pglite.mjs # RED: the state before it
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261115014233_export_my_data_timeout.sql", import.meta.url), "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
// export_my_data is defined by older migrations, but the file guards on it anyway: with no function, no error.
await db.exec(NEW);
check("applies cleanly when export_my_data does not exist (replay-safe)", true);

await db.exec(`CREATE FUNCTION public.export_my_data(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $f$ BEGIN RETURN jsonb_build_object('user_id', p_user_id); END $f$;`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEW);
const { rows } = await db.query(`SELECT proconfig FROM pg_proc WHERE oid = 'public.export_my_data(uuid)'::regprocedure`);
const cfg = rows[0]?.proconfig ?? [];
check("export_my_data carries statement_timeout 60s", cfg.some((c) => /^statement_timeout=(60s|1min)$/.test(c)), JSON.stringify(cfg));
check("its search_path is kept", cfg.some((c) => c.startsWith("search_path=")), JSON.stringify(cfg));
const out = await db.query(`SELECT public.export_my_data('00000000-0000-0000-0000-000000000001') AS j`);
check("it still answers", out.rows[0]?.j?.user_id === "00000000-0000-0000-0000-000000000001");

console.log(failures ? `${failures} FAIL` : "all PASS");
process.exit(failures ? 1 : 0);
