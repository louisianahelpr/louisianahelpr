/**
 * Audit 11-10 W2 F305: the "Pick up your draft" card said only "Continue the request you saved earlier", never which
 * draft. It now leads with the draft's title and price. (The Discard link from the same finding is not built here.)
 *
 * @mutate src/pages/post-job/EntryChoice.tsx | if (!title) return line; | return line;
 */
import { describe, expect, it } from "vitest";
import { draftCardLine } from "@/pages/post-job/EntryChoice";

const LINE = "Continue the request you saved earlier.";

describe("F305: the draft card names the draft", () => {
  it("leads with the title and price", () => {
    expect(draftCardLine({ title: "Clean the kitchen", budget: "45" }, LINE)).toBe(`Clean the kitchen · $45. ${LINE}`);
  });
  it("a draft without a price shows the title alone; a non-number adds nothing", () => {
    expect(draftCardLine({ title: "Clean the kitchen", budget: "" }, LINE)).toBe(`Clean the kitchen. ${LINE}`);
    expect(draftCardLine({ title: " Mow ", budget: "abc" }, LINE)).toBe(`Mow. ${LINE}`);
  });
  it("an untitled draft keeps the plain line", () => {
    expect(draftCardLine({ title: "  ", budget: "45" }, LINE)).toBe(LINE);
  });
});
