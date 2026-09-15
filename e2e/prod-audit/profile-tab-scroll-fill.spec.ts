/**
 * PROFILE TABS SCROLL, AND THEIR CONTENT FILLS THE PAGE (owner, 2026-09-14).
 *
 * The two halves of docs/audit/visual-notes-2026-09-14.md that only a rendered
 * page can settle — both were fixed blind, in a code-only lane, and neither is
 * closed until these numbers move:
 *
 *   VN-46  "/profile?tab=notifications … this page doesn't scroll" — the list
 *          cut off under Promotions with a Test row and the security note
 *          unreachable. Cause: NotificationPreferences kept a `flex-1 min-h-0
 *          overflow-y-auto overscroll-contain` region after the card was moved
 *          off the height-constrained tab shell. Unbounded, so it never
 *          scrolled itself; `overscroll-contain`, so it would not chain the
 *          wheel to the page behind it either.
 *
 *   VN-37  "reviews and other pages still have that small gap to the left and
 *          right of content. content should fill that space."
 *
 * Geometry on the REAL authed page against prod, never jsdom — there is no
 * layout there, and a unit test can only assert the class strings
 * (src/components/profile/profileTabScroll.test.ts does exactly that, and
 * deliberately cannot see a pixel).
 *
 * Read-only: navigates and measures, toggles nothing, writes no row.
 *
 * Vacuity guards, because both checks are the kind that pass by measuring
 * nothing: the scroll test fails if the tab does not overflow its container in
 * the first place (nothing to scroll proves nothing), and the fill test fails
 * if it cannot find the frame, the card and the title.
 *
 * Red on the original: run against the live site before the fix ships —
 *   PLAYWRIGHT_BASE_URL=https://www.louisianahelpr.com \
 *   npx playwright test --project=prod-audit profile-tab-scroll-fill
 * VN-46 goes red at both widths ("nested scroller" + the bottom row clipped);
 * VN-37 goes red at 1440 only (the change is scoped to `xl`, ≥1280px).
 *
 * Shots land in LH_PROFILE_SHOTS when set. Per CLAUDE.md they are not evidence
 * until someone has LOOKED: `npm run review:record -- <png> <screen> <checked>
 * <ok|defect>`.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, settle, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;

test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

interface Geometry {
  /** The one scroll surface the tab is supposed to have. */
  scroller: { scrollHeight: number; clientHeight: number; overflows: boolean } | null;
  /** Any OTHER vertically scrollable element inside the tab — must be empty. */
  nested: string[];
  frame: { left: number; right: number } | null;
  card: { left: number; right: number } | null;
  /** The title BLOCK, not the <h1> glyph — see titleRow(). */
  title: { left: number; text: string } | null;
  docOverflow: number;
  widest: string | null;
}

