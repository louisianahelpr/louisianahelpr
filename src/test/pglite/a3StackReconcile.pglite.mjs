#!/usr/bin/env node
/**
 * PGlite proof for 20261102084222_a3_stack_reconcile (builder 166, lead 11-02 for Lander 33).
 *
 * The A3 stack (b149 -> b154 -> b159) and b164-open restated three functions from different bases; the newest file
 * of each dropped a hunk an earlier one added. The reconcile restates each with every hunk. This proof applies EVERY
 * definition of the three functions in the migration history (each file's CREATE OR REPLACE + its REVOKE/GRANT for
 * that function), in timestamp order, the whole sequence 3x, on a database with Supabase's default grant emulated
 * (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated). Then it asserts every hunk is in
 * the final bodies, that anon/authenticated cannot execute them, and RUNS notify_on_payment_escrowed on stub tables.
 *
 *   node src/test/pglite/a3StackReconcile.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/a3StackReconcile.pglite.mjs   # RED: without the reconcile
 *   PLANT=<name> node src/test/pglite/a3StackReconcile.pglite.mjs         # a hunk dropped from the reconcile: RED
 *     PLANT=strict          handover_sweep: the two "Delivery coming up" sends back to declutter_notify (Q2465)
 *     PLANT=never_booked    handover_sweep: A3-72's loop (b2) closes nothing (the delivery_never_booked close removed)
 *     PLANT=result_key      handover_sweep: the delivery_never_booked result key removed
 *     PLANT=buyer_copy      close_paid_order: A3-72's buyer "Refund on its way" line removed
 *     PLANT=seller_copy     close_paid_order: A3-72's seller "Sale cancelled" line removed
 *     PLANT=seller_out      close_paid_order: gap 3's seller_out reason removed (the newest base lost)
 *     PLANT=closed_skip     notify_on_payment_escrowed: Q1995's closed-job skip removed
 *     PLANT=confirm_next    notify_on_payment_escrowed: A3-38's Helpr line back to "is held safely. Get to work!"
 *     PLANT=anon_grant      the REVOKE lines removed (Supabase's default anon/authenticated grant stays)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const RECONCILE = "20261102084222_a3_stack_reconcile.sql";
const FNS = ["declutter_handover_sweep", "declutter_close_paid_order", "notify_on_payment_escrowed"];
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: without the reconcile (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

let reconcile = readFileSync(MIG_DIR + RECONCILE, "utf8");
const plant = (find, repl) => {
  if (!reconcile.includes(find)) throw new Error(`plant ${PLANT}: find-string not in the reconcile`);
  reconcile = reconcile.split(find).join(repl);
};
if (PLANT === "strict") plant("PERFORM public.declutter_notify_strict(r.", "PERFORM public.declutter_notify(r.");
if (PLANT === "never_booked") plant("PERFORM public.declutter_close_paid_order(o.id, 'delivery_never_booked', NULL, NULL, NULL);", "NULL;");
if (PLANT === "result_key") plant(",\n                            'delivery_never_booked', v_sd_unbooked);", ");");
if (PLANT === "buyer_copy") plant("THEN format('No delivery time was picked within 7 days, so the order is cancelled. All $%s is coming back to your card.',\n                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))\n", "THEN 'x'\n");
if (PLANT === "seller_copy") plant("THEN 'No delivery time was picked within 7 days, so this sale was cancelled and the buyer refunded. Your item is back on sale.'", "THEN 'x'");
if (PLANT === "seller_out") plant("    v_fee_reason := 'seller_out';\n", "    NULL;\n");
if (PLANT === "closed_skip") plant("\n     AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN", " THEN");
if (PLANT === "confirm_next") plant("VALUES (NEW.helper_id, 'Job funded', v_msg,", "VALUES (NEW.helper_id, 'Job funded', 'Payment for \"' || NEW.title || '\" is held safely. Get to work!',");
// CREATE OR REPLACE keeps an existing ACL, so the plant also drops the three first: the reconcile then creates them
// fresh, under the emulated default grant, and only its own REVOKE lines can take anon/authenticated off.
if (PLANT === "anon_grant") {
  reconcile = "DROP FUNCTION IF EXISTS public.declutter_handover_sweep();\nDROP FUNCTION IF EXISTS public.declutter_close_paid_order(uuid, text, text, text, text);\nDROP FUNCTION IF EXISTS public.notify_on_payment_escrowed() CASCADE;\n"
    + reconcile.replace(/^REVOKE ALL ON FUNCTION .*$/gm, "");
}

/** One function's CREATE OR REPLACE statement(s) plus the REVOKE/GRANT lines naming it, from one migration's text. */
function statementsFor(sql, fn) {
  // A DROP of the function first (only the anon_grant plant has one), then its CREATE, then its REVOKE/GRANT.
  const out = sql.split("\n").filter((l) => /^\s*DROP\s+FUNCTION\b/i.test(l) && new RegExp(`public\\.${fn}\\s*\\(`).test(l));
  const head = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "gi");
  let m;
  while ((m = head.exec(sql))) {
    const rest = sql.slice(m.index);
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(rest);
    if (!tag) throw new Error(`${fn}: no dollar tag`);
    const bodyStart = tag.index + tag[0].length;
    const end = rest.indexOf(tag[1], bodyStart) + tag[1].length;
    const semi = rest.indexOf(";", end);
    out.push(rest.slice(0, semi + 1));
  }
  for (const line of sql.split("\n")) {
    if (/^\s*(REVOKE|GRANT)\b/i.test(line) && new RegExp(`public\\.${fn}\\s*\\(`).test(line)) out.push(line);
  }
  return out;
}

