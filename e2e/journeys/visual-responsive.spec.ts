import type { Request } from "@playwright/test";
import { test, expect, assertHealthy, getSession, isUserWrite, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";
import { findOffCanvas } from "../visual-audit/offCanvas";

/**
 * Journey — EVERY KEY SCREEN FITS THE PHONE AND TABLET, on the real backend.
 *
 * Moved here from the mocked e2e/visual-audit/responsive.spec.ts (Q1035: every
 * mocked spec is migrated to prod or retired, one at a time). The check is the
 * same: six key screens at four widths (320, 375, 414, 768) must have no
 * horizontal scroll, no visible element past the right edge, and a page body
 * that is not blank (CLAUDE.md: "Every page fits the screen at every
 * breakpoint: zero horizontal overflow"). The signed-in screens are the shared
 * test poster signed in for real, so each page draws its own prod rows; the
 * public screens are a real guest.
 *
 * ONE TEST PER SCREEN x WIDTH on purpose: the request budget is per test, and
 * the mocked file's 24 loads in one serial describe would not fit it. Because
 * each test is its own, each one asserts its own layout; the mocked file's
 * trailing "zz every viewport was free of layout issues" aggregate existed
 * only because a serial describe skips the rest after a failure.
 *
 * Read-only: it only opens screens. Any user write fails the test.
 */

type Viewport = { width: number; label: string };
type Screen = { name: string; url: string; auth: "anon" | "authed" };

const VIEWPORTS: Viewport[] = [
  { width: 320, label: "iPhoneSE" },
  { width: 375, label: "iPhone13mini" },
  { width: 414, label: "iPhoneProMax" },
  { width: 768, label: "iPadPortrait" },
];

const SCREENS: Screen[] = [
  { name: "01-landing", url: "/", auth: "anon" },
  { name: "02-guest-dashboard", url: "/browse", auth: "anon" },
  { name: "03-authed-dashboard", url: "/home", auth: "authed" },
  { name: "04-post-job", url: "/post-job", auth: "authed" },
  { name: "05-profile", url: "/profile", auth: "authed" },
  { name: "06-activity", url: "/jobs?tab=working", auth: "authed" },
];

// Shown able to fail on the defect it exists for: forcing the hero's own
// wrapper wider than a 320px phone puts the landing page into horizontal
// scroll, which the horizontal-scroll and past-the-edge assertions below catch.
// @mutate src/components/landing/HeroSection.tsx | <div data-testid="landing-hero-column" className="flex flex-col items-center text-center min-w-0"> | <div data-testid="landing-hero-column" style={{ minWidth: 900 }} className="flex flex-col items-center text-center min-w-0">

SCREENS.forEach((screen, si) => {
  VIEWPORTS.forEach((vp, vi) => {
    const rotation = rotationFor(40 + si * VIEWPORTS.length + vi);
    const title = scenarioTitle({
      journey: `visual-responsive-${screen.name}-${vp.width}`,
      persona: screen.auth === "authed" ? "poster-only" : "new",
      state: "approved",
      rotation,
      outcome: "smooth",
    });

    test(`${title} · ${screen.url} fits ${vp.width}px (${vp.label})`, async ({ browser, request, journey }) => {
      test.skip(filteredOut(title), "SCENARIO pins another scenario");
      const avail = sessionsAvailable();
      if (screen.auth === "authed") test.skip(!avail.ok, avail.why);
      test.setTimeout(120_000);

      const session = screen.auth === "authed" ? await getSession(request, "poster") : null;
      const ctx = await newUserContext(browser, session);
      const writes: string[] = [];
      ctx.on("request", (req: Request) => {
        if (isUserWrite(req.method(), req.url()) || /\/rpc\/save_my_job_post_draft\b/.test(req.url())) {
          writes.push(`${req.method()} ${req.url().slice(0, 140)}`);
        }
      });
      try {
        const page = journey.track(screen.auth === "authed" ? "poster" : "guest", await ctx.newPage());
        await page.setViewportSize({ width: vp.width, height: 800 });
        await page.goto(screen.url);
        await assertHealthy(page, `${screen.url} @ ${vp.width}`);
        await page
          .evaluate(() => (document as Document & { fonts?: { ready: Promise<void> } }).fonts?.ready)
          .catch(() => {
            /* fonts API missing: measure with what is drawn */
          });

        const offCanvas = await page.evaluate(findOffCanvas);
        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            viewportW: window.innerWidth,
            at: window.location.pathname + window.location.search,
            bodyText: (document.body.innerText || "").length,
          };
        });
        console.log(
          `[responsive] ${screen.name} @ ${vp.width}: scrollWidth ${m.scrollWidth}/${m.clientWidth}, ` +
            `${offCanvas.length} past the edge, body ${m.bodyText} chars, at ${m.at}`,
        );
        await journey.milestone(page, `responsive-${screen.name}-${vp.width}`);

        expect(m.bodyText, `${screen.url} @ ${vp.width}: nearly empty page body (possible white screen)`).toBeGreaterThanOrEqual(20);
        expect(
          m.scrollWidth,
          `${screen.url} @ ${vp.width}: horizontal scroll (scrollWidth ${m.scrollWidth} > viewport ${m.viewportW})`,
        ).toBeLessThanOrEqual(m.clientWidth + 1);
        expect(
          offCanvas.map((e) => `<${e.tag}${e.cls ? " ." + e.cls.split(" ")[0] : ""}> right=${e.rect.x + e.rect.w}`),
          `${screen.url} @ ${vp.width}: element(s) past the right edge`,
        ).toEqual([]);
        expect(writes, "the responsive journey is read-only: no user writes").toEqual([]);
      } finally {
        await ctx.close().catch(() => {});
      }
    });
  });
});
