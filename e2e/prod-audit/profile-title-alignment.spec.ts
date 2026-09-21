/**
 * EVERY PROFILE SURFACE PUTS ITS TITLE ON ONE LINE — the landing included.
 *
 * ─── THE REPORT ────────────────────────────────────────────────────────────
 * Owner, 2026-09-20: "align the landing title to x=72." Their whole complaint
 * across that evening was Profile surfaces not agreeing with each other, and
 * the landing's title was the last place they did not. Measured at 1440,
 * signed in, on the built app before the fix:
 *
 *     /profile (landing)     h1 left = 145     column edge = 24
 *     /profile?tab=<any>     h1 left =  72     column edge = 24
 *
 * and at 375, 141 against 68 with the column at 20 on both. The bodies already
 * agreed; only the title did not.
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
 * At 1440 and 375, on every Profile surface — the landing and all 25 tabs —
 * TWO exact numbers:
 *
 *   1. `.page-measure`'s CONTENT-BOX left, the shared column edge every
 *      Profile surface is drawn inside. 24 at 1440, 20 at 375. (Content-box,
 *      not border-box: the tab scroller is `px-3 -mx-3`, so its border edge is
 *      12px out and its content edge is the same 24 the landing's is.)
 *   2. `h1.left` MINUS that edge. 48 everywhere — the back slot (36) plus
 *      `gap-3` (12).
 *
 * Exact equality, not a tolerance: a 4px disagreement is what this exists to
 * catch. Two numbers rather than one because the title's absolute x can be
 * made to agree by dragging the whole column sideways, and that is not what
 * the owner asked for.
 *
 * WHAT IT DELIBERATELY DOES NOT MEASURE: "the first content card". That was
 * tried first and is not a sound invariant — the 25 tabs draw their bodies
 * with genuinely different components, so a generic "first rounded painted
 * box" finds the outer panel on Notifications (24), an inner record card on
 * Home History (44), a pill INSIDE the card on Support at 375 (12), and
 * nothing at all on Support at 1440. Those are four different things, not four
 * gutters, and a guard that reds on them would be a false-positive machine.
 * The column edge above is the same element on every surface, which is what
 * makes it assertable.
 *
 * The tab inventory is the app's own `Tab` union (src/pages/profile/types.ts),
 * so a tab added tomorrow is measured tomorrow, and the parse is floored so a
 * rotted regex fails loudly instead of checking nothing.
 *
 * ─── VACUITY ───────────────────────────────────────────────────────────────
 * Every leg would pass by measuring nothing, so: the parse must yield at
 * least 20 tabs; each surface must produce BOTH an `<h1>` with real text and a
 * `.page-measure` column or that surface fails by name; and the run ends by
 * shifting the landing's title 4px in its own DOM and asserting the compared
 * number moves — the same 4px that actually shipped for one build.
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
  /** `.page-measure`'s CONTENT-box left: the shared column edge. */
  column: number | null;
  /** h1.left − column. The number the back slot and `gap-3` decide. */
  indent: number | null;
  /** Horizontal overflow, because a title that fits by pushing the page does not fit. */
  overflow: number;
  /** Elements past the right edge — the half `overflow` is blind to. See readTitle. */
  pastRightEdge: string[];
}

function readTitle(): TitleBox {
  const h1 = document.querySelector("h1");
  const hr = h1?.getBoundingClientRect();
  // `.page-measure` is the one element every Profile surface shares — the
  // landing wraps its scroller in it, every tab wraps its own. Its CONTENT
  // edge is the column: the tab scroller carries `px-3 -mx-3`, so its border
  // edge sits 12px outside the column it actually draws into.
  const pm = document.querySelector(".page-measure");
  const pr = pm?.getBoundingClientRect();
  const column =
    pm && pr ? Math.round(pr.left + parseFloat(getComputedStyle(pm).paddingLeft)) : null;
  const left = hr ? Math.round(hr.left) : null;
  return {
    h1: hr ? { left: left!, text: (h1!.textContent || "").trim().slice(0, 40) } : null,
    column,
    indent: left !== null && column !== null ? left - column : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    /**
     * `overflow` above cannot see most overflow, and the reason is our own CSS:
     * `src/index.css` sets `body { overflow-x: hidden }` to absorb the 1-2px the
     * .full-bleed -50vw trick spills, which also stops documentElement.scrollWidth
     * growing. Measured 2026-09-21 in mobile-viewports: a deliberately 1400px-wide
     * element left the identical metric reading zero at every width.
     *
     * A bounding rect does not care what an ancestor clips, so the real check is
     * per element — the second clause of CLAUDE.md's proof-of-fit rule, and what
     * `measureLayout` in auditRoutes.ts has always used as `overflowOffenders`.
     */
    pastRightEdge: (() => {
      const vw = window.innerWidth;
      const out: string[] = [];
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>("button, a, input, h1, h2, h3, p, li, label"),
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.display === "none") continue;
        if (r.right > vw + 2 && r.left < vw) {
          out.push(`<${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}> right=${Math.round(r.right)}`);
          if (out.length >= 5) break;
        }
      }
      return out;
    })(),
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
  expect(
    box.column,
    `${tag}: no .page-measure column — nothing to measure the title against`,
  ).not.toBeNull();
  return box;
}

// Shown able to fail on the owner's 2026-09-20 report itself: the landing's
// title at x=145 while all 25 tabs sat at x=72. Indenting the shared
// ProfileTabHeader moves every TAB off the landing's column, which is the same
// disagreement seen from the other side — and the fix then was to put the
// landing on this shell, not to nudge a number, so this is the contract.
// @mutate src/components/profile/ProfileTabHeader.tsx | <div className="-mb-4"> | <div className="-mb-4 pl-8">

for (const vw of WIDTHS) {
  test(`every Profile title starts on the same x @${vw}`, async ({ browser }, info) => {
    const { ctx, page } = await authedPage(browser, vw, info.project.use.baseURL);
    try {
      const say = (tag: string, b: TitleBox) => {
        const line =
          `${tag}@${vw} h1="${b.h1!.text}" left=${b.h1!.left} column=${b.column} indent=${b.indent}`;
        info.annotations.push({ type: "profile-title", description: line });
        console.log(`[profile-title] ${line}`);
      };

      const landing = await measure(page, "/profile", `landing@${vw}`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `landing-${vw}.png`) });
      say("landing", landing);
      expect(landing.overflow, `landing@${vw}: the page scrolls sideways`).toBeLessThanOrEqual(0);
      expect(
        landing.pastRightEdge,
        `landing@${vw}: content past the right edge (body{overflow-x:hidden} hides this from scrollWidth)`,
      ).toEqual([]);

      const disagree: string[] = [];
      for (const tab of TABS) {
        const box = await measure(page, `/profile?tab=${tab}`, `?tab=${tab}@${vw}`);
        say(`?tab=${tab}`, box);
        if (box.column !== landing.column) {
          disagree.push(
            `?tab=${tab} draws into a column starting at x=${box.column} against the ` +
              `landing's ${landing.column}`,
          );
        }
        if (box.indent !== landing.indent) {
          disagree.push(
            `?tab=${tab} title sits ${box.indent}px into its column against the landing's ` +
              `${landing.indent}px (absolute x=${box.h1!.left} against ${landing.h1!.left})`,
          );
        }
        expect(box.overflow, `?tab=${tab}@${vw}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        expect(
          box.pastRightEdge,
          `?tab=${tab}@${vw}: content past the right edge (body{overflow-x:hidden} hides this from scrollWidth)`,
        ).toEqual([]);
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