function measure(): Geometry {
  const q = <T extends Element>(s: string) => document.querySelector<T>(s);
  const scrollerEl = q<HTMLElement>(".page-measure");
  // No `?? document.documentElement` fallback: that made the "no frame"
  // assertion below unfailable, which is the exact vacuity this spec polices.
  const frameEl = q<HTMLElement>(".app-shell-frame");

  const scrolls = (el: Element) => {
    const cs = getComputedStyle(el);
    return (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
  };

  const nested: string[] = [];
  if (scrollerEl) {
    for (const el of scrollerEl.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.overflowY === "auto" || cs.overflowY === "scroll" || cs.overscrollBehaviorY === "contain") {
        // A bounded scroller (a dialog listbox) is legitimate; an unbounded one
        // inside the tab is exactly the VN-46 defect.
        const bounded = cs.maxHeight !== "none" || cs.position === "fixed" || cs.position === "absolute";
        if (!bounded) nested.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 90)}`);
      }
    }
  }

  // The first real content card under the title, not the header itself.
  const cardEl = scrollerEl?.querySelector<HTMLElement>(".liquid-glass, [class*='rounded-2xl']") ?? null;

  // NOT the <h1>'s own rect. PageHeader lays the title row out as
  // [back chevron] [title column], so the h1's left edge sits a 44px tap
  // target plus a gap to the right of the row — measured 48px in at BOTH 375
  // and 1440, which is a property of the chevron, not of the page's gutter.
  // Asserting on it would fail forever and say nothing about VN-37. Climb to
  // the first ancestor that spans the content column: that block's left edge
  // is what "the title is edge-aligned with the card" actually means.
  const h1El = scrollerEl?.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("h1");
  let titleEl: HTMLElement | null = h1El;
  if (h1El && cardEl) {
    const want = cardEl.getBoundingClientRect().width - 2;
    for (let n: HTMLElement | null = h1El; n && n !== document.body; n = n.parentElement) {
      if (n.getBoundingClientRect().width >= want) { titleEl = n; break; }
    }
  }

  let widest: string | null = null;
  let widestW = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width > widestW + 1) {
      widestW = r.width;
      widest = `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 90)} ${Math.round(r.width)}px`;
    }
  }

  const rect = (el: HTMLElement | null) =>
    el ? { left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right) } : null;

  return {
    scroller: scrollerEl
      ? {
          scrollHeight: scrollerEl.scrollHeight,
          clientHeight: scrollerEl.clientHeight,
          overflows: scrolls(scrollerEl),
        }
      : null,
    nested,
    frame: rect(frameEl),
    card: rect(cardEl),
    title: titleEl
      ? { left: Math.round(titleEl.getBoundingClientRect().left), text: (titleEl.textContent ?? "").trim().slice(0, 40) }
      : null,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    widest,
  };
}

/**
 * Clear the app's own "We couldn't load your account" card if it is showing.
 *
 * Not a layout defect and not a harness bug: the profile query against prod
 * genuinely fails now and then, and the app handles it correctly by offering a
 * Try again button. Caught here because the 1440 run (which goes second) hit it
 * reproducibly while 375 passed — the spec reported it as an opaque
 * `locator('h1')` timeout, which reads like the page never rendered.
 *
 * So do what a user does, rather than widening a timeout around it: a timeout
 * bump would only have made the same hiccup take longer to report the wrong
 * cause.
 */
async function clearAccountHiccup(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const retry = page.getByRole("button", { name: /try again/i });
    if (!(await retry.count())) return;
    await retry.first().click();
    await settle(page);
    await page.waitForTimeout(1_500);
  }
}

async function openTab(page: Page, tab: string) {
  await page.goto(`/profile?tab=${tab}`);
  await settle(page);
  await clearAccountHiccup(page);
  await expect(
    page.locator("h1").first(),
    `no title on ?tab=${tab}. If the screenshot shows "We couldn't load your account", ` +
      `that is a backend hiccup the retry above could not clear, not a layout defect.`,
  ).toBeVisible({ timeout: 45_000 });
  // The panels are lazy AND query-backed: an <h1> can be painted while the tab
  // is still a Suspense skeleton, and measuring there reports the skeleton's
  // geometry (it did, on the first probe of this spec). Wait for real content.
  await expect(
    page.locator(".page-measure .liquid-glass").first(),
    `?tab=${tab} never rendered a content card`,
  ).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(900);
}

for (const vw of [375, 1440] as const) {
  test(`Profile tabs: one scroll surface and no dead gutter at ${vw}`, async ({ browser }, info) => {
    const ctx = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: { width: vw, height: vw === 1440 ? 900 : 812 },
      hasTouch: vw === 375,
      colorScheme: "light",
      serviceWorkers: "block",
    });
    await ctx.addInitScript(
      ({ key, val }) => {
        try {
          localStorage.setItem(key, val);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch {
          /* signed out: the h1 assertion fails visibly */
        }
      },
      { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
    );
    const page = await ctx.newPage();

    // ── VN-46 ────────────────────────────────────────────────────────────
    await openTab(page, "notifications");
    const notif = await page.evaluate(measure);
    info.annotations.push({
      type: "VN-46",
      description: `${vw}: scrollHeight ${notif.scroller?.scrollHeight} vs clientHeight ${notif.scroller?.clientHeight}; nested ${notif.nested.length}`,
    });

    expect(notif.scroller, "no .page-measure tab scroll container found").not.toBeNull();
    // Vacuity guard FIRST: if the tab fits, "it scrolls" is unprovable here.
    expect(
      notif.scroller!.scrollHeight,
      `Notifications fits in ${notif.scroller!.clientHeight}px at ${vw} — this check cannot fail, so it proves nothing. Widen the account's preference list or drop this viewport.`,
    ).toBeGreaterThan(notif.scroller!.clientHeight + 1);
    expect(notif.nested, `VN-46: an unbounded scroller is nested inside the tab at ${vw}`).toEqual([]);

    // The bottom must be REACHABLE, not merely overflowing.
    const bottom = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".page-measure");
      if (!el) return null;
      el.scrollTop = el.scrollHeight;
      return { scrollTop: el.scrollTop, max: el.scrollHeight - el.clientHeight };
    });
    await page.waitForTimeout(400);
    expect(bottom, "scroll container vanished").not.toBeNull();
    expect(
      bottom!.scrollTop,
      `VN-46: the tab would not scroll to its last row at ${vw} (stopped at ${bottom!.scrollTop} of ${bottom!.max})`,
    ).toBeGreaterThanOrEqual(bottom!.max - 2);

    // The two controls the owner named as cut off, now on screen.
    const testRow = page.getByRole("button", { name: /test/i }).first();
    if (await testRow.count()) {
      await expect(testRow, "VN-46: the Send-a-Test control is still not reachable").toBeInViewport();
    }

    if (process.env.LH_PROFILE_SHOTS) {
      const dir = process.env.LH_PROFILE_SHOTS;
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `vn46-notifications-${vw}-bottom.png`) });
    }

    // ── VN-37 ────────────────────────────────────────────────────────────
    await openTab(page, "reviews");
    const rev = await page.evaluate(measure);
    const gapL = rev.card && rev.frame ? rev.card.left - rev.frame.left : null;
    const gapR = rev.card && rev.frame ? rev.frame.right - rev.card.right : null;
    info.annotations.push({
      type: "VN-37",
      description: `${vw}: frame ${rev.frame?.left}→${rev.frame?.right}, card ${rev.card?.left}→${rev.card?.right} (gap L${gapL} R${gapR}), title x=${rev.title?.left} "${rev.title?.text}"`,
    });

    expect(rev.frame, "no .app-shell-frame").not.toBeNull();
    expect(rev.card, "no content card found in the reviews tab").not.toBeNull();
    expect(rev.title, "no <h1> on the reviews tab").not.toBeNull();

    // The owner's actual ask: the title block sits on the card's edge.
    expect(
      Math.abs(rev.title!.left - rev.card!.left),
      `VN-37: the title block (x=${rev.title!.left}) is not edge-aligned with the card (x=${rev.card!.left}) at ${vw}`,
    ).toBeLessThanOrEqual(1);

    // No dead band on one side only.
    expect(Math.abs((gapL ?? 0) - (gapR ?? 0)), `VN-37: side gaps disagree at ${vw} — L${gapL} R${gapR}`).toBeLessThanOrEqual(2);

    // The standing fit gates (CLAUDE.md "every page fits the screen").
    expect(rev.docOverflow, `horizontal overflow at ${vw}`).toBeLessThanOrEqual(0);
    expect(rev.widest, `an element is wider than the viewport at ${vw}`).toBeNull();

    // THE INVARIANT, and the one this spec exists for.
    //
    // It replaces a hard-coded "the card should sit 36px inside the frame",
    // which was written on 2026-09-14 from a misreading of VN-37 and would have
    // frozen that mistake into the suite. Profile is the one main screen not
    // built on PageScaffold, so the thing worth asserting is not a number — it
    // is that its tab pages land on the same edge as the screens that ARE.
    // Measured on prod at 1440 (frame 0->1192): /dashboard, /my-posts,
    // /messages all put `.page-panel` at 48->1144 and ?tab=reviews put its card
    // at 48->1144. Identical. A number would have to be re-chosen every time the
    // shared gutter changes; this does not.
    const sibling = await (async () => {
      await page.goto("/dashboard");
      await settle(page);
      await clearAccountHiccup(page);
      await expect(page.locator(".page-panel").first(), "no PageScaffold panel on /dashboard").toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(700);
      return page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".page-panel");
        const f = document.querySelector<HTMLElement>(".app-shell-frame");
        if (!el || !f) return null;
        const a = el.getBoundingClientRect(), b = f.getBoundingClientRect();
        return { left: Math.round(a.left - b.left), right: Math.round(b.right - a.right) };
      });
    })();
    info.annotations.push({
      type: "VN-37 parity",
      description: `${vw}: profile card inset L${gapL} R${gapR} vs PageScaffold panel inset L${sibling?.left} R${sibling?.right}`,
    });
    expect(sibling, "could not measure a PageScaffold sibling to compare against").not.toBeNull();
    expect(
      gapL,
      `VN-37: Profile tab cards sit ${gapL}px inside the frame at ${vw} while its PageScaffold ` +
        `siblings sit ${sibling!.left}px in. Profile is the one main screen not built on ` +
        `PageScaffold; its tab pages must land on the same edge, or the app has two gutters. ` +
        `If the gutter is meant to change, change it for the shared container, not for Profile.`,
    ).toBe(sibling!.left);

    if (process.env.LH_PROFILE_SHOTS) {
      await page.screenshot({ path: join(process.env.LH_PROFILE_SHOTS, `vn37-reviews-${vw}.png`) });
    }

    await ctx.close();
  });
}
