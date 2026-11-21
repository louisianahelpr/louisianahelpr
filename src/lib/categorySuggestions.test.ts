/**
 * "Suggest a category" (I1): the form refuses the same drafts the server refuses, the three calls send the trimmed
 * values under the server's argument names, and a refusal carries plain words for the member.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string; code?: string } | null };
const calls: Array<[string, unknown]> = [];
let next: Result = { data: null, error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return next; } },
}));
vi.mock("@/lib/lifecycleErrors", () => ({
  rpcErrorMessage: (fn: string) => `member words for ${fn}`,
  loadAdminRpcErrorCopy: async () => ({ rpcErrorMessage: (fn: string) => `admin words for ${fn}` }),
}));

import {
  SUGGESTION_MAX, fetchCategorySuggestions, reviewCategorySuggestion, suggestCategory, suggestionErrorMessage, suggestionProblem,
} from "./categorySuggestions";

beforeEach(() => {
  calls.length = 0;
  next = { data: null, error: null };
});

describe("suggestionProblem", () => {
  it.each(["Pressure washing", "  Pet   sitting  ", "Arts & crafts", "Mom's helpers (weekends)", "A1"])("takes %j", (text) => {
    expect(suggestionProblem(text)).toBeNull();
  });
  it("asks for at least two letters", () => {
    expect(suggestionProblem(" a ")).toBe("Type at least 2 letters.");
    expect(suggestionProblem("")).toBe("Type at least 2 letters.");
  });
  it("holds the length to the server's limit, counted after spaces collapse", () => {
    expect(suggestionProblem("a".repeat(SUGGESTION_MAX))).toBeNull();
    expect(suggestionProblem(`${"a".repeat(SUGGESTION_MAX - 1)}    b`)).toBe("Keep it under 41 characters.");
    expect(suggestionProblem("a".repeat(SUGGESTION_MAX + 1))).toBe("Keep it under 41 characters.");
  });
  it.each(["1 day jobs", "Call 337 555 0100", "Visit mysite.com", "Crafts <b>", "Jobs @ home"])("refuses %j", (text) => {
    expect(suggestionProblem(text)).toBe("Start with a letter. No links or contact details.");
  });
});

describe("the three calls", () => {
  it("suggestCategory sends the trimmed suggestion and returns the new row's id", async () => {
    next = { data: "s1", error: null };
    expect(await suggestCategory("declutter", "  Vintage toys ")).toBe("s1");
    expect(calls).toEqual([["suggest_category", { p_area: "declutter", p_suggestion: "Vintage toys" }]]);
  });
  it("a refused suggestion throws with the member's words", async () => {
    next = { data: null, error: { message: "suggestion_exists" } };
    const err = await suggestCategory("jobs", "Lawn care").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(suggestionErrorMessage(err)).toBe("member words for suggest_category");
  });
  it("fetchCategorySuggestions lists by status, and an empty answer is an empty list", async () => {
    const row = { id: "s1", area: "shops", suggestion: "Candles", status: "pending", created_at: "2026-10-15T00:00:00Z", suggester_name: null, same_count: 2, reviewed_at: null, admin_note: null };
    next = { data: [row], error: null };
    expect(await fetchCategorySuggestions("pending")).toEqual([row]);
    next = { data: null, error: null };
    expect(await fetchCategorySuggestions("approved")).toEqual([]);
    expect(calls).toEqual([
      ["admin_list_category_suggestions", { p_status: "pending" }],
      ["admin_list_category_suggestions", { p_status: "approved" }],
    ]);
  });
  it("a refused list throws with the admin's words", async () => {
    next = { data: null, error: { message: "admin_only" } };
    const err = await fetchCategorySuggestions("pending").catch((e: unknown) => e);
    expect(suggestionErrorMessage(err)).toBe("admin words for admin_list_category_suggestions");
  });
  it("reviewCategorySuggestion sends the trimmed note, or none when it is blank", async () => {
    next = { data: 3, error: null };
    expect(await reviewCategorySuggestion("s1", true, "  Good idea ")).toBe(3);
    await reviewCategorySuggestion("s2", false, "   ");
    await reviewCategorySuggestion("s3", false, null);
    expect(calls).toEqual([
      ["admin_review_category_suggestion", { p_id: "s1", p_approve: true, p_note: "Good idea" }],
      ["admin_review_category_suggestion", { p_id: "s2", p_approve: false, p_note: undefined }],
      ["admin_review_category_suggestion", { p_id: "s3", p_approve: false, p_note: undefined }],
    ]);
  });
  it("a refused review throws with the admin's words", async () => {
    next = { data: null, error: { message: "already_reviewed" } };
    const err = await reviewCategorySuggestion("s1", true, null).catch((e: unknown) => e);
    expect(suggestionErrorMessage(err)).toBe("admin words for admin_review_category_suggestion");
  });
});

describe("suggestionErrorMessage", () => {
  it("falls back to the connection words for anything without its own", () => {
    const fallback = "Couldn't do that just now. Check your connection and try again.";
    expect(suggestionErrorMessage(new Error("boom"))).toBe(fallback);
    expect(suggestionErrorMessage(null)).toBe(fallback);
    expect(suggestionErrorMessage({ userMessage: "" })).toBe(fallback);
    expect(suggestionErrorMessage({ userMessage: 7 })).toBe(fallback);
  });
});
