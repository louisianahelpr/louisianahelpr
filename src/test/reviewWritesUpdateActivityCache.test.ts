/*
 * CLASS GUARD: every client write to `reviews` tells the activity cache, in its
 * success branch, before anything else can return.
 *
 * The defect (nightly-red #1719, e2e-journeys run 36164148002, 2026-09-25):
 * the poster's Done card never showed "Reviewed" after a 5-star review. The
 * chip reads `completedJobMeta` from the My Posts detail query, which is
 * persisted, fresh for 60s and not revalidated on mount; a review changes
 * neither its key nor anything realtime delivers. ReviewForm's 5-star + canTip
 * branch returned into the tip prompt before `onClose` (the only refresh), and
 * CompletionPrompts never refreshed at all. So the card kept offering "Review",
 * a reload repainted the persisted "Review", and pressing it said "You've
 * already reviewed this job."
 *
 * Inventory is derived from source: every `.from("reviews")...insert(` or
 * `.upsert(` outside tests. For each one, the first statement after the next
 * `hapticSuccess();` (the success branch, both writers) must be
 * `recordReviewInActivityCache(`. Then the helper itself is exercised against a
 * real QueryClient.
 *
 * AND ONLY A PROVEN ROW MAY MARK A JOB REVIEWED (lh-money-escrow review L4/L5,
 * 2026-09-25). CompletionPrompts inserted without `.select("id")`, so an
 * RLS-filtered insert ({ data: [], error: null }) took the success branch and
 * wrote "Reviewed" into the cache for a review that does not exist. So each
 * write must (a) end its chain in `.select("id")`, (b) treat an empty result as
 * a failure (`unwrapMutation(` or an explicit `.length === 0`), and (c) call
 * `recordReviewInActivityCache(` in its failure handling only inside the
 * branch that tested 23505 (the server already holds this review).
 */

// @mutate src/components/reviewPanel/ReviewForm.tsx | recordReviewInActivityCache(jobId);\n      // Brand-tinted | // Brand-tinted
// @mutate src/components/CompletionPrompts.tsx | recordReviewInActivityCache(jobId);\n\n      // Repeat low ratings | // Repeat low ratings
// @mutate src/lib/reviewActivityCache.ts | if (!old \|\| !meta \|\| meta.reviewed) return old; | return old;
// @mutate src/components/CompletionPrompts.tsx | rating, feedback: feedback.trim() \|\| null,\n          })\n          .select("id"), | rating, feedback: feedback.trim() \|\| null,\n          }),
// @mutate src/components/reviewPanel/ReviewForm.tsx | photo_urls: uploadedPhotoUrls,\n      })\n      .select("id"); | photo_urls: uploadedPhotoUrls,\n      });
// @mutate src/components/reviewPanel/ReviewForm.tsx | } else if (!error) {\n        toast.error( | } else if (!error) {\n        recordReviewInActivityCache(jobId);\n        toast.error(
// @mutate src/components/CompletionPrompts.tsx | else { hapticError(); toast.error("We couldn't submit your review — please try again."); } | else { recordReviewInActivityCache(jobId); hapticError(); toast.error("We couldn't submit your review — please try again."); }

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { recordReviewInActivityCache } from "@/lib/reviewActivityCache";
import { queryKeys } from "@/lib/queryKeys";

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
for (const file of walk(SRC)) {
  const code = blankComments(readFileSync(file, "utf8"));
  for (const m of code.matchAll(WRITE)) sites.push({ file: relative(root, file), index: m.index ?? 0, code });
}

describe("every client review write updates the activity cache", () => {
  it("finds the review writers (inventory floor)", () => {
    expect(sites.length).toBeGreaterThan(1);
    expect(sites.map((s) => s.file)).toEqual(
      expect.arrayContaining(["src/components/reviewPanel/ReviewForm.tsx", "src/components/CompletionPrompts.tsx"]),
    );
  });

  it.each(sites.map((s) => [`${s.file}@${s.index}`, s] as const))(
    "%s: the success branch records the review before anything else",
    (_name, site) => {
      const after = site.code.slice(site.index);
      const ok = after.search(/hapticSuccess\(\);/);
      expect(ok, `${site.file}: no hapticSuccess() success branch after the review write`).toBeGreaterThan(-1);
      const next = after.slice(ok + "hapticSuccess();".length).trimStart();
      expect(
        next.startsWith("recordReviewInActivityCache("),
        `${site.file}: the first statement of the success branch must be recordReviewInActivityCache(jobId); found: ${next.slice(0, 60)}`,
      ).toBe(true);
    },
  );
});

/** The statement from the write to its terminating `;` (the whole PostgREST chain). */
function writeStatement(site: Site): string {
  const after = site.code.slice(site.index);
  return after.slice(0, after.indexOf(";") + 1);
}

/**
 * From the start of the statement holding the write (so a wrapping
 * `unwrapMutation(` counts) to the success branch's `hapticSuccess();`.
 */
