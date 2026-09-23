/*
 * Q219 CLASS GUARD: every bucket a deletion path names must exist, and a
 * missing bucket must fail the deletion instead of reading as "empty".
 *
 * Measured by the Q196 silent-failure review: a service-role Storage list of a
 * bucket that does not exist answers [] with HTTP 200. So a dropped or
 * misspelled name in a purge list made account deletion report `storage ok`
 * while erasing nothing there, and the re-list verification saw the same
 * nothing. `profile-videos` was dropped by 20260921212141 and still sat in two
 * of these lists (storageOrphans.mjs USER_BUCKETS, jobMediaRest.mjs
 * userStoragePrefixes), which is how this guard was shown red.
 *
 * Two halves:
 *   1. STATIC: every bucket named by every purge/sweep list is one the
 *      migration replay still declares (the same inventory
 *      noOrphanedStorageBuckets.test.ts uses, never a hand-typed list).
 *   2. RUNTIME: the Deno purge asks Storage which buckets exist before it
 *      lists (missingBuckets), and the Node twin (removePrefixes) GETs each
 *      bucket first; each is exercised against a Storage that has no such
 *      bucket and must report a failure.
 *
 * @mutate scripts/lib/storageOrphans.mjs | ["avatars", "user-documents"] | ["avatars", "user-documents", "profile-videos"]
 * @mutate scripts/lib/jobMediaRest.mjs | "avatars", "user-documents", "application-attachments", | "avatars", "user-documents", "profile-videos", "application-attachments",
 * @mutate supabase/functions/_shared/purgeBuckets.ts | "user-documents", | "user-documents", "profile-videos",
 * @mutate supabase/functions/_shared/purgeBuckets.ts | return wanted.filter((b) => !have.has(b)); | return [];
 * @mutate scripts/lib/jobMediaRest.mjs | await call(base, headers, "GET", `/bucket/${encodeURIComponent(bucket)}`); | void 0;
 * @mutate supabase/functions/_shared/accountPurge.ts | const missing = await missingBuckets(admin, IDENTITY_BUCKETS); | const missing: string[] = [];
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { declaredBuckets } from "./helpers/declaredBuckets";
import { IDENTITY_BUCKETS, missingBuckets } from "../../supabase/functions/_shared/purgeBuckets";
import { jobMediaPrefixes as denoJobPrefixes } from "../../supabase/functions/_shared/jobMedia";
import { USER_BUCKETS, IDENTITY_DOCUMENT_BUCKETS } from "../../scripts/lib/storageOrphans.mjs";
import {
  jobMediaPrefixes as restJobPrefixes,
  removePrefixes,
  userStoragePrefixes,
} from "../../scripts/lib/jobMediaRest.mjs";

const ROOT = resolve(__dirname, "..", "..");
const DECLARED = declaredBuckets();
const U = "76b07824-9b41-4741-a4c4-4f8de362f682";
const J = "fde2605b-1111-4111-8111-111111111111";
const JOB = { id: J, customer_id: U, helper_id: U };

/** Every list a deletion or sweep path acts on, by where it lives. */
const LISTS: Record<string, readonly string[]> = {
  "purgeBuckets.ts IDENTITY_BUCKETS (account deletion)": IDENTITY_BUCKETS,
  "storageOrphans.mjs USER_BUCKETS (weekly orphan sweep)": USER_BUCKETS,
  "storageOrphans.mjs IDENTITY_DOCUMENT_BUCKETS": IDENTITY_DOCUMENT_BUCKETS,
  "jobMediaRest.mjs userStoragePrefixes (seed/E2E teardown)": userStoragePrefixes(U).map((p) => p.bucket),
  "jobMediaRest.mjs jobMediaPrefixes": restJobPrefixes(JOB).map((p) => p.bucket),
  "jobMedia.ts jobMediaPrefixes (deleted jobs)": denoJobPrefixes(JOB).map((p) => p.bucket),
};

afterEach(() => vi.unstubAllGlobals());

describe("Q219: purge and sweep bucket lists name only buckets that exist", () => {
  it("the inventories are real (an empty list passes vacuously)", () => {
    expect(DECLARED.length).toBeGreaterThan(5);
    const named = new Set(Object.values(LISTS).flat());
    expect(named.size).toBeGreaterThan(5);
  });

  it.each(Object.entries(LISTS))("%s names only declared buckets", (_where, buckets) => {
    const gone = [...new Set(buckets)].filter((b) => !DECLARED.includes(b));
    expect(
      gone,
      `These buckets are not declared by the migration replay (dropped, or never created). ` +
        `Storage answers a list of a missing bucket with [] and HTTP 200, so a deletion over ` +
        `them reports success while erasing nothing. Remove them from the list.`,
    ).toEqual([]);
  });
});

describe("Q219: a missing bucket fails the deletion", () => {
  it("missingBuckets names every wanted bucket Storage does not have", async () => {
    const admin = { storage: { listBuckets: async () => ({ data: [{ id: "avatars", name: "avatars" }], error: null }) } };
    expect(await missingBuckets(admin, IDENTITY_BUCKETS)).toEqual(
      IDENTITY_BUCKETS.filter((b) => b !== "avatars"),
    );
  });

  it("missingBuckets throws when Storage cannot be asked (never 'none missing')", async () => {
    const admin = { storage: { listBuckets: async () => ({ data: null, error: { message: "boom" } }) } };
    await expect(missingBuckets(admin, IDENTITY_BUCKETS)).rejects.toThrow(/boom/);
  });

  it("the account purge checks bucket existence and no longer skips 'not found'", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/_shared/accountPurge.ts"), "utf8"));
    const start = src.indexOf("async function purgeIdentityStorage(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toMatch(/await\s+missingBuckets\(\s*admin\s*,\s*IDENTITY_BUCKETS\s*\)/);
    expect(body, "a 'not found → continue' branch turns a missing bucket back into a clean purge").not.toMatch(
      /\/[^/\n]*(?:not found|does not exist)[^/\n]*\/i?\.test\(/,
    );
  });

  it("removePrefixes reports a failure for a bucket Storage does not have", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { method: string }) => {
      calls.push(`${init.method} ${url}`);
      // Exactly what Storage does: the bucket GET 400s, but a list of the
      // same missing bucket answers [] with 200.
      if (init.method === "GET") return new Response('{"error":"Bucket not found"}', { status: 400 });
      return new Response("[]", { status: 200 });
    });
    const out = await removePrefixes({
      base: "https://example.test",
      headers: {},
      prefixes: [{ bucket: "no-such-bucket", prefix: U }],
      source: "test",
    });
    expect(calls.some((c) => c.startsWith("GET ") && c.endsWith("/bucket/no-such-bucket"))).toBe(true);
    expect(out.failures.join(" ")).toMatch(/no-such-bucket/);
  });
});
