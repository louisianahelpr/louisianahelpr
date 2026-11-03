#!/usr/bin/env node
/**
 * PGlite proof for 20261103203202_helpr_delivery_talk_refuses_objectionable (NOID-20, Declutter chat safety filter):
 * the Helpr delivery chat refuses objectionable language (before contact details), as the handover and order chats
 * do. Loads prod's current contact_leak_reason, objectionable_reason and reject_contact_leak_in_helpr_task_talk (the
 * newest definitions before this migration; md5 checked against read-only prod SQL), a table holding only the body
 * the trigger reads, the trigger as 20261031231948 creates it; then the migration 3x.
 *
 *   node src/test/pglite/helprDeliveryTalkRefusesObjectionable.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/helprDeliveryTalkRefusesObjectionable.pglite.mjs  # RED: prod's body
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261103203202_helpr_delivery_talk_refuses_objectionable.sql";
// md5(prosrc) on prod (read-only SQL on fncmgoasalhdgfwzhsqa, 2026-11-03).
const PROD_MD5 = {
  contact_leak_reason: "e77858cc708e091b44f74498ef65b648",
  objectionable_reason: "b63d2d38556d87adf6178509d978d887",
  reject_contact_leak_in_helpr_task_talk: "4c174d9060595c49f3904daef598c365",
};
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

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

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.helpr_task_talk_messages (id serial PRIMARY KEY, body text NOT NULL);`);
for (const fn of Object.keys(PROD_MD5)) {
  await db.exec(definitionBefore(fn, NEW_FILE));
  const md5 = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = '${fn}'`)).rows[0]?.m;
  ok(md5 === PROD_MD5[fn], `the world's ${fn} is prod's body (md5 ${md5?.slice(0, 8)})`);
}
await db.exec(`CREATE TRIGGER trg_reject_contact_leak_in_helpr_task_talk BEFORE INSERT OR UPDATE OF body ON public.helpr_task_talk_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_helpr_task_talk();`);
if (!skip) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) {
    let err = null;
    try { await db.exec(sql); } catch (e) { err = e.message; }
    ok(!err, `the migration applies (run ${i + 1} of 3)${err ? `: ${err}` : ""}`);
  }
}
const send = async (body) => { try { await db.query(`INSERT INTO public.helpr_task_talk_messages (body) VALUES ($1)`, [body]); return null; } catch (e) { return e; } };
const threat = await send("I'm gonna kill you if it's late");
ok(threat?.code === "23514" && /community rules/.test(threat.message), `a threat to the Helpr is refused (${threat?.message ?? "sent"})`);
const slur = await send("you retards");
ok(slur?.code === "23514" && /community rules/.test(slur.message), `a slur is refused (${slur?.message ?? "sent"})`);
const both = await send("you retards, call 337-555-0199");
ok(both?.code === "23514" && /community rules/.test(both.message), `objectionable words are refused first, before the contact check (${both?.message ?? "sent"})`);
const phone = await send("call me at 337-555-0199");
ok(phone?.code === "23514" && /Keep contact details/.test(phone.message), `contact details are still refused (${phone?.message ?? "sent"})`);
ok((await send("At the door in 5 minutes, thanks!")) === null, "an ordinary message still sends");
const edit = await (async () => { try { await db.query(`UPDATE public.helpr_task_talk_messages SET body = 'kys' WHERE id = (SELECT min(id) FROM public.helpr_task_talk_messages)`); return null; } catch (e) { return e; } })();
ok(edit?.code === "23514", `an edit into objectionable words is refused (${edit?.message ?? "saved"})`);
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.reject_contact_leak_in_helpr_task_talk()', 'EXECUTE') AS a`)).rows[0]?.a;
ok(acl === false, "members cannot call the trigger function");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
