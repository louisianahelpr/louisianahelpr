/**
 * THE BUILT CSS DRAWS THE DESKTOP RAIL (PR-time; follow-up to the 2026-11-05 rail hotfix).
 *
 * 2026-11-05: the signed-in desktop left rail was display:none on every page for ~10 hours (8ec1841d7f, live 12:57 PM,
 * until 2e5de1df25). The only spec that measures the rail, e2e/prod-audit/rail-inset.spec.ts, runs against PROD with
 * the shared accounts, so it runs only on prod-audit's schedule (Sun/Thu 01:17 UTC) and in post-merge vacuity; no PR
 * check looked at the rail, and #4144's train went green. Cause: the inlined first-screen CSS
 * (<style id="lh-shell-css">, scripts/inline-shell-css.mjs) sat AFTER the app sheet link, so its `.hidden{display:none}`
 * beat the sheet's `@media (min-width:900px){.lg\:flex{display:flex}}`; the rail's classes are `hidden lg:flex`.
 *
 * The claim, on the BUILT dist this PR job serves (`npm run build` = vite + every post-processor, then vite preview):
 * the real built index.html head, every script removed (no app JS, no Supabase, no request beyond this preview
 * server: there is nothing to mock), the async app sheet switched on the way its own swap script does it, and an
 * element wearing the rail's own static classes (read from src/components/DesktopSidebarNav.tsx). From the `lg`
 * breakpoint (tailwind.config.ts, 900 px) and at 1024 and 1440 it is display:flex, 248 px wide, flush at x=0; one px
 * below `lg` it is display:none. Red on 2e5de1df25's parent (block after the sheet link): display none at every width.
 */
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";

const RAIL_SRC = readFileSync("src/components/DesktopSidebarNav.tsx", "utf8");
// className={`fixed left-0 top-0 bottom-0 z-40 hidden lg:flex lg:flex-col ${sidePanelOpen ? "visible" : "invisible"}`}
const RAIL_CLASSES = /data-desktop-sidebar="left"\s+className=\{`([^`$]+)\$\{sidePanelOpen \? "visible"/.exec(RAIL_SRC)?.[1]?.trim();
const LG = Number(/screens:\s*\{\s*lg:\s*"(\d+)px"/.exec(readFileSync("tailwind.config.ts", "utf8"))?.[1]);
const PROBE = "/__rail-css-probe";

/** Our own built head with every script element dropped (any case; repeated until nothing is left to drop). */
function withoutScripts(html: string): string {
  let prev: string;
  let out = html;
  do {
    prev = out;
    out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*>/gi, "");
  } while (out !== prev);
  return out;
}

test("the rail's own classes read from the component (the parser works)", () => {
  expect(RAIL_CLASSES).toMatch(/\bhidden\b/);
  expect(RAIL_CLASSES).toMatch(/\blg:flex\b/);
  expect(LG).toBeGreaterThan(0);
});

for (const [width, display] of [[LG - 1, "none"], [LG, "flex"], [1024, "flex"], [1440, "flex"]] as const) {
  test(`the built head draws the rail's classes as display:${display} @ ${width}`, async ({ page, baseURL }) => {
    const built = await (await page.request.get(`${baseURL ?? ""}/`)).text();
    expect(built, "the built head carries the inlined first-screen CSS").toContain('<style id="lh-shell-css">');
    expect(built, "the built head carries the async app sheet").toMatch(/<link rel="stylesheet" href="\/assets\/[^"]+\.css" media="print" data-async-css>/);
    const head = withoutScripts(built.slice(0, built.indexOf("</head>")))
      // What vite.config.ts's swap script does once the sheet loads: same element, same place in the head.
      .replace(/ media="print" data-async-css>/g, ' media="all" data-async-css>');
    const probe = `${head}</head><body><nav data-probe class="${RAIL_CLASSES} visible" style="width:var(--desktop-sidebar-w, 248px)"></nav></body></html>`;
    await page.route(`**${PROBE}`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: probe }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PROBE);
    await page.waitForFunction(() => [...document.styleSheets].some((s) => s.href?.includes("/assets/")));
    const got = await page.locator("nav[data-probe]").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { display: getComputedStyle(el).display, left: r.left, width: r.width };
    });
    console.log(`RAIL-CSS @ ${width}: ${JSON.stringify(got)}`);
    expect(got.display).toBe(display);
    if (display === "flex") {
      expect(got.left).toBe(0);
      expect(Math.abs(got.width - 248)).toBeLessThanOrEqual(1);
    }
  });
}