const files = readdirSync(MIG_DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const steps = [];
for (const f of files) {
  if (f === RECONCILE && MODE === "skip") continue;
  const sql = f === RECONCILE ? reconcile : readFileSync(MIG_DIR + f, "utf8");
  for (const fn of FNS) {
    const st = statementsFor(sql, fn);
    if (st.length) steps.push({ f, fn, sql: st.join("\n") });
  }
}
check("the reconcile is the LAST definition of all three functions",
  MODE === "skip" || FNS.every((fn) => steps.filter((s) => s.fn === fn).at(-1)?.f === RECONCILE),
  FNS.map((fn) => `${fn}:${steps.filter((s) => s.fn === fn).at(-1)?.f.slice(0, 14)}`).join(" "));
check("history has more than 5 definitions to replay", steps.length > 5, `${steps.length}`);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, status text, payment_status text, customer_id uuid,
    helper_id uuid, date_needed date, start_time time, helper_confirmed_at timestamptz, is_group_job boolean DEFAULT false);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, financial_alerts boolean);
  -- %ROWTYPE in the Declutter bodies' DECLARE needs the table's type; their columns are resolved only when run.
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text);
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, status text);
  CREATE TABLE public.group_job_helpers (id serial PRIMARY KEY, job_id uuid, helper_id uuid, status text);
  CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL';
`);
for (let i = 1; i <= 3; i++) {
  for (const s of steps) {
    try {
      await db.exec(s.sql);
    } catch (e) {
      check(`apply ${s.f} ${s.fn} (pass ${i})`, false, String(e.message).slice(0, 200));
    }
  }
  console.log(`applied the ${steps.length} definitions ${i}x`);
}

const src = async (fn) => (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = $1 ORDER BY oid DESC LIMIT 1`, [fn])).rows[0]?.prosrc ?? "";
const hs = await src("declutter_handover_sweep");
const cp = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.declutter_close_paid_order(uuid, text, text, text, text)'::regprocedure`)).rows[0]?.prosrc ?? "";
const ne = await src("notify_on_payment_escrowed");
const count = (s, needle) => s.split(needle).length - 1;

