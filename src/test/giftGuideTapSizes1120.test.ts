/**
 * Holiday audit D M6 (11-20): the gift guides' code Copy buttons (sidebar "Deals & codes" and the deals guide's
 * cards) and the Gift of the Day Share button are 44px tap targets: the shared Button at size "sm" (h-11), never the
 * text-sized InlineTextButton (min-h-0 p-0) or size "inline", and the Share's own CSS floor is 44px, not 32px.
 * Inventory from source: every element marked data-gift-code-copy, with a floor on how many there are.
 *
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <Button type="button" variant="ghost" size="sm" onClick={() => copy(c.code)} | <Button type="button" variant="ghost" size="inline" onClick={() => copy(c.code)}
 * @mutate src/pages/info/giftGuides/fun/GiftCountdown.tsx | .gg-today-share{flex:none;min-height:44px; | .gg-today-share{flex:none;min-height:32px;
 * @mutate src/pages/info/giftGuides/fun/GiftCountdown.tsx | <Button type="button" variant="ghost" size="sm" className="gg-today-share" | <Button type="button" variant="ghost" size="inline" className="gg-today-share"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));
/** Every JSX element carrying `attr`: its component name and its opening tag up to that attribute. */
const tagsWith = (src: string, attr: string) =>
  [...src.matchAll(new RegExp(attr, "g"))].map((m) => {
    const start = src.lastIndexOf("<", m.index);
    const tag = src.slice(start, m.index! + attr.length);
    return { name: /^<([A-Za-z]\w*)/.exec(tag)?.[1] ?? "", tag };
  });

describe("gift guide copy and share buttons are 44px tap targets (holiday audit D M6)", () => {
  it("every code Copy button is the shared Button at size sm", () => {
    const tags = ["src/pages/info/giftGuides/GiftGuidesSidebar.tsx", "src/pages/info/giftGuides/GiftGuideDeals.tsx"].flatMap((f) => tagsWith(read(f), "data-gift-code-copy"));
    expect(tags.length).toBeGreaterThan(1);
    for (const t of tags) {
      expect(t.name, t.tag).toBe("Button");
      expect(t.tag, t.tag).toContain('size="sm"');
    }
    for (const f of ["src/pages/info/giftGuides/GiftGuidesSidebar.tsx", "src/pages/info/giftGuides/GiftGuideDeals.tsx"]) expect(read(f), f).not.toContain("InlineTextButton");
  });

  it("the Gift of the Day Share is size sm with a 44px floor", () => {
    const src = readFileSync(join(ROOT, "src/pages/info/giftGuides/fun/GiftCountdown.tsx"), "utf8");
    const [share] = tagsWith(blankComments(src), "data-gift-gotd-share");
    expect(share?.name).toBe("Button");
    expect(share.tag).toContain('size="sm"');
    const rule = src.match(/\.gg-today-share\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/min-height:44px/);
  });
});
