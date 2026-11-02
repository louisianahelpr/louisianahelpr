#!/usr/bin/env node
/**
 * PGlite proof for 20261102031228_declutter_reminders_retry_strict (Q2465, lead 2026-11-01): the 24-hour and 2-hour
 * checkout reminders in declutter_deadline_sweep are sent strict. A reminder that cannot be written clears its line's
 * claim and is logged, so the next run sends it; the other lines still get theirs and the count counts only the
 * reminders written. The offer-expiry notices stay best-effort (a failed one never undoes the expiry).
 *
 *   node src/test/pglite/declutterRemindersRetryStrict.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRemindersRetryStrict.pglite.mjs # RED: a lost reminder is marked sent
 *   MUTANT=<name> node src/test/pglite/declutterRemindersRetryStrict.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_notify (the swallow-and-log wrapper, its newest earlier CREATE) and the sweep before this migration
 * (20261101030040). Stubbed, said so: declutter_notify_strict to its contract (writes the bell row, raises when it
 * can't; its link and wording helpers are not part of this change), the tables the sweep reads,
 * declutter_pair_talking (no), log_cron_defect (records), and a trigger on notifications that refuses one member's
 * row (stands in for a notice insert that fails: a deleted member or a CHECK change). Supabase's default
 * anon/authenticated EXECUTE grant is emulated. declutter_handover_sweep (d) is held to its block by
 * src/test/declutterRemindersRetryStrict.test.ts (source), not run here: its world is the whole delivery chain.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102031228_declutter_reminders_retry_strict.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The 24-hour reminder stays best-effort (the bug).
  lax24: ["      PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',\n        CASE WHEN r.title IS NULL THEN 'You have an item waiting at checkout.",
          "      PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',\n        CASE WHEN r.title IS NULL THEN 'You have an item waiting at checkout."],
  // The claim is not cleared, so a lost reminder is never sent.
  keepClaim24: ["    UPDATE public.declutter_cart_items SET reminded_24h_at = NULL WHERE id = r.id;\n", ""],
  keepClaim2: ["    UPDATE public.declutter_cart_items SET reminded_2h_at = NULL WHERE id = r.id;\n", ""],
  // Counted before the send, so a lost reminder is counted.
  countFirst: ["   BEGIN\n    -- 20261029025838: the reminder names its item and opens the buyer's own tab.\n    IF r.price_cents = 0 THEN\n      -- DA-12: a free item has no strike to threaten.\n      PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', 'Choose a pickup within 24 hours',",
               "   BEGIN\n    v_r24 := v_r24 + 1;\n    IF r.price_cents = 0 THEN\n      PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', 'Choose a pickup within 24 hours',"],
};
const skip = process.env.NEW_MIGRATION === "skip";

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
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), AMY = U(2), BAD = U(3), CAL = U(4);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.refuse_bad() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.user_id = '${BAD}' AND current_setting('test.refuse', true) = 'on' THEN RAISE EXCEPTION 'notice refused'; END IF; RETURN NEW; END $$;
CREATE TRIGGER refuse_bad BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.refuse_bad();
CREATE TABLE public.defects (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.defects VALUES (p_fn, p_ref, p_msg) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, awaiting text,
  item_id uuid, status text, respond_by timestamptz, closed_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, item_id uuid,
  price_cents integer, source text DEFAULT 'offer', status text DEFAULT 'in_cart', order_id uuid, created_at timestamptz,
  checkout_by timestamptz, reminded_24h_at timestamptz, reminded_2h_at timestamptz);
CREATE TABLE public.declutter_handover_talks (closed_at timestamptz, expires_at timestamptz);
CREATE FUNCTION public.declutter_pair_talking(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
// declutter_notify_strict, stubbed to its contract (write the bell row, raise when it can't); the real declutter_notify
// (the swallow-and-log wrapper over it) and the real sweep.
await db.exec(`CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (p_user, p_type, p_title, p_message, p_link) $$;`);
for (const fn of ["declutter_notify", "declutter_deadline_sweep"]) await db.exec(definitionBefore(fn, THIS));
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;`);

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  // Only the deadline sweep runs here; the handover sweep's world is not built (see the header).
  mig = mig.slice(0, mig.indexOf("CREATE OR REPLACE FUNCTION public.declutter_handover_sweep("));
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
for (const u of [SELLER, AMY, BAD, CAL]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
const item = async (t) => (await q(`INSERT INTO public.declutter_items (title) VALUES ($1) RETURNING id`, [t]))[0].id;
// 48-hour holds: Amy and Bad in their last day (24-hour reminder due); Cal in the last 2 hours (2-hour reminder due).
const line = async (buyer, title, hoursLeft, source = "buy", price = 2000) =>
  (await q(`INSERT INTO public.declutter_cart_items (buyer_id, seller_id, item_id, price_cents, source, created_at, checkout_by)
            VALUES ($1, $2, $3, $5, $4, now() - interval '30 hours', now() + make_interval(hours => $6)) RETURNING id`,
           [buyer, SELLER, await item(title), source, price, hoursLeft]))[0].id;
const amy = await line(AMY, "Lamp", 10), bad = await line(BAD, "Desk", 10), badFree = await line(BAD, "Rug", 1, "offer", 0), cal = await line(CAL, "Chair", 1);
// An open offer past its time on Bad's side: the expiry stays best-effort.
await q(`INSERT INTO public.declutter_offers (buyer_id, seller_id, awaiting, item_id, status, respond_by) VALUES ($1, $2, 'seller', $3, 'open', now() - interval '1 minute')`,
  [BAD, SELLER, await item("Vase")]);

await q(`SELECT set_config('test.refuse', 'on', false)`);
const run1 = (await q(`SELECT public.declutter_deadline_sweep() AS j`))[0].j;
const claim = async (id) => (await q(`SELECT reminded_24h_at IS NOT NULL AS c24, reminded_2h_at IS NOT NULL AS c2 FROM public.declutter_cart_items WHERE id = $1`, [id]))[0];
const bells = async (u) => (await q(`SELECT title FROM public.notifications WHERE user_id = $1 ORDER BY title`, [u])).map((r) => r.title);

check((await bells(AMY)).includes("Check out within 24 hours") && (await claim(amy)).c24, `Amy got her 24-hour reminder and her line is marked (${await bells(AMY)})`);
check((await bells(CAL)).includes("2 hours left to check out") && (await claim(cal)).c2, `Cal got his 2-hour reminder and his line is marked (${await bells(CAL)})`);
check(!(await claim(bad)).c24, `[fix] Bad's lost 24-hour reminder: the claim is cleared for the next run (${JSON.stringify(await claim(bad))})`);
check(!(await claim(badFree)).c2, `[fix] Bad's lost 2-hour reminder: the claim is cleared (${JSON.stringify(await claim(badFree))})`);
check(run1.reminded_24h === 1 && run1.reminded_2h === 1, `[fix] the counts are reminders written: 24h ${run1.reminded_24h}, 2h ${run1.reminded_2h}`);
const refs = (await q(`SELECT ref FROM public.defects WHERE fn = 'declutter_deadline_sweep' ORDER BY ref`)).map((r) => r.ref);
check(refs.includes(`reminder_24h:${bad}`) && refs.includes(`reminder_2h:${badFree}`), `[fix] each lost reminder is logged (${refs})`);
check((await q(`SELECT status FROM public.declutter_offers`))[0].status === "expired", "the offer still expired though its notice to Bad was refused (best-effort kept)");

// The next run, with the refusal gone: Bad gets both, once; Amy and Cal are not told twice.
await q(`SELECT set_config('test.refuse', 'off', false)`);
const run2 = (await q(`SELECT public.declutter_deadline_sweep() AS j`))[0].j;
const badBells = await bells(BAD);
check(badBells.includes("Check out within 24 hours") && badBells.includes("2 hours left to choose a pickup"), `[fix] the next run sends Bad's reminders (${badBells})`);
check((await claim(bad)).c24 && (await claim(badFree)).c2, "[fix] and marks them sent");
check((await bells(AMY)).length === 1 && (await bells(CAL)).length === 1 && run2.reminded_24h === 1 && run2.reminded_2h === 1,
  `nobody is told twice (Amy ${(await bells(AMY)).length}, Cal ${(await bells(CAL)).length}; run 2 counts ${run2.reminded_24h}/${run2.reminded_2h})`);

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_deadline_sweep()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_deadline_sweep()', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_deadline_sweep()', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
