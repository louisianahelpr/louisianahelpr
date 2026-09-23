// Guard for the "upsert upload to a bucket with no SELECT policy" bug class.
//
// supabase-js `.upload(path, file, { upsert: true })` issues
// INSERT ... ON CONFLICT, and Postgres requires the row to satisfy a SELECT
// policy to arbitrate the conflict. A bucket that receives upsert uploads but
// has ZERO SELECT-capable policy therefore fails EVERY client upload with
// "new row violates row-level security policy" — this shipped twice (the
// avatars "Enter app" blocker, then the helper intro-video upload, whose
// bucket didn't exist at all). These tests statically assert that every
// bucket the client upserts into is backed by a migration that both creates
// the bucket and grants it a SELECT (or ALL) policy.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { blankComments } from "@/test/helpers/blankNonCode";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = resolve(ROOT, "supabase/migrations");

/*
 * THE INVENTORY IS DERIVED, NOT TYPED.
 *
 * This was a hand-written list with a comment asking the next person to keep
 * it in sync with `grep -rn "upsert: true" src`. A list that is maintained by
 * remembering is the hollow shape this whole burn-down keeps finding: the guard
 * stays green precisely when someone adds the upsert upload it exists to catch,
 * because a new bucket never enters the list. And "a bucket that didn't exist
 * at all" is not hypothetical here — it is one of the two bugs named above.
 *
 * So the buckets are read out of the source. For every `.upload(..., { upsert:
 * true })` we walk back to the `storage.from(...)` that owns it, resolving a
 * constant (`AVATAR_BUCKET`, `PORTFOLIO_BUCKET`) to its literal.
 *
 * Verified on 2026-09-21 to reproduce the hand list exactly — avatars,
 * id-documents, job-photos, user-documents — with nothing unresolved.
 * id-documents left the list on 2026-09-23 (Q40): its only upsert upload was
 * the deleted Profile.tsx handleIdUpload.
 */
const SRC_FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

const FROM_RE = /storage\s*\.\s*from\(\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*\)/g;

function deriveUpsertBuckets(): { buckets: string[]; unresolved: string[] } {
  const buckets = new Set<string>();
  const unresolved: string[] = [];
  for (const rel of SRC_FILES) {
    // Comments only — string bodies must survive, they hold the bucket names.
    const src = blankComments(readFileSync(resolve(ROOT, rel), "utf8"));
    const froms = [...src.matchAll(FROM_RE)].map((m) => ({
      at: m.index ?? 0,
      literal: m[1] ?? m[2],
      ident: m[3],
    }));
    if (froms.length === 0) continue;
    let i = -1;
    while ((i = src.indexOf(".upload(", i + 1)) !== -1) {
      const end = src.indexOf(";", i);
      if (!/upsert:\s*true/.test(src.slice(i, end === -1 ? i + 400 : end))) continue;
      const owner = froms.filter((f) => f.at < i).pop();
      if (!owner) { unresolved.push(`${rel}: .upload() with no storage.from() before it`); continue; }
      let bucket: string | undefined = owner.literal;
      if (!bucket && owner.ident) {
        bucket = new RegExp(`\\b${owner.ident}\\s*=\\s*["']([^"']+)["']`).exec(src)?.[1];
      }
      if (!bucket) { unresolved.push(`${rel}: could not resolve bucket for ${owner.ident}`); continue; }
      buckets.add(bucket);
    }
  }
  return { buckets: [...buckets].sort(), unresolved };
}

const { buckets: UPSERT_BUCKETS, unresolved: UNRESOLVED } = deriveUpsertBuckets();

const allMigrationSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

/** CREATE POLICY statements, split so each chunk holds one policy body. */
const policyChunks = allMigrationSql
  .split(/create policy/i)
  .slice(1)
  .map((c) => c.toLowerCase());

function hasSelectPolicy(bucket: string): boolean {
  return policyChunks.some(
    (chunk) =>
      chunk.includes(`bucket_id = '${bucket}'`) &&
      /\bfor\s+(select|all)\b/.test(chunk),
  );
}

function hasBucketDefinition(bucket: string): boolean {
  return new RegExp(`insert into storage\\.buckets[\\s\\S]{0,200}'${bucket}'`, "i").test(
    allMigrationSql,
  );
}

describe("storage bucket policies", () => {
  it("the scan actually found the upsert uploads (an empty inventory passes vacuously)", () => {
    // Without this floor, a scanner that silently matched nothing would turn
    // every it.each below into zero cases and report success.
    expect(UNRESOLVED, "a .upload() whose bucket could not be resolved").toEqual([]);
    expect(UPSERT_BUCKETS.length).toBeGreaterThanOrEqual(3);
    expect(UPSERT_BUCKETS).toContain("avatars");
  });

  it.each(UPSERT_BUCKETS)(
    "bucket '%s' is created by a migration",
    (bucket) => {
      expect(hasBucketDefinition(bucket)).toBe(true);
    },
  );

  it.each(UPSERT_BUCKETS)(
    "bucket '%s' has a SELECT-capable policy (required for upsert)",
    (bucket) => {
      expect(hasSelectPolicy(bucket)).toBe(true);
    },
  );
});

// The regression, exactly as it shipped twice: a client upsert upload pointed
// at a bucket with no SELECT policy — and here, one no migration creates at
// all. `.upload(…, { upsert: true })`
// issues INSERT ... ON CONFLICT, and Postgres needs a SELECT policy to
// arbitrate the conflict, so EVERY upload fails with "new row violates
// row-level security policy". The hand-written list could not see this,
// because a bucket only entered it if someone remembered to type it.
// @mutate src/components/profile/CredentialsTab.tsx | .from("user-documents")\n          .upload(path, draft.file, { upsert: true | .from("no-such-bucket")\n          .upload(path, draft.file, { upsert: true
