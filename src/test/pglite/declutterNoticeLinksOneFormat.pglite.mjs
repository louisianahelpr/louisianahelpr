#!/usr/bin/env node
/**
 * Declutter audit DC-17 (2026-10-30): Declutter notices link in one format, ?tab=selling / ?tab=buying. Runs NEW_FILE
 * VERBATIM (3x) after the previous definitions of declutter_notify_strict, declutter_notify and declutter_notice_type,
 * then writes notices through declutter_notify (the path every sender uses) and reads the stored link:
 *   - ?view=sales / ?view=selling / ?view=mine are stored as ?tab=selling, keeping the rest of the link;
 *   - ?view=bought / ?view=buying are stored as ?tab=buying;
 *   - ?view=cart, ?view=offers (both sides), ?view=deliver, ?tab=..., /declutter/item/... and non-Declutter links
 *     are stored unchanged; a NULL link stays NULL;
 *   - a look-alike (?view=salesman) is not rewritten;
 *   - the notice's kind is unchanged (a Helpr's ?view=deliver notice keeps its own type);
 *   - grants: declutter_notice_link and declutter_notify_strict are service_role only.
 * Stubbed, and said so: declutter_price_words and declutter_notice_names_item return the message (they only word the
 * message), log_cron_defect does nothing.
 *
 *   node src/test/pglite/declutterNoticeLinksOneFormat.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticeLinksOneFormat.pglite.mjs   # RED: the previous writer
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_notice_links_one_format.sql"));
if (!NEW_FILE) throw new Error("the DC-17 migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS writer (expect FAILs)");

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = "99999999-0000-0000-0000-000000000001";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_price_words(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
CREATE FUNCTION public.declutter_notice_names_item(u uuid, o uuid, l text, m text) RETURNS text LANGUAGE sql AS $$ SELECT m $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.profiles (user_id) VALUES ('${U}');
`);
await db.exec(definitionBefore("declutter_notice_type", NEW_FILE));
await db.exec(definitionBefore("declutter_notify_strict", NEW_FILE));
await db.exec(definitionBefore("declutter_notify", NEW_FILE));
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
const q = async (s, p) => (await db.query(s, p)).rows;

/** Writes one notice through declutter_notify and returns the stored row. */
async function send(link, title = "Buyer paid", type = "payment") {
  await q(`DELETE FROM public.notifications`);
  await q(`SELECT public.declutter_notify($1::uuid, $2, $3, 'msg', $4, NULL::uuid)`, [U, type, title, link]);
  return (await q(`SELECT type, link FROM public.notifications`))[0];
}

const cases = [
  ["/declutter?view=sales", "/declutter?tab=selling"],
  ["/declutter?view=selling", "/declutter?tab=selling"],
  ["/declutter?view=mine", "/declutter?tab=selling"],
  ["/declutter?view=selling&talk=abc", "/declutter?tab=selling&talk=abc"],
  ["/declutter?view=bought", "/declutter?tab=buying"],
  ["/declutter?view=buying", "/declutter?tab=buying"],
  ["/declutter?view=buying&order_talk=o1", "/declutter?tab=buying&order_talk=o1"],
];
for (const [from, to] of cases) {
  const row = await send(from);
  check(`${from} is stored as ${to}`, row?.link === to, JSON.stringify(row));
}
const kept = [
  "/declutter?view=cart", "/declutter?view=cart&paid=1", "/declutter?view=offers", "/declutter?view=deliver",
  "/declutter?tab=selling", "/declutter?tab=buying&talk=x", "/declutter/item/aaaa", "/declutter?view=salesman", "/jobs/123",
];
for (const link of kept) {
  const row = await send(link);
  check(`${link} is stored unchanged`, row?.link === link, JSON.stringify(row));
}
const nul = await send(null);
check("a notice with no link is still written, with no link", nul !== undefined && nul.link === null, JSON.stringify(nul));

// The kind is decided as before: a Helpr's delivery work keeps its own type; a sale notice lands in declutter_sales.
const deliver = await send("/declutter?view=deliver", "Delivery booked", "job_updates");
check("a Helpr's ?view=deliver notice keeps its own type", deliver?.type === "job_updates", JSON.stringify(deliver));
const sale = await send("/declutter?view=sales", "Buyer paid", "payment");
check("a rewritten sale notice is still a declutter_sales notice", sale?.type === "declutter_sales" && sale?.link === "/declutter?tab=selling", JSON.stringify(sale));

const acl = async (sig) => (await q(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig]))[0]?.a ?? "MISSING";
const linkAcl = await acl("public.declutter_notice_link(text)");
check("declutter_notice_link exists and is service_role only",
  /service_role=X/.test(linkAcl) && !/(anon|authenticated)=X/.test(linkAcl) && !/[{,]=X/.test(linkAcl), linkAcl);
const strictAcl = await acl("public.declutter_notify_strict(uuid,text,text,text,text,uuid)");
check("declutter_notify_strict stays service_role only (as prod)",
  /service_role=X/.test(strictAcl) && !/(anon|authenticated)=X/.test(strictAcl) && !/[{,]=X/.test(strictAcl), strictAcl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
