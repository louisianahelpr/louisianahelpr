/*
 * CLASS GUARD: a storage bucket must not outlive the feature it was built for.
 *
 * Found 2026-09-21 by an owner question ("I thought we got rid of intro
 * videos?"). The helper intro-video feature was removed in two steps — the UI,
 * then 20260827120000, which dropped the three `profiles.intro_video_*`
 * columns and rebuilt `get_safe_profiles` without them. Neither step touched
 * storage, so on prod the `profile-videos` bucket was still there: PUBLIC
 * (anon-readable), INSERT open to any authenticated account, 30 MB per file,
 * for a feature with no UI, no moderation and nothing that would ever surface
 * what landed in it. `social-posts` was the same shape, milder (admin-only
 * INSERT). Both dropped by 20260921212141.
 *
 * WHY A NAIVE REFERENCE CHECK WOULD HAVE MISSED IT, which is the whole point
 * of this file: `profile-videos` WAS referenced in the repo — by
 * `accountPurge.ts`, which lists every bucket to purge when an account is
 * deleted. Cleanup code names a bucket precisely BECAUSE it may hold junk, so
 * counting it as "in use" makes the guard blindest exactly where a bucket has
 * been abandoned. Cleanup-only references are therefore excluded below, and
 * that exclusion is the load-bearing line here.
 *
 * The inventory is the migrations' final state (the same source of truth
 * `storageBucketLimits.test.ts` replays), not a hand-typed list.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = resolve(ROOT, "supabase", "migrations");

/**
 * Files whose mention of a bucket is CLEANUP, not use. A bucket named only
 * here is an orphan being tidied up, not a feature.
 */
const CLEANUP_ONLY = [
  "supabase/functions/_shared/accountPurge.ts",
  "supabase/functions/_shared/jobMedia.ts",
];

/** Buckets with no in-repo caller BY DESIGN, each with a reason. */
const EXTERNALLY_USED: Record<string, string> = {};

/** Replay every INSERT/DELETE against storage.buckets in timestamp order. */
function declaredBuckets(): string[] {
  const live = new Set<string>();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), "utf8");
    for (const m of sql.matchAll(
      /insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*([\s\S]*?)(?:on\s+conflict|;)/gi,
    )) {
      for (const q of m[1].matchAll(/'([a-z0-9][a-z0-9-]*)'/gi)) live.add(q[1]);
    }
    /*
     * A later migration may remove one; honour that or every dropped bucket
     * would be reported forever.
     *
     * BOTH forms. This originally matched only `WHERE id = 'x'`, and then
     * 20260921212141 was rewritten to delete three buckets with `WHERE id IN
     * (...)` — inside a DO block, because storage.protect_delete() requires
     * its GUC escape hatch. The replay stopped seeing the deletions and this
     * guard went red on main against buckets that were already gone from prod.
     * A parser that silently understands one spelling of the thing it grades
     * is the same failure as a hand-written list.
     */
    for (const m of sql.matchAll(
      /delete\s+from\s+storage\.buckets\s+where\s+id\s*=\s*'([^']+)'/gi,
    )) {
      live.delete(m[1]);
    }
    for (const m of sql.matchAll(
      /delete\s+from\s+storage\.buckets\s+where\s+id\s+in\s*\(([^)]*)\)/gi,
    )) {
      for (const q of m[1].matchAll(/'([^']+)'/g)) live.delete(q[1]);
    }
  }
  return [...live].sort();
}

const BUCKETS = declaredBuckets();

const CODE_FILES = execFileSync("git", ["ls-files", "src", "supabase/functions"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter((f) => !CLEANUP_ONLY.includes(f));

/** Files that genuinely USE the bucket (cleanup files already excluded). */
function usersOf(bucket: string): string[] {
  return CODE_FILES.filter((f) => {
    const src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
    return src.includes(`"${bucket}"`) || src.includes(`'${bucket}'`);
  });
}

describe("no orphaned storage buckets", () => {
  it("the migration replay actually found the buckets (an empty inventory passes vacuously)", () => {
    expect(BUCKETS.length).toBeGreaterThanOrEqual(6);
    expect(BUCKETS).toContain("avatars");
    expect(BUCKETS).toContain("job-photos");
  });

  it("the cleanup-only exclusion list points at real files", () => {
    // If one of these is renamed, the exclusion silently stops applying and
    // this guard quietly goes blind in the one way that matters.
    for (const f of CLEANUP_ONLY) {
      expect(() => readFileSync(resolve(ROOT, f), "utf8"), `${f} no longer exists`).not.toThrow();
    }
  });

  it.each(BUCKETS)("bucket '%s' is used by feature code, not just cleanup code", (bucket) => {
    if (EXTERNALLY_USED[bucket]) return;
    expect(
      usersOf(bucket),
      `No file in src/ or supabase/functions/ uses the '${bucket}' bucket, ignoring ` +
        `cleanup-only files (${CLEANUP_ONLY.join(", ")}).\n\n` +
        `A bucket whose feature was deleted keeps its policies: it stays writable, and if it is ` +
        `public it stays world-readable, for something no one can see or moderate. That is how ` +
        `'profile-videos' survived the intro-video removal.\n\n` +
        `Either delete the bucket in a migration, or add it to EXTERNALLY_USED with the reason ` +
        `it has no in-repo caller.`,
    ).not.toEqual([]);
  });
});

// Proof this is able to fail: re-create a bucket for a feature that no code
// uses. The migration replay picks it up and no non-cleanup file names it.
// @mutate supabase/migrations/20260921212141_drop_orphaned_profile_videos_bucket.sql | WHERE id IN ('profile-videos', 'social-posts', 'business-documents'); | WHERE id IN ('social-posts', 'business-documents');
