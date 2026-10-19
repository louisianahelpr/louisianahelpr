/**
 * EVERY TITLE IS UPRIGHT MONTSERRAT, measured from the RENDERED style.
 *
 * Owner rule (global organization, 2026-10-19): "upright titles". index.css T1
 * forces every `.font-display` element to upright Montserrat; the one Bodoni
 * headline left is the landing H1 (`.landing-h1`, signed-out only). The class
 * strings were cleaned the same day (no `font-display italic` left in src),
 * but a class check cannot see what actually paints: a Homes branch shot
 * (10-19) showed the "Lease" / "Your lease" sheet titles in Bodoni italic
 * while every source check was green.
 *
 * So this reads `getComputedStyle` on every visible element that owns text,
 * signed in on THIS commit's build against prod, on each section's own
 * screen (Home, Jobs, Declutter, Shops, Homes Browse, Homes Owning, Messages,
 * Profile) and one OPENED sheet (the Jobs filter sheet: it needs no data and
 * wears the shared SHEET_HERO_TITLE_CLASS), at 375 and 1440, and fails on any
 * italic or Bodoni text outside `.landing-h1`. Read-only: page loads and one
 * sheet opened, nothing submitted.
 *
 * Proven red 2026-10-19 on both mutations below (T1 switched off: every
 * display title paints Bodoni; the sheet title given `font-sans italic`: the
 * opened-sheet leg reds).
 *
 * @mutate src/index.css | .font-display:not(.landing-h1, .landing-h1 *) { | .font-display-off:not(.landing-h1, .landing-h1 *) {
 * @mutate src/components/ui/sheetHeroTitle.ts | "font-display font-bold leading-tight [overflow-wrap:anywhere]" | "font-sans italic font-bold leading-tight [overflow-wrap:anywhere]"
 */
import { test, expect, type Browser, type Page } from "../prodTest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

const SHOTS = process.env.LH_TITLES_UPRIGHT_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Each section's own screen; `h1` pins that the real screen rendered (not
 *  NotFound or a gate), so a pass can never come from an empty page. */
const SCREENS: { name: string; url: string; h1?: RegExp; sheet?: RegExp }[] = [
  { name: "home", url: "/home" },
  { name: "jobs-browse", url: "/jobs", h1: /^Jobs$/ },
  { name: "declutter-browse", url: "/declutter", h1: /^Declutter$/ },
  { name: "shops-browse", url: "/shops", h1: /^Shops$/ },
  { name: "homes-browse", url: "/rentals", h1: /^Homes$/ },
  { name: "homes-owning", url: "/rentals?tab=own", h1: /^Homes$/ },
  { name: "messages", url: "/messages", h1: /^Messages$/ },
  { name: "profile", url: "/profile" },
  { name: "jobs-filter-sheet", url: "/jobs", h1: /^Jobs$/, sheet: /^Filters/ },
];

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

async function authedPage(browser: Browser, vw: number, baseURL: string | undefined) {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: vw, height: vw >= 900 ? 900 : 812 },
    hasTouch: vw < 900,
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        localStorage.setItem(key, val);
        localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }));
        localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
        localStorage.setItem("helpr_cookie_consent", "accepted");
        localStorage.setItem("push-nudge-dismissed-at", String(Date.now()));
      } catch {
        /* signed out: the h1 checks below fail visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
  );
  return { ctx, page: await ctx.newPage() };
}

/** Every visible element that owns text and paints it italic or in Bodoni,
 *  outside the landing H1. */
function slantedOrBodoniText() {
  const offenders: string[] = [];
  let inspected = 0;
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (el.closest(".landing-h1")) continue;
    const ownsText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
    if (!ownsText) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    inspected += 1;
    const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    if (cs.fontStyle !== "normal" || /bodoni/i.test(family)) {
      offenders.push(
        `<${el.tagName.toLowerCase()} class="${String(el.getAttribute("class") ?? "").slice(0, 70)}"> ` +
          `"${(el.textContent ?? "").trim().slice(0, 40)}" -> ${cs.fontStyle} ${family}`,
      );
    }
  }
  return { offenders, inspected };
}

async function open(page: Page, screen: (typeof SCREENS)[number], tag: string) {
  await page.goto(screen.url, { waitUntil: "domcontentloaded" });
  const h1 = page.locator("h1").first();
  await h1.waitFor({ state: "visible", timeout: 45_000 });
  if (screen.h1) await expect(h1, `${tag}: the real screen rendered`).toHaveText(screen.h1, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  if (screen.sheet) {
    await page.getByRole("button", { name: screen.sheet }).first().click();
    const dialog = page.getByRole("dialog").last();
    await expect(dialog, `${tag}: the sheet opened`).toBeVisible();
    await expect(dialog.getByRole("heading").first(), `${tag}: the sheet carries its title`).toBeVisible();
  }
  await page.waitForTimeout(700);
}

for (const vw of [375, 1440] as const) {
  test(`every title is upright Montserrat, never italic or Bodoni, on each section and an open sheet @${vw}`, async ({ browser }, info) => {
    const { ctx, page } = await authedPage(browser, vw, info.project.use.baseURL);
    try {
      const found: string[] = [];
      for (const screen of SCREENS) {
        const tag = `${screen.name}@${vw}`;
        await open(page, screen, tag);
        const { offenders, inspected } = await page.evaluate(slantedOrBodoniText);
        console.log(`[titles-upright] ${tag} inspected=${inspected} offenders=${offenders.length}`);
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${screen.name}-${vw}.png`) });
        // Floor: a screen that painted nothing would pass vacuously.
        expect(inspected, `${tag}: too few text elements, the screen did not render`).toBeGreaterThan(5);
        found.push(...offenders.map((o) => `${tag}: ${o}`));
      }
      expect(found, `italic or Bodoni text outside the landing H1 (titles are upright Montserrat, index.css T1)`).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
