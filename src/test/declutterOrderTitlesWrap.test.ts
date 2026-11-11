/**
 * Audit 1110 F408 (Low, Orders with Bigger text on): offer and order titles cut off with "…" in 6 places at 375 with
 * Bigger text ("SEED TEST Throw pillows (p…"). The order card's head (OrderCardHead) and the offer row's title
 * (DeclutterOffersSection) wrap to two lines (line-clamp-2, break-words) instead of a one-line ellipsis (truncate).
 *
 * @mutate src/components/declutter/OrderCardHead.tsx |         <p className="line-clamp-2 break-words text-ds-15 font-semibold leading-snug" title={title}>{title}</p> |         <p className="truncate text-ds-15 font-semibold" title={title}>{title}</p>
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | className="line-clamp-2 break-words block text-ds-15 font-semibold leading-snug" title={o.item_title}> | className="text-ds-15 font-semibold truncate block" title={o.item_title}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(__dirname, "..", "..", f), "utf8");

describe("F408: Declutter order and offer titles wrap to two lines, never an ellipsis", () => {
  it("the order card's title is line-clamp-2 break-words, not truncate", () => {
    const src = read("src/components/declutter/OrderCardHead.tsx");
    const m = src.match(/<p className="([^"]*)" title=\{title\}>\{title\}<\/p>/);
    expect(m, "order title element").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("line-clamp-2");
    expect(cls).toContain("break-words");
    expect(cls).not.toContain("truncate");
  });

  it("the offer row's title link is line-clamp-2 break-words, not truncate", () => {
    const src = read("src/components/declutter/DeclutterOffersSection.tsx");
    const m = src.match(/<Link to=\{`\/declutter\/item\/\$\{o\.item_id\}`\} className="([^"]*)" title=\{o\.item_title\}>/);
    expect(m, "offer title link").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("line-clamp-2");
    expect(cls).toContain("break-words");
    expect(cls).not.toContain("truncate");
  });
});
