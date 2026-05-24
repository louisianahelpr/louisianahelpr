import { test, expect } from "@playwright/test";
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
  { name: "02-guest-dashboard", url: "/jobs", auth: "anon" },
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
