/**
 * AN OPEN SEARCH NEVER COVERS THE PAGE TITLE.
 *
 * Owner, 2026-10-01, from the iOS app: "Search should not cover the page
 * titles in app." On a phone, opening the header search on Jobs, My Posts and
 * Messages took the title's place: ScreenHeaderRow's `narrowTitleStepsAside`
 * hid the visible title below 500px and handed its width to the field, so the
 * field sat exactly where the title had been.
 *
 * Measured before the fix (2026-10-01, both engines): at 375 jobs, posts and
 * messages showed their title closed and none open ("My Jobs" / "My Posts" /
 * "Messages" gone, the field in its place). The fix: below 500px the row
 * wraps and the field takes its own line under the title.
 *
 * For every expanding search, this measures the page title (the screen's
 * <h1>, or its visible twin when the <h1> is sr-only) closed, then opens the
 * field and measures again:
 *   - a title that was shown closed is still shown open (at 1440 /jobs and
 *     /posts carry no visible title by design — the tab row is the header —
 *     so there is nothing there to cover, and the check says so);
 *   - its box and the open field's box do not intersect.
 * At 375 and 1440, Chromium and WebKit (the iOS app is WKWebView).
 *
 * Run: PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit search-keeps-title --workers=1
 */
// @mutate src/components/ui/ScreenHeaderRow.tsx | "max-[499px]:max-w-none max-[499px]:flex-1 max-[499px]:min-w-0" | "max-[499px]:[div:has(input)>&]:hidden"

import { test, expect, webkit, type Browser } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

/** Every expanding header search whose row carries the page title. Home's
 * phone search replaces the emblem row, which holds no title (the <h1> lives
 * in the feed toolbar below it); it is measured too, so a title that IS
 * covered there would fail the same way. */
const SURFACES: { name: string; file: string; url: string; trigger: string; field: string; minWidth?: number; maxWidth?: number }[] = [
  { name: "jobs", file: "src/pages/jobs/JobsHeader.tsx", url: "/jobs", trigger: "[data-search-trigger]", field: 'input[aria-label="Search jobs"]' },
  { name: "posts", file: "src/pages/posts/PostsHeader.tsx", url: "/posts", trigger: "[data-search-trigger]", field: 'input[aria-label="Search jobs"]' },
  { name: "messages", file: "src/components/messages/ConversationList.tsx", url: "/messages", trigger: "[data-search-trigger]", field: 'input[aria-label="Search conversations"]' },
  {
    name: "saved-helprs", file: "src/components/profile/SavedHelpersTab.tsx",
    url: "/profile?tab=saved_helpers",
    trigger: 'button[aria-label="Search saved Helprs"]',
    field: 'input[aria-label="Search saved Helprs"]',
  },
  { name: "legal", file: "src/pages/info/Legal.tsx", url: "/legal", trigger: 'button[aria-label="Search all policies"]', field: 'input[aria-label="Search all policies"]' },
  { name: "browse-phone", file: "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx", url: "/home", trigger: "[data-search-trigger]", field: 'input[aria-label="Search jobs"]', maxWidth: 899 },
  {
    name: "browse-desktop-strip", file: "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
    url: "/home",
    trigger: "[data-feed-strip] [data-search-trigger]",
    field: '[data-feed-strip] input[aria-label="Search jobs"]',
    minWidth: 900,
  },
];

/** Runs in the page. The title (h1, or its visible leaf twin) and the field
 * box, and how much they overlap. */
