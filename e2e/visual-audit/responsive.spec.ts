import { test, expect } from "../prodTest";
import {
  FAKE_CUSTOMER,
  installSupabaseMocks,
  seedAuthedSession,
} from "../happy-path/fixtures";
import fs from "node:fs";
import path from "node:path";

// Responsive UI audit — capture 6 key screens at 4 viewport widths each
// (24 screenshots total). DOES NOT make code fixes; the orchestrator
// reviews the output. Saved into /tmp/responsive-audit/ as
// <width>-<screenName>.png plus a per-combo OK/issue log to
// /tmp/responsive-audit/_report.json.

const OUTPUT_DIR = "/tmp/responsive-audit";
const REPORT_PATH = path.join(OUTPUT_DIR, "_report.json");

interface Viewport {
  width: number;
  label: string;
}

interface Screen {
  name: string;
  url: string;
  auth: "anon" | "authed";
}

const VIEWPORTS: Viewport[] = [
  { width: 320, label: "iPhoneSE" },
  { width: 375, label: "iPhone13mini" },
  { width: 414, label: "iPhoneProMax" },
  { width: 768, label: "iPadPortrait" },
];

const SCREENS: Screen[] = [
  { name: "01-landing", url: "/", auth: "anon" },
  { name: "02-guest-dashboard", url: "/browse", auth: "anon" },
  { name: "03-authed-dashboard", url: "/dashboard", auth: "authed" },
  { name: "04-post-job", url: "/post-job", auth: "authed" },
  { name: "05-profile", url: "/profile", auth: "authed" },
  { name: "06-activity", url: "/my-jobs", auth: "authed" },
];

interface ComboResult {
  screen: string;
  url: string;
  width: number;
  viewport: string;
  file: string;
  status: "OK" | "issue" | "failed" | "skipped";
  notes: string[];
}

const allResults: ComboResult[] = [];

function ensureOutput() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function persistReport() {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(allResults, null, 2));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  ensureOutput();
});

test.afterAll(() => {
  persistReport();
});

for (const screen of SCREENS) {
  for (const vp of VIEWPORTS) {
    test(`${screen.name} @ ${vp.width}w (${vp.label})`, async ({
      context,
      page,
    }, testInfo) => {
      testInfo.setTimeout(180_000); // 3-min per combo budget

      const fileName = `${vp.width}-${screen.name}.png`;
      const filePath = path.join(OUTPUT_DIR, fileName);
      const notes: string[] = [];
      const result: ComboResult = {
        screen: screen.name,
        url: screen.url,
        width: vp.width,
        viewport: vp.label,
        file: filePath,
        status: "OK",
        notes,
      };

      try {
        // Block the workbox service worker from registering in the test
        // context. Without this, `dist/sw.js` activates mid-suite and emits
        // a `/?_v=<timestamp>` version-bump redirect that white-screens
        // every subsequent navigation in the same browser context. See
        // issue #329.
        await page.route("**/sw.js", (route) =>
          route.fulfill({ status: 404, body: "" }),
        );
        await page.route("**/workbox-*.js", (route) =>
          route.fulfill({ status: 404, body: "" }),
        );

        await page.setViewportSize({ width: vp.width, height: 800 });

        if (screen.auth === "authed") {
          await seedAuthedSession(context, FAKE_CUSTOMER, "http://localhost:4173");
          await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
        } else {
          // Anon — install empty-array supabase mocks so any opportunistic
          // call doesn't 404 / blank the page.
          await installSupabaseMocks(page);
        }

        await page.goto(screen.url, { waitUntil: "domcontentloaded" });

        // Best-effort networkidle, but don't hang forever — some app
        // surfaces hold open long-poll-ish requests.
        await page
          .waitForLoadState("networkidle", { timeout: 8_000 })
          .catch(() => notes.push("networkidle timeout (8s); continued"));

        await page
          .evaluate(() => (document as Document & { fonts?: { ready: Promise<void> } }).fonts?.ready)
          .catch(() => {});

        // Small settle for animation, transition, etc.
        await page.waitForTimeout(600);

        await page.screenshot({ path: filePath, fullPage: false });

        // --- Heuristic bug detection ---
        const evalResult = await page.evaluate(() => {
          const doc = document.documentElement;
          const horizontalScroll =
            doc.scrollWidth > doc.clientWidth + 1;
          const viewportW = window.innerWidth;
          const viewportH = window.innerHeight;
          const offCanvas: Array<{
            tag: string;
            cls: string;
            id: string;
            rect: { x: number; y: number; w: number; h: number };
          }> = [];
          // Inspect text-bearing or interactive elements that are visible
          // but extend past the right edge of the viewport.
          const nodes = Array.from(
            document.querySelectorAll<HTMLElement>(
              "button, a, input, textarea, select, [role=button], h1, h2, h3, p, li, label",
            ),
          );
          for (const el of nodes) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const style = getComputedStyle(el);
            if (style.visibility === "hidden" || style.display === "none") continue;
            if (r.right > viewportW + 2 && r.left < viewportW) {
              offCanvas.push({
                tag: el.tagName.toLowerCase(),
                cls: (el.className || "").toString().slice(0, 60),
                id: el.id || "",
                rect: {
                  x: Math.round(r.left),
                  y: Math.round(r.top),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                },
              });
              if (offCanvas.length >= 5) break;
            }
          }
          return {
            horizontalScroll,
            docScrollWidth: doc.scrollWidth,
            viewportW,
            viewportH,
            offCanvas,
            currentUrl: window.location.pathname + window.location.search,
            title: document.title,
            bodyTextLength: (document.body.innerText || "").length,
          };
        });

        if (evalResult.currentUrl !== screen.url) {
          notes.push(
            `navigated to ${evalResult.currentUrl} (expected ${screen.url})`,
          );
        }

        if (evalResult.bodyTextLength < 20) {
          notes.push(
            `nearly empty page body (text length=${evalResult.bodyTextLength}) — possible white-screen`,
          );
          result.status = "issue";
        }

        if (evalResult.horizontalScroll) {
          notes.push(
            `horizontal scrollbar present: scrollWidth=${evalResult.docScrollWidth} > viewport=${evalResult.viewportW}`,
          );
          result.status = "issue";
        }

        if (evalResult.offCanvas.length > 0) {
          notes.push(
            `${evalResult.offCanvas.length} element(s) overflow right of viewport: ` +
              evalResult.offCanvas
                .map(
                  (e) =>
                    `<${e.tag}${e.cls ? " ." + e.cls.split(" ")[0] : ""}> right=${e.rect.x + e.rect.w}`,
                )
                .join("; "),
          );
          result.status = "issue";
        }
      } catch (err) {
        result.status = "failed";
        notes.push(`exception: ${(err as Error).message}`);
      } finally {
        allResults.push(result);
        // Persist incrementally so a kill mid-suite still leaves report.
        try {
          persistReport();
        } catch {
          /* ignore */
        }
      }

      // We want the suite to keep running on issue — assertion only
      // fails on hard exceptions.
      expect(result.status === "failed").toBe(false);
    });
  }
}

