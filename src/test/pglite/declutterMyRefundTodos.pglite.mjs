#!/usr/bin/env node
/**
 * PGlite proof for 20261102002217_declutter_my_refund_todos (A3-81, audit 11-01 High: Home names a refund request
 * that waits on the member, with its deadline).
 *
 *   node src/test/pglite/declutterMyRefundTodos.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyRefundTodos.pglite.mjs  # RED: the function is absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMyRefundTodos.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Stubs (prod-shaped, only the columns the read touches): roles + prod's default function ACL, auth.uid(),
 * feature_enabled_for(text) (a per-key on/off table), declutter_orders, declutter_refund_requests,
 * declutter_cart_items, declutter_items. Applies the migration 3x (replay-safety), then proves: the seller sees an
 * 'open' request with answer_by; the buyer sees an 'offered' part offer with offer_answer_by; neither sees the other
 * side's step; a request past its deadline, a settled one and someone else's order are left out; the item title and
 * count come from the order's lines; the switch off returns no rows (no error); anon cannot call it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(process.env.MIGRATION_PATH ?? new URL("../../../supabase/migrations/20261102002217_declutter_my_refund_todos.sql", import.meta.url).pathname, "utf8");

const SELLER = "00000000-0000-0000-0000-0000000000a1";
const BUYER = "00000000-0000-0000-0000-0000000000b1";
const OTHER = "00000000-0000-0000-0000-0000000000c1";
const id = (n) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.feature_on (key text PRIMARY KEY, on_ boolean NOT NULL);
CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT COALESCE((SELECT on_ FROM public.feature_on WHERE key = p_key), false) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL DEFAULT 'handed_over');
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, order_id uuid, item_id uuid, item_title text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY, order_id uuid NOT NULL, status text NOT NULL,
  answer_by timestamptz NOT NULL, offer_answer_by timestamptz);
REVOKE ALL ON TABLE public.declutter_refund_requests, public.declutter_orders, public.declutter_cart_items FROM PUBLIC, anon, authenticated;
INSERT INTO public.feature_on VALUES ('declutter_refund_requests', true);
INSERT INTO public.declutter_items VALUES ('${id(901)}', 'Oak rocking chair'), ('${id(902)}', 'Lamp'), ('${id(903)}', 'Desk'), ('${id(904)}', 'Rug'), ('${id(905)}', 'Bike');
-- o1: open, due in 20 h (seller's turn). o2: offered, buyer's turn in 5 h. o3: open but past answer_by.
-- o4: agreed (settled). o5: open, but between OTHER and BUYER (not the seller's).
INSERT INTO public.declutter_orders VALUES
  ('${id(1)}', '${BUYER}', '${SELLER}'), ('${id(2)}', '${BUYER}', '${SELLER}'), ('${id(3)}', '${BUYER}', '${SELLER}'),
  ('${id(4)}', '${BUYER}', '${SELLER}'), ('${id(5)}', '${BUYER}', '${OTHER}');
INSERT INTO public.declutter_cart_items VALUES
  ('${id(11)}', '${id(1)}', '${id(901)}', 'old title', now() - interval '2 days'),
  ('${id(12)}', '${id(1)}', '${id(902)}', null, now() - interval '1 day'),
  ('${id(21)}', '${id(2)}', null, 'Kept title', now()),
  ('${id(31)}', '${id(3)}', '${id(903)}', null, now()),
  ('${id(41)}', '${id(4)}', '${id(904)}', null, now()),
  ('${id(51)}', '${id(5)}', '${id(905)}', null, now());
INSERT INTO public.declutter_refund_requests VALUES
  ('${id(101)}', '${id(1)}', 'open', now() + interval '20 hours', null),
  ('${id(102)}', '${id(2)}', 'offered', now() - interval '1 hour', now() + interval '5 hours'),
  ('${id(103)}', '${id(3)}', 'open', now() - interval '1 minute', null),
  ('${id(104)}', '${id(4)}', 'agreed', now() + interval '20 hours', null),
  ('${id(105)}', '${id(5)}', 'open', now() + interval '20 hours', null);
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${MIG}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, got) => {
  if (ok) console.log(`PASS ${name}`);
  else { failed++; console.log(`FAIL ${name}${got === undefined ? "" : ` (got ${JSON.stringify(got)})`}`); }
};
async function as(role, uid, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec("RESET ROLE;"); }
}
const read = (uid) => as("authenticated", uid, "SELECT request_id, order_id, my_side, status, due_at, title, item_count FROM public.declutter_my_refund_todos()");

const s = await read(SELLER);
check("seller: the read exists and answers", !s.error, s.error);
const sRows = s.rows ?? [];
check("seller: exactly one row (the open request still inside answer_by)", sRows.length === 1 && sRows[0].request_id === id(101), sRows.map((r) => r.request_id));
check("seller: side seller, status open", sRows[0]?.my_side === "seller" && sRows[0]?.status === "open", sRows[0]);
check("seller: due_at is answer_by (about 20 h out)", sRows[0] && Math.abs(new Date(sRows[0].due_at).getTime() - Date.now() - 20 * 3600e3) < 120e3, sRows[0]?.due_at);
check("seller: title is the live item's title of the first line, count 2", sRows[0]?.title === "Oak rocking chair" && sRows[0]?.item_count === 2, sRows[0]);

const b = await read(BUYER);
const bRows = b.rows ?? [];
check("buyer: exactly one row (the part offer waiting on the buyer)", bRows.length === 1 && bRows[0].request_id === id(102), bRows.map((r) => r.request_id));
check("buyer: due_at is offer_answer_by (about 5 h out)", bRows[0] && Math.abs(new Date(bRows[0].due_at).getTime() - Date.now() - 5 * 3600e3) < 120e3, bRows[0]?.due_at);
check("buyer: a line whose item is gone keeps its title", bRows[0]?.title === "Kept title" && bRows[0]?.item_count === 1, bRows[0]);
check("buyer: never sees the seller's open requests (o1, o5)", !bRows.some((r) => r.request_id === id(101) || r.request_id === id(105)));

const o = await read(OTHER);
check("other seller: sees only their own open request (o5)", (o.rows ?? []).length === 1 && o.rows[0].request_id === id(105), o.rows);

const anon = await as("anon", null, "SELECT * FROM public.declutter_my_refund_todos()");
check("anon cannot call it", !!anon.error && /permission denied/i.test(anon.error), anon);
const noUid = await as("authenticated", null, "SELECT * FROM public.declutter_my_refund_todos()");
check("no session: not_authenticated", !!noUid.error && /not_authenticated/.test(noUid.error), noUid);
const direct = await as("authenticated", SELLER, "SELECT * FROM public.declutter_refund_requests");
check("members still cannot read the table directly", !!direct.error, direct);

await db.exec(`UPDATE public.feature_on SET on_ = false`);
const off = await read(SELLER);
check("switch off: no rows and no error", !off.error && (off.rows ?? []).length === 0, off);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
