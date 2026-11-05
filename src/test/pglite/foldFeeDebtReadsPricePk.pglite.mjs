#!/usr/bin/env node
/**
 * PGlite proof for 20261105030137_fold_fee_debt_reads_price_drops_pk (Q1816, nightly-red #3743).
 *
 * (A) helpr_card_fee_debts: the two PERMISSIVE SELECT policies become one. The row set each viewer
 *     sees is measured BEFORE (the policies as 20261102072106 made them) and AFTER each of 3 runs:
 *     the Helpr sees only their own debt, an admin sees every debt, another member sees none, anon
 *     sees nothing (no grant), and exactly one permissive SELECT policy is left, no restrictive one.
 * (B) declutter_item_price_drops gets an identity primary key: the fixture rows seeded below get ids, the
 *     writer's own insert (item_id, from_cents, to_cents) still works, twice for one item in ONE
 *     transaction (same now()), and a second and third run change nothing.
 *
 *   node src/test/pglite/foldFeeDebtReadsPricePk.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/foldFeeDebtReadsPricePk.pglite.mjs   (red: the fold and the key are missing)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const { PGlite } = await import(`${process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261105030137_fold_fee_debt_reads_price_drops_pk.sql", import.meta.url).pathname, "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); if (!ok) failures++; };

const HELPR = "11111111-1111-4111-8111-111111111111";
const OTHER_HELPR = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const ITEM = "55555555-5555-4555-8555-555555555555";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
INSERT INTO auth.users VALUES ('${HELPR}'), ('${OTHER_HELPR}'), ('${ADMIN}'), ('${MEMBER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
CREATE TABLE public.jobs (id uuid PRIMARY KEY);

-- helpr_card_fee_debts, its grants and its two read policies as 20261102072106 made them.
CREATE TABLE public.helpr_card_fee_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  card_fee_cents integer NOT NULL,
  remaining_cents integer NOT NULL,
  refund_ref text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.helpr_card_fee_debts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_card_fee_debts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, helper_id, source, job_id, card_fee_cents, remaining_cents, created_at)
  ON TABLE public.helpr_card_fee_debts TO authenticated;
GRANT ALL ON TABLE public.helpr_card_fee_debts TO service_role;
CREATE POLICY "helpr card fee debts: the Helpr reads own" ON public.helpr_card_fee_debts
  FOR SELECT TO authenticated USING (helper_id = (SELECT auth.uid()));
CREATE POLICY "helpr card fee debts: admins read" ON public.helpr_card_fee_debts
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));
INSERT INTO public.helpr_card_fee_debts (helper_id, source, card_fee_cents, remaining_cents) VALUES
  ('${HELPR}', 'series_visit_lapsed', 300, 300),
  ('${OTHER_HELPR}', 'series_visit_lapsed', 500, 200),
  (NULL, 'series_visit_lapsed', 100, 100);

-- declutter_item_price_drops and its writer as 20261031224850 / 20261031220326 made them.
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, status text NOT NULL, current_price_cents integer NOT NULL);
CREATE TABLE public.saved_search_item_queue (item_id uuid PRIMARY KEY, attempts integer DEFAULT 0, retry_after timestamptz, queued_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_item_price_drops (
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  from_cents integer NOT NULL,
  to_cents integer NOT NULL
);
CREATE INDEX declutter_item_price_drops_item_at ON public.declutter_item_price_drops (item_id, at);
ALTER TABLE public.declutter_item_price_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_item_price_drops FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.saved_search_on_item_price_drop() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  INSERT INTO public.declutter_item_price_drops (item_id, from_cents, to_cents)
  VALUES (NEW.id, OLD.current_price_cents, NEW.current_price_cents);
  INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();
  RETURN NULL;
END;
$fn$;
CREATE TRIGGER saved_search_on_item_price_drop
  AFTER UPDATE OF current_price_cents ON public.declutter_items
  FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status = 'live' AND NEW.current_price_cents < OLD.current_price_cents)
  EXECUTE FUNCTION public.saved_search_on_item_price_drop();
INSERT INTO public.declutter_items VALUES ('${ITEM}', 'live', 5000);
UPDATE public.declutter_items SET current_price_cents = 4000 WHERE id = '${ITEM}';
UPDATE public.declutter_items SET current_price_cents = 3500 WHERE id = '${ITEM}';
`);

/** The debts a viewer sees, as fee amounts (sorted). uid null = anon. */
async function seen(uid) {
  try {
    await db.exec(uid ? `SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;` : `RESET request.jwt.claim.sub; SET ROLE anon;`);
    const r = await db.query(`SELECT card_fee_cents FROM public.helpr_card_fee_debts ORDER BY card_fee_cents`);
    return r.rows.map((x) => x.card_fee_cents).join(",");
  } catch (e) {
    return `ERROR ${String(e.message).slice(0, 60)}`;
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const views = async () => ({ helpr: await seen(HELPR), admin: await seen(ADMIN), member: await seen(MEMBER), anon: await seen(null) });
const before = await views();
check("before: the Helpr sees only their own debt", before.helpr === "300", before.helpr);
check("before: an admin sees every debt", before.admin === "100,300,500", before.admin);
check("before: another member sees none", before.member === "", before.member);
check("before: anon is refused", before.anon.startsWith("ERROR"), before.anon);
const dropsBefore = (await db.query(`SELECT count(*)::int AS n FROM public.declutter_item_price_drops`)).rows[0].n;
check("before: the writer recorded 2 drops", dropsBefore === 2, `${dropsBefore}`);

const policies = async () => (await db.query(
  `SELECT polname, polpermissive FROM pg_policy WHERE polrelid = 'public.helpr_card_fee_debts'::regclass ORDER BY 1`)).rows;
const pkey = async () => (await db.query(
  `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.declutter_item_price_drops'::regclass AND contype = 'p'`)).rows[0].n;

for (let run = 1; run <= 3; run++) {
  if (!SKIP) await db.exec(NEW);
  const after = await views();
  check(`run ${run}: same rows for every viewer`, JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
  const pol = await policies();
  check(`run ${run}: exactly one permissive read policy, no restrictive one`,
    pol.length === 1 && pol[0].polpermissive === true && pol[0].polname === "helpr card fee debts: own or admin read",
    pol.map((p) => `${p.polname}${p.polpermissive ? "" : " (restrictive)"}`).join(" | "));
  check(`run ${run}: declutter_item_price_drops has a primary key`, (await pkey()) === 1, `${await pkey()}`);
  const ids = (await db.query(`SELECT count(*)::int AS n, count(DISTINCT id)::int AS d FROM public.declutter_item_price_drops`).catch(() => ({ rows: [{ n: -1, d: -1 }] }))).rows[0];
  check(`run ${run}: every existing drop has its own id`, ids.n >= 2 && ids.n === ids.d, `${ids.n} rows, ${ids.d} ids`);
}

// The writer, unchanged, still records drops: two of one item in ONE transaction (one now()).
let writeErr = "";
try {
  await db.exec(`BEGIN;
    UPDATE public.declutter_items SET current_price_cents = 3000 WHERE id = '${ITEM}';
    UPDATE public.declutter_items SET current_price_cents = 2500 WHERE id = '${ITEM}';
    COMMIT;`);
} catch (e) { writeErr = e.message; await db.exec("ROLLBACK").catch(() => {}); }
const dropsAfter = (await db.query(`SELECT count(*)::int AS n FROM public.declutter_item_price_drops`)).rows[0];
check("the writer's insert works, twice in one transaction", !writeErr && dropsAfter.n === 4, writeErr || `${dropsAfter.n} rows`);
const lastTwo = (await db.query(`SELECT count(DISTINCT at)::int AS ats FROM public.declutter_item_price_drops WHERE to_cents IN (3000, 2500)`)).rows[0];
check("those two share one timestamp (why (item_id, at) could not be the key)", lastTwo.ats === 1, `${lastTwo.ats} distinct at`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