// Shown able to fail on the defect it exists for. Forcing the hero's own
// wrapper wider than a 320px phone puts the landing page into horizontal
// scroll, which every version of this file could MEASURE and none could
// REPORT. The old `status === "failed"` assertion survives this mutation
// untouched — no exception is thrown, the page simply does not fit.
// @mutate src/components/landing/HeroSection.tsx | <div className="relative z-10 w-full mx-auto max-w-5xl flex flex-col items-center text-center gap-10 sm:gap-14 lg:gap-16"> | <div style={{ minWidth: 900 }} className="relative z-10 w-full mx-auto max-w-5xl flex flex-col items-center text-center gap-10 sm:gap-14 lg:gap-16">
// ─────────────────────────────────────────────────────────────────────────────
// THE ASSERTION THIS FILE SPENT ITS LIFE WITHOUT.
//
// 240 lines, 24 tests, and one `expect`: `result.status === "failed"` is false.
// `"failed"` is set ONLY by the catch block, i.e. by a thrown exception. Every
// defect this spec actually detects — a horizontal scrollbar, elements
// overflowing right of the viewport, the other layout checks above — sets
// `"issue"`, and NOTHING read that. The suite passed with horizontal scroll on
// every screen at every width, which is the one defect CLAUDE.md singles out
// ("Every page fits the screen at every breakpoint: zero horizontal overflow")
// and the reason the file measures 320/375/414/768 at all.
//
// The per-test assertion stays as it was, and the comment beside it was right:
// `mode: "serial"` means a failing test SKIPS the rest of the describe, so
// asserting `"issue"` in place would stop the sweep at the first bad screen and
// hide the other 23. Hence a trailing aggregate: every screen is measured, and
// the run still fails if any of them had an issue.
//
// Measured 2026-09-21 before switching it on: 24 of 24 OK, so this reds nothing
// today. It is a guard that could not fire, not a backlog being deferred.
test("zz every viewport was free of layout issues", () => {
  const bad = allResults.filter((r) => r.status === "issue");
  expect(
    bad.map((r) => `${r.screen} @ ${r.viewport}: ${(r.notes ?? []).join(" || ")}`),
    `LAYOUT ISSUES. Each line is a screen/width whose measurements came back\n` +
      `wrong — horizontal scroll, or an element past the right edge. Screenshots\n` +
      `and the full report are in ${OUTPUT_DIR}.`,
  ).toEqual([]);
});
