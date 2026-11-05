import type { Page, Request } from "@playwright/test";
import { test, expect, assertHealthy, getSession, isUserWrite, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — DOES THE APP WORK ON IPAD? on the real backend.
 *
 * Moved here from the mocked e2e/happy-path/ipad-render-check.spec.ts (Q1035:
 * every mocked spec is migrated to prod or retired, one at a time; Q1018 folded
 * in). App Review rejected 1.0 under guideline 2.1(a), "the content didn't load
 * after launched", on an iPad Air 11-inch. TARGETED_DEVICE_FAMILY is "1,2" with
 * all four orientations and UIRequiresFullScreen=false, so Split View too.
 *
 * The checks are the same; the account is the shared test Helpr signed in for
 * real, so every screen draws its own prod rows instead of a mock seed. The old
 * fixed `waitForTimeout` race (Q1018) is replaced by assertHealthy, which waits
 * until the screen is neither blank, stuck nor an error screen.
 *
 * Read-only: it only opens screens. Any user write during the run fails it.
 *
 * Pinned:
 *   1. /home renders real text at the four sizes Apple reviews with, with no
 *      sideways scroll.
 *   2. At iPad 11-inch portrait every main route renders text, does not scroll
 *      sideways, and has no element wider than the viewport.
 */
// Breaks the thing this spec exists to catch: App Review's 2.1(a) rejection
// was "the content didn't load". Emptying the Dashboard render is that
// rejection, reproduced.
// @mutate src/pages/home/Dashboard.tsx |   return (\n    <>\n    <PageScaffold |   if (true) return null;\n  return (\n    <>\n    <PageScaffold

const ROUTES = ["/home", "/post-job", "/messages", "/profile", "/profile?tab=subscription", "/jobs?tab=posted"];

const SIZES = [
  { name: "ipad-11-portrait", width: 834, height: 1194 },
  { name: "ipad-11-landscape", width: 1194, height: 834 },
  { name: "ipad-13-portrait", width: 1024, height: 1366 },
  { name: "ipad-splitview-half", width: 507, height: 1194 },
];

type Measure = { text: number; scrollWidth: number; clientWidth: number; widest: number };

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const widest = Array.from(document.querySelectorAll("*"))
      .map((el) => (el as HTMLElement).getBoundingClientRect().width)
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      text: (document.body.textContent ?? "").trim().length,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      widest: Math.round(widest),
    };
  });
}

const rotation = rotationFor(9);
const title = scenarioTitle({ journey: "ipad-render", persona: "helper-only", state: "approved", rotation, outcome: "smooth" });

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  test.setTimeout(300_000);

  const session = await getSession(request, "helper");
  const ctx = await newUserContext(browser, session, { desktop: true });
  const writes: string[] = [];
  ctx.on("request", (req: Request) => {
    if (isUserWrite(req.method(), req.url()) || /\/rpc\/save_my_job_post_draft\b/.test(req.url())) {
      writes.push(`${req.method()} ${req.url().slice(0, 140)}`);
    }
  });
  try {
    const page = journey.track("helper", await ctx.newPage());

    for (const size of SIZES) {
      await test.step(`/home at ${size.name} (${size.width}x${size.height}) has content and no sideways scroll`, async () => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto("/home");
        await assertHealthy(page, `/home @ ${size.name}`);
        const m = await measure(page);
        console.log(`[${size.name}] chars=${m.text} scrollW=${m.scrollWidth} clientW=${m.clientWidth}`);
        expect(m.text, `${size.name} rendered no text — this is the 2.1(a) failure`).toBeGreaterThan(50);
        expect(m.scrollWidth, `${size.name} scrolls horizontally`).toBeLessThanOrEqual(m.clientWidth + 1);
        await journey.milestone(page, `ipad-home-${size.name}`);
      });
    }

    await test.step("iPad 11-inch: every main route renders with no overflow", async () => {
      await page.setViewportSize({ width: 834, height: 1194 });
      const bad: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route);
        await assertHealthy(page, `${route} @ ipad-11-portrait`);
        const m = await measure(page);
        const overflow = m.scrollWidth > m.clientWidth + 1;
        const tooWide = m.widest > m.clientWidth + 1;
        const empty = m.text < 60;
        console.log(
          `  ${route.padEnd(28)} chars=${String(m.text).padStart(5)} scrollW=${m.scrollWidth} widest=${m.widest} ` +
            `${overflow ? "OVERFLOW " : ""}${tooWide ? "WIDE-EL " : ""}${empty ? "EMPTY" : ""}`,
        );
        if (overflow) bad.push(`${route}: horizontal overflow (${m.scrollWidth} > ${m.clientWidth})`);
        if (tooWide) bad.push(`${route}: element wider than viewport (${m.widest})`);
        if (empty) bad.push(`${route}: rendered almost no text (${m.text} chars)`);
      }
      expect(bad, `iPad problems:\n  ${bad.join("\n  ")}`).toEqual([]);
    });

    expect(writes, "the iPad pass is read-only, but these user writes went out").toEqual([]);
  } finally {
    await ctx.close();
  }
});
