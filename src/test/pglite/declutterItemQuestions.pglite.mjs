#!/usr/bin/env node
/**
 * PGlite proof for 20261021122157_declutter_item_questions (Q2278): an item's questions, never who asked them,
 * read AS THE CALLER so the table's row policy decides exactly as for the old table read.
 *
 *   node src/test/pglite/declutterItemQuestions.pglite.mjs                       # all PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterItemQuestions.pglite.mjs    # RED: the RPC is absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterItemQuestions.pglite.mjs
 *
 * World: scripts/declutter/slice3Harness.mjs (Declutter slices 1-3: declutter_questions with its policy "readable with
 * their item", declutter_items with the foundation's read policy, the hidden 'declutter' switch on for testers;
 * OUTSIDER is not a tester). The items policy here is the foundation's; prod's newest (20261020033623, the seed
 * boundary) only narrows it further, which an invoker function inherits as is.
 * Part 4 replays the column grant ready/declutter-narrow-floor2 brings (every column but asker_id) and shows the RPC
 * and the client's fallback read still work while asker_id is refused.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261021122157_declutter_item_questions.sql";
const { SELLER, BUYER, BUYER2, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
for (const sql of setupStatements({ times: 1 })) await db.exec(sql);
if (!skip) {
  const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql, role = "authenticated") {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const rows = (r) => (Array.isArray(r) ? r : []);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const Q = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;

// seed-policy: not prod (throwaway PGlite only)
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Oak dresser" }));
await db.exec(`
  INSERT INTO public.declutter_items (id, seller_id, status, title, description, category, condition_stars, delivery_size,
    price_cents, current_price_cents, area_label, area_lat, area_lng)
  VALUES ('${I(2)}', '${SELLER}', 'draft', 'Draft lamp', 'Works.', 'furniture', 4, 'small', 2000, 2000, 'Mid-City, Baton Rouge', 30.45, -91.15);
  INSERT INTO public.declutter_questions (id, item_id, asker_id, question, answer, answered_at, removed_at, created_at) VALUES
    ('${Q(1)}', '${I(1)}', '${BUYER}',  'Does it have all four drawers?', 'Yes, all four.', now() - interval '1 hour', NULL, now() - interval '3 hours'),
    ('${Q(2)}', '${I(1)}', '${BUYER2}', 'Is the top scratched?', NULL, NULL, NULL, now() - interval '2 hours'),
    ('${Q(3)}', '${I(1)}', '${BUYER}',  'Removed by an admin', NULL, NULL, now(), now() - interval '4 hours'),
    ('${Q(4)}', '${I(2)}', '${BUYER}',  'On a draft nobody else can read', NULL, NULL, NULL, now());`);

const call = (uid, item = I(1), role) => me(uid, `SELECT * FROM public.declutter_item_questions('${item}')`, role);

// --- 1. what a member gets
const got = await call(BUYER2);
ok(Array.isArray(got), `[fix] Q1: a member reads an item's questions through the RPC${Array.isArray(got) ? "" : `: ${got.error}`}`);
ok(rows(got).map((r) => r.id).join() === [Q(1), Q(2)].join(), "[fix] Q2: the two live questions, oldest first; the removed one is left out");
ok(rows(got).length > 0 && Object.keys(rows(got)[0]).sort().join() === "answer,answered_at,created_at,id,item_id,question",
  `[fix] Q3: the columns never include asker_id (got ${Object.keys(rows(got)[0] ?? {}).sort().join()})`);
ok(rows(await call(BUYER)).length === 2, "[fix] Q4: the asker reads the same rows (no asker column, no 'mine' flag)");

// --- 2. the row policy still decides (SECURITY INVOKER)
const direct = await me(BUYER2, `SELECT id FROM public.declutter_questions WHERE item_id = '${I(1)}' ORDER BY created_at`);
ok(rows(direct).map((r) => r.id).join() === rows(got).map((r) => r.id).join(), "[fix] Q5: the same rows the table's own policy lets the caller read");
ok(rows(await call(BUYER2, I(2))).length === 0, "[fix] Q6: a draft's questions stay unreadable to other members (the items policy applies)");
ok(rows(await call(SELLER, I(2))).length === 1, "[fix] Q7: the seller reads the questions on their own draft");
const def = rows(await svc(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure('public.declutter_item_questions(uuid)')`))[0];
ok(def && def.prosecdef === false, "[fix] Q8: SECURITY INVOKER (not a definer)");

// --- 3. who may call it
ok(refused(await call(OUTSIDER), /feature_disabled/), "[fix] Q9: a member the 'declutter' switch is off for is refused (feature_disabled)");
ok(refused(await call(null, I(1), "anon"), /permission denied/), "[fix] Q10: signed out, EXECUTE is refused before the body runs");
const priv = rows(await svc(`SELECT has_function_privilege('anon', 'public.declutter_item_questions(uuid)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.declutter_item_questions(uuid)', 'EXECUTE') u`))[0];
ok(priv && priv.a === false && priv.u === true, "[fix] Q11: EXECUTE for authenticated, never anon");

// --- 4. after the column narrowing (ready/declutter-narrow-floor2's grant, replayed here)
await db.exec(`REVOKE SELECT ON public.declutter_questions FROM anon, authenticated;
  GRANT SELECT (id, item_id, question, answer, answered_at, removed_at, created_at) ON public.declutter_questions TO authenticated;`);
ok(rows(await call(BUYER2)).map((r) => r.id).join() === [Q(1), Q(2)].join(), "[fix] Q12: the RPC still answers once asker_id is withheld");
ok(refused(await me(BUYER2, `SELECT asker_id FROM public.declutter_questions`), /permission denied/), "[fix] Q13: a direct asker_id read is then refused");
ok(rows(await me(BUYER2, `SELECT id, item_id, question, answer, answered_at, created_at FROM public.declutter_questions WHERE item_id = '${I(1)}' ORDER BY created_at`)).length === 2,
  "[fix] Q14: the client's PGRST202 fallback read (no asker_id) still works after the narrowing");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
