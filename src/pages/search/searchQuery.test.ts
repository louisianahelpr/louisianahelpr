// Board 89: /search matches the typed words literally.
// @mutate src/pages/search/searchQuery.ts | .replace(/\*/g, " ") | .replace(/\*/g, "*")
import { describe, it, expect } from "vitest";
import { likePattern } from "./searchQuery";

describe("likePattern", () => {
  it("wraps the words and escapes LIKE wildcards", () => {
    expect(likePattern(" chair ")).toBe("%chair%");
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
  it("neutralises PostgREST's * wildcard (it has no escape)", () => {
    expect(likePattern("ch*ir")).not.toContain("*");
    expect(likePattern("*")).toBe("% %");
  });
});
