// Overlay sweep — dialogs, sheets, popovers, dropdowns, alert dialogs.
//
// WHY THIS EXISTS
// The route sweep (visual-audit-sweep.spec.ts) captures each of the 68 routes
// in its RESTING state. Anything that needs a tap to appear was invisible to
// it: ~91 components in src/ render an overlay, and exactly none of them were
// ever audited. So "0 contrast failures, 0 overflow, correct headings" was
// only ever a statement about flat pages.
//
// That gap matters more than a normal coverage hole, because overlays fail in
// ways flat pages cannot: focus not trapped, Escape not closing, the page
// behind still scrolling, a sheet's primary action under the home indicator,
// content taller than the viewport with no internal scroll, and no accessible
// name on the dialog itself. Both of the last two owner-reported UI bugs (the
// select-mode dead band, the attach sheet) were overlay bugs found by eye.
//
// APPROACH
// Hand-writing 91 open sequences would be brittle and would only ever cover
// the overlays somebody remembered to list. Instead this PROBES: on each
// route it clicks every plausible trigger, detects whether an overlay
// appeared, and runs the check set against it. Anything reachable gets
// audited, including overlays nobody wrote down.
//
// Supabase is fully mocked (installSupabaseMocks), so clicking arbitrary
// buttons cannot write to a real backend. Navigation IS possible, so the
// prober snapshots the URL and returns if a click routed away.
//
// Run:
//   RUN_OVERLAY_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path overlay-sweep
//
// IMPORTANT: kill anything on :4173 first. playwright.config.ts sets
// reuseExistingServer: !CI, so a stale preview server is reused and you will
// silently measure an old dist/.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  installSupabaseMocks,
  mockTable,
  seedAuthedSession,
} from "./fixtures";

const OUTPUT_DIR = "/tmp/ui-review";
mkdirSync(OUTPUT_DIR, { recursive: true });

interface OverlayFinding {
  route: string;
  trigger: string;
  kind: string;
  issues: string[];
  violations: { id: string; impact: string | null; detail: string[] }[];
}

const findings: OverlayFinding[] = [];
const probed: string[] = [];

/** Selector matching any open overlay Radix renders. */
const OPEN_OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]';

/**
 * Routes to probe. Every route that carries interactive chrome — the static
 * legal/marketing pages are skipped because they have no triggers to click,
 * and probing them is pure wall-clock.
 */
const ROUTES = [
  "/dashboard",
  "/my-posts",
  "/my-jobs",
  "/messages",
  "/post-job",
  "/jobs",
  "/browse",
  "/profile",
  "/profile?tab=profile",
  "/profile?tab=payment",
  "/profile?tab=security",
  "/profile?tab=credentials",
  "/profile?tab=notifications",
  "/profile?tab=subscription",
  "/profile?tab=saved_helpers",
  "/profile?tab=schedule",
  "/profile?tab=availability",
  "/profile?tab=reviews",
  "/profile?tab=warnings",
  "/profile?tab=referral",
  "/profile?tab=support",
  "/profile?tab=legal",
  "/profile?tab=earnings",
  "/profile?tab=posted_jobs",
  "/profile?tab=completed_jobs",
  "/settings",
  "/schedule",
  "/pets",
  "/family",
  "/subscription",
  "/analytics",
  "/earnings",
  "/saved-helpers",
  "/str-settings",
  "/auto-tip",
  "/pay-it-forward",
  "/work-record",
  "/job-history",
  "/home-history",
  "/availability",
  "/business/team",
  "/business/billing",
  "/business/onboarding",
  "/jobs/10000000-0000-4000-8000-000000000001",
  `/user/${FAKE_CUSTOMER.id}`,
  "/admin",
];

/**
 * Check an OPEN overlay. Everything here is a failure mode a screenshot
 * cannot show, which is the whole point of probing rather than capturing.
 */
