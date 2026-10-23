/**
 * ONE SECTION SHELL: Jobs, Declutter, Shops and Homes put their shell in the
 * SAME place, measured from the rendered page.
 *
 * Owner, 2026-10-19, from iPhone shots of the four Browse screens: "make
 * layout consistent so the shells are in the same place for each". Jobs sat
 * further in than the others (on this branch before the fix, at 375: top bar
 * x=25 vs 20, toggle 25 vs 20, cards 25 vs 20, toggle 9px lower), Shops had a
 * plain "All shops" row instead of the search row, and Homes had a second
 * Rent | Buy pill row under its toggle.
 *
 * For each section's Browse, signed in on THIS commit's build against prod, at
 * 320 and 375, this reads the box of: the top bar, its title, the toggle, the
 * search row, and the first block under the search row (the first card, or the
 * empty state). Every left edge and top must match Jobs' within 1px, and the
 * bar, title, toggle and search row also their right edge and height,
 * and the search row must be the one shared row (magnifier + "Search ..." /
 * "City or ZIP" field + filter button inside). Read-only: page loads only.
 *
 * Proven red 2026-10-19 on the mutations below (the old Jobs inset; a section
 * that adds an extra row under its toggle; the old Jobs gap under the bar).
 *
 * @mutate src/pages/jobs/JobsSection.tsx | className="explore-header flex flex-col gap-1"> | className="explore-header flex flex-col gap-1 px-1">
 * @mutate src/pages/jobs/JobsSection.tsx | className="explore-header flex flex-col gap-1"> | className="explore-header flex flex-col gap-3">
 * @mutate src/components/shops/ShopsHomeView.tsx |       <SectionSearchRow\n        value={query} |       <div className="h-10" />\n      <SectionSearchRow\n        value={query}
 */
import { test, expect, type Browser } from "../prodTest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

const SHOTS = process.env.LH_SECTION_SHELL_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const SECTIONS = [
  { name: "jobs", url: "/jobs", h1: "Jobs", search: /^Search jobs$/ },
  { name: "declutter", url: "/declutter", h1: "Declutter", search: /^Search items$/ },
  { name: "shops", url: "/shops", h1: "Shops", search: /^Search shops$/ },
  { name: "homes", url: "/rentals", h1: "Homes", search: /^City or ZIP$/ },
] as const;
const WIDTHS = [320, 375] as const;
const TOL = 1;

type Box = { x: number; y: number; w: number; h: number };
type Shell = { bar: Box | null; title: Box | null; tabs: Box | null; search: Box | null; searchField: string | null; searchFilter: boolean; first: Box | null; firstWhat: string | null };

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

async function authedPage(browser: Browser, vw: number, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: vw, height: 812 }, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        localStorage.setItem(key, val);
        localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }));
        localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
        localStorage.setItem("helpr_cookie_consent", "accepted");
        localStorage.setItem("push-nudge-dismissed-at", String(Date.now()));
      } catch {
        /* signed out: the title check below fails visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
  );
  return { ctx, page: await ctx.newPage() };
}

/** The shell's boxes, in viewport px. The "first block" is where the content
 *  starts under the search row: the first CARD (an element that paints a
 *  background, a border or a photo, card-sized) or the shared empty state
 *  (`[data-empty-state]`), whichever is higher; never the bottom nav or the
 *  page panel (a layout wrapper that paints nothing on a phone). */
function readShell(): Shell {
  const box = (el: Element | null | undefined): Box | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const bar = document.querySelector(".app-top-bar");
  const search = document.querySelector("[data-section-search]");
  const sb = search?.getBoundingClientRect();
  let first: Element | null = null;
  let firstTop = Infinity;
  if (sb) {
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("nav, .page-panel > [aria-hidden], [role='dialog']") || el.classList.contains("page-panel")) continue;
      const r = el.getBoundingClientRect();
      if (r.top < sb.bottom - 0.5 || r.width < 120 || r.height < 40 || r.top >= firstTop) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const painted =
        el.hasAttribute("data-empty-state") ||
        el.tagName === "IMG" ||
        !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.backgroundColor) ||
        parseFloat(cs.borderTopWidth) > 0 ||
        cs.boxShadow !== "none";
      if (painted) {
        first = el;
        firstTop = r.top;
      }
    }
  }
  return {
    bar: box(bar),
    title: box(bar?.querySelector("h1")),
    tabs: box(document.querySelector('[role="tablist"]')),
    search: box(search),
    searchField: search?.querySelector('input[type="search"]')?.getAttribute("aria-label") ?? null,
    searchFilter: !!search?.querySelector('button[aria-label^="Filters"]'),
    first: box(first),
    firstWhat: first ? `${first.tagName}.${String(first.className).slice(0, 50)}` : null,
  };
}

