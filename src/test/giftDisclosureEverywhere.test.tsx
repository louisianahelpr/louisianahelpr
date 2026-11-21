/**
 * Holiday audit D (11-20), the gift guides' affiliate links:
 *  - H3: every page that can show an affiliate link (a <GiftOut> or a rel="sponsored" link) also shows the FTC
 *    disclosure and Amazon's Associates statement (GiftDisclosure). Inventory from source: every file under src/pages
 *    and src/components that draws one must be reachable, by its imports, from a page that renders <GiftDisclosure />
 *    (GiftGuides.tsx) or must itself render <FunBody> (whose footer is the disclosure). A new fun page or a new
 *    component that links out from somewhere else fails here until its page carries the footer.
 *  - H2: a Shop click queues ONE gift_out_click analytics row with the link's host + path only (no query, no member
 *    data), and never cancels the link.
 *
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | <div className="gg gg-fun w-full" data-gift-fun={path}>{children}<GiftDisclosure /></div> | <div className="gg gg-fun w-full" data-gift-fun={path}>{children}</div>
 * @mutate src/pages/info/GiftGuides.tsx |   const footer = <GiftDisclosure />; |   const footer = null;
 * @mutate src/pages/info/giftGuides/GiftOut.tsx |         if (props) track("gift_out_click", props); |         void props;
 * @mutate src/pages/info/giftGuides/GiftOut.tsx |     return { host, link: `${host}${u.pathname.replace(/\/+$/, "")}` }; |     return { host, link: u.href };
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { giftGuides as G } from "@/content/giftGuides";

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => trackMock(...a) }));

import { FunBody } from "@/pages/info/giftGuides/fun/FunPage";
import { GiftOut, giftOutProps } from "@/pages/info/giftGuides/GiftOut";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

afterEach(() => {
  cleanup();
  trackMock.mockReset();
});

/** The file an import specifier names, or null when it is a package. */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  }
  return null;
}

const rawCache = new Map<string, string>();
const raw = (file: string) => {
  let c = rawCache.get(file);
  if (c === undefined) rawCache.set(file, (c = readFileSync(file, "utf8")));
  return c;
};
/** Comments blanked, only for a file whose raw text names one of the markers (blanking every file is slow). */
const MARKERS = /GiftOut|sponsored|GiftDisclosure|FunBody|AMAZON_ASSOCIATE_DISCLOSURE/;
const code = (file: string) => (MARKERS.test(raw(file)) ? blankComments(raw(file)) : "");
const importsOf = (file: string) =>
  [...raw(file).matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((m) => resolveImport(file, m[1])).filter((f): f is string => !!f);

/** Every file reachable by imports from `roots`. */
function reachable(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f));
  }
  return seen;
}

describe("every gift guide page with an affiliate link shows the disclosures (holiday audit D H3)", () => {
  it("FunBody renders the FTC disclosure and the Amazon statement", () => {
    const { container } = render(
      <MemoryRouter>
        <FunBody title="Swipe" path="/gift-guides/swipe"><p>cards</p></FunBody>
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-gift-disclosure]")?.textContent).toBe(G.disclosure);
    expect(container.querySelector("[data-gift-amazon-statement]")?.textContent).toBe(G.amazonStatement);
  });

  it("every file that draws an affiliate link is on a page that carries GiftDisclosure", () => {
    const files = walkSource([join(SRC, "pages"), join(SRC, "components")]);
    const linksOut = files.filter((f) => /<GiftOut\b|rel=["'{`][^"'}`]*\bsponsored\b/.test(code(f)) && !f.endsWith("GiftOut.tsx"));
    // Inventory floor: the guides' view, landing, sidebar, deals, Gift of the Day, Swipe and the planner.
    expect(linksOut.length).toBeGreaterThan(6);
    const hosts = files.filter((f) => /<GiftDisclosure\s*\/>/.test(code(f)) && !f.endsWith("GiftDisclosure.tsx"));
    expect(hosts.map((f) => relative(ROOT, f)).sort()).toEqual(["src/pages/info/GiftGuides.tsx", "src/pages/info/giftGuides/fun/FunPage.tsx"]);
    const funPages = files.filter((f) => /<FunBody\b/.test(code(f)));
    expect(funPages.length).toBeGreaterThan(3);
    const covered = reachable([join(SRC, "pages/info/GiftGuides.tsx"), ...funPages]);
    // A component that prints its own Associates statement beside its links (the job post's MaterialsPanel) is covered too.
    const ownStatement = (f: string) => /\{AMAZON_ASSOCIATE_DISCLOSURE\}/.test(code(f));
    const bare = linksOut.filter((f) => !covered.has(f) && !ownStatement(f)).map((f) => relative(ROOT, f));
    expect(bare, "an affiliate link on a page with no disclosure footer").toEqual([]);
  });
});

describe("a Shop click is counted once, with no query and no delay (holiday audit D H2)", () => {
  it("giftOutProps keeps the host and path only", () => {
    expect(giftOutProps("https://www.amazon.com/dp/B0ABC123/?tag=louisianahelpr-20&psc=1#x")).toEqual({ host: "amazon.com", link: "amazon.com/dp/B0ABC123" });
    expect(giftOutProps("https://shopmy.us/collections/123?utm_source=x")).toEqual({ host: "shopmy.us", link: "shopmy.us/collections/123" });
    expect(giftOutProps("not a url")).toBeNull();
  });

  it("clicking Shop queues one gift_out_click row and leaves the link alone", () => {
    const { getByText } = render(<GiftOut href="shopmy.us/p/abc?ref=1">Shop</GiftOut>);
    const a = getByText("Shop").closest("a")!;
    expect(a.getAttribute("href")).toBe("https://shopmy.us/p/abc?ref=1");
    expect(a.getAttribute("target")).toBe("_blank");
    // fireEvent returns false when a handler cancelled the click (the link would never open).
    expect(fireEvent.click(a)).toBe(true);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("gift_out_click", { host: "shopmy.us", link: "shopmy.us/p/abc" });
    // No waiting on the network before the link opens.
    const src = code(join(SRC, "pages/info/giftGuides/GiftOut.tsx"));
    expect(src).not.toMatch(/preventDefault|await\s/);
  });
});
