/**
 * Q1102: in Senior mode no visible text is CUT without an ellipsis.
 *
 * The 2026-09-01 report measured Senior mode amputating characters
 * ("St. Martinville" -48px, "Opelousas" -43px, "Baton Rouge" -39px, and a 40px
 * hard clip with no ellipsis on a job card at 320). The blanket fix was
 * reverted; the per-component one (src/index.css: .job-meta-row wraps,
 * opt-in .senior-clamp-2 with overflow-wrap:anywhere, wrapping names) landed,
 * but nothing held it. Re-measured on prod 2026-10-07 (poster-e2e, Senior mode
 * on, the feed's city replaced by "St. Martinville" to stress it): /home,
 * /jobs, /posts, /messages, /profile, /help at 320 and 375 have NO visible
 * text cut without an ellipsis; the only clipped text is ellipsized (the feed
 * card's city at 320, the owner's one-line card rule; the Messages title at
 * 320).
 *
 * This is that measurement as a check: every visible element whose own text
 * overflows a hidden/clipped box must be ellipsized (text-overflow: ellipsis
 * or a line clamp). sr-only text is skipped: it is clipped by design.
 */
// @mutate src/components/dashboard/JobCard.tsx | <span className="truncate font-sans min-w-[4.5rem]">{cityState}</span> | <span className="font-sans min-w-[4.5rem] whitespace-nowrap">{cityState}</span>

import { test, expect } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

const ROUTES = ["/home", "/jobs", "/posts", "/messages", "/profile", "/help"];

for (const vw of [320, 375] as const) {
  for (const route of ROUTES) {
    test(`senior mode: no visible text is cut without an ellipsis on ${route} @${vw}`, async ({ browser }, info) => {
      test.setTimeout(90_000);
      const ctx = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: vw, height: 812 }, serviceWorkers: "block" });
      try {
        await ctx.addInitScript(({ key, val }) => {
          try {
            localStorage.setItem(key, val);
            localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
          } catch {
            /* signed out: the route check below fails visibly */
          }
        }, { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) });
        const page = await ctx.newPage();
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await page.locator("main, [role=main], #root").first().waitFor({ state: "visible", timeout: 45_000 });
        await page.waitForTimeout(5000);
        await page.evaluate(() => document.documentElement.classList.add("senior-mode"));
        // The longest parish name the original report measured, in place of
        // whatever city the shared account's feed shows today.
        const stressed = await page.evaluate(() => {
          let n = 0;
          // A location label: the text right after a map-pin icon.
          for (const pin of document.querySelectorAll("svg.lucide-map-pin")) {
            const e = pin.nextElementSibling;
            if (e && !e.children.length && (e.textContent || "").trim()) {
              e.textContent = "St. Martinville";
              n++;
            }
          }
          return n;
        });
        await page.waitForTimeout(400);
        // Cut = text clipped by its OWN hidden overflow with no ellipsis/clamp,
        // or text whose box runs past an ancestor that hides overflow (no
        // ellipsis can be drawn there at all: the 40px hard clip of the report).
        const cut = await page.evaluate(() => {
          const out: string[] = [];
          for (const e of document.querySelectorAll("body *")) {
            const el = e as HTMLElement;
            if (el.closest(".sr-only")) continue;
            if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim())) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const cs = getComputedStyle(el);
            if (el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX)) {
              if (cs.textOverflow !== "ellipsis" && cs.webkitLineClamp === "none") out.push(`"${(el.textContent || "").trim().slice(0, 30)}" cut by itself -${el.scrollWidth - el.clientWidth}px`);
              continue;
            }
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              if (!/(hidden|clip)/.test(getComputedStyle(a).overflowX)) continue;
              const ar = a.getBoundingClientRect();
              if (r.right > ar.right + 1 || r.left < ar.left - 1) {
                out.push(`"${(el.textContent || "").trim().slice(0, 30)}" cut by ${String(a.className).slice(0, 40)} -${Math.round(r.right - ar.right)}px`);
                break;
              }
            }
          }
          return out;
        });
        const msg = `${route}@${vw} senior: ${stressed} city label(s) stressed; ${cut.length} silent cut(s)`;
        info.annotations.push({ type: "measure", description: msg });
        console.log(`[senior-cut] ${msg}`);
        expect(cut, `${msg}:\n${cut.join("\n")}`).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
}
