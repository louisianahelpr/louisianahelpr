/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the Handover talk's "Add porch pickup to
 * {title}" row is the shared <Button variant="outline">, never a hand-made <button>. Its label carries the listing's
 * own title, so it takes the shared size `wrapSm` (`sm` that grows: h-auto, min-h-11, whitespace-normal) and stays
 * left-aligned: a long title wraps inside the pill at 375 instead of running past its edge (Button's base is
 * whitespace-nowrap). The hand-made ratchet lost the file's entry in the same commit.
 *
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx | <Button type="button" variant="outline" size="wrapSm" | <Button type="button" variant="outline" size="sm"
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx | size="wrapSm" className="w-full max-w-full justify-start text-left font-semibold" | size="wrapSm" className="w-full max-w-full font-semibold"
 * @mutate src/components/ui/button.tsx | wrapSm: "h-auto min-h-11 px-4 py-2 text-ds-14 whitespace-normal", | wrapSm: "h-11 px-4 py-2 text-ds-14",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));
const talk = read("src/components/declutter/DeclutterHandoverTalk.tsx");
const button = read("src/components/ui/button.tsx");

describe("Handover's add-porch row is the shared Button (Q2709)", () => {
  it("is an outline Button in the growing small size, left-aligned, with its busy guard", () => {
    const tags = [...talk.matchAll(/<Button\b[^>]*>[\s\S]*?<\/Button>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    const row = tags.find((t) => t.includes("Add porch pickup to {i.title}"));
    expect(row, "the add-porch row is not a shared Button").toBeDefined();
    expect(row!).toMatch(/variant="outline"/);
    expect(row!).toMatch(/size="wrapSm"/);
    expect(row!).toMatch(/\btext-left\b/);
    expect(row!).toContain("disabled={add.isPending}");
    expect(talk, "a hand-made <button> is back").not.toMatch(/<button\b/);
  });
  it("wrapSm grows instead of clipping: no fixed height, wraps", () => {
    const m = /wrapSm: "([^"]+)"/.exec(button);
    expect(m, "Button has no wrapSm size").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["h-auto", "min-h-11", "whitespace-normal"]));
    expect(cls.filter((c) => /^h-(\d|\[)/.test(c))).toEqual([]);
  });
});
