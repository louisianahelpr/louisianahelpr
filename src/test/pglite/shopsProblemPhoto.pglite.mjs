#!/usr/bin/env node
/**
 * PGlite proof for 20261112090512_shops_problem_photo.sql (Shops audit 11-12 S018): the buyer's problem report takes
 * an optional photo in the private shop-handover bucket (<buyer>/shops/problem/<order>/<file>).
 *
 *   node src/test/pglite/shopsProblemPhoto.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsProblemPhoto.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                               # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; is_caller_banned from a setting;
 * contact_leak_reason NULL; shop_order_is_service false; has_role from user_roles; declutter_notify records.
 * storage.objects is a real table with RLS on, so the DELETE policy runs as authenticated.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112090512_shops_problem_photo.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a0d-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), ADMIN = U(3), OTHER = U(4);
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage, auth TO authenticated;
CREATE TABLE storage.objects (bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.uid', true), '')::uuid \$f\$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL,
  captured_at timestamptz, ready_date date, fulfillment text NOT NULL DEFAULT 'pickup');
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, problem_at timestamptz, problem_note text,
  problem_photo_path text, CHECK (problem_photo_path IS NULL OR (problem_at IS NOT NULL AND char_length(problem_photo_path) <= 300)));
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS \$f\$ SELECT coalesce(current_setting('test.banned', true), '') = 'on' \$f\$;
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_order_is_service(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql AS \$f\$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) \$f\$;
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS \$f\$ SELECT (now() AT TIME ZONE 'America/Chicago')::date \$f\$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  \$f\$ INSERT INTO public.notices VALUES (u, ti, m) \$f\$;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`);
if (skip) {
  await db.exec(fnFrom("20261018211820_shops_handover_payout.sql", "shop_handover_photo_access"));
  await db.exec(fnFrom("20261112081213_shops_notice_words_s011_s017.sql", "shops_report_not_received"));
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
// The two shop-handover policies of 20261018211820 (unchanged here), so reads and writes run under RLS.
await db.exec(`
CREATE POLICY ins ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'shop-handover' AND public.shop_handover_photo_access(name, true));
CREATE POLICY sel ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'shop-handover' AND public.shop_handover_photo_access(name, false));
`);
const q = async (s) => (await db.query(s)).rows;
const as = async (uid, sql) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec(`RESET ROLE; SET test.uid = '';`); }
};
const order = async ({ due = true, status = "accepted" } = {}) =>
  (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date)
    VALUES ('${BUYER}', '${SELLER}', '${status}', now(), current_date ${due ? "- 1" : "+ 5"}) RETURNING id`))[0].id;
const p = (uid, o, f = "a.jpg") => `${uid}/shops/problem/${o}/${f}`;
const upload = (uid, path) => as(uid, `INSERT INTO storage.objects VALUES ('shop-handover', '${path}') RETURNING name`);
const report = (uid, o, photo) => as(uid, `SELECT public.shops_report_not_received('${o}', 'Box was empty', ${photo ? `'${photo}'` : "NULL"}) AS r`);

// 1. Upload rules.
const o1 = await order();
check(!(await upload(BUYER, p(BUYER, o1))).err, "buyer uploads a problem photo into their own folder for a due order");
check(!!(await upload(SELLER, p(SELLER, o1))).err, "the shop cannot upload into 'problem'");
check(!!(await upload(OTHER, p(OTHER, o1))).err, "a stranger cannot upload into 'problem'");
check(!!(await upload(BUYER, p(SELLER, o1, "x.jpg"))).err, "the buyer cannot upload into someone else's folder");
const oNotDue = await order({ due: false });
check(!!(await upload(BUYER, p(BUYER, oNotDue))).err, "no upload for an order not due yet (no report possible)");
const oDone = await order({ status: "handed_over" });
check(!!(await upload(BUYER, p(BUYER, oDone))).err, "no upload for a finished order");
await db.exec(`SET test.banned = 'on'`);
check(!!(await upload(BUYER, p(BUYER, o1, "b.jpg"))).err, "a banned buyer cannot upload");
await db.exec(`SET test.banned = ''`);
check(!(await upload(SELLER, `${SELLER}/shops/handover/${o1}/r.jpg`)).err, "the shop's ready photo upload is unchanged");

// 2. Read rules.
const seen = async (uid, path) => ((await as(uid, `SELECT name FROM storage.objects WHERE name = '${path}'`)).rows ?? []).length === 1;
check(await seen(BUYER, p(BUYER, o1)), "the buyer reads their own problem photo");
check(await seen(ADMIN, p(BUYER, o1)), "an admin reads the problem photo");
check(!(await seen(SELLER, p(BUYER, o1))), "the shop never reads the buyer's problem photo");
check(!(await seen(OTHER, p(BUYER, o1))), "a stranger never reads it");
check(await seen(BUYER, `${SELLER}/shops/handover/${o1}/r.jpg`), "the buyer still reads the shop's ready photo");

// 3. The report takes the photo.
const r0 = await report(BUYER, o1, p(SELLER, o1, "x.jpg"));
check(/photo_not_uploaded/.test(r0.err ?? ""), "a photo path outside the caller's folder is refused", r0.err);
const r0b = await report(BUYER, o1, p(BUYER, o1, "never-uploaded.jpg"));
check(/photo_not_uploaded/.test(r0b.err ?? ""), "a photo that was never uploaded is refused", r0b.err);
await q(`INSERT INTO storage.objects VALUES ('shop-handover', '${p(BUYER, oNotDue)}')`);
const o2 = await order();
const r0c = await report(BUYER, o2, p(BUYER, oNotDue));
check(/photo_not_uploaded/.test(r0c.err ?? ""), "another order's photo is refused", r0c.err);
await q(`INSERT INTO storage.objects VALUES ('other-bucket', '${p(BUYER, o2, "z.jpg")}')`);
const r0d = await report(BUYER, o2, p(BUYER, o2, "z.jpg"));
check(/photo_not_uploaded/.test(r0d.err ?? ""), "an object in another bucket is refused", r0d.err);
await q(`INSERT INTO storage.objects VALUES ('shop-handover', '${p(SELLER, o2, "s.jpg")}')`);
const r0e = await report(BUYER, o2, p(SELLER, o2, "s.jpg"));
check(/photo_not_uploaded/.test(r0e.err ?? ""), "an uploaded photo in someone else's folder is refused", r0e.err);
const r1 = await report(BUYER, o1, p(BUYER, o1));
check(!r1.err, "the report with the buyer's own photo succeeds", r1.err);
const h1 = (await q(`SELECT problem_photo_path, problem_note FROM public.shop_handovers WHERE order_id = '${o1}'`))[0];
check(h1?.problem_photo_path === p(BUYER, o1), "the photo is on the problem row", JSON.stringify(h1));
const r2 = await report(BUYER, o2, null);
check(!r2.err, "a report without a photo still works", r2.err);
const r2b = await as(BUYER, `SELECT public.shops_report_not_received('${o2}', 'Again')`);
check(!r2b.err, "the 2-arg call still resolves", r2b.err);
check((await q(`SELECT problem_photo_path FROM public.shop_handovers WHERE order_id = '${o2}'`))[0]?.problem_photo_path === null,
  "no photo, no path");

// An already open problem keeps its own photo (a later report never swaps it).
await upload(BUYER, p(BUYER, o1, "late.jpg"));
const late = await upload(BUYER, p(BUYER, o1, "late2.jpg"));
check(!!late.err, "no new problem upload once a problem is open");
await q(`INSERT INTO storage.objects VALUES ('shop-handover', '${p(BUYER, o1, "late3.jpg")}')`);
await report(BUYER, o1, p(BUYER, o1, "late3.jpg"));
check((await q(`SELECT problem_photo_path FROM public.shop_handovers WHERE order_id = '${o1}'`))[0]?.problem_photo_path === p(BUYER, o1),
  "an open problem keeps its first photo");

// 4. Unsent photo cleanup (DELETE policy).
const o3 = await order();
await upload(BUYER, p(BUYER, o3, "unsent.jpg"));
const del = await as(BUYER, `DELETE FROM storage.objects WHERE name = '${p(BUYER, o3, "unsent.jpg")}' RETURNING name`);
check((del.rows ?? []).length === 1, "the buyer deletes their own unsent problem photo", del.err);
const delSent = await as(BUYER, `DELETE FROM storage.objects WHERE name = '${p(BUYER, o1)}' RETURNING name`);
check((delSent.rows ?? []).length === 0, "a sent problem photo cannot be deleted by the buyer", delSent.err);
const delReady = await as(BUYER, `DELETE FROM storage.objects WHERE name = '${SELLER}/shops/handover/${o1}/r.jpg' RETURNING name`);
check((delReady.rows ?? []).length === 0, "the buyer cannot delete the shop's ready photo");
await q(`INSERT INTO storage.objects VALUES ('shop-handover', '${p(BUYER, o3, "other.jpg")}')`);
const delOther = await as(SELLER, `DELETE FROM storage.objects WHERE name = '${p(BUYER, o3, "other.jpg")}' RETURNING name`);
check((delOther.rows ?? []).length === 0, "the shop cannot delete the buyer's photo");

await q(`INSERT INTO storage.objects VALUES ('shop-handover', '${BUYER}/shops/handover/${o3}/h.jpg')`);
const delHand = await as(BUYER, `DELETE FROM storage.objects WHERE name = '${BUYER}/shops/handover/${o3}/h.jpg' RETURNING name`);
check((delHand.rows ?? []).length === 0, "the DELETE policy reaches only the 'problem' folder");

// 5. Grants.
const acl = (await q(`SELECT proacl::text a FROM pg_proc WHERE proname = 'shops_report_not_received'`)).map((r) => r.a);
check(acl.length === 1 && !/anon=/.test(acl[0]) && /authenticated=X/.test(acl[0]), "one form, not for anon", JSON.stringify(acl));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