async function checkOpenOverlay(page: Page): Promise<{ kind: string; issues: string[] }> {
  return page.evaluate((sel) => {
    const issues: string[] = [];
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return { kind: "none", issues };

    const kind = el.getAttribute("role") ?? "popper";
    const r = el.getBoundingClientRect();

    // 1. Accessible name. A dialog announced as just "dialog" tells a screen
    //    reader user nothing about what they just opened.
    if (kind === "dialog" || kind === "alertdialog") {
      const labelled =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent?.trim());
      if (!labelled) issues.push("no accessible name (aria-label / aria-labelledby)");
    }

    // 2. Fits the viewport, or scrolls internally. A dialog taller than the
    //    screen with no internal scroll strands its own buttons off-screen.
    if (r.height > window.innerHeight + 1) {
      const cs = getComputedStyle(el);
      const scrolls =
        ["auto", "scroll"].includes(cs.overflowY) ||
        !!el.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]');
      if (!scrolls) issues.push(`taller than viewport (${Math.round(r.height)}px) with no internal scroll`);
    }
    if (r.width > window.innerWidth + 1) issues.push(`wider than viewport (${Math.round(r.width)}px)`);

    // 3. Focus must have moved inside. If it is still on the trigger, a
    //    keyboard user tabs through the PAGE BEHIND the overlay.
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active)) {
      issues.push("focus not moved into the overlay");
    }

    // 4. Background scroll lock. Without it the page behind scrolls under the
    //    overlay on touch, which reads as the app coming apart.
    const bodyLocked =
      getComputedStyle(document.body).overflow === "hidden" ||
      getComputedStyle(document.documentElement).overflow === "hidden" ||
      document.body.hasAttribute("data-scroll-locked");
    if ((kind === "dialog" || kind === "alertdialog") && !bodyLocked) {
      issues.push("background not scroll-locked");
    }

    // 5. Text below the type floor inside the overlay.
    el.querySelectorAll("*").forEach((n) => {
      if (n.children.length === 0 && (n.textContent ?? "").trim()) {
        const fs = parseFloat(getComputedStyle(n).fontSize);
        if (fs < 9) issues.push(`text below 9px floor: ${fs}px`);
      }
    });

    // 6. Tap targets inside the overlay.
    el.querySelectorAll("button, a[href], [role=button]").forEach((n) => {
      const b = n.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      if (b.height < 44 && !n.closest("p")) {
        issues.push(`tap target ${Math.round(b.height)}px: "${(n.textContent ?? "").trim().slice(0, 18)}"`);
      }
    });

    return { kind, issues };
  }, OPEN_OVERLAY);
}

async function probeRoute(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  const landed = new URL(page.url()).pathname + new URL(page.url()).search;

  // Candidate triggers: every visible control. Radix triggers are plain
  // buttons, so there is no reliable attribute to filter on — aria-haspopup
  // is set by some primitives and not others.
  const count = await page.locator("#root button:visible").count();
  const max = Math.min(count, 40); // per-route cap; logged below if it bites

  for (let i = 0; i < max; i++) {
    const btn = page.locator("#root button:visible").nth(i);
    let label: string;
    try {
      label = ((await btn.textContent({ timeout: 1500 })) ?? "").trim().slice(0, 30) ||
        (await btn.getAttribute("aria-label"))?.slice(0, 30) || `button[${i}]`;
    } catch { continue; }

    try {
      await btn.click({ timeout: 2500, noWaitAfter: true });
    } catch { continue; }
    await page.waitForTimeout(320);

    const open = await page.locator(OPEN_OVERLAY).count();
    if (open === 0) {
      // Not an overlay trigger. If it navigated, go back and continue.
      const now = new URL(page.url()).pathname + new URL(page.url()).search;
      if (now !== landed) {
        await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page.waitForTimeout(350);
      }
      continue;
    }

    probed.push(`${route} :: ${label}`);
    const { kind, issues } = await checkOpenOverlay(page);

    // axe, scoped to the open overlay.
    let violations: OverlayFinding["violations"] = [];
    try {
      const axe = await new AxeBuilder({ page })
        .include(OPEN_OVERLAY)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      violations = axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        detail: v.nodes.slice(0, 2).flatMap((n) =>
          [...(n.any ?? []), ...(n.all ?? [])]
            .filter((c) => c.data && typeof c.data === "object")
            .map((c) => {
              const d = c.data as Record<string, unknown>;
              return d.contrastRatio
                ? `${String(d.fgColor)} on ${String(d.bgColor)} = ${String(d.contrastRatio)}:1 (needs ${String(d.expectedContrastRatio ?? "?")})`
                : "";
            })
            .filter(Boolean),
        ),
      }));
    } catch { /* overlay closed mid-scan */ }

    // Escape must close it. A modal you cannot dismiss from the keyboard is a
    // trap, and this is the cheapest possible check for it.
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(280);
    if ((await page.locator(OPEN_OVERLAY).count()) > 0) {
      issues.push("Escape did not close it");
      // Force it shut so the next trigger is testable.
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(350);
    }

    if (issues.length || violations.length) {
      findings.push({ route, trigger: label, kind, issues, violations });
    }
  }
}

const sweepDescribe = process.env.RUN_OVERLAY_SWEEP ? test.describe : test.describe.skip;

test.describe.configure({ mode: "serial" });

sweepDescribe("overlay sweep", () => {
  test.afterAll(() => {
    writeFileSync(
      resolve(OUTPUT_DIR, "overlay-report.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), probed, findings }, null, 2),
    );
  });

  for (const route of ROUTES) {
    test(`probe ${route}`, async ({ context, page, baseURL }) => {
      test.setTimeout(180_000);
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, {
        user: FAKE_CUSTOMER,
        seed: true,
        rules: route === "/admin" ? [mockTable("user_roles", [{ role: "admin" }])] : [],
      });
      await probeRoute(page, route);
    });
  }

  test("zz probed something", () => {
    expect(probed.length).toBeGreaterThan(0);
  });
});
