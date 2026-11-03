/**
 * Q1088 helpers: the form's one text box splits into feedback + tags, readers rebuild the same text, and both sides
 * fall back cleanly while the tags column is not deployed yet.
 *
 * @mutate src/lib/reviewTags.ts |   return { feedback: prose, tags: [...new Set(tags)] }; |   return { feedback: text.trim() \|\| null, tags: [...new Set(tags)] };
 * @mutate src/lib/reviewTags.ts |   if (!tags \|\| tags.length === 0) return feedback ?? null; |   if (!tags) return feedback ?? null;
 * @mutate src/lib/reviewTags.ts |   if (first.error && isNotDeployedYet(first.error)) return (await without()) as unknown as T; |   if (first.error) return (await without()) as unknown as T;
 * @mutate src/lib/reviewTags.ts |   if (first.error && isNotDeployedYet(first.error)) return run({ feedback: text.trim() \|\| null }); |   if (first.error && isNotDeployedYet(first.error)) return run({ feedback: text.trim() \|\| null, tags: [] });
 */
import { describe, expect, it, vi } from "vitest";
import { ALL_QUICK_TAGS, insertReviewWithTags, reviewSubmitFields, reviewText, withReviewTags } from "./reviewTags";

describe("reviewSubmitFields / reviewText", () => {
  it("splits the trailing picked tags from the prose", () => {
    expect(reviewSubmitFields("Came early, cleaned up., On time, Great work")).toEqual({
      feedback: "Came early, cleaned up.",
      tags: ["On time", "Great work"],
    });
    expect(reviewSubmitFields("On time, Friendly")).toEqual({ feedback: null, tags: ["On time", "Friendly"] });
    expect(reviewSubmitFields("  Nice work.  ")).toEqual({ feedback: "Nice work.", tags: [] });
    expect(reviewSubmitFields("")).toEqual({ feedback: null, tags: [] });
    // a tag word inside the prose stays prose
    expect(reviewSubmitFields("On time, but the gate was left open.")).toEqual({ feedback: "On time, but the gate was left open.", tags: [] });
    expect(reviewSubmitFields("Good., On time, On time")).toEqual({ feedback: "Good.", tags: ["On time"] });
  });

  it("every tag it writes is one the CHECK allows", () => {
    const all = `Ok., ${ALL_QUICK_TAGS.join(", ")}`;
    expect(reviewSubmitFields(all).tags.every((t) => ALL_QUICK_TAGS.includes(t))).toBe(true);
  });

  it("reviewText rebuilds exactly what the form used to store", () => {
    for (const typed of ["Came early, cleaned up., On time, Great work", "On time, Friendly", "Nice work.", "Good., Would hire again"]) {
      const { feedback, tags } = reviewSubmitFields(typed);
      expect(reviewText(feedback, tags)).toBe(typed);
    }
    // old rows: no tags column value, the text already holds them
    expect(reviewText("Great job., On time", [])).toBe("Great job., On time");
    expect(reviewText("Great job., On time", undefined)).toBe("Great job., On time");
    expect(reviewText(null, [])).toBeNull();
  });
});

describe("deploy-lag fallbacks", () => {
  const missing = { data: null, error: { code: "42703", message: 'column reviews.tags does not exist' } };
  it("withReviewTags reruns without tags only when the column is missing", async () => {
    const without = vi.fn(async () => ({ data: [{ feedback: "x" }], error: null }));
    expect(await withReviewTags(async () => missing, without)).toEqual({ data: [{ feedback: "x" }], error: null });
    const denied = { data: null, error: { code: "42501", message: "permission denied" } };
    const without2 = vi.fn(async () => ({ data: [], error: null }));
    expect(await withReviewTags(async () => denied, without2)).toBe(denied);
    expect(without2).not.toHaveBeenCalled();
  });

  it("insertReviewWithTags sends tags, and the old joined text when the column is missing", async () => {
    const seen: unknown[] = [];
    await insertReviewWithTags("Nice., On time", async (f) => (seen.push(f), { error: null }));
    expect(seen).toEqual([{ feedback: "Nice.", tags: ["On time"] }]);
    seen.length = 0;
    await insertReviewWithTags("Nice., On time", async (f) => (seen.push(f), seen.length === 1 ? missing : { error: null }));
    expect(seen).toEqual([{ feedback: "Nice.", tags: ["On time"] }, { feedback: "Nice., On time" }]);
  });
});
