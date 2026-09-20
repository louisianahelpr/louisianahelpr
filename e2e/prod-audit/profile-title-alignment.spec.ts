/**
 * EVERY PROFILE SURFACE PUTS ITS TITLE ON ONE LINE — the landing included.
 *
 * ─── THE REPORT ────────────────────────────────────────────────────────────
 * Owner, 2026-09-20: "align the landing title to x=72." Their whole complaint
 * across that evening was Profile surfaces not agreeing with each other, and
 * the landing's title was the last place they did not. Measured at 1440,
 * signed in, on the built app before the fix:
 *
 *     /profile (landing)     h1 left = 145     first card left = 24
 *     /profile?tab=<any>     h1 left =  72     first card left = 24
 *
 * and at 375, 141 against 68 with cards at 20. The cards already agreed; only
 * the title did not.
 *
 * ─── WHY A BROWSER HAS TO SAY IT ───────────────────────────────────────────
 * Because nothing in the source does. The landing's 145 was not a margin
 * anybody typed: it was the card's gutter (24) plus the identity card's own
 * `p-4` (17) plus the 88px avatar plus `gap-4` (16), four numbers in three
 * files, none of which is wrong on its own. And the tabs' 72 is the back
 * button's box plus `gap-3` — where the box is 44px NOT because a class says
 * so but because `:where(button …)` in index.css floors every button at 44.
 * A source-level guard reading `w-10` would have computed 68 and agreed with
 * a screen showing 72. Only a rendered page can referee that, which is also
 * how the first build of the fix was caught landing the landing at 68.
 *
 * ─── THE CLAIM ─────────────────────────────────────────────────────────────
 * At 1440 and 375: the landing's `<h1>` starts at exactly the same x as every
 * Profile TAB's `<h1>`, and every tab agrees with every other tab. Exact
 * equality, not a tolerance — a 4px disagreement is what this exists to
 * catch. The first content card is checked on the same pass, because "the
 * title moved and took the body with it" must not pass as agreement.
 *
 * The tab inventory is the app's own `Tab` union (src/pages/profile/types.ts),
 * so a tab added tomorrow is measured tomorrow, and the parse is floored so a
 * rotted regex fails loudly instead of checking nothing.
 *
 * ─── VACUITY ───────────────────────────────────────────────────────────────
 * Every leg would pass by measuring nothing, so: the parse must yield at
 * least 20 tabs; each surface must produce BOTH an h1 and a card box or that
 * surface fails by name; and the run ends by shifting the landing's title 4px
 * in its own DOM and asserting the comparison goes red — the same 4px that
 * actually shipped for one build.
 *
 * Read-only against prod: navigates, measures, and mutates only its own last
 * page's DOM for the vacuity leg. Writes no row.
 *
 * Red on the original:
 *   PLAYWRIGHT_BASE_URL=https://www.louisianahelpr.com \
 *     npx playwright test --project=prod-audit profile-title-alignment
 * goes red on the landing at both widths until the fix is deployed.
 *
 * Shots land in LH_PROFILE_TITLE_SHOTS when set. Per CLAUDE.md they are not
 * evidence until someone has LOOKED:
 * `npm run review:record -- <png> <screen> <checked> <ok|defect>`.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

const SHOTS = process.env.LH_PROFILE_TITLE_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [1440, 375] as const;

/**
 * Every `?tab=` value, from the union the Profile router actually switches on
 * — the same source `src/components/profile/profileTabShell.test.ts` reads.
 * `landing` is in that union and is the surface under test, so it is measured
 * as the landing rather than as a tab.
 */
