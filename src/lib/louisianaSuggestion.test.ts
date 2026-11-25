/**
 * Deep audit 11-22 #25: address search drops out-of-state suggestions before listing them.
 * @mutate src/lib/louisianaSuggestion.ts |     if (OTHER_STATE_CODES.has(m[1])) return false; |     if (OTHER_STATE_CODES.has(m[1])) continue;
 * @mutate src/lib/louisianaSuggestion.ts |   if (OTHER_STATE_NAME.test(place)) return false; |   if (false) return false;
 */
import { describe, expect, it } from "vitest";
import { isLouisianaSuggestion } from "./louisianaSuggestion";

describe("isLouisianaSuggestion", () => {
  it.each([
    [["200 Jefferson St", "Lafayette, LA 70501, United States"]],
    [["200 Jefferson St", "Lafayette, LA, United States"]],
    [["Washington", "Washington, LA 70589"]],
    [["Baton Rouge", "LA"]],
    [["123 Main St", "Baton Rouge, Louisiana"]],
    [["Some Place"]],
    [["9 Elm St", "Dallas"]],
  ])("keeps %j", (lines) => expect(isLouisianaSuggestion(lines)).toBe(true));

  it.each([
    [["200 Jefferson St", "Lafayette, OR 97127, United States"]],
    [["200 Jefferson St", "Lafayette, IN, United States"]],
    [["9 Elm St", "Dallas, TX"]],
    [["1 Beach Blvd", "Biloxi, Mississippi, United States"]],
    [["Lafayette", "Lafayette, Oregon"]],
    [["Rue Jefferson", "Montréal, Canada"]],
  ])("drops %j", (lines) => expect(isLouisianaSuggestion(lines)).toBe(false));

  it("the state lists are complete (49 other states + DC + PR)", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/louisianaSuggestion.ts", "utf8");
    const codes = /OTHER_STATE_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(src)![1].match(/"[A-Z]{2}"/g)!;
    expect(codes.length).toBe(51);
    expect(codes).not.toContain('"LA"');
  });
});