test("the inventory is the four sections, at two phone widths", () => {
  expect(SECTIONS.length).toBeGreaterThan(3);
  expect(WIDTHS.length).toBeGreaterThan(1);
});

for (const vw of WIDTHS) {
  test(`Jobs, Declutter, Shops and Homes put the shell in the same place @ ${vw}`, async ({ browser, baseURL }, info) => {
    test.setTimeout(4 * 60_000);
    const got: Record<string, Shell> = {};
    for (const s of SECTIONS) {
      const { ctx, page } = await authedPage(browser, vw, baseURL);
      await page.goto(s.url, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".app-top-bar h1"), `${s.name}@${vw}: the section's own screen never rendered`).toHaveText(s.h1, { timeout: 45_000 });
      await expect(page.locator("[data-section-search]"), `${s.name}@${vw}: no shared search row`).toBeVisible({ timeout: 45_000 });
      // Let the list (or its empty state) settle under the row.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1_200);
      got[s.name] = await page.evaluate(readShell);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${s.name}-${vw}.png`) });
      await ctx.close();
    }
    info.annotations.push({ type: "measured", description: `@${vw} ${JSON.stringify(got)}` });
    const r = (b: Box | null) => (b ? `${Math.round(b.x * 10) / 10},${Math.round(b.y * 10) / 10} ${Math.round(b.w)}x${Math.round(b.h)}` : "-");
    for (const s of SECTIONS) {
      const m = got[s.name];
      console.log(`[section-shell] ${s.name}@${vw} bar=${r(m.bar)} title=${r(m.title)} tabs=${r(m.tabs)} search=${r(m.search)} first=${r(m.first)} (${m.firstWhat})`);
    }

    for (const s of SECTIONS) {
      const m = got[s.name];
      for (const k of ["bar", "title", "tabs", "search", "first"] as const) {
        expect(m[k], `${s.name}@${vw}: no ${k} (${m.firstWhat ?? "-"})`).not.toBeNull();
      }
      expect(m.searchField ?? "", `${s.name}@${vw}: the search field`).toMatch(s.search);
      expect(m.searchFilter, `${s.name}@${vw}: no filter button inside the search row`).toBe(true);
    }
    const ref = got.jobs;
    for (const s of SECTIONS.slice(1)) {
      const m = got[s.name];
      for (const k of ["bar", "title", "tabs", "search", "first"] as const) {
        const a = ref[k]!, b = m[k]!;
        expect(Math.abs(b.x - a.x), `${s.name}@${vw}: ${k} left ${b.x} vs Jobs ${a.x}`).toBeLessThanOrEqual(TOL);
        // Widths that are the section's own: the title's word, and the first block (Declutter's
        // first card is half a 2-column grid). Their left edge and top still must match.
        if (k !== "first" && k !== "title") expect(Math.abs(b.x + b.w - (a.x + a.w)), `${s.name}@${vw}: ${k} right ${b.x + b.w} vs Jobs ${a.x + a.w}`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(b.y - a.y), `${s.name}@${vw}: ${k} top ${b.y} vs Jobs ${a.y} (${m.firstWhat})`).toBeLessThanOrEqual(TOL);
        if (k !== "first") expect(Math.abs(b.h - a.h), `${s.name}@${vw}: ${k} height ${b.h} vs Jobs ${a.h}`).toBeLessThanOrEqual(TOL);
      }
    }
  });
}
