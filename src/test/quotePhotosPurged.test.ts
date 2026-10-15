/**
 * Account deletion erases the quoter's quote past-work photos. They are
 * uploaded to the PUBLIC job-photos bucket at `<uid>/quotes/<nonce>.jpg`
 * (src/lib/quotes/api.ts), and on the quoter's deletion the
 * quote_follows_quoter_deletion trigger empties job_quotes.photo_paths, so
 * nothing references the objects any more. Measured 2026-10-15 before this
 * guard: IDENTITY_SUBFOLDERS named only `declutter`, so the purge left every
 * quote photo behind.
 *
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   { bucket: "job-photos", folder: "quotes" }, |   { bucket: "job-photos", folder: "quotes-x" },
 * @mutate src/lib/quotes/api.ts |   return `${userId}/quotes/${nonce}.jpg`; |   return `${userId}/quote-photos/${nonce}.jpg`;
 * @mutate src/lib/quotes/api.ts |   const path = quotePhotoPath(userId, nonce); |   const path = `${userId}/${nonce}.jpg`;
 * @mutate supabase/functions/_shared/accountPurge.ts |       if (data.length < STORAGE_LIST_PAGE) break; |       break;
 * @mutate supabase/functions/_shared/accountPurge.ts |           offset: page * STORAGE_LIST_PAGE, |           offset: 0,
 * @mutate supabase/functions/_shared/accountPurge.ts |         await admin.storage.from(bucket).remove(batch); |         await admin.storage.from(bucket).remove(paths);
 *
 * The folder is FLAT (a fresh name per upload) and grows with every quote, so
 * it can pass Storage's 1000-row list page. lh-silent-failure review of
 * 4cd9c94d1 (must-fix 1): listAllObjects read one page and threw at 1000, so a
 * busy quoter's deletion failed on every retry. It now pages with offset, and
 * the purge removes in page-sized batches.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { identitySubfolderPrefixes, IDENTITY_SUBFOLDERS } from "../../supabase/functions/_shared/purgeBuckets";
import { quotePhotoPath } from "@/lib/quotes/api";

// Loaded by path, not by a static import: accountPurge.ts is Deno source and
// stays out of the app tsconfig's graph (as in seriesBlocksAccountDeletion.test.ts).
const PURGE = new URL("../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname;
const { listAllObjects } = (await import(/* @vite-ignore */ PURGE)) as {
  listAllObjects: (admin: unknown, bucket: string, prefix: string) => Promise<string[]>;
};

/** A Storage fake that honours limit/offset over sorted names, like the real list. */
function fakeStorage(objects: string[]) {
  const lists: { prefix: string; limit: number; offset: number }[] = [];
  const admin = {
    storage: {
      from: () => ({
        list: async (prefix: string, opts: { limit?: number; offset?: number } = {}) => {
          const limit = opts.limit ?? 100;
          const offset = opts.offset ?? 0;
          lists.push({ prefix, limit, offset });
          const rows = objects
            .filter((o) => o.startsWith(`${prefix}/`))
            .map((o) => o.slice(prefix.length + 1))
            .filter((rest) => !rest.includes("/"))
            .sort()
            .slice(offset, offset + Math.min(limit, 1000))
            .map((name) => ({ name, id: `id-${name}` }));
          return { data: rows, error: null };
        },
      }),
    },
  };
  return { admin, lists };
}

const api = blankComments(readFileSync(join(process.cwd(), "src/lib/quotes/api.ts"), "utf8"));

describe("account deletion erases job-photos/<uid>/quotes/ (quote past-work photos)", () => {
  it("the purge list names a job-photos folder that every quote photo path sits under", () => {
    expect(IDENTITY_SUBFOLDERS.length).toBeGreaterThan(1);
    const path = quotePhotoPath("u-1", "abc");
    const covering = identitySubfolderPrefixes("u-1").filter(
      ({ bucket, prefix }) => bucket === "job-photos" && path.startsWith(`${prefix}/`),
    );
    expect(covering).toEqual([{ bucket: "job-photos", prefix: "u-1/quotes" }]);
  });

  it("uploadQuotePhoto uploads to the job-photos bucket at quotePhotoPath, nowhere else", () => {
    expect(api).toContain('const QUOTE_PHOTO_BUCKET = "job-photos";');
    const start = api.indexOf("export async function uploadQuotePhoto(");
    expect(start).toBeGreaterThan(0);
    const body = api.slice(start, api.indexOf("\n}\n", start));
    expect(body).toContain("const path = quotePhotoPath(userId, nonce);");
    expect(body).toContain("supabase.storage.from(QUOTE_PHOTO_BUCKET).upload(path,");
    expect((body.match(/\.upload\(/g) ?? []).length).toBe(1);
  });

  it("a quote folder past one 1000-row page is listed in full (2,345 photos), page by page", async () => {
    const objects = Array.from({ length: 2345 }, (_, i) => `u-1/quotes/${String(i).padStart(5, "0")}.jpg`);
    const { admin, lists } = fakeStorage(objects);
    const found = await listAllObjects(admin, "job-photos", "u-1/quotes");
    expect(found.length).toBe(2345);
    expect(new Set(found)).toEqual(new Set(objects));
    expect(lists.map((l) => l.offset)).toEqual([0, 1000, 2000]);
  });

  it("the purge removes in batches no bigger than one page", () => {
    const purge = blankComments(readFileSync(join(process.cwd(), "supabase/functions/_shared/accountPurge.ts"), "utf8"));
    const start = purge.indexOf("async function purgeIdentityStorage(");
    expect(start).toBeGreaterThan(0);
    const body = purge.slice(start, purge.indexOf("\nasync function ", start + 10));
    expect(body).toContain("const batch = paths.slice(i, i + STORAGE_LIST_PAGE);");
    expect(body).toContain("await admin.storage.from(bucket).remove(batch);");
    expect(body).not.toContain(".remove(paths)");
  });
});
