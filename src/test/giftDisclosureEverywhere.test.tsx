/**
 * Holiday audit D (11-20, salvaged 11-23 onto today's GuidesDisclosure), the gift guides' affiliate links:
 *  - H3: every page that can show an affiliate link (a <GiftOut> or a rel="sponsored" link) also carries the FTC
 *    disclosure and Amazon's Associates statement (GuidesDisclosure, which shows while its page holds such a link; owner
 *    11-22). Inventory from source: every file under src/pages and src/components that draws one must be reachable, by
 *    its imports, from a page that renders <GuidesDisclosure> (GiftGuides.tsx) or must itself render <FunBody> (whose
 *    frame carries it). A new page or component that links out from somewhere else fails here until its page carries
 *    the line. (GuidesDisclosure's own show/hide is guarded by giftGuideDisclosureWhereLinked1122.)
 *  - H2: a Shop click queues ONE gift_out_click analytics row and never cancels or delays the link.
 *
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |         <GuidesDisclosure scope={frame} data-gift-fun-disclosure="" /> |         {null}
 * @mutate src/pages/info/GiftGuides.tsx |   const footer = <GuidesDisclosure scope={page} />; |   const footer = null;
 * @mutate src/pages/info/giftGuides/GiftOut.tsx |   const opened = () => track("gift_out_click", { href: url }); |   const opened = () => undefined;
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
import { GiftOut } from "@/pages/info/giftGuides/GiftOut";

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
const MARKERS = /GiftOut|sponsored|GuidesDisclosure|GuidesFrame|FunBody|AMAZON_ASSOCIATE_DISCLOSURE/;
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
  it("FunBody carries the FTC disclosure and the Amazon statement once its page holds an affiliate link", async () => {
    const { container, findByText } = render(
      <MemoryRouter>
        <FunBody title="Swipe" path="/gift-guides/swipe"><GiftOut href="shopmy.us/p/abc">Shop</GiftOut></FunBody>
      </MemoryRouter>,
    );
    await findByText(G.amazonStatement);
    expect(container.querySelector("[data-gift-disclosure]")?.textContent).toBe(`${G.disclosureLead} ${G.amazonStatement}`);
    expect(container.querySelector("[data-gift-amazon-statement]")?.textContent).toBe(G.amazonStatement);
  });

  it("every file that draws an affiliate link is on a page that carries GuidesDisclosure", () => {
    const files = walkSource([join(SRC, "pages"), join(SRC, "components")]);
    const linksOut = files.filter((f) => /<GiftOut\b|rel=["'{`][^"'}`]*\bsponsored\b/.test(code(f)) && !f.endsWith("GiftOut.tsx"));
    // Inventory floor: the guides' view, landing, sidebar, deals, Gift of the Day, Swipe and the planner.
    expect(linksOut.length).toBeGreaterThan(6);
    const hosts = files.filter((f) => /<GuidesDisclosure\b/.test(code(f)) && !f.endsWith("GuidesDisclosure.tsx"));
    expect(hosts.map((f) => relative(ROOT, f)).sort()).toEqual(["src/pages/info/GiftGuides.tsx", "src/pages/info/giftGuides/fun/FunPage.tsx"]);
    // The frame pages: FunBody (the fun pages, the printables) and GuidesFrame (the Holiday Hub) carry the line.
    const funPages = files.filter((f) => /<(FunBody|GuidesFrame)\b/.test(code(f)) && !f.endsWith("FunPage.tsx"));
    expect(funPages.length).toBeGreaterThan(3);
    const covered = reachable([join(SRC, "pages/info/GiftGuides.tsx"), ...funPages]);
    // A component that prints its own Associates statement beside its links (the job post's MaterialsPanel) is covered too.
    const ownStatement = (f: string) => /\{AMAZON_ASSOCIATE_DISCLOSURE\}/.test(code(f));
    const bare = linksOut.filter((f) => !covered.has(f) && !ownStatement(f)).map((f) => relative(ROOT, f));
    expect(bare, "an affiliate link on a page with no disclosure footer").toEqual([]);
  });
});

describe("a Shop click is counted once, with no delay (holiday audit D H2)", () => {
  it("clicking Shop queues one gift_out_click row and leaves the link alone", () => {
    const { getByText } = render(<GiftOut href="shopmy.us/p/abc?ref=1">Shop</GiftOut>);
    const a = getByText("Shop").closest("a")!;
    expect(a.getAttribute("href")).toBe("https://shopmy.us/p/abc?ref=1");
    expect(a.getAttribute("target")).toBe("_blank");
    // fireEvent returns false when a handler cancelled the click (the link would never open).
    expect(fireEvent.click(a)).toBe(true);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("gift_out_click", { href: "https://shopmy.us/p/abc?ref=1" });
    // No waiting on the network before the link opens.
    const src = code(join(SRC, "pages/info/giftGuides/GiftOut.tsx"));
    expect(src).not.toMatch(/preventDefault|await\s/);
  });
});
