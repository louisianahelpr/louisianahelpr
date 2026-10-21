#!/usr/bin/env node
/**
 * PGlite proof for 20261021113222_my_quotes_say_bank_payment_pending.sql (Q1877, Helpr side).
 *
 *   node src/test/pglite/myQuotesBankPaymentPending.pglite.mjs                    # AFTER: the fix, applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/myQuotesBankPaymentPending.pglite.mjs # RED: the prior body (no job_payment)
 *
 * A quoter's accepted quote whose job is: funded (escrow) -> 'paid'; ACH settling (unpaid + PaymentIntent) ->
 * 'bank_pending'; checkout never finished (unpaid, no PI) or bounced (failed) -> 'unpaid'; cancelled or refunded -> 'closed';
 * no job yet -> NULL; a pending quote -> NULL; another member's quote is never returned. anon cannot execute.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const FIX = readFileSync(new URL("../../../supabase/migrations/20261021113222_my_quotes_say_bank_payment_pending.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1), OTHER = U(2), POSTER = U(3);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE public.whoami (uid uuid);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.whoami LIMIT 1 $$;
  CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.quote_require_member() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.quote_display_status(text, timestamptz) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
  -- Prod's body (20260907060556).
  CREATE FUNCTION public.job_payment_is_funded(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS
    $$ SELECT $1 IN ('escrow', 'payout_pending', 'released') $$;
  CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'cancelled');
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, status public.job_status, payment_status text, stripe_payment_intent_id text);
  CREATE TABLE public.job_quote_requests (id uuid PRIMARY KEY, title text, parish text, date_needed date, job_id uuid);
  CREATE TABLE public.job_quotes (id uuid PRIMARY KEY, request_id uuid, quoter_id uuid, price_cents int, note text,
    available_note text, last_offer_side text, respond_until timestamptz, status text, created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.job_quote_offers (quote_id uuid, by_side text, price_cents int, note text, created_at timestamptz);
  INSERT INTO public.whoami VALUES ('${ME}');
  INSERT INTO public.jobs VALUES
    ('${U(51)}', 'open', 'escrow', 'pi_1'), ('${U(52)}', 'open', 'unpaid', 'pi_2'),
    ('${U(53)}', 'open', 'unpaid', NULL), ('${U(54)}', 'cancelled', 'unpaid', 'pi_4'), ('${U(55)}', 'open', 'released', 'pi_5'),
    ('${U(56)}', 'open', 'refunded', 'pi_6'), ('${U(57)}', 'open', 'failed', 'pi_7');
  INSERT INTO public.job_quote_requests VALUES
    ('${U(61)}', 'Funded', 'EBR', '2037-01-01', '${U(51)}'), ('${U(62)}', 'Settling', 'EBR', '2037-01-01', '${U(52)}'),
    ('${U(63)}', 'Not paid', 'EBR', '2037-01-01', '${U(53)}'), ('${U(64)}', 'Cancelled', 'EBR', '2037-01-01', '${U(54)}'),
    ('${U(65)}', 'No job', 'EBR', '2037-01-01', NULL), ('${U(66)}', 'Pending', 'EBR', '2037-01-01', '${U(55)}'),
    ('${U(67)}', 'Someone else', 'EBR', '2037-01-01', '${U(51)}'),
    ('${U(68)}', 'Refunded', 'EBR', '2037-01-01', '${U(56)}'), ('${U(69)}', 'Bounced', 'EBR', '2037-01-01', '${U(57)}');
  INSERT INTO public.job_quotes (id, request_id, quoter_id, price_cents, status) VALUES
    ('${U(71)}', '${U(61)}', '${ME}', 100, 'accepted'), ('${U(72)}', '${U(62)}', '${ME}', 100, 'accepted'),
    ('${U(73)}', '${U(63)}', '${ME}', 100, 'accepted'), ('${U(74)}', '${U(64)}', '${ME}', 100, 'accepted'),
    ('${U(75)}', '${U(65)}', '${ME}', 100, 'accepted'), ('${U(76)}', '${U(66)}', '${ME}', 100, 'pending'),
    ('${U(77)}', '${U(67)}', '${OTHER}', 100, 'accepted'),
    ('${U(78)}', '${U(68)}', '${ME}', 100, 'accepted'), ('${U(79)}', '${U(69)}', '${ME}', 100, 'accepted');
`);
if (MODE === "skip") {
  // The prior body (live md5 46492d73...), no job_payment column.
  await db.exec(`CREATE FUNCTION public.get_my_job_quotes() RETURNS TABLE(id uuid, title text, job_id uuid)
    LANGUAGE sql AS $$ SELECT q.id, r.title, CASE WHEN q.status='accepted' THEN r.job_id END FROM public.job_quotes q
    JOIN public.job_quote_requests r ON r.id = q.request_id WHERE q.quoter_id = auth.uid() $$;`);
} else {
  for (let i = 0; i < 3; i++) await db.exec(FIX);
}

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
let rows = [];
try { rows = (await db.query(`SELECT title, job_payment FROM public.get_my_job_quotes()`)).rows; } catch (e) { rows = []; console.log(`(query failed: ${e.message})`); }
const pay = (t) => rows.find((r) => r.title === t);
check("funded job reads 'paid'", pay("Funded")?.job_payment === "paid", pay("Funded"));
check("bank payment settling reads 'bank_pending'", pay("Settling")?.job_payment === "bank_pending", pay("Settling"));
check("checkout never finished reads 'unpaid' (not booked)", pay("Not paid")?.job_payment === "unpaid", pay("Not paid"));
check("a settling job that was cancelled reads 'closed'", pay("Cancelled")?.job_payment === "closed", pay("Cancelled"));
check("a refunded job reads 'closed', never 'paid for later'", pay("Refunded")?.job_payment === "closed", pay("Refunded"));
check("a bounced bank payment (failed) reads 'unpaid'", pay("Bounced")?.job_payment === "unpaid", pay("Bounced"));
check("no job yet: NULL", pay("No job") !== undefined && pay("No job").job_payment === null, pay("No job"));
check("a pending quote: NULL even when the request has a job", pay("Pending") !== undefined && pay("Pending").job_payment === null, pay("Pending"));
check("another member's quote is never returned", rows.length > 0 && !pay("Someone else"), rows.map((r) => r.title));
const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname='get_my_job_quotes'`)).rows[0]?.a ?? "";
check("anon cannot execute; authenticated can", !/anon=X/.test(acl) && /authenticated=X/.test(acl) && !/^\{?=X/.test(acl), acl);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
