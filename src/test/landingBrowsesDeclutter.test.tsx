/**
 * Owner 11-04 (via the lead): "on the landing page you can browse open jobs, but can you browse Declutter?" Guests
 * CAN read /declutter (BUY-16), yet the landing's Declutter card said "Join to browse Declutter" (to sign-up), the
 * top bar had only Jobs and the footer's Explore had no Declutter. Now:
 *   1. the Declutter card says "Browse Declutter" and goes straight to /declutter (landingFrontDoor.test.tsx holds
 *      cardLinkFor for every section);
 *   2. "Fresh on Declutter" sits under the jobs section: the newest live listings (photo, price or "Free", title,
 *      town), each to its item page, plus "See everything" to /declutter. It reads declutter_items, whose row policy
 *      hides test listings (is_seed) from guests, and it never joins the first paint: no static Supabase import,
 *      nothing fetched until the page has loaded and the spot nears the screen;
 *   3. the guest top bar has Declutter next to Jobs, and the footer's Explore lists it.
 * Measured on a local build against prod data (B115, ~/.lh-shots/b115): before, 0 strip cards and the card to
 * /signup?redirect=%2Fdeclutter; after, 6 cards (4 shown at 375), the card to /declutter, nav fits 320-1440.
 *
 * @mutate src/components/landing/SectionsShowcase.tsx |   if (key === "declutter") return { to: path, text: `Browse ${label}`, signedIn: path }; |
 * @mutate src/pages/info/Index.tsx |       <FreshDeclutterSection />\n |
 * @mutate src/components/Navbar.tsx |                 to="/declutter" |                 to="/signup?redirect=%2Fdeclutter"
 * @mutate src/components/Footer.tsx |               <Link to="/declutter" className="link-standard"> |               <Link to="/help" className="link-standard">
 * @mutate src/components/landing/FreshDeclutterStrip.tsx |                 to={`/declutter/item/${encodeURIComponent(it.id)}`} |                 to="/declutter"
 * @mutate src/components/landing/FreshDeclutterSection.tsx |     if (document.readyState === "complete") watch(); |     watch();
 * @mutate src/components/landing/FreshDeclutterSection.tsx |             .eq("status", "live") |             .in("status", ["live", "reserved", "sold"])
 * @mutate src/components/landing/FreshDeclutterStrip.tsx |             <li key={it.id} className={i >= 4 ? "hidden sm:block" : undefined}> |             <li key={it.id}>
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
  current_price_cents: cents,
  area_label: n === 2 ? null : `Town ${n}`,
  photo: n === 3 ? null : `https://cdn.invalid/${n}.webp`,
  photoFull: n === 3 ? null : `https://cdn.invalid/${n}.jpg`,
});

afterEach(cleanup);

describe("the landing lets a guest browse Declutter (owner 11-04)", () => {
  it("the Declutter card goes straight to /declutter as 'Browse Declutter'", () => {
    expect(cardLinkFor("declutter", "/declutter", "Declutter")).toEqual({ to: "/declutter", text: "Browse Declutter", signedIn: "/declutter" });
    // Shops / Homes keep sign-up (they are behind sign-in).
    expect(cardLinkFor("shops", "/shops", "Shops").to).toBe("/signup?redirect=%2Fshops");
  });

  it("the strip shows price or Free, title and town, each card to its item page, plus See everything", () => {
    const items = [item(1, 0), item(2), item(3), item(4), item(5), item(6), item(7)];
    render(<MemoryRouter><FreshDeclutterStrip items={items} /></MemoryRouter>);
    const strip = screen.getByTestId("landing-fresh-declutter");
    expect(within(strip).getByRole("heading", { name: "Fresh on Declutter" })).toBeTruthy();
    const cards = within(screen.getByTestId("landing-fresh-declutter-list")).getAllByRole("listitem");
    expect(FRESH_DECLUTTER_LIMIT).toBeGreaterThan(3);
    expect(cards.length).toBe(FRESH_DECLUTTER_LIMIT); // never more than the limit, even when handed more
    expect(cards[0].textContent).toContain("Free");
    expect(cards[0].textContent).toContain("Thing 1");
    expect(cards[0].textContent).toContain("Town 1");
    expect(cards[1].textContent).toContain("$20");
    expect(cards.map((c) => c.querySelector("a")?.getAttribute("href"))).toEqual(items.slice(0, FRESH_DECLUTTER_LIMIT).map((i) => `/declutter/item/${i.id}`));
    expect(cards[0].querySelector("img")?.getAttribute("src")).toBe("https://cdn.invalid/1.webp");
    expect(cards[0].querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(cards[2].querySelector("img")).toBeNull(); // no photo: the grey square, never a broken image
    // A phone shows 4 (two rows of two); the 5th and 6th from sm up.
    expect(cards.slice(0, 4).every((c) => !c.className.includes("hidden"))).toBe(true);
    expect(cards.slice(4).every((c) => c.className.includes("hidden sm:block"))).toBe(true);
    const all = within(strip).getAllByRole("link", { name: /See everything/ });
    expect(all.length).toBe(2);
    expect(all.every((a) => a.getAttribute("href") === "/declutter")).toBe(true);
  });

  it("never joins the first paint: no static Supabase import; it reads after load, near the screen, live items only", () => {
    const src = read("src/components/landing/FreshDeclutterSection.tsx");
    const strip = read("src/components/landing/FreshDeclutterStrip.tsx");
    const staticImports = [src, strip].flatMap((t) => [...t.matchAll(/^import [^;]+ from "([^"]+)";/gm)].map((m) => m[1]));
    expect(staticImports.length).toBeGreaterThan(3);
    for (const m of staticImports) expect(m, m).not.toMatch(/supabase|lib\/declutter\/api/);
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

  it("Index puts it right under the jobs section", () => {
    const index = read("src/pages/info/Index.tsx");
    const live = index.indexOf("<LiveJobsSection />");
    const fresh = index.indexOf("<FreshDeclutterSection />");
    const sections = index.indexOf("<SectionsShowcase />");
    expect(live).toBeGreaterThan(-1);
    expect(fresh).toBeGreaterThan(live);
    expect(sections).toBeGreaterThan(fresh);
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
    expect(footer).toMatch(/<Link to="\/declutter" className="link-standard">\s*Declutter\s*<\/Link>/);
    expect(footer.indexOf('to="/declutter"')).toBeGreaterThan(footer.indexOf("browseDestinationFor(user)}"));
  });
});
