#!/usr/bin/env node
/**
 * PGlite proof for 20261031082308_helpr_task_confirm_not_on_the_road (BUY-39 server half, buying audit 10-30 #39).
 *
 *   node src/test/pglite/helprTaskConfirmNotOnTheRoad.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/helprTaskConfirmNotOnTheRoad.pglite.mjs  # RED: the newest before it
 *
 * World: helpr_tasks with the columns the function reads, and helpr_task_customer_confirm: the newest CREATE before
 * this migration (SKIP) or this migration's file, run verbatim 3 times. Stubbed, and said so: auth.uid() (the GUC
 * test.uid), is_caller_banned (false), helpr_task_lock (SELECT ... FOR UPDATE of the row), helpr_task_source_event
 * (sets status 'confirmed' and answers {"result":"handed_over"}; the real one pays the Helpr and the seller, which is
 * exactly what must not happen on the road). Not read against prod (no prod read here): the before-body is the
 * repo's newest CREATE (20261017055505).
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031082308_helpr_task_confirm_not_on_the_road.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const BUYER = "44444444-4444-4444-4444-444444444444";
const OTHER = "55555555-5555-5555-5555-555555555555";
const T = (n) => `a0000000-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, customer_id uuid, status text, picked_up_at timestamptz);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.helpr_task_lock(p_task uuid) RETURNS public.helpr_tasks LANGUAGE sql AS
    $$ SELECT * FROM public.helpr_tasks WHERE id = p_task FOR UPDATE $$;
  CREATE FUNCTION public.helpr_task_source_event(p uuid, e text, by text) RETURNS jsonb LANGUAGE plpgsql AS $$
  BEGIN UPDATE public.helpr_tasks SET status = 'confirmed' WHERE id = p; RETURN jsonb_build_object('result', 'handed_over'); END $$;
  INSERT INTO public.helpr_tasks VALUES
    ('${T(1)}', '${BUYER}', 'picked_up', now() - interval '10 minutes'),
    ('${T(2)}', '${BUYER}', 'picked_up', now() - interval '23 hours 59 minutes'),
    ('${T(3)}', '${BUYER}', 'picked_up', now() - interval '25 hours'),
    ('${T(4)}', '${BUYER}', 'delivered', now() - interval '1 hour'),
    ('${T(5)}', '${BUYER}', 'accepted', NULL),
    ('${T(6)}', '${BUYER}', 'confirmed', now() - interval '2 days'),
    ('${T(7)}', '${OTHER}', 'delivered', now() - interval '1 hour');
`);

const fnSql = SKIP ? newest("helpr_task_customer_confirm").sql : readFileSync(MIG_DIR + THIS, "utf8");
for (let i = 0; i < (SKIP ? 1 : 3); i++) await db.exec(fnSql);
console.log(SKIP ? `before: ${newest("helpr_task_customer_confirm").file}` : `after: ${THIS}, applied 3x`);

async function confirm(uid, task) {
  await db.exec(`SET test.uid = '${uid}'`);
  try {
    const r = await db.query(`SELECT public.helpr_task_customer_confirm('${task}') AS r`);
    return { ok: r.rows[0].r };
  } catch (e) {
    return { err: String(e.message) };
  }
}
const status = async (task) => (await db.query(`SELECT status FROM public.helpr_tasks WHERE id = '${task}'`)).rows[0].status;

const r1 = await confirm(BUYER, T(1));
check(r1.err?.includes("delivery_on_the_way") && (await status(T(1))) === "picked_up",
  "[fix] picked up 10 minutes ago: refused (delivery_on_the_way), nobody paid");
const r2 = await confirm(BUYER, T(2));
check(r2.err?.includes("delivery_on_the_way") && (await status(T(2))) === "picked_up",
  "[fix] picked up 23 h 59 min ago: still refused");
const r3 = await confirm(BUYER, T(3));
check(r3.ok?.result === "handed_over" && (await status(T(3))) === "confirmed",
  "[keep] held 25 h without a drop-off: the buyer's I got it finishes it (BUY-37)");
const r4 = await confirm(BUYER, T(4));
check(r4.ok?.result === "handed_over", "[keep] delivered: I got it finishes it");
const r5 = await confirm(BUYER, T(5));
check(r5.err?.includes("delivery_not_done"), "[keep] not picked up yet: delivery_not_done");
const r6 = await confirm(BUYER, T(6));
check(r6.ok?.result === "already_confirmed", "[keep] already confirmed answers already_confirmed");
const r7 = await confirm(BUYER, T(7));
check(r7.err?.includes("task_not_found"), "[keep] another buyer's delivery: task_not_found");
const r8 = await confirm("", T(4));
check(String(r8.err ?? "").includes("not_authenticated"), "[keep] no caller: not_authenticated");
const acl = await db.query("SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'helpr_task_customer_confirm'");
check(!SKIP ? !/(^|[{,])anon=/.test(acl.rows[0].acl ?? "") && !/(^|[{,])=X/.test(acl.rows[0].acl ?? "") : true,
  "[keep] no EXECUTE for PUBLIC or anon");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
