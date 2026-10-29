#!/usr/bin/env node
/**
 * PGlite proof for 20261029222816_declutter_handover_photo_cleanup (Declutter audit 1a #10, prod 2026-10-29): a
 * handover photo the RPC refused stayed in the private declutter-handover bucket for good. Now the member who
 * uploaded it can delete it while no handover row references the path; an attached photo, another member's photo
 * and the 'problem' folder can never be deleted this way.
 *
 *   node src/test/pglite/declutterHandoverPhotoCleanup.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoverPhotoCleanup.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then 20261028235709, 20261029002010 and 20261029201542 once each
 * (the newest handover photo RPCs); this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029222816_declutter_handover_photo_cleanup.sql";
// The newest handover photo RPCs: at the address, live only, and the porch photo not before the booked day.
const BASES = ["20261028235709_declutter_handover_photos_at_the_address.sql", "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql"];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const PICKUP = { lat: 30.451234, lng: -91.154321 };
const pt = (p) => `${p.lat}, ${p.lng}`;
const I = (n) => `cccccccc-0000-0000-0000-${String(n).padStart(12, "0")}`;
const put = async (path, agoMin = 0) => {
  await svc(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('declutter-handover', '${path}', now() - interval '${agoMin} minutes')`);
  return path;
};
const exists = async (path) => Number(one(await svc(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'declutter-handover' AND name = '${path}'`))) === 1;
/** A member's delete, as the storage API sends it: the rows it removed. */
const del = async (uid, path) => {
  const r = await me(uid, `DELETE FROM storage.objects WHERE bucket_id = 'declutter-handover' AND name = '${path}' RETURNING name`);
  return Array.isArray(r) ? r.length : r;
};
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
await run(liveItemSql({ id: I(1), seller: SELLER2, title: "Cleanup lamp", price: 1200, floor: 100 }));
await me(BUYER, `SELECT public.declutter_buy_now('${I(1)}', 1200)`);
const O = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${O?.order_id}', 'pi_clean_1', ${O?.total_cents}, now(), 150)`);
const today = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
await me(BUYER, `SELECT public.declutter_book_porch_day('${O?.order_id}', '${today}'::date)`);
ok(!!O?.order_id, "fixture: a paid porch order booked for today");
const dir = (uid) => `${uid}/declutter/handover/${O?.order_id}`;

// 1. A refused photo: its uploader removes it.
{
  const old = await put(`${dir(SELLER2)}/old.jpg`, 30);
  const r = await me(SELLER2, `SELECT public.declutter_porch_photo('${O?.order_id}', '${old}', ${pt(PICKUP)})`);
  ok(!Array.isArray(r) && /photo_too_old/.test(r?.error ?? ""), "fixture: the porch RPC refuses a 30-minute-old photo");
  ok(await del(SELLER2, old) === 1, "the seller deletes the refused photo they uploaded");
  ok(!await exists(old), "  and it is gone from storage");
}

// 2. Someone else's unattached photo: never.
{
  const mine = await put(`${dir(SELLER2)}/stray.jpg`);
  ok(await del(BUYER, mine) === 0, "the buyer cannot delete the seller's unattached photo");
  ok(await exists(mine), "  and it stays");
}

// 3. An attached photo (the proof of the handover): never, not even by its uploader.
{
  const fresh = await put(`${dir(SELLER2)}/fresh.jpg`);
  const r = await me(SELLER2, `SELECT public.declutter_porch_photo('${O?.order_id}', '${fresh}', ${pt(PICKUP)}) AS r`);
  ok(one(r)?.result === "set_out", "fixture: a fresh photo at the address is taken (set_out)");
  ok(await del(SELLER2, fresh) === 0, "the seller cannot delete the photo the handover holds");
  ok(await exists(fresh), "  and it stays");
  const pick = await put(`${dir(BUYER)}/pick.jpg`);
  const p = await me(BUYER, `SELECT public.declutter_porch_photo('${O?.order_id}', '${pick}', ${pt(PICKUP)}) AS r`);
  ok(one(p)?.result === "picked_up", "fixture: the buyer's pickup photo is taken (picked_up)");
  ok(await del(BUYER, pick) === 0 && await exists(pick), "the buyer cannot delete their attached pickup photo");
}

// 4. The problem folder is not this policy's: never.
{
  const prob = `${SELLER2}/declutter/problem/${O?.order_id}/p.jpg`;
  await put(prob);
  ok(await del(SELLER2, prob) === 0 && await exists(prob), "a problem-folder photo cannot be deleted this way");
}

// 5. The helper: own handover-folder paths only, NULL is false, anon cannot call it.
{
  const h = async (uid, p) => one(await me(uid, `SELECT public.declutter_handover_photo_unattached(${p === null ? "NULL" : `'${p}'`})`));
  ok(await h(SELLER2, null) === false, "unattached(NULL) is false");
  ok(await h(BUYER, `${dir(SELLER2)}/stray.jpg`) === false, "unattached(another member's path) is false");
  ok(await h(SELLER2, `${dir(SELLER2)}/stray.jpg`) === true, "unattached(your own unused path) is true");
  const acl = async (role) => one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_handover_photo_unattached(text)', 'EXECUTE')`));
  ok(await acl("anon") === false && await acl("authenticated") === true, "anon revoked, members granted");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
