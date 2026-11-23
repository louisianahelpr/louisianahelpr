#!/usr/bin/env node
/**
 * PGlite proof for 20261123090716_gift_cards_never_expire (MON-1123-01): a paid gift card never expires.
 *
 *   node src/test/pglite/giftCardsNeverExpire.pglite.mjs                     # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/giftCardsNeverExpire.pglite.mjs  # RED: the prod shape (90-day default)
 *
 * Real: the migration verbatim (3x) over gift_cards with prod's old default (now() + 90 days), plus the NEWEST
 * restore_gift_card_for_job (20261103221953), which still writes greatest(..., now() + 90 days): the card it puts
 * back must come out with no expiry. The newest redeem_gift_card refusal line is read from its migration and run as
 * a predicate, so "NULL = valid" is the code's own words. pglite is not a dependency (CLAUDE.md): ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261123090716_gift_cards_never_expire.sql";
const RESTORE = "20261103221953_gift_tax_due_split_conserves_value.sql";
const skip = process.env.NEW_MIGRATION === "skip";

function slice(file, start, end) {
  const sql = readFileSync(MIG_DIR + file, "utf8");
  const a = sql.indexOf(start);
  if (a < 0) throw new Error(`${start} not found in ${file}`);
  return sql.slice(a, sql.indexOf(end, a) + end.length);
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `9e9e9e9e-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric, status text, payment_status text, category text, message text, occasion text, design_id text, job_id uuid,
  parent_credit_id uuid, restored_from_job_id uuid UNIQUE, split_for_job_id uuid, redeemed_at timestamptz, created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + '90 days'::interval));
`);
await db.exec(slice(RESTORE, "create or replace function public.restore_gift_card_for_job(", "$function$;"));
const q = async (s, p = []) => (await db.query(s, p)).rows;

// Prod's rows before the fix: one unspent, one past its date and unspent, one spent.
await q(`INSERT INTO public.gift_cards (id, amount, status, payment_status) VALUES ($1, 25, 'sent', 'paid')`, [U(1)]);
await q(`INSERT INTO public.gift_cards (id, amount, status, payment_status, expires_at) VALUES ($1, 40, 'sent', 'paid', now() - interval '1 day')`, [U(2)]);
await q(`INSERT INTO public.gift_cards (id, amount, status, payment_status) VALUES ($1, 10, 'redeemed', 'paid')`, [U(3)]);

if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  let applied = true;
  for (let i = 0; i < 3; i++) { try { await db.exec(sql); } catch (e) { applied = false; check(false, `migration applies (run ${i + 1})`, e.message); } }
  check(applied, "migration applies 3x");
}

// 1. No default: a new card has no expiry.
const def = (await q(`SELECT column_default AS d FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gift_cards' AND column_name = 'expires_at'`))[0].d;
check(def === null, "gift_cards.expires_at has no default", String(def));
await q(`INSERT INTO public.gift_cards (id, amount, status, payment_status) VALUES ($1, 50, 'sent', 'paid')`, [U(4)]);
const exp = async (n) => (await q(`SELECT expires_at FROM public.gift_cards WHERE id = $1`, [U(n)]))[0]?.expires_at;
check(await exp(4) === null, "a newly bought card is minted with no expiry", String(await exp(4)));

// 2. Backfill: unspent, already-lapsed-but-unspent and spent cards all have no expiry.
check(await exp(1) === null, "an existing unspent card no longer expires", String(await exp(1)));
check(await exp(2) === null, "a card already past its old date and unspent is spendable again", String(await exp(2)));
check(await exp(3) === null, "a spent card carries no date either", String(await exp(3)));

// 3. Any writer that still stamps a date is overridden (insert and update).
await q(`INSERT INTO public.gift_cards (id, amount, status, payment_status, expires_at) VALUES ($1, 15, 'sent', 'paid', now() + interval '90 days')`, [U(5)]);
check(await exp(5) === null, "an INSERT that sets now() + 90 days still gets no expiry", String(await exp(5)));
await q(`UPDATE public.gift_cards SET expires_at = now() + interval '90 days' WHERE id = $1`, [U(1)]);
check(await exp(1) === null, "an UPDATE that sets a date is kept at no expiry", String(await exp(1)));

// 4. The real restore path (newest restore_gift_card_for_job) puts the gift back with no expiry.
await q(`INSERT INTO public.jobs VALUES ($1)`, [U(10)]);
await q(`INSERT INTO public.gift_cards (id, recipient_id, amount, status, payment_status, job_id) VALUES ($1, $2, 30, 'redeemed', 'paid', $3)`, [U(11), U(900), U(10)]);
let r;
try { r = (await q(`SELECT public.restore_gift_card_for_job(p_job_id => $1) AS r`, [U(10)]))[0].r; } catch (e) { r = { error: e.message }; }
const back = (await q(`SELECT expires_at FROM public.gift_cards WHERE restored_from_job_id = $1`, [U(10)]))[0];
check(r?.outcome === "restored" && back && back.expires_at === null, "a cancelled job's gift comes back with no expiry", JSON.stringify({ r, back }));

// 5. The redeem refusal, in its own words, accepts a card with no expiry and is still the only date check.
const redeemSql = slice("20261103221953_gift_tax_due_split_conserves_value.sql", "CREATE OR REPLACE FUNCTION public.redeem_gift_card(", "$function$;");
const refusal = /if (v_credit\.expires_at is not null and v_credit\.expires_at < now\(\)) then/i.exec(redeemSql)?.[1];
check(Boolean(refusal), "redeem_gift_card's refusal line was found");
if (refusal) {
  const pred = refusal.replaceAll("v_credit.expires_at", "g.expires_at");
  const refused = (await q(`SELECT count(*)::int n FROM public.gift_cards g WHERE ${pred}`))[0].n;
  check(refused === 0, "no card is refused as expired by redeem_gift_card's own check", String(refused));
}

// 6. The trigger function is no member's to call.
const g = (await q(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
  FROM pg_proc p WHERE p.proname = 'gift_cards_never_expire'`))[0];
check(g && !g.a && !g.u, "gift_cards_never_expire(): not executable by anon or authenticated", JSON.stringify(g));

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
