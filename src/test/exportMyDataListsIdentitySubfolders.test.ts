/**
 * Q1863: Download My Data exports what account deletion erases. Deletion erases every IDENTITY_BUCKETS bucket under
 * <uid>/ AND every IDENTITY_SUBFOLDERS <uid>/<folder> (supabase/functions/_shared/purgeBuckets.ts: Declutter listing,
 * porch and problem photos, quote photos, a Helpr's truck photo, shop photos); export-my-data listed only the first.
 * Reads export-my-data's code (comments blanked) and fails unless it lists both, through the shared lists.
 *
 * @mutate supabase/functions/export-my-data/index.ts |     for (const { bucket, prefix } of identitySubfolderPrefixes(user.id)) { |     for (const { bucket, prefix } of identitySubfolderPrefixes(user.id).slice(0, 0)) {
 * @mutate supabase/functions/export-my-data/index.ts |       targets.push({ bucket, paths: await listAllObjects(admin, bucket, prefix) }); |       targets.push({ bucket, paths: [] });
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { IDENTITY_SUBFOLDERS, identitySubfolderPrefixes } from "../../supabase/functions/_shared/purgeBuckets";

const SRC = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/export-my-data/index.ts"), "utf8")).replace(/\s+/g, " ");

describe("Download My Data lists every folder account deletion erases (Q1863)", () => {
  it("the shared subfolder list is real (floor)", () => {
    expect(IDENTITY_SUBFOLDERS.length).toBeGreaterThan(4);
    expect(identitySubfolderPrefixes("u1").map((p) => `${p.bucket}:${p.prefix}`)).toContain("job-photos:u1/declutter");
  });

  it("export-my-data lists the identity buckets AND every identity subfolder, from the shared lists", () => {
    expect(SRC).toContain("for (const bucket of IDENTITY_BUCKETS) { targets.push({ bucket, paths: await listAllObjects(admin, bucket, user.id) }); }");
    expect(SRC).toContain("for (const { bucket, prefix } of identitySubfolderPrefixes(user.id)) { targets.push({ bucket, paths: await listAllObjects(admin, bucket, prefix) }); }");
  });
});