const measure = (fieldSel: string) => {
  const f = document.querySelector(fieldSel) as HTMLElement | null;
  const fr = f?.getBoundingClientRect();
  const h1 = document.querySelector("h1");
  const text = (h1?.textContent ?? "").trim();
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const srOnly = r.width <= 1 || r.height <= 1 || cs.clip === "rect(0px, 0px, 0px, 0px)";
    return !srOnly && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && r.right > 0 && r.left < innerWidth;
  };
  // The <h1> itself when it renders; otherwise its visible twin —
  // the innermost element carrying exactly the same text.
  let title: Element | null = h1 && shown(h1) ? h1 : null;
  if (!title && text) {
    const twins = [...document.body.querySelectorAll("*")].filter(
      (el) => el !== h1 && el.children.length === 0 && (el.textContent ?? "").trim() === text && shown(el),
    );
    title = twins[0] ?? null;
  }
  const tr = title?.getBoundingClientRect();
  const ix = fr && tr ? Math.max(0, Math.min(fr.right, tr.right) - Math.max(fr.left, tr.left)) : 0;
  const iy = fr && tr ? Math.max(0, Math.min(fr.bottom, tr.bottom) - Math.max(fr.top, tr.top)) : 0;
  const r = (b?: DOMRect) => (b ? { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } : null);
  return { text, titleShown: !!title, title: r(tr), field: r(fr), overlapArea: +(ix * iy).toFixed(1) };
};

const SHOTS = process.env.LH_SEARCH_SHOTS;

for (const engine of ["chromium", "webkit"] as const) {
  for (const vw of [375, 1440] as const) {
    for (const s of SURFACES) {
      test(`${s.name}: the open search leaves the page title visible and uncovered @${vw} ${engine}`, async ({ browser: def }, info) => {
        test.skip(!!s.minWidth && vw < s.minWidth, `${s.name} does not render at ${vw}`);
        test.skip(!!s.maxWidth && vw > s.maxWidth, `${s.name} does not render at ${vw}`);
        test.setTimeout(120_000);
        const browser: Browser = engine === "chromium" ? def : await webkit.launch();
        const ctx = await browser.newContext({
          baseURL: info.project.use.baseURL,
          viewport: { width: vw, height: vw >= 900 ? 900 : 812 },
          serviceWorkers: "block",
        });
        try {
          await ctx.addInitScript(
            ({ key, val }) => {
              try {
                localStorage.setItem(key, val);
                localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
              } catch {
                /* signed out: the trigger wait below fails visibly */
              }
            },
            { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
          );
          const page = await ctx.newPage();
          await page.goto(s.url, { waitUntil: "domcontentloaded" });
          const trigger = page.locator(s.trigger).first();
          await trigger.waitFor({ state: "visible", timeout: 45_000 });
          await page.waitForTimeout(1000);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name}-${vw}-${engine}-closed.png` });
          const closed = await page.evaluate(measure, s.field);
          await trigger.click();
          const field = page.locator(s.field).first();
          await field.waitFor({ state: "visible", timeout: 10_000 });
          await field.fill("plumb");
          await page.waitForTimeout(450);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name}-${vw}-${engine}-open.png` });

          const m = await page.evaluate(measure, s.field);
          const msg = `${s.name}@${vw} ${engine}: title "${m.text}" closed shown=${closed.titleShown} open shown=${m.titleShown} ${JSON.stringify(m.title)} field ${JSON.stringify(m.field)} overlap ${m.overlapArea}px²`;
          info.annotations.push({ type: "title", description: msg });
          console.log(msg);
          expect(m.field, `${msg} — the field never opened`).not.toBeNull();
          if (s.name.startsWith("browse")) {
            // Home's header row has no title of its own; its only check is
            // that wherever the <h1> is, the field is not on top of it.
            expect(m.overlapArea, `${msg} — the field covers the title`).toBe(0);
          } else {
            // Not vacuous on a phone: every titled surface shows its title closed.
            if (vw === 375) expect(closed.titleShown, `${msg} — no visible title even closed; nothing was measured`).toBe(true);
            expect(m.titleShown, `${msg} — the title is gone while search is open`).toBe(closed.titleShown);
            expect(m.overlapArea, `${msg} — the field covers the title`).toBe(0);
          }
        } finally {
          await ctx.close();
          if (engine !== "chromium") await browser.close();
        }
      });
    }
  }
}
