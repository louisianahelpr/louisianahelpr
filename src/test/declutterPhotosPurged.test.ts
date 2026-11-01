/**
 * Account deletion erases the member's Declutter listing photos
 * (docs/specs/declutter-auctions.md B4: they live in the PUBLIC job-photos
 * bucket under `<uid>/declutter/<item id>/`, and before slice 2 the purge
 * erased `<uid>/` only in avatars, user-documents and application-attachments,
 * measured in supabase/functions/_shared/purgeBuckets.ts 2026-10-14).
 *
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   { bucket: "job-photos", folder: "declutter" }, |   { bucket: "job-photos", folder: "declutter-x" },
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   { bucket: "declutter-handover", folder: "declutter" }, |
 * @mutate src/lib/declutter/handover.ts | supabase.storage.from(DECLUTTER_HANDOVER_BUCKET).upload( | supabase.storage.from("job-photos").upload(
 * @mutate supabase/functions/_shared/accountPurge.ts |       targets.push({ bucket, paths: kept(bucket, await listAllObjects(admin, bucket, prefix)) }); |       targets.push({ bucket, paths: [] });
 * @mutate supabase/functions/_shared/accountPurge.ts |       const left = kept(bucket, await listAllObjects(admin, bucket, prefix)); |       const left: string[] = [];
 * Lane J: a not-yet-created declutter-handover bucket is nothing to erase, never a failed deletion;
 * every other missing subfolder bucket still fails the step (Q219).
 * @mutate supabase/functions/_shared/purgeBuckets.ts |     notCreatedYet: missing.filter((b) => SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET.includes(b)), |     notCreatedYet: [] as string[],
 * @mutate supabase/functions/_shared/purgeBuckets.ts |     failing: missing.filter((b) => !SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET.includes(b)), |     failing: [] as string[],
 * @mutate supabase/functions/_shared/purgeBuckets.ts | export const SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET: readonly string[] = ["declutter-handover", "helpr-tasks", "listing-photos"]; | export const SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET: readonly string[] = ["declutter-handover", "helpr-tasks", "listing-photos", "job-photos"];
 * Slice 5: the Helpr's truck photo is erased with the account.
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   { bucket: "helpr-tasks", folder: "vehicle" }, |
 * @mutate src/lib/helprTasks/api.ts |   return uploadCleaned(`${userId}/vehicle/${nonce()}.jpg`, file); |   return uploadCleaned(`${userId}/truck/${nonce()}.jpg`, file);
 * @mutate supabase/functions/_shared/accountPurge.ts |     for (const bucket of failing) { |     for (const bucket of missingSub) {
 * LEAD-LIST-FOR-SELLER: a Helpr's photos of a seller's listing go with the SELLER's account, never the Helpr's.
 * @mutate supabase/functions/_shared/purgeBuckets.ts |     if (p.seller_id === userId && seg[0] !== userId) sellerExtra.push(p.storage_path); |     if (false) sellerExtra.push(p.storage_path);
 * @mutate supabase/functions/_shared/purgeBuckets.ts |     else if (p.seller_id !== null && p.seller_id !== userId && seg[0] === userId) helprKeep.add(p.storage_path); |     else if (false) helprKeep.add(p.storage_path);
 * @mutate supabase/functions/_shared/purgeBuckets.ts |     if (seg.length !== 4 \|\| !seg[0] \|\| seg[1] !== "declutter" \|\| seg[2] !== p.item_id \|\| !seg[3]) continue; |     if (!seg[0]) continue;
 * @mutate supabase/functions/_shared/accountPurge.ts |     if (rows.length < PHOTO_PAGE) return { data: all, error: null }; |     return { data: all, error: null };
 * @mutate supabase/functions/_shared/accountPurge.ts |     .eq("seller_id", userId).not("storage_path", "like", `${userId}/%`) |     .eq("seller_id", "nobody").not("storage_path", "like", `${userId}/%`)
 * @mutate supabase/functions/_shared/accountPurge.ts |     { bucket: "job-photos", paths: listed.sellerExtra }, |     { bucket: "job-photos", paths: [] },
 * @mutate supabase/functions/_shared/accountPurge.ts |   ], listed.helprKeep)) && listed.ok; |   ])) \&\& listed.ok;
 * @mutate supabase/functions/_shared/accountPurge.ts |       const left = kept(bucket, await listAllObjects(admin, bucket, prefix)); |       const left = await listAllObjects(admin, bucket, prefix);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  classifyMissingSubfolderBuckets,
  listedForSellerPhotoPlan,
  identitySubfolderPrefixes,
  IDENTITY_SUBFOLDERS,
  SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET,
} from "../../supabase/functions/_shared/purgeBuckets";
import { listingPhotoPath } from "@/lib/declutter/photos";

const ROOT = process.cwd();
const purge = blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/accountPurge.ts"), "utf8"));

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nasync function ", start + 10);
  const nextExport = src.indexOf("\nexport async function ", start + 10);
  const ends = [next, nextExport].filter((n) => n > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("account deletion erases job-photos/<uid>/declutter/ (Declutter B4)", () => {
  it("the purge list names the Declutter folder, under the uid", () => {
    expect(IDENTITY_SUBFOLDERS.length).toBeGreaterThan(0);
    expect(identitySubfolderPrefixes("u-1")).toContainEqual({ bucket: "job-photos", prefix: "u-1/declutter" });
  });

  it("porch and problem photos in the private declutter-handover bucket are erased too (20261017055502)", () => {
    expect(identitySubfolderPrefixes("u-1")).toContainEqual({ bucket: "declutter-handover", prefix: "u-1/declutter" });
    // ...and it is the bucket the app uploads them to (never the public job-photos).
    const handover = blankComments(readFileSync(join(ROOT, "src/lib/declutter/handover.ts"), "utf8"));
    expect(handover).toContain('const DECLUTTER_HANDOVER_BUCKET = "declutter-handover";');
    expect(handover).toContain("supabase.storage.from(DECLUTTER_HANDOVER_BUCKET).upload(path, cleaned");
    expect(handover).not.toContain('from("job-photos")');
  });

  it("a Helpr's truck photo (private helpr-tasks bucket, <uid>/vehicle/) is erased; task evidence photos are not (slice 5)", () => {
    expect(identitySubfolderPrefixes("u-1")).toContainEqual({ bucket: "helpr-tasks", prefix: "u-1/vehicle" });
    expect(identitySubfolderPrefixes("u-1")).not.toContainEqual({ bucket: "helpr-tasks", prefix: "u-1/task" });
    const api = blankComments(readFileSync(join(ROOT, "src/lib/helprTasks/api.ts"), "utf8"));
    expect(api).toContain("return uploadCleaned(`${userId}/vehicle/${nonce()}.jpg`, file);");
    expect(api).toContain('await supabase.storage.from("helpr-tasks").upload(path, cleaned');
  });

  it("the folder is the one the app uploads listing photos under", () => {
    const [prefix] = identitySubfolderPrefixes("u-1");
    expect(listingPhotoPath("u-1", "item-1", "abc").startsWith(`${prefix.prefix}/`)).toBe(true);
  });

  it("purgeIdentityStorage lists, removes and re-lists each subfolder prefix", () => {
    const body = fnBody(purge, "purgeIdentityStorage");
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain("const subfolders = identitySubfolderPrefixes(userId);");
    expect(body).toContain("targets.push({ bucket, paths: kept(bucket, await listAllObjects(admin, bucket, prefix)) });");
    expect(body).toContain("const left = kept(bucket, await listAllObjects(admin, bucket, prefix));");
    expect(body).toMatch(/missingBuckets\(admin, \[\.\.\.new Set\(subfolders\.map/);
  });

  it("a subfolder bucket whose migration has not run yet is nothing to erase; any other missing bucket fails (Q219)", () => {
    // EXACT: only the bucket a migration newer than the purge creates (20261017055502).
    // ...and helpr-tasks (20261017055505, slice 5), and listing-photos (20261019071203, Q2211).
    expect([...SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET]).toEqual(["declutter-handover", "helpr-tasks", "listing-photos"]);
    for (const b of SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET) expect(IDENTITY_SUBFOLDERS.map((s) => s.bucket)).toContain(b);
    expect(classifyMissingSubfolderBuckets(["declutter-handover", "job-photos"])).toEqual({
      notCreatedYet: ["declutter-handover"],
      failing: ["job-photos"],
    });
    expect(classifyMissingSubfolderBuckets([])).toEqual({ notCreatedYet: [], failing: [] });
    const body = fnBody(purge, "purgeIdentityStorage");
    expect(body).toContain("const { notCreatedYet, failing } = classifyMissingSubfolderBuckets(missingSub);");
    // Only the failing ones fail the step; the not-created ones are logged as notes.
    const notCreatedLoop = /for \(const bucket of notCreatedYet\) \{([\s\S]*?)\n {4}\}/.exec(body)?.[1] ?? "";
    expect(notCreatedLoop).toContain("notes.push(");
    expect(notCreatedLoop).not.toMatch(/allOk|failures/);
    const failingLoop = /for \(const bucket of failing\) \{([\s\S]*?)\n {4}\}/.exec(body)?.[1] ?? "";
    expect(failingLoop).toContain("allOk = false;");
    expect(failingLoop).toContain("failures.push(");
  });
});

describe("listed-for-seller photos (a Helpr's folder, the seller's listing) follow the seller", () => {
  const S = "seller-1", H = "helpr-1", I = "item-1";
  const photos = [
    { item_id: I, storage_path: `${H}/declutter/${I}/a.jpg`, seller_id: S },
    { item_id: I, storage_path: `${H}/declutter/${I}/b.jpg`, seller_id: S },
    { item_id: I, storage_path: `${H}/declutter/other-item/y.jpg`, seller_id: S }, // not this item's folder: never touched
    { item_id: I, storage_path: `${H}/quotes/${I}/q.jpg`, seller_id: S }, // not a declutter folder: never touched
    { item_id: I, storage_path: `${H}/declutter/${I}/deep/z.jpg`, seller_id: S }, // not the exact shape: never touched
    { item_id: "item-own", storage_path: `${S}/declutter/item-own/z.jpg`, seller_id: S }, // the seller's own upload: the folder sweep's
    { item_id: "h-own", storage_path: `${H}/declutter/h-own/h.jpg`, seller_id: H }, // the Helpr's own listing: the Helpr's sweep
    { item_id: "gone", storage_path: `${H}/declutter/gone/g.jpg`, seller_id: null }, // a seller already gone: swept
  ];
  it("the seller's deletion removes their listing's photos from the Helpr's folder, by exact path", () => {
    const p = listedForSellerPhotoPlan(S, photos);
    expect(p.sellerExtra).toEqual([`${H}/declutter/${I}/a.jpg`, `${H}/declutter/${I}/b.jpg`]);
    expect(p.helprKeep.size).toBe(0);
  });
  it("the Helpr's deletion keeps them for the seller", () => {
    const p = listedForSellerPhotoPlan(H, photos);
    expect([...p.helprKeep]).toEqual([`${H}/declutter/${I}/a.jpg`, `${H}/declutter/${I}/b.jpg`]);
    expect(p.sellerExtra).toEqual([]);
  });

  type Row = { id: number; item_id: string; storage_path: string; seller_id: string | null };
  /** PostgREST stand-in for the two declutter_item_photos reads: eq / not like / like / neq / order / range, 1,000-row cap. */
  function fakeAdmin(rows: Row[], reads: string[] = []) {
    return {
      from(table: string) {
        const preds: Array<(r: Row) => boolean> = [];
        const like = (pat: string) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
        let lo = 0, hi = 999;
        const q = {
          select: () => q,
          eq: (c: keyof Row, v: unknown) => (preds.push((r) => r[c] === v), q),
          neq: (c: keyof Row, v: unknown) => (preds.push((r) => r[c] !== null && r[c] !== v), q),
          like: (c: keyof Row, pat: string) => (preds.push((r) => like(pat).test(String(r[c]))), q),
          not: (c: keyof Row, op: string, pat: string) => (op === "like" && preds.push((r) => !like(pat).test(String(r[c]))), q),
          order: () => q,
          range: (a: number, b: number) => ((lo = a), (hi = Math.min(b, a + 999)), q),
          then: (res: (v: unknown) => unknown) => {
            reads.push(`${table} ${lo}-${hi}`);
            const all = rows.filter((r) => preds.every((p) => p(r))).sort((x, y) => x.id - y.id);
            return Promise.resolve({ data: all.slice(lo, hi + 1), error: null }).then(res);
          },
        };
        return q;
      },
    };
  }
  const collect = async (admin: unknown, uid: string) => {
    const mod = (await import(/* @vite-ignore */ new URL("../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname)) as {
      collectListedForSellerPhotos: (a: unknown, u: string, s: unknown[]) => Promise<{ ok: boolean; sellerExtra: string[]; helprKeep: Set<string> }>;
    };
    return mod.collectListedForSellerPhotos(admin, uid, []);
  };

  it("the Helpr deletes first, then the seller: the seller's purge still finds the photos (no link row needed)", async () => {
    // After the Helpr's deletion the link row is gone (ON DELETE CASCADE); only declutter_item_photos remains.
    const rows: Row[] = photos.map((p, k) => ({ id: k + 1, ...p }));
    const helprSide = await collect(fakeAdmin(rows), H);
    expect([...helprSide.helprKeep].sort()).toEqual([`${H}/declutter/${I}/a.jpg`, `${H}/declutter/${I}/b.jpg`]);
    const sellerSide = await collect(fakeAdmin(rows), S);
    expect(sellerSide.ok).toBe(true);
    expect(sellerSide.sellerExtra.sort()).toEqual([`${H}/declutter/${I}/a.jpg`, `${H}/declutter/${I}/b.jpg`]);
  });

  it("pages past PostgREST's 1,000-row cap: 2,500 photos are all found", async () => {
    const rows: Row[] = Array.from({ length: 2500 }, (_, k) => ({ id: k + 1, item_id: `i${k}`, storage_path: `${H}/declutter/i${k}/p.jpg`, seller_id: S }));
    const reads: string[] = [];
    const out = await collect(fakeAdmin(rows, reads), S);
    expect(out.sellerExtra.length).toBe(2500);
    expect(reads.filter((r) => r.startsWith("declutter_item_photos")).length).toBeGreaterThan(3);
    const keep = await collect(fakeAdmin(rows), H);
    expect(keep.helprKeep.size).toBe(2500);
  });

  it("the purge reads the plan before the RPC, removes the seller's extras, and skips the kept ones in the sweep and its check", () => {
    const body = fnBody(purge, "purgeAccount");
    expect(body.indexOf("collectListedForSellerPhotos(admin, userId, steps)")).toBeGreaterThan(0);
    expect(body.indexOf("collectListedForSellerPhotos(admin, userId, steps)")).toBeLessThan(body.indexOf("purgeDatabaseRows"));
    expect(body).toContain('{ bucket: "job-photos", paths: listed.sellerExtra },');
    expect(body).toMatch(/\], listed\.helprKeep\)\) && listed\.ok;/);
    const storage = fnBody(purge, "purgeIdentityStorage");
    expect(storage).toContain("targets.push({ bucket, paths: kept(bucket, await listAllObjects(admin, bucket, prefix)) });");
    expect(storage).toContain("const left = kept(bucket, await listAllObjects(admin, bucket, prefix));");
    expect(purge).not.toMatch(/from\("declutter_listed_for_seller"\)/);
  });
});
