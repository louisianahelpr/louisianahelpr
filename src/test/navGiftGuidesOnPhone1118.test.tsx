/**
 * GUARD (owner 11-18, on the phone landing, whose bar showed only the logo, Log in and Join free): "Where am I suppose
 * to find the holiday guides here? Shouldn't it be on the top nav?" This overrides the 11-04 phone bar of only Jobs,
 * Declutter, Log in and Join free.
 *  - Below md the signed-out public bar has a short "Guides" link with the gift icon to /gift-guides, named "Holiday
 *    Gift Guides" (sr-only prefix, so the visible word is in the name: labelInName.test.tsx), before Log in;
 *  - on the landing it shows at every phone width; on the other public pages from sm (below 640 their bar already
 *    carries Jobs and Declutter beside the logo);
 *  - from md up the full "Holiday Gift Guides" link shows instead (never both at once);
 *  - index.html's prerendered landing bar (B100 shell) carries it, so the first paint has it too.
 *
 * @mutate src/components/Navbar.tsx |   const guidesPhoneHidden = landing ? "" : " max-[639px]:hidden"; |   const guidesPhoneHidden = " max-[639px]:hidden";
 * @mutate src/components/Navbar.tsx |                 data-testid="nav-gift-guides-phone" |                 data-testid="nav-gift-guides-phone" hidden
 * @mutate src/components/Navbar.tsx |                 <span className="sr-only">Holiday Gift Guides</span> |
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Navbar from "@/components/Navbar";

afterEach(cleanup);

const bar = (landing: boolean, path = landing ? "/" : "/browse") => {
  render(<MemoryRouter initialEntries={[path]}><Navbar landing={landing} /></MemoryRouter>);
  const links = screen.getAllByRole("link");
  return { links, phone: screen.getByTestId("nav-gift-guides-phone"), wide: screen.getByTestId("nav-gift-guides") };
};

describe("the public top bar has the gift guides on a phone (owner 11-18)", () => {
  it("the landing: a short 'Guides' link, named Holiday Gift Guides, to /gift-guides, before Log in, at every phone width", () => {
    const { links, phone } = bar(true);
    expect(links.length).toBeGreaterThan(3);
    expect(phone.getAttribute("href")).toBe("/gift-guides");
    expect(phone).toHaveAccessibleName("Holiday Gift Guides");
    // The visible word is "Guides" (the full name is sr-only) beside the gift icon.
    const visible = [...phone.children].filter((n) => !n.classList.contains("sr-only") && n.tagName !== "svg").map((n) => n.textContent).join("").trim();
    expect(visible).toBe("Guides");
    expect(phone.querySelector("svg.lucide-gift")).toBeTruthy();
    const cls = phone.className.split(/\s+/);
    expect(cls).toContain("md:hidden");
    expect(cls).not.toContain("hidden");
    expect(cls).not.toContain("max-[639px]:hidden");
    const at = (el: Element) => links.indexOf(el as HTMLElement);
    expect(at(phone)).toBeLessThan(at(screen.getByRole("link", { name: "Log in" })));
  });

  it("other public pages: from sm (their phone bar keeps Jobs and Declutter), and the wide link only from md", () => {
    const { phone, wide } = bar(false);
    expect(phone.className.split(/\s+/)).toEqual(expect.arrayContaining(["md:hidden", "max-[639px]:hidden"]));
    expect(wide.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "md:inline-flex"]));
    expect(wide.textContent).toBe("Holiday Gift Guides");
  });

  it("marks the page it is on", () => {
    const { phone } = bar(false, "/gift-guides/her");
    expect(phone.getAttribute("aria-current")).toBe("page");
  });

  it("index.html's prerendered landing bar has it", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('data-testid="nav-gift-guides-phone"');
    expect(html).toContain('<span class="sr-only">Holiday Gift Guides</span><span aria-hidden="true">Guides</span></a>');
  });
});
