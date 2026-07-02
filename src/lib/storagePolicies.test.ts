// Guard for the "upsert upload to a bucket with no SELECT policy" bug class.
//
// supabase-js `.upload(path, file, { upsert: true })` issues
// INSERT ... ON CONFLICT, and Postgres requires the row to satisfy a SELECT
// policy to arbitrate the conflict. A bucket that receives upsert uploads but
// has ZERO SELECT-capable policy therefore fails EVERY client upload with
// "new row violates row-level security policy" — this shipped twice (the
// avatars "Enter app" blocker, then the profile-videos intro-video upload,
// whose bucket didn't exist at all). These tests statically assert that every
// bucket the client upserts into is backed by a migration that both creates
// the bucket and grants it a SELECT (or ALL) policy.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = resolve(ROOT, "supabase/migrations");

// Buckets the client uploads to with `{ upsert: true }`. Derived from
// `grep -rn "upsert:\s*true" src` — keep in sync when a new upsert upload is
// added (a bucket here without a SELECT policy is the exact regression).
const UPSERT_BUCKETS = [
  "avatars",
  "business-documents",
  "id-documents",
  "job-photos",
  "profile-videos",
  "user-documents",
] as const;

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