function profileTabs(): string[] {
  const src = readFileSync(resolve(process.cwd(), "src/pages/profile/types.ts"), "utf8");
  const union = /export type Tab\s*=\s*([^;]+);/.exec(src)?.[1] ?? "";
  return [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const ALL_TABS = profileTabs();
const TABS = ALL_TABS.filter((t) => t !== "landing");

test("the tab inventory is the app's own, and is not empty", () => {
  expect(
    ALL_TABS.length,
    "no ?tab= values parsed out of src/pages/profile/types.ts — this guard has rotted",
  ).toBeGreaterThanOrEqual(20);
  expect(ALL_TABS, "the landing must be in the union it is measured against").toContain("landing");
});

interface TitleBox {
  /** The page's first `<h1>` — the page title on every Profile surface. */
  h1: { left: number; text: string } | null;
  /** The first content card under it. */
  card: { left: number } | null;
  /** Horizontal overflow, because a title that fits by pushing the page does not fit. */
  overflow: number;
}

function readTitle(): TitleBox {
  const h1 = document.querySelector("h1");
  const hr = h1?.getBoundingClientRect();
  // The first real content card: a rounded, painted box wide enough to be a
  // card and below the top of the viewport. Deliberately NOT a class name —
  // the landing and the tabs draw their cards with different classes, and the
  // question is where the content edge IS.
  const card = Array.from(document.querySelectorAll("div,section"))
    .filter((e) => {
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return (
        parseFloat(cs.borderTopLeftRadius) >= 8 &&
        b.width > 150 &&
        b.height > 40 &&
        b.top > 0 &&
        (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none")
      );
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  const cr = card?.getBoundingClientRect();
  return {
    h1: hr ? { left: Math.round(hr.left), text: (h1!.textContent || "").trim().slice(0, 40) } : null,
    card: cr ? { left: Math.round(cr.left) } : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

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
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
        );
      } catch {
        /* signed out: the assertions below fail visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
  );
  return { ctx, page: await ctx.newPage() };
}

/** Open one Profile surface and read its title line. */
async function measure(page: Page, url: string, tag: string): Promise<TitleBox> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Wait for a real title, not a skeleton bar: the skeleton draws a title ROW
  // but no <h1>, so this is also what keeps the measurement off the bones.
  await page.waitForSelector("h1", { state: "attached", timeout: 45_000 });
  await page.waitForFunction(() => (document.querySelector("h1")?.textContent || "").trim().length > 0, {
    timeout: 45_000,
  });
  await page.waitForTimeout(900);
  const box = await page.evaluate(readTitle);
  expect(box.h1, `${tag}: no <h1> on the page at all`).not.toBeNull();
  expect(box.card, `${tag}: no content card — nothing to measure the title against`).not.toBeNull();
  return box;
}

for (const vw of WIDTHS) {
  test(`every Profile title starts on the same x @${vw}`, async ({ browser }, info) => {
    const { ctx, page } = await authedPage(browser, vw, info.project.use.baseURL);
    try {
      const landing = await measure(page, "/profile", `landing@${vw}`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `landing-${vw}.png`) });
      info.annotations.push({
        type: "profile-title",
        description: `landing@${vw} h1="${landing.h1!.text}" left=${landing.h1!.left} card=${landing.card!.left}`,
      });
      console.log(
        `[profile-title] landing@${vw} h1="${landing.h1!.text}" left=${landing.h1!.left} card=${landing.card!.left}`,
      );
      expect(landing.overflow, `landing@${vw}: the page scrolls sideways`).toBeLessThanOrEqual(0);

      const disagree: string[] = [];
      for (const tab of TABS) {
        const box = await measure(page, `/profile?tab=${tab}`, `?tab=${tab}@${vw}`);
        console.log(
          `[profile-title] ?tab=${tab}@${vw} h1="${box.h1!.text}" left=${box.h1!.left} card=${box.card!.left}`,
        );
        if (box.h1!.left !== landing.h1!.left) {
          disagree.push(
            `?tab=${tab} title at x=${box.h1!.left} against the landing's ${landing.h1!.left}`,
          );
        }
        if (box.card!.left !== landing.card!.left) {
          disagree.push(
            `?tab=${tab} first card at x=${box.card!.left} against the landing's ${landing.card!.left}`,
          );
        }
        expect(box.overflow, `?tab=${tab}@${vw}: the page scrolls sideways`).toBeLessThanOrEqual(0);
      }

      expect(
        disagree,
        `@${vw}: Profile surfaces disagree about where a page title starts. The owner's ` +
          `report on 2026-09-20 was exactly this — the landing's title at x=145 while all ` +
          `25 tabs sat at x=72 — and the fix was to put the landing on the same PageHeader ` +
          `rather than to nudge it. A disagreement here means one surface has left that ` +
          `shell again.`,
      ).toEqual([]);

      // ── VACUITY: the 4px that actually shipped ─────────────────────────
      // The first build of this fix reserved the back slot from the back
      // button's Tailwind classes (`w-10` = 40px) while the button itself
      // renders at 44 under the app's tap-target floor, and the landing came
      // out at 68 against the tabs' 72. Reproduce that offset here and the
      // comparison above must go red — otherwise it is comparing a number
      // with itself.
      await page.goto("/profile", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { state: "attached", timeout: 45_000 });
      await page.waitForTimeout(600);
      const before = (await page.evaluate(readTitle)).h1!.left;
      await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        if (h1) (h1 as HTMLElement).style.marginLeft = "-4px";
      });
      const nudged = (await page.evaluate(readTitle)).h1!.left;
      info.annotations.push({
        type: "profile-title",
        description: `vacuity@${vw}: landing title ${before} → ${nudged} after a -4px nudge`,
      });
      expect(
        nudged,
        `@${vw}: nudging the landing's title by 4px did not move the number this spec ` +
          `compares, so the equality above cannot fail and proves nothing.`,
      ).not.toBe(before);
    } finally {
      await ctx.close();
    }
  });
}
