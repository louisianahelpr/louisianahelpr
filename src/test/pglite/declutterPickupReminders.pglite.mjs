#!/usr/bin/env node
/**
 * PGlite proof for 20261027205028_declutter_pickup_reminders (Q2432, lead
 * 2026-10-27): both sides of a booked Declutter pickup get ONE reminder
 * (bell row + email request) 1 hour before the time; a moved time gets one
 * more; nothing for a closed sale, a past or far-off time; a test sale reminds
 * only its test account, never a real member; one failing booking is logged
 * and retried without stopping the others (lh-silent-failure review fixes).
 *
 *   node src/test/pglite/declutterPickupReminders.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPickupReminders.pglite.mjs # RED: main (no reminders)
 *
 * declutter_notify is the repo's newest definition (20261014210518). The
 * tables carry the columns the migration reads, as on prod (information_schema,
 * 2026-10-27). net.http_post and vault are stubs that record the call.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261027205028_declutter_pickup_reminders.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running WITHOUT the new migration (expect FAILs)`);
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BUYER = id(1), SELLER = id(2), SEEDBUYER = id(3), BROKEN = id(4);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault;
CREATE TABLE net.calls (id serial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL DEFAULT 'error', message text NOT NULL, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text, title text, message text, link text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL, handover text NOT NULL, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, order_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.declutter_bookings (order_id uuid PRIMARY KEY, buyer_id uuid NOT NULL, seller_id uuid NOT NULL, slot_start timestamptz, slot_end timestamptz,
  porch_mode text, porch_until timestamptz, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text, work_visibility text, work_exempt_reason text);
-- The repo's newest declutter_notify (20261014210518).
CREATE OR REPLACE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT p_user, p_type, p_title, p_message, p_link
   WHERE p_user IS NOT NULL
     AND (p_other IS NULL
          OR NOT COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
          OR COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false));
$fn$;
INSERT INTO public.profiles VALUES ('${BUYER}', false), ('${SELLER}', false), ('${SEEDBUYER}', true), ('${BROKEN}', false);
-- A recipient whose bell row cannot be written: stands in for any per-booking failure.
CREATE FUNCTION public.refuse_broken() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '${BROKEN}' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
CREATE TRIGGER refuse_broken BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.refuse_broken();
`);
if (MODE !== "skip") { for (let i = 0; i < 3; i++) await db.exec(NEW); check("migration applies 3x (replay-safe)", true); }

let n = 100;
async function sale({ inMin, status = "paid", handover = "pickup_home", seed = false, porch = null, buyer = BUYER, title = "Oak dresser", items = 1 }) {
  const oid = id(++n);
  await db.query(`INSERT INTO public.declutter_orders VALUES ($1, $2, $3, $4, $5, $6)`, [oid, buyer, SELLER, status, handover, seed]);
  for (let i = 0; i < items; i++) {
    const iid = id(++n);
    await db.query(`INSERT INTO public.declutter_items VALUES ($1, $2)`, [iid, i === 0 ? title : `Extra ${i}`]);
    await db.query(`INSERT INTO public.declutter_cart_items (item_id, order_id, created_at) VALUES ($1, $2, now() + make_interval(secs => $3))`, [iid, oid, i]);
  }
  await db.query(
    `INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end, porch_mode, is_seed)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4), now() + make_interval(mins => $4 + 30), $5, $6)`,
    [oid, buyer, SELLER, inMin, porch, seed]);
  return oid;
}
const sweep = async () => {
  try { return (await db.query(`SELECT public.declutter_pickup_reminder_sweep() AS n`)).rows[0].n; } catch (e) { return `error: ${e.message.slice(0, 80)}`; }
};
const bells = async (user) => (await db.query(`SELECT title, message, link, type FROM public.notifications WHERE user_id = $1 ORDER BY title`, [user])).rows;
const emails = async () => (await db.query(`SELECT body FROM net.calls ORDER BY id`)).rows.map((r) => r.body);

const due = await sale({ inMin: 56, items: 2 });
await sale({ inMin: 90 });                              // too far off
await sale({ inMin: -10 });                             // already started
await sale({ inMin: 30, status: "refunded" });          // closed sale
await sale({ inMin: 30, status: "handed_over" });       // done
const seedSale = await sale({ inMin: 30, seed: true, buyer: SEEDBUYER }); // test sale

check("one sweep reminds the due pickup and the test sale (two bookings)", (await sweep()) === 2);
const b = await bells(BUYER), s = await bells(SELLER);
check("the buyer gets one bell row", b.length === 1, JSON.stringify(b));
check("the seller gets one bell row", s.length === 1, JSON.stringify(s));
check("the buyer's says when, what, and to move it if they can't make it",
  b[0]?.title === "Pickup in 1 hour" && /Oak dresser and 1 more/.test(b[0]?.message ?? "") && /\d{1,2}:\d{2} (AM|PM) today/.test(b[0]?.message ?? "") && /move the time/.test(b[0]?.message ?? ""), b[0]?.message);
check("the seller's says to have it ready", /Have it ready at the door/.test(s[0]?.message ?? ""), s[0]?.message);
check("both are job_updates (the push and email settings that apply)", b[0]?.type === "job_updates" && s[0]?.type === "job_updates");
const e1 = await emails();
const realEmails = e1.filter((x) => x.user_id !== SEEDBUYER);
check("two email requests to the real sale's sides, through send-notification-email",
  realEmails.length === 2 && realEmails.every((x) => x.type === "job_updates") && new Set(realEmails.map((x) => x.user_id)).size === 2, JSON.stringify(e1.map((x) => x.user_id)));
check("the test sale reminds its test account, and never the real seller (bell or email)",
  (await bells(SEEDBUYER)).length === 1 && s.length === 1 && e1.filter((x) => x.user_id === SELLER).length === 1, JSON.stringify(e1.map((x) => x.user_id)));
check("no money words in either reminder", ![...b, ...s].some((x) => /\$|fee|refund|charge/i.test(x.message)));

check("a second sweep sends nothing again", (await sweep()) === 0 && (await bells(BUYER)).length === 1 && (await emails()).length === e1.length);

// The buyer moves the time (still within the hour): one more reminder for the new time.
await db.query(`UPDATE public.declutter_bookings SET slot_start = now() + interval '50 minutes', slot_end = now() + interval '80 minutes' WHERE order_id = $1`, [due]);
check("a moved time is reminded once more", (await sweep()) === 1 && (await bells(BUYER)).length === 2);
check("…and only once", (await sweep()) === 0);

// Porch pickups say porch.
await db.exec(`DELETE FROM public.notifications; DELETE FROM net.calls;`);
await sale({ inMin: 20, handover: "porch", title: "Lamp" });
check("a porch pickup is reminded", (await sweep()) === 1);
const pb = await bells(BUYER), ps = await bells(SELLER);
check("porch copy for both sides", /porch/i.test(pb[0]?.title ?? "") && /porch/i.test(ps[0]?.message ?? "") && /porch photo/.test(ps[0]?.message ?? ""), `${pb[0]?.title} / ${ps[0]?.message}`);
check("booked 20 minutes ahead: the title names the time, never \"in 1 hour\"", /^Porch pickup at \d{1,2}:\d{2} (AM|PM)$/.test(pb[0]?.title ?? ""), pb[0]?.title);

// The far-off sale comes into the window later.
await db.query(`UPDATE public.declutter_bookings SET slot_start = now() + interval '55 minutes', slot_end = now() + interval '85 minutes' WHERE slot_start > now() + interval '80 minutes'`);
check("a pickup that comes within the hour later is reminded then", (await sweep()) === 1);

// One booking that fails is logged and retried next run; the others still go out.
await db.exec(`DELETE FROM public.notifications; DELETE FROM net.calls;`);
const broken = await sale({ inMin: 40, buyer: BROKEN, title: "Broken" });
await sale({ inMin: 41, title: "Fine" });
check("a failing booking does not stop the others", (await sweep()) === 1 && (await bells(BUYER)).length === 1);
const logged = (await db.query(`SELECT tags->>'order_id' AS o FROM public.error_logs WHERE tags->>'source' = 'declutter_pickup_reminder_sweep'`)).rows;
check("…it is logged to error_logs with its order", logged.length === 1 && logged[0].o === broken, JSON.stringify(logged));
const claimed = await db.query(`SELECT reminded_slot_start IS NULL AS open FROM public.declutter_bookings WHERE order_id = $1`, [broken]).then((r) => r.rows[0].open, () => "no column");
check("…and left unclaimed, so the next run tries it again", claimed === true);
check("…and its seller got no half-sent reminder", (await bells(SELLER)).every((x) => !/Broken/.test(x.message)));
void seedSale;

const acl = (await db.query(`SELECT proname, coalesce(proacl::text, '') a FROM pg_proc WHERE proname IN ('declutter_pickup_reminder_sweep', 'declutter_pickup_remind') ORDER BY 1`)).rows;
check("neither function is callable by members", acl.length === 2 && acl.every((r) => !/(^|[{,])(=|anon=|authenticated=)[^,}]*X/.test(r.a)), JSON.stringify(acl));
const exp = (await db.query(`SELECT count(*)::int n FROM public.cron_work_expectations WHERE jobname = 'declutter-pickup-reminders'`)).rows[0].n;
check("the cron's work expectation is registered", exp === 1);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