function failureRegion(site: Site): string {
  const before = site.code.slice(0, site.index);
  const start = Math.max(before.lastIndexOf(";"), before.lastIndexOf("{"), before.lastIndexOf("}")) + 1;
  const after = site.code.slice(start);
  const ok = after.search(/hapticSuccess\(\);/);
  return ok < 0 ? after : after.slice(0, ok);
}

/** The head of the block that immediately encloses `pos` (its `if (…)` / `else`, up to the `{`). */
function enclosingCondition(text: string, pos: number): string {
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        // The block's own head: back to the previous `}`, `;` or `{`, so a bare
        // `} else {` yields " else ", never the sibling `if` before it.
        const head = text.slice(0, i);
        const cut = Math.max(head.lastIndexOf("}"), head.lastIndexOf(";"), head.lastIndexOf("{"));
        return head.slice(cut + 1);
      }
      depth--;
    }
  }
  return "";
}

describe("only a proven review row marks a job Reviewed", () => {
  it.each(sites.map((s) => [`${s.file}@${s.index}`, s] as const))(
    "%s: the insert carries .select(\"id\") and an empty result is a failure",
    (_name, site) => {
      expect(writeStatement(site), `${site.file}: the review write has no .select("id"), so zero rows look like success`).toMatch(
        /\.select\(\s*["']id["']\s*\)/,
      );
      expect(
        failureRegion(site),
        `${site.file}: an empty insert result is not treated as a failure (unwrapMutation or .length === 0)`,
      ).toMatch(/unwrapMutation\(|\.length\s*===\s*0/);
    },
  );

  it.each(sites.map((s) => [`${s.file}@${s.index}`, s] as const))(
    "%s: no failure branch but 23505 records the review",
    (_name, site) => {
      const region = failureRegion(site);
      const calls = [...region.matchAll(/recordReviewInActivityCache\(/g)].map((m) => m.index ?? 0);
      // Both writers treat "already reviewed" as reviewed: the floor proves the scan sees them.
      expect(calls.length, `${site.file}: the 23505 branch no longer records the review`).toBeGreaterThan(0);
      for (const at of calls) {
        expect(
          enclosingCondition(region, at),
          `${site.file}: recordReviewInActivityCache is called on a failure that is not 23505`,
        ).toMatch(/23505/);
      }
    },
  );

  it("the scanner is not vacuous: a generic failure branch that records is caught", () => {
    const planted = `if (error) { if (error.code === "23505") { recordReviewInActivityCache(jobId); } else { recordReviewInActivityCache(jobId); toast.error("x"); } }`;
    const calls = [...planted.matchAll(/recordReviewInActivityCache\(/g)].map((m) => m.index ?? 0);
    expect(enclosingCondition(planted, calls[0])).toMatch(/23505/);
    expect(enclosingCondition(planted, calls[1])).not.toMatch(/23505/);
  });
});

describe("recordReviewInActivityCache", () => {
  const USER = "u1";
  const JOB = "job-1";

  it("flips the poster's Reviewed badge and the helper's reviewed set, and leaves others alone", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detailKey = queryKeys.activity.postedDetail(USER, { helperIds: [], completedIds: [JOB, "job-2"], activeIds: [], groupIds: [] });
    qc.setQueryData(detailKey, {
      helperNames: {},
      helperAvatars: {},
      completedJobMeta: { [JOB]: { tipped: false, reviewed: false }, "job-2": { tipped: false, reviewed: false } },
      latestTracking: {},
      groupHelpersByJob: {},
    });
    qc.setQueryData(queryKeys.activity.applied(USER), {
      appliedApps: [],
      declinedJobIds: new Set<string>(),
      helperReviewedJobIds: new Set<string>(),
    });

    recordReviewInActivityCache(JOB, qc);

    const detail = qc.getQueryData<{ completedJobMeta: Record<string, { reviewed: boolean; tipped: boolean }> }>(detailKey);
    expect(detail?.completedJobMeta[JOB]).toEqual({ tipped: false, reviewed: true });
    expect(detail?.completedJobMeta["job-2"]).toEqual({ tipped: false, reviewed: false });
    const applied = qc.getQueryData<{ helperReviewedJobIds: Set<string> }>(queryKeys.activity.applied(USER));
    expect(applied?.helperReviewedJobIds.has(JOB)).toBe(true);
    // Marked for revalidation, so the server's truth follows.
    expect(qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
  });

  it("does not invent meta for a job the cache does not hold", () => {
    const qc = new QueryClient();
    const detailKey = queryKeys.activity.postedDetail(USER, { helperIds: [], completedIds: [], activeIds: [], groupIds: [] });
    const before = { helperNames: {}, helperAvatars: {}, completedJobMeta: {}, latestTracking: {}, groupHelpersByJob: {} };
    qc.setQueryData(detailKey, before);
    recordReviewInActivityCache(JOB, qc);
    expect(qc.getQueryData(detailKey)).toBe(before);
  });
});
