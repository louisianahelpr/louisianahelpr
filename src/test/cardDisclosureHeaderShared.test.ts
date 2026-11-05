/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): a settings card that folds its form away
 * opens and closes on the shared CardDisclosureHeader (src/components/ui/CardDisclosureHeader.tsx), never a hand-made
 * <button aria-expanded>. Moved in this packet, markup byte-identical in 12 states (renderToStaticMarkup, harness
 * ~/.lh-shots/b1-q2709disclosure): Declutter's "I can deliver" (SellerDeliverySettings) and "Police spot meetup times"
 * (MeetupTimesCard). The hand-made ratchet lost both files' entries in the same commit.
 *
 * @mutate src/components/declutter/SellerDeliverySettings.tsx | <CardDisclosureHeader icon={Truck} title="I can deliver" open={open} | <CardDisclosureHeader icon={Truck} title="I can deliver" open={false}
 * @mutate src/components/declutter/MeetupTimesCard.tsx | onToggle={toggle} disabled={saved.isLoading} | onToggle={toggle}
 * @mutate src/components/ui/CardDisclosureHeader.tsx | aria-expanded={open} disabled={disabled} | disabled={disabled}
 * @mutate src/components/ui/CardDisclosureHeader.tsx | className="flex w-full min-h-11 items-center | className="flex w-full items-center
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));
const CARDS: Array<[file: string, title: string, extra: RegExp | null]> = [
  ["src/components/declutter/SellerDeliverySettings.tsx", "I can deliver", null],
  ["src/components/declutter/MeetupTimesCard.tsx", "Police spot meetup times", /disabled=\{saved\.isLoading\}/],
];

describe("folding settings cards open on the shared CardDisclosureHeader (Q2709)", () => {
  it("each card's header is a CardDisclosureHeader driven by its own open state", () => {
    expect(CARDS.length).toBeGreaterThan(1);
    for (const [file, title, extra] of CARDS) {
      const src = read(file);
      const tag = [...src.matchAll(/<CardDisclosureHeader\b[\s\S]*?\/>/g)].map((m) => m[0]).find((t) => t.includes(`title="${title}"`));
      expect(tag, `${file}: the header is not a CardDisclosureHeader`).toBeDefined();
      expect(tag!, file).toMatch(/open=\{open\}/);
      if (extra) expect(tag!, file).toMatch(extra);
      expect(src, `${file}: a hand-made aria-expanded <button> is back`).not.toMatch(/<button\b[^>]*aria-expanded/);
    }
  });
  it("the shared header is a 44px+ row that says aria-expanded and turns its chevron", () => {
    const ui = read("src/components/ui/CardDisclosureHeader.tsx");
    expect(ui).toContain("aria-expanded={open}");
    expect(ui).toMatch(/className="flex w-full min-h-11 items-center[^"]*text-left"/);
    expect(ui).toContain('${open ? "rotate-180" : ""}');
  });
});
