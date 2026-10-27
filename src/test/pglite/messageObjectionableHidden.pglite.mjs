/**
 * Q1799 (Apple 1.2): objectionable language in a message is hidden from its
 * recipient (flagged_hidden + flag_reason 'objectionable'); everyday work words
 * are not; the team thread is never scanned; contact sharing still hides as before.
 * Applies 20261027194309 three times on a messages stub whose trigger is the real one.
 *   node src/test/pglite/messageObjectionableHidden.pglite.mjs
 *   NEW_MIGRATION=skip ... (RED: the old scanner leaves objectionable messages visible)
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261027194309_message_objectionable_language_hidden.sql", import.meta.url).pathname;
const db = new PGlite();
let fail = 0;
const check = (name, ok, got = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${got})`}`); if (!ok) fail++; };
await db.exec(`
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.messages (id serial PRIMARY KEY, content text, team_thread_user_id uuid, flagged_hidden boolean, flag_reason text);
  -- prod's contact_leak_reason, reduced to its phone rule for this harness
  CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql AS $$
    SELECT CASE WHEN t ~ '\\d{3}[-. ]?\\d{3}[-. ]?\\d{4}' THEN 'phone' END $$;
  -- prod's scan_message_content before this change (pg_get_functiondef 2026-10-27)
  CREATE FUNCTION public.scan_message_content() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE v_reason text; BEGIN
    IF NEW.team_thread_user_id IS NOT NULL THEN NEW.flagged_hidden := false; NEW.flag_reason := NULL; RETURN NEW; END IF;
    v_reason := public.contact_leak_reason(NEW.content);
    IF v_reason IS NOT NULL THEN NEW.flagged_hidden := true; NEW.flag_reason := v_reason;
    ELSE NEW.flagged_hidden := false; NEW.flag_reason := NULL; END IF;
    RETURN NEW; END $$;
  CREATE TRIGGER messages_scan_content BEFORE INSERT OR UPDATE OF content ON public.messages FOR EACH ROW EXECUTE FUNCTION public.scan_message_content();
`);
if (process.env.NEW_MIGRATION !== "skip") {
  const sql = readFileSync(MIG, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const send = async (content, team = null) =>
  (await db.query(`INSERT INTO public.messages (content, team_thread_user_id) VALUES ($1, $2) RETURNING flagged_hidden, flag_reason`, [content, team])).rows[0];
for (const t of ["I will kill you", "you are a retard", "send nudes", "kill yourself", "F A G".replace(/ /g, "") + "got"]) {
  const r = await send(t);
  check(`hidden: "${t}"`, r.flagged_hidden === true && r.flag_reason === "objectionable", JSON.stringify(r));
}
for (const t of ["need a hoe for the garden", "the stopcock is leaking", "screw the shelf in", "assume 2 hours", "Dick's Sporting Goods pickup", "Spicy gumbo after", "I'll kill the weeds by the fence"]) {
  const r = await send(t);
  check(`visible: "${t}"`, r.flagged_hidden === false && r.flag_reason === null, JSON.stringify(r));
}
const ph = await send("call me 337-555-1212");
check("contact sharing still hides as before", ph.flagged_hidden === true && ph.flag_reason === "phone", JSON.stringify(ph));
const team = await send("I will kill you", "00000000-0000-0000-0000-000000000001");
check("the team thread is never scanned", team.flagged_hidden === false, JSON.stringify(team));
const edit = (await db.query(`UPDATE public.messages SET content = 'you are a retard' WHERE content = 'need a hoe for the garden' RETURNING flagged_hidden, flag_reason`)).rows[0];
check("an edit into objectionable words hides it", edit.flagged_hidden === true && edit.flag_reason === "objectionable", JSON.stringify(edit));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
