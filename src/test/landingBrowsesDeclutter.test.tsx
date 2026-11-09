/**
 * Owner 11-04 (via the lead): "on the landing page you can browse open jobs, but can you browse Declutter?" Guests
 * CAN read /declutter (BUY-16), yet the landing's Declutter card said "Join to browse Declutter" (to sign-up), the
 * top bar had only Jobs and the footer's Explore had no Declutter. Now:
 *   1. the Declutter card says "Browse Declutter" and goes straight to /declutter (landingFrontDoor.test.tsx holds
 *      cardLinkFor for every section);
 *   2. "Fresh on Declutter" shows the newest live listings, each to its item page, plus "See everything" to
 *      /declutter. Since owner 11-08 it is the landing's "Shop Declutter" view (the switch under the hero,
 *      landingBrowseSwitch1108.test.tsx): up to 8 /declutter browse cards in place of the jobs. It reads declutter_items, whose row policy
 *      hides test listings (is_seed) from guests, and it never joins the first paint: no static Supabase import,
 *      nothing fetched until the page has loaded and the spot nears the screen;
 *   3. the guest top bar has Declutter next to Jobs, and the footer's Explore lists it.
 * Measured on a local build against prod data (B115, ~/.lh-shots/b115): before, 0 strip cards and the card to
 * /signup?redirect=%2Fdeclutter; after, 6 cards (4 shown at 375), the card to /declutter, nav fits 320-1440.
 *
 * @mutate src/components/landing/SectionsShowcase.tsx |   if (key === "declutter") return { to: path, text: `Browse ${label}`, signedIn: path }; |
 * @mutate src/pages/info/Index.tsx |       <LandingBrowseSwitch />\n |
 * @mutate src/components/Navbar.tsx |                 to="/declutter" |                 to="/signup?redirect=%2Fdeclutter"
 * @mutate src/components/Footer.tsx |               <Link to="/declutter" className={FOOTER_LINK}> |               <Link to="/help" className={FOOTER_LINK}>
 * @mutate src/components/landing/FreshDeclutterStrip.tsx |     <Link to={`/declutter/item/${encodeURIComponent(it.id)}`} data-item-card="" | <Link to="/declutter" data-item-card=""
 * @mutate src/components/landing/FreshDeclutterSection.tsx |     if (document.readyState === "complete") watch(); |     watch();
 * @mutate src/components/landing/FreshDeclutterSection.tsx |             .eq("status", "live") |             .in("status", ["live", "reserved", "sold"])
 * @mutate src/components/landing/FreshDeclutterStrip.tsx |           {items.slice(0, FRESH_DECLUTTER_LIMIT).map((it) => ( |           {items.map((it) => (
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { FRESH_DECLUTTER_LIMIT, type FreshItem } from "@/components/landing/FreshDeclutterSection";
import FreshDeclutterStrip from "@/components/landing/FreshDeclutterStrip";
import { cardLinkFor } from "@/components/landing/SectionsShowcase";

const ROOT = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const item = (n: number, cents = 1000 * n): FreshItem => ({
  id: `item-${n}`,
  title: `Thing ${n}`,
  category: "furniture",
  condition_stars: 4,
  porch_ok: n === 1,
  price_cents: cents,
  current_price_cents: cents,
  area_label: n === 2 ? null : `Town ${n}`,
  photo: n === 3 ? null : `https://cdn.invalid/item-${n}.webp`,
  photoFull: n === 3 ? null : `https://cdn.invalid/item-${n}.jpg`,
});

afterEach(cleanup);

describe("the landing lets a guest browse Declutter (owner 11-04)", () => {
  it("the Declutter card goes straight to /declutter as 'Browse Declutter'", () => {
    expect(cardLinkFor("declutter", "/declutter", "Declutter")).toEqual({ to: "/declutter", text: "Browse Declutter", signedIn: "/declutter" });
    // Shops / Homes keep sign-up (they are behind sign-in).
    expect(cardLinkFor("shops", "/shops", "Shops").to).toBe("/signup?redirect=%2Fshops");
  });

  it("the grid wears the /declutter browse card style: price or Free, title, condition, each to its item page, plus See everything", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i + 1, i === 0 ? 0 : undefined));
    render(<MemoryRouter><FreshDeclutterStrip items={items} /></MemoryRouter>);
    const strip = screen.getByTestId("landing-fresh-declutter");
    expect(within(strip).getByRole("heading", { name: "Fresh on Declutter" })).toBeTruthy();
    const cards = within(screen.getByTestId("landing-fresh-declutter-list")).getAllByRole("listitem");
    expect(FRESH_DECLUTTER_LIMIT).toBe(8); // owner 11-08: a grid of 8
    expect(cards.length).toBe(FRESH_DECLUTTER_LIMIT); // never more than the limit, even when handed more
    // Every card is a browse-style card (data-item-card), all shown at every width.
    expect(cards.every((c) => c.querySelector("[data-item-card]") && !c.className.includes("hidden"))).toBe(true);
    expect(cards[0].querySelector("[data-card-free]")?.textContent).toBe("Free");
    expect(cards[0].querySelector("[data-card-title]")?.textContent).toBe("Thing 1");
    expect(cards[0].querySelector("[data-card-porch]")).toBeTruthy();
    expect(cards[1].querySelector("[data-card-price]")?.textContent).toContain("$20");
    expect(cards[1].querySelector("[data-card-condition]")).toBeTruthy();
    expect(cards.map((c) => c.querySelector("a")?.getAttribute("href"))).toEqual(items.slice(0, FRESH_DECLUTTER_LIMIT).map((i) => `/declutter/item/${i.id}`));
    expect(cards[0].querySelector("img")?.getAttribute("src")).toBe("https://cdn.invalid/item-1.webp");
    expect(cards[0].querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(cards[2].querySelector("img")).toBeNull(); // no photo: the category icon tile, never a broken image
    const all = within(strip).getAllByRole("link", { name: /See everything/ });
    expect(all.length).toBe(2);
    expect(all.every((a) => a.getAttribute("href") === "/declutter")).toBe(true);
  });

  it("never joins the first paint: no static Supabase import; it reads after load, near the screen, live items only", () => {
    const src = read("src/components/landing/FreshDeclutterSection.tsx");
    const strip = read("src/components/landing/FreshDeclutterStrip.tsx");
    const staticImports = [src, strip].flatMap((t) => [...t.matchAll(/^import [^;]+ from "([^"]+)";/gm)].map((m) => m[1]));
    expect(staticImports.length).toBeGreaterThan(3);
    // Neither the loader nor the strip's chunk carries Supabase, the Declutter api or ItemCard (which imports both
    // and the category icons: in this chunk it regrouped the shared icon chunks, /declutter?tab=selling 557 -> 563 KB gz).
    for (const m of staticImports) expect(m, m).not.toMatch(/supabase|lib\/declutter\/api|DeclutterItemCard/);
    // The strip's markup is its own lazy chunk; Index's page chunk carries only the loader.
    expect(src).toMatch(/const FreshDeclutterStrip = lazy\(\(\) => import\("\.\/FreshDeclutterStrip"\)\);/);
    expect(src).not.toMatch(/^import [^;]+ from "\.\/FreshDeclutterStrip";/m);
    expect(src).toMatch(/await import\("@\/integrations\/supabase\/client"\)/);
    expect(src).toMatch(/if \(document\.readyState === "complete"\) watch\(\);\s*else window\.addEventListener\("load", watch, \{ once: true \}\);/);
    expect(src).toMatch(/new IntersectionObserver\(/);
    expect(src).toMatch(/\.from\("declutter_items"\)\s*\.select\(FRESH_SELECT\)\s*\.eq\("status", "live"\)\s*\.order\("live_at", \{ ascending: false \}\)\s*\.limit\(FRESH_DECLUTTER_LIMIT\)/);
    expect(src).toMatch(/unwrap\(/);
    // A failed read says so (not silent); an empty one draws nothing.
    expect(src).toMatch(/state\.kind === "failed" && <FreshDeclutterFailed \/>/);
    expect(src).toMatch(/state\.kind === "ok" && state\.items\.length > 0 && <FreshDeclutterStrip/);
  });

  it("Index puts the Jobs | Declutter switch right under the hero, before the sections", () => {
    const index = read("src/pages/info/Index.tsx");
    const hero = index.indexOf("<HeroSection />");
    const sw = index.indexOf("<LandingBrowseSwitch />");
    const sections = index.indexOf("<SectionsShowcase />");
    expect(hero).toBeGreaterThan(-1);
    expect(sw).toBeGreaterThan(hero);
    expect(index.slice(hero + "<HeroSection />".length, sw)).not.toMatch(/<[A-Z]/); // nothing between the hero and the switch
    expect(sections).toBeGreaterThan(sw);
  });

  it("the guest top bar has Declutter right after Jobs, and the footer's Explore lists it", () => {
    const nav = read("src/components/Navbar.tsx");
    const jobs = nav.indexOf('to="/browse"');
    const declutter = nav.indexOf('to="/declutter"');
    const login = nav.indexOf('to="/login"');
    expect(jobs).toBeGreaterThan(-1);
    expect(declutter).toBeGreaterThan(jobs);
    expect(login).toBeGreaterThan(declutter);
    expect(nav.slice(declutter, login)).toMatch(/>\s*Declutter\s*<\/Link>/);
    const footer = read("src/components/Footer.tsx");
    expect(footer).toMatch(/<Link to="\/declutter" className=\{FOOTER_LINK\}>\s*Declutter\s*<\/Link>/);
    expect(footer.indexOf('to="/declutter"')).toBeGreaterThan(footer.indexOf("browseDestinationFor(user)}"));
  });
});