// (1) declutter_handover_sweep
check("(1) Q2465: both 'Delivery coming up' sends are strict", count(hs, "PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up'") === 1
  && count(hs, "PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up'") === 1);
check("(1) A3-72: loop (b2) closes a needs_time delivery past book_by as delivery_never_booked, no strike",
  hs.includes("PERFORM public.declutter_close_paid_order(o.id, 'delivery_never_booked', NULL, NULL, NULL);")
  && hs.includes("AND d.status = 'needs_time'") && hs.includes("AND o2.book_by IS NOT NULL AND o2.book_by <= now()"));
check("(1) A3-72: the counter and its result key", hs.includes("v_sd_unbooked integer := 0;") && hs.includes("'delivery_never_booked', v_sd_unbooked)"));
// (2) declutter_close_paid_order
check("(2) gap 3 (newest base): seller_out recorded under v_fee_reason", cp.includes("v_fee_reason := 'seller_out';") && cp.includes("WHEN v_fee_reason = 'seller_out'"));
check("(2) S6 2d + Q1935 kept: held shipping and the prorated card fee",
  cp.includes("v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);")
  && cp.includes("public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved)"));
check("(2) A3-72: the buyer's delivery_never_booked line",
  cp.includes("THEN format('No delivery time was picked within 7 days, so the order is cancelled. All $%s is coming back to your card.'"));
check("(2) A3-72: the seller's delivery_never_booked line",
  cp.includes("THEN 'No delivery time was picked within 7 days, so this sale was cancelled and the buyer refunded. Your item is back on sale.'"));
// (3) notify_on_payment_escrowed
check("(3) Q1995: closed jobs skipped", ne.includes("AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN"));
check("(3) A3-38: the Helpr's line is the confirm next step, not 'Get to work!'",
  ne.includes("VALUES (NEW.helper_id, 'Job funded', v_msg,") && !ne.includes("is held safely. Get to work!"));

// Grants: Supabase's default grant to anon/authenticated is revoked on every one.
for (const sig of ["declutter_handover_sweep()", "declutter_close_paid_order(uuid, text, text, text, text)", "notify_on_payment_escrowed()"]) {
  const r = (await db.query(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') u, has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') s`)).rows[0];
  check(`grant: ${sig} not executable by anon or authenticated; service_role can`, !r.a && !r.u && r.s, JSON.stringify(r));
}

// RUN notify_on_payment_escrowed as the trigger it is.
await db.exec(`
  CREATE TRIGGER t_escrow AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();
  INSERT INTO public.jobs (id, title, status, payment_status, customer_id, helper_id, date_needed, start_time) VALUES
    ('c0000000-0000-4000-8000-000000000001', 'Open job', 'assigned', 'pending', 'a0000000-0000-4000-8000-000000000001',
     'a0000000-0000-4000-8000-000000000002', (now() AT TIME ZONE 'America/Chicago')::date + 5, '10:00'),
    ('c0000000-0000-4000-8000-000000000002', 'Cancelled job', 'cancelled', 'pending', 'a0000000-0000-4000-8000-000000000001',
     'a0000000-0000-4000-8000-000000000002', (now() AT TIME ZONE 'America/Chicago')::date + 5, '10:00');
  UPDATE public.jobs SET payment_status = 'escrow';
`);
const notes = (await db.query(`SELECT title, message, link FROM public.notifications ORDER BY id`)).rows;
check("run: a cancelled job promoted to escrow tells nobody", !notes.some((n) => n.message.includes("Cancelled job")), JSON.stringify(notes.map((n) => n.message)));
check("run: the open job tells the poster 'Payment secured'", notes.some((n) => n.title === "Payment secured" && n.message.includes("Open job")));
check("run: the Helpr's notice names the confirm deadline", notes.some((n) => n.title === "Job funded" && /Next: confirm you'll be there by /.test(n.message)),
  JSON.stringify(notes.filter((n) => n.title === "Job funded").map((n) => n.message)));

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
