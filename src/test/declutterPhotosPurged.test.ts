/**
 * Account deletion erases the member's Declutter listing photos
 * (docs/specs/declutter-auctions.md B4: they live in the PUBLIC job-photos
 * bucket under `<uid>/declutter/<item id>/`, and before slice 2 the purge
 * erased `<uid>/` only in avatars, user-documents and application-attachments,
 * measured in supabase/functions/_shared/purgeBuckets.ts 2026-10-14).
 *
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   { bucket: "job-photos", folder: "declutter" }, |   { bucket: "job-photos", folder: "declutter-x" },
 * @mutate supabase/functions/_shared/accountPurge.ts |       targets.push({ bucket, paths: await listAllObjects(admin, bucket, prefix) }); |       targets.push({ bucket, paths: [] });
 * @mutate supabase/functions/_shared/accountPurge.ts |       const left = await listAllObjects(admin, bucket, prefix); |       const left: string[] = [];
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { identitySubfolderPrefixes, IDENTITY_SUBFOLDERS } from "../../supabase/functions/_shared/purgeBuckets";
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

  it("the folder is the one the app uploads listing photos under", () => {
    const [prefix] = identitySubfolderPrefixes("u-1");
    expect(listingPhotoPath("u-1", "item-1", "abc").startsWith(`${prefix.prefix}/`)).toBe(true);
  });

  it("purgeIdentityStorage lists, removes and re-lists each subfolder prefix", () => {
    const body = fnBody(purge, "purgeIdentityStorage");
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain("const subfolders = identitySubfolderPrefixes(userId);");
    expect(body).toContain("targets.push({ bucket, paths: await listAllObjects(admin, bucket, prefix) });");
    expect(body).toContain("const left = await listAllObjects(admin, bucket, prefix);");
    expect(body).toMatch(/missingBuckets\(admin, \[\.\.\.new Set\(subfolders\.map/);
  });
});
