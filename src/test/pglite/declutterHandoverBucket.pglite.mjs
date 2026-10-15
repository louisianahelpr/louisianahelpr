#!/usr/bin/env node
/**
 * PGlite proof for 20261015092723_declutter_handover_private_bucket (lh-authz-rls
 * review of slice 4, should-fix (a)): Declutter porch and problem photos live in
 * a PRIVATE bucket; a party of the order uploads into their own folder, the two
 * parties and admins read, nobody else does, members never change or delete
 * one, and the RPCs accept a photo only from that bucket.
 *
 *   node src/test/pglite/declutterHandoverBucket.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoverBucket.pglite.mjs    # RED: the migration absent
 *
 * On top of slices 1-4 (scripts/declutter/slice3Harness.mjs; its storage.objects
 * has RLS on and the live grants); the migration is applied 3 times. Storage
 * itself is not Supabase's here: what is proven is the policy and RPC logic,
 * not the Storage API. pglite is not a dependency (CLAUDE.md): ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, OUTSIDER, ADMIN } = USERS;
const NEW_FILE = "20261015092723_declutter_handover_private_bucket.sql";
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
// Live columns of storage.buckets the migration writes.
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }];
if (!skip) extra.push({ file: NEW_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    const r = await db.query(sql);
    return r.affectedRows !== undefined && !r.rows.length ? { affected: r.affectedRows, rows: r.rows } : r.rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && typeof r.error === "string" && re.test(r.error);
const I = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function paidOrder(n, buyer, seller, price) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Bucket item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'porch')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_bk_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
const put = (uid, name) => me(uid, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('declutter-handover', '${name}', '${uid}') RETURNING name`);
const seen = async (uid, name) => one(await me(uid, `SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'declutter-handover' AND name = '${name}'`));

const bucket = (await svc(`SELECT public, allowed_mime_types FROM storage.buckets WHERE id = 'declutter-handover'`))[0];
ok(bucket?.public === false, `the bucket exists and is PRIVATE: ${JSON.stringify(bucket)}`);

const A = await paidOrder(1, BUYER, SELLER, 3000);
ok(typeof A.order_id === "string", "setup: a paid porch order");
const sellerPhoto = `${SELLER}/declutter/handover/${A.order_id}/setout.jpg`;
const buyerPhoto = `${BUYER}/declutter/handover/${A.order_id}/pickedup.jpg`;
const problemPhoto = `${BUYER}/declutter/problem/${A.order_id}/crack.jpg`;

// Writes.
ok(Array.isArray(await put(SELLER, sellerPhoto)), "the seller uploads the 'Set out' photo into their own folder");
ok(Array.isArray(await put(BUYER, buyerPhoto)), "the buyer uploads the 'Picked up' photo into their own folder");
ok(Array.isArray(await put(BUYER, problemPhoto)), "the buyer uploads a problem photo");
ok(refused(await put(BUYER, `${SELLER}/declutter/handover/${A.order_id}/fake.jpg`), /row-level security/),
  "nobody uploads into the other side's folder");
ok(refused(await put(OUTSIDER, `${OUTSIDER}/declutter/handover/${A.order_id}/x.jpg`), /row-level security/),
  "a stranger cannot upload for someone else's order, even into their own folder");
ok(refused(await put(SELLER, `${SELLER}/declutter/handover/not-a-uuid/x.jpg`), /row-level security/),
  "a path that does not name an order is refused (no cast error leaks)");
ok(refused(await put(SELLER, `${SELLER}/declutter/elsewhere/${A.order_id}/x.jpg`), /row-level security/),
  "only the handover/ and problem/ folders");

ok(refused(await put(SELLER, `${SELLER}/declutter/handover/${A.order_id}/x.jpg/`), /row-level security/)
  && refused(await put(SELLER, `${SELLER}/declutter/handover/${A.order_id}/x.jpg//evil`), /row-level security/),
  "a path with extra or empty segments is refused (exactly 5)");

// Reads.
ok(await seen(BUYER, sellerPhoto) === 1, "the buyer of the order sees the seller's porch photo");
ok(await seen(SELLER, buyerPhoto) === 1 && await seen(SELLER, problemPhoto) === 1, "the seller sees the buyer's photos");
ok(await seen(ADMIN, sellerPhoto) === 1, "an admin sees it");
ok(await seen(OUTSIDER, sellerPhoto) === 0 && await seen(OUTSIDER, buyerPhoto) === 0, "a stranger sees nothing");

// No member changes or deletes evidence.
await me(SELLER, `UPDATE storage.objects SET name = name || '.x' WHERE bucket_id = 'declutter-handover' AND name = '${sellerPhoto}'`);
await me(SELLER, `DELETE FROM storage.objects WHERE bucket_id = 'declutter-handover' AND name = '${sellerPhoto}'`);
ok(one(await svc(`SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'declutter-handover' AND name = '${sellerPhoto}'`)) === 1,
  "the seller can neither rename nor delete their porch photo");

// A closed order takes no new photo (lh-authz-rls review of lane J, should-fix 2); the photos already there stay readable.
const B = await paidOrder(2, BUYER, SELLER, 2500);
await svc(`UPDATE public.declutter_orders SET status = 'refunded' WHERE id = '${B.order_id}'`);
ok(refused(await put(BUYER, `${BUYER}/declutter/handover/${B.order_id}/late.jpg`), /row-level security/),
  "no upload to an order that is no longer paid (refunded)");

// The RPCs take a photo only from the private bucket.
await svc(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('job-photos', '${BUYER}/declutter/problem/${A.order_id}/public.jpg', '${BUYER}')`);
ok(refused(await me(BUYER, `SELECT public.declutter_report_problem('${A.order_id}', 'damaged', 'Cracked', ARRAY['${BUYER}/declutter/problem/${A.order_id}/public.jpg'])`), /photo_not_uploaded/),
  "a problem photo in the PUBLIC job-photos bucket is refused");
const prob = await me(BUYER, `SELECT public.declutter_report_problem('${A.order_id}', 'damaged', 'Cracked', ARRAY['${problemPhoto}']) AS id`);
ok(Array.isArray(prob) && typeof one(prob) === "string", `a problem photo in declutter-handover is accepted: ${JSON.stringify(prob)}`);
const fnBody = one(await svc(`SELECT pg_get_functiondef('public.declutter_porch_photo(uuid, text, numeric, numeric)'::regprocedure)`)) ?? "";
ok(/so\.bucket_id = 'declutter-handover'/.test(fnBody) && !/job-photos/.test(fnBody), "declutter_porch_photo accepts only the private bucket");

let anonCall;
try {
  await db.exec(`SET ROLE anon`);
  anonCall = (await db.query(`SELECT public.declutter_handover_photo_access('x', false)`)).rows;
} catch (e) {
  anonCall = { error: String(e.message ?? e) };
} finally {
  await db.exec(`RESET ROLE`);
}
ok(refused(anonCall, /permission denied/), `anon cannot call the access helper: ${JSON.stringify(anonCall)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
