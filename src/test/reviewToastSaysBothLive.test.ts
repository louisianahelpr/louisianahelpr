/**
 * Audit A2-C34 (2026-10-29): the second reviewer was told "It goes live once they review you too" when both
 * reviews had just gone live. set_review_visibility() is an AFTER INSERT trigger, so the insert's RETURNING never
 * sees feedback_visible_at; ReviewForm now reads the reviewer's own row once and says "Your reviews are both live
 * now." when the trigger revealed it (now()), keeping the held wording when it was held (now() + 14 days) or the
 * read failed.
 *
 * @mutate src/components/reviewPanel/reviewLiveNow.ts |   return !Number.isNaN(at) && at < nowMs + DAY_MS; |   return !Number.isNaN(at);
 * @mutate src/components/reviewPanel/ReviewForm.tsx |       if (await reviewIsLiveNow(inserted[0].id)) { |       if (false) {
 * @mutate src/components/reviewPanel/reviewLiveNow.ts |   if (error \|\| !data) return false; |   if (error \|\| !data) return true;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, calls: [] as Array<[string, unknown]> }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: (cols: string) => { read.calls.push(["select", cols]); return chain; },
    eq: (col: string, v: unknown) => { read.calls.push([`eq:${col}`, v]); return chain; },
    maybeSingle: async () => read.result,
  };
  return { supabase: { from: (t: string) => { read.calls.push(["from", t]); return chain; } } };
});

import { isLiveNow, reviewIsLiveNow } from "@/components/reviewPanel/reviewLiveNow";

const NOW = Date.parse("2026-10-29T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  read.calls = [];
  read.result = { data: null, error: null };
});

describe("isLiveNow: the trigger's two stamps", () => {
  it("revealed (now(), or a server clock a little ahead of this device) is live", () => {
    expect(isLiveNow(iso(NOW), NOW)).toBe(true);
    expect(isLiveNow(iso(NOW - 5_000), NOW)).toBe(true);
    expect(isLiveNow(iso(NOW + 90_000), NOW)).toBe(true);
  });
  it("held (now() + 14 days), unstamped, or unreadable is not", () => {
    expect(isLiveNow(iso(NOW + 14 * 86_400_000), NOW)).toBe(false);
    expect(isLiveNow(null, NOW)).toBe(false);
    expect(isLiveNow(undefined, NOW)).toBe(false);
    expect(isLiveNow("not a date", NOW)).toBe(false);
  });
});

describe("reviewIsLiveNow reads the reviewer's own row once", () => {
  it("reads reviews.feedback_visible_at by the new review's id", async () => {
    read.result = { data: { feedback_visible_at: new Date().toISOString() }, error: null };
    expect(await reviewIsLiveNow("rev-1")).toBe(true);
    expect(read.calls).toEqual([["from", "reviews"], ["select", "feedback_visible_at"], ["eq:id", "rev-1"]]);
  });
  it("a held review answers false", async () => {
    read.result = { data: { feedback_visible_at: new Date(Date.now() + 14 * 86_400_000).toISOString() }, error: null };
    expect(await reviewIsLiveNow("rev-1")).toBe(false);
  });
  it("a failed or empty read answers false (keeps the held wording, never claims it is public)", async () => {
    read.result = { data: null, error: { message: "boom" } };
    expect(await reviewIsLiveNow("rev-1")).toBe(false);
    read.result = { data: null, error: null };
    expect(await reviewIsLiveNow("rev-1")).toBe(false);
  });
});

describe("ReviewForm says which", () => {
  const src = blankComments(readFileSync(resolve(__dirname, "../components/reviewPanel/ReviewForm.tsx"), "utf8"));
  it("asks after the insert, with the inserted id, and picks the toast from the answer", () => {
    expect(src).toMatch(/if \(await reviewIsLiveNow\(inserted\[0\]\.id\)\) \{\s*confirmConsequential\("Your reviews are both live now\."\);\s*\} else \{\s*confirmConsequential\(\s*"Review posted\. It goes live once they review you too/);
  });
  it("the held wording is said only in the else branch (one site)", () => {
    expect(src.match(/It goes live once they review you too/g)).toHaveLength(1);
  });
});
