/**
 * Buy-now links (owner 2026-11-21, pop-up choice "Amazon + Walmart Buy Now"): the Amazon add-to-cart link always
 * carries our Associates tag (louisianahelpr-20), reads the ASIN from our /dp/ links, numbers several items ASIN.1,
 * ASIN.2 ... each with Quantity 1 and each once, and is null when nothing on the list is from Amazon. Walmart is not
 * built (no official buy-now format confirmed): no Walmart cart link exists.
 *
 * @mutate src/lib/retailerCart.ts |   const q = new URLSearchParams({ AssociateTag: AMAZON_TAG }); |   const q = new URLSearchParams({});
 * @mutate src/lib/retailerCart.ts |   const asins = [...new Set(hrefs.map(amazonAsin).filter((a): a is string => a !== null))]; |   const asins = hrefs.map(amazonAsin).filter((a): a is string => a !== null);
 * @mutate src/lib/retailerCart.ts |     q.set(`ASIN.${k + 1}`, a); |     q.set(`ASIN.1`, a);
 * @mutate src/lib/retailerCart.ts | (?:dp\|gp\/product)\/([A-Z0-9]{10})(?:[/?#]\|$)/; | (?:dp\|gp\/product)\/([A-Z0-9]+)/;
 * @mutate src/pages/info/giftGuides/AmazonCartButton.tsx |   const url = amazonCartUrl(person.ideas.map((i) => i.href)); |   const url = amazonCartUrl(person.ideas.slice(0, 1).map((i) => i.href));
 *
 * Each person's list (My lists panel, the gift planner) has "Add <Name>'s Amazon items to my cart": one link with
 * every Amazon gift on it, opened like every outbound gift link (sponsored, noopener, new tab); none on a list with no
 * Amazon gift.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AmazonCartForList } from "@/pages/info/giftGuides/AmazonCartButton";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { amazonAsin, amazonCartUrl } from "@/lib/retailerCart";

const DIR = join(process.cwd(), "src/content/giftGuidePicks");
const amazonHrefs = readdirSync(DIR).filter((f) => f.endsWith(".json")).flatMap((f) =>
  (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { picks?: { href: string }[] }).picks ?? []).map((p) => p.href).filter((h) => /^https:\/\/(www\.)?amazon\.com\//.test(h));

describe("Amazon add-to-cart link", () => {
  it("every Amazon link in the guides gives its ASIN", () => {
    // Inventory floor: 236 Amazon links across the guides' chunks today.
    expect(amazonHrefs.length).toBeGreaterThan(100);
    for (const h of amazonHrefs) expect(amazonAsin(h), h).toMatch(/^[A-Z0-9]{10}$/);
  });

  it("one item: our tag, ASIN.1 and Quantity.1, on Amazon's cart form", () => {
    const u = new URL(amazonCartUrl(["https://www.amazon.com/dp/B0D3L9BYFZ?tag=louisianahelpr-20"])!);
    expect(`${u.origin}${u.pathname}`).toBe("https://www.amazon.com/gp/aws/cart/add.html");
    expect(u.searchParams.get("AssociateTag")).toBe("louisianahelpr-20");
    expect(u.searchParams.get("ASIN.1")).toBe("B0D3L9BYFZ");
    expect(u.searchParams.get("Quantity.1")).toBe("1");
  });

  it("several items are numbered in order, each once; non-Amazon links are left out; none gives null", () => {
    const u = new URL(amazonCartUrl([
      "https://www.amazon.com/dp/B0D3L9BYFZ?tag=someone-else-20",
      "https://shopmy.us/collections/123",
      "https://www.amazon.com/dp/B087G6TGJL",
      "https://www.amazon.com/dp/B0D3L9BYFZ",
      undefined,
    ])!);
    expect([...u.searchParams.keys()]).toEqual(["AssociateTag", "ASIN.1", "Quantity.1", "ASIN.2", "Quantity.2"]);
    expect(u.searchParams.get("ASIN.2")).toBe("B087G6TGJL");
    // Always our tag, never one read from a link.
    expect(u.searchParams.get("AssociateTag")).toBe("louisianahelpr-20");
    expect(amazonCartUrl(["https://shopmy.us/collections/123", undefined])).toBeNull();
    expect(amazonAsin("https://www.amazon.com/dp/B0D3L9BYFZEXTRA")).toBeNull();
    expect(amazonAsin("https://evil.example/www.amazon.com/dp/B0D3L9BYFZ")).toBeNull();
  });
});

describe("a person's list: add its Amazon items to my cart", () => {
  const person = (ideas: { href?: string }[], name = "Mom") => ({ id: "p1", name, ideas: ideas.map((x, k) => ({ id: `i${k}`, name: `Gift ${k}`, bought: false, ...x })) });
  it("one link with every Amazon gift on the list, opened like every outbound gift link", () => {
    const { container } = render(createElement(AmazonCartForList, { person: person([
      { href: "https://www.amazon.com/dp/B0D3L9BYFZ?tag=louisianahelpr-20" },
      { href: "https://shopmy.us/collections/1" },
      {},
      { href: "https://www.amazon.com/dp/B087G6TGJL?tag=louisianahelpr-20" },
    ]) }));
    const a = container.querySelector("a")!;
    expect(a.textContent).toBe("Add Mom's Amazon items to my cart");
    const u = new URL(a.getAttribute("href")!);
    expect(u.searchParams.get("ASIN.1")).toBe("B0D3L9BYFZ");
    expect(u.searchParams.get("ASIN.2")).toBe("B087G6TGJL");
    expect(u.searchParams.get("ASIN.3")).toBeNull();
    expect(u.searchParams.get("AssociateTag")).toBe("louisianahelpr-20");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("sponsored noopener");
  });
  it("no button on a list with no Amazon gift; a name ending in s reads Kids'", () => {
    expect(render(createElement(AmazonCartForList, { person: person([{ href: "https://shopmy.us/collections/1" }, {}]) })).container.innerHTML).toBe("");
    const { container } = render(createElement(AmazonCartForList, { person: person([{ href: "https://www.amazon.com/dp/B0D3L9BYFZ" }], "Kids") }));
    expect(container.textContent).toBe("Add Kids' Amazon items to my cart");
  });
});
