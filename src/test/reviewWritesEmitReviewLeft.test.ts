/*
 * CLASS GUARD: every client write to `reviews` emits review_left (Q2815).
 *
 * The defect (alert-ledger 428558972dc4, analytics-freshness, 2026-11-15):
 * review_left read 0 events against 1 real review in 7 days. Two screens write
 * a review; only ReviewForm called track(AhaEvent.ReviewLeft). CompletionPrompts
 * (the review that opens right after Done since Q2484, 2026-10-29) wrote the
 * row and emitted nothing, so it became the unmeasured main path: review
 * 59adb87b (2026-11-14 03:21Z) was written 17 s after that member's
 * job_completed {source: "activity"} and no review_left followed.
 *
 * Inventory is derived from source: every `.from("reviews")...insert(` or
 * `.upsert(` outside tests (same scan as reviewWritesUpdateActivityCache). For
 * each, the success branch (the block holding the next `hapticSuccess();`)
 * must call `trackReviewLeft(`, and no other file may emit
 * AhaEvent.ReviewLeft / FirstReviewLeft / FirstFiveStarReview directly, so a
 * new writer cannot add its own half-copy of the events.
 */

// @mutate src/components/CompletionPrompts.tsx | trackReviewLeft(jobId, rating, userId); | void rating;
// @mutate src/components/reviewPanel/ReviewForm.tsx | trackReviewLeft(jobId, rating, user.id); | void rating;
// @mutate src/lib/reviewLeftEvent.ts |   track(AhaEvent.ReviewLeft, { job_id: jobId, rating }); |   void jobId;
// @mutate src/lib/reviewLeftEvent.ts | if (!error && (count ?? 0) <= 1) | if (!error && (count ?? 0) <= 0)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const tracked = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);
const reviewCount = vi.hoisted(() => ({ n: 1 as number | null }));

vi.mock("@/lib/analytics", async (orig) => {
  const real = await orig<typeof import("@/lib/analytics")>();
  return { ...real, track: (e: string, p: Record<string, unknown>) => { tracked.push([e, p]); } };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => Promise.resolve({ count: reviewCount.n, error: null }),
  };
  return { supabase: { from: () => chain } };
});

import { trackReviewLeft } from "@/lib/reviewLeftEvent";

const root = join(__dirname, "..", "..");
const SRC = join(root, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const WRITE = /\.from\(\s*["']reviews["']\s*\)\s*\.(insert|upsert)\(/g;
interface Site { file: string; index: number; code: string }
const sites: Site[] = [];
const emitters: string[] = [];
for (const file of walk(SRC)) {
  const code = blankComments(readFileSync(file, "utf8"));
  const rel = relative(root, file);
  for (const m of code.matchAll(WRITE)) sites.push({ file: rel, index: m.index ?? 0, code });
  if (/(?<![.\w])track\(\s*AhaEvent\.(ReviewLeft|FirstReviewLeft|FirstFiveStarReview)\b/.test(code)) emitters.push(rel);
}

/** The body of the block that holds the first `hapticSuccess();` after the write. */
function successBlock(site: Site): string {
  const after = site.code.slice(site.index);
  const ok = after.search(/hapticSuccess\(\);/);
  if (ok < 0) return "";
  let depth = 0;
  for (let i = ok; i < after.length; i++) {
    if (after[i] === "{") depth++;
    else if (after[i] === "}") {
      if (depth === 0) return after.slice(ok, i);
      depth--;
    }
  }
  return after.slice(ok);
}

describe("every client review write emits review_left", () => {
  it("finds the review writers (inventory floor)", () => {
    expect(sites.length).toBeGreaterThan(1);
    expect(sites.map((s) => s.file)).toEqual(
      expect.arrayContaining(["src/components/reviewPanel/ReviewForm.tsx", "src/components/CompletionPrompts.tsx"]),
    );
  });

  it.each(sites.map((s) => [`${s.file}@${s.index}`, s] as const))(
    "%s: the success branch calls trackReviewLeft",
    (_name, site) => {
      const block = successBlock(site);
      expect(block, `${site.file}: no hapticSuccess() success branch after the review write`).not.toBe("");
      expect(block, `${site.file}: a review is written but review_left is never emitted (Q2815)`).toMatch(/(?<![.\w])trackReviewLeft\(/);
    },
  );

  it("the review events are emitted only by src/lib/reviewLeftEvent.ts", () => {
    expect(emitters).toEqual(["src/lib/reviewLeftEvent.ts"]);
  });

  it("the block scan is not vacuous: a success branch without the call is caught", () => {
    const planted = `const { data } = await supabase.from("reviews").insert(row).select("id"); if (bad) { x(); } else { hapticSuccess(); recordReviewInActivityCache(jobId); } trackReviewLeft(a, b, c);`;
    const block = successBlock({ file: "planted", index: planted.indexOf(".from("), code: planted });
    expect(block).toContain("recordReviewInActivityCache");
    expect(block).not.toMatch(/trackReviewLeft\(/);
  });
});

describe("trackReviewLeft", () => {
  beforeEach(() => { tracked.length = 0; });

  it("a first five-star review emits review_left, first_five_star_review and first_review_left", async () => {
    reviewCount.n = 1;
    trackReviewLeft("job-1", 5, "u1");
    await vi.waitFor(() => expect(tracked.map(([e]) => e)).toContain("first_review_left"));
    expect(tracked).toEqual([
      ["review_left", { job_id: "job-1", rating: 5 }],
      ["first_five_star_review", { job_id: "job-1", rating: 5 }],
      ["first_review_left", { job_id: "job-1", rating: 5 }],
    ]);
  });

  it("a later 3-star review emits only review_left", async () => {
    reviewCount.n = 4;
    trackReviewLeft("job-2", 3, "u1");
    await new Promise((r) => setTimeout(r, 0));
    expect(tracked).toEqual([["review_left", { job_id: "job-2", rating: 3 }]]);
  });
});
