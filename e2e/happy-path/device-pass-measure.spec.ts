/**
 * Device-testing pass — the MEASUREMENTS, not the opinions.
 *
 * The owner reported a set of defects from build 4825 on a real iPhone. Several
 * of them are numbers, not judgements ("the dock overlaps the card", "the card
 * takes too much space"), and the only honest way to close them is to measure
 * before and after. This spec is that measuring stick: it renders the authed
 * screens with the seeded fixtures, writes every figure to JSON, and asserts
 * only the invariants that must hold on BOTH sides of the change.
 *
 * ── The safe-area simulation, and why it is not a cheat ────────────────────
 *
 * Chrome resolves `env(safe-area-inset-*)` to 0, so the dock-overlap bug is
 * invisible here by default. On the device it is not one number but TWO: the
 * bottom dock is mounted at the App root, OUTSIDE the framer-motion
 * <PageTransition> wrapper, so its `env()` resolves to the real 34px home
 * indicator; the page content is INSIDE that transform, and WebKit resolves
 * `env()` to 0 for any element under a transformed ancestor. So the dock stood
 * 96px tall while the page reserved 96px of clearance measured from the wrong
 * origin — and the last card ran underneath it.
 *
 * `withDeviceInsets()` reproduces exactly that asymmetry: it sets the resolved
 * `--safe-area-*` custom properties to iPhone values AND forces the nav's own
 * bottom padding, which is the "outside the transform" half. Under that
 * simulation the pre-fix build shows ~0px of clearance and the post-fix build
 * shows the full inset, which is the proof.
 *
 * Numbers land in /tmp/ui-review/device-pass/measurements-<label>.json.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
  type MockRule,
} from "./fixtures";
import { settleAnimations } from "./auditRoutes";
import { SEED_JOBS, CUSTOMER_ID, HELPER_ID } from "./seedData";

const SHOTS = "/tmp/ui-review/device-pass";
mkdirSync(SHOTS, { recursive: true });

/** Set by the runner so a before/after pair writes to two different files. */
const LABEL = process.env.MEASURE_LABEL || "after";

type Row = Record<string, unknown>;

/**
 * One file per TEST, not one per run.
 *
 * The first cut wrote every row to `measurements-<label>.json` from a
 * module-level array. Playwright runs this file across parallel workers, each
 * with its own module instance and its own array, all writing that one path —
 * so the last worker to finish silently clobbered every other worker's
 * numbers, and half the measurements vanished without any test failing. Keying
 * the filename to the test title makes the writes disjoint; the runner
 * concatenates the shards afterwards.
 */
function recorder(slug: string) {
  const rows: Row[] = [];
  return (row: Row) => {
    rows.push(row);
    writeFileSync(`${SHOTS}/m-${LABEL}--${slug}.json`, JSON.stringify(rows, null, 2));
  };
}
const slugify = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);

/** iPhone 14 Pro insets. 47px notch, 34px home indicator. */
const INSET_TOP = 47;
const INSET_BOTTOM = 34;

/**
 * Reproduce the device's split brain about `env()` — see the file header.
 *
 * `--safe-area-*` is what a FIXED build reads (it is resolved at :root, which
 * has no transform ancestor). The `nav` override is what the dock reads on the
 * device either way, because the dock lives outside <PageTransition>. A build
 * that still writes raw `env()` in its page padding therefore sees only the
 * nav move, which is precisely the bug.
 */
async function withDeviceInsets(page: Page) {
  await page.addStyleTag({
    content: `
      :root {
        --safe-area-top: ${INSET_TOP}px;
        --safe-area-bottom: ${INSET_BOTTOM}px;
      }
      nav[aria-label="Bottom navigation"] {
        padding-bottom: ${INSET_BOTTOM}px !important;
      }
    `,
  });
  await page.waitForTimeout(120);
}

/**
 * Wait until NOTHING on the page is still animating, then scan.
 *
 * `settleAnimations` waits a fixed ~2.2s, which is enough when the page is
 * quiet by then and is not when it is not. Under four parallel workers this
 * spec intermittently scanned the dashboard mid-entry and axe reported **264**
 * colour-contrast violations at ratios of 1.1–1.25 — i.e. every foreground on
 * the page composited toward its background, which is what a half-faded page
 * looks like to a contrast algorithm. It is a finding about a frame, not about
 * the design, and a fixed timeout can only ever make it rarer.
 *
 * `document.getAnimations()` is the actual signal: it returns every running
 * CSS animation, CSS transition and Web-Animations effect. Poll until the set
 * is empty (ignoring infinite ones like the FAB's pulse ring, which never
 * finish by design and are not part of any settled state), with a hard cap so
 * a permanently-animating page fails loudly instead of hanging.
 */
async function waitForNoAnimations(page: Page, capMs = 6000) {
  // Wait until the page stops MOVING, then let the caller scan.
  //
  // Three things had to be true at once, and each one broke a simpler version:
  //
  //  1. `document.getAnimations()` alone is blind to framer-motion, which
  //     drives `style.opacity` from requestAnimationFrame rather than through
  //     the Web Animations API. With only that check, axe intermittently
  //     scanned a half-faded dashboard and reported contrast ratios drifting
  //     1.01 → 2.21 → 3.65 across runs — one fade, caught at three frames.
  //  2. Flagging any element merely SITTING at a fractional opacity is the
  //     opposite error: a guest-locked nav tab is permanently `opacity-50`.
  //     So compare two consecutive samples — CHANGE is the signal, not value.
  //  3. Several elements pulse FOREVER by design (the Post FAB's halo,
  //     `urgent-pulse`, `boosted-pulse`). Sampling those means the page is
  //     never still and the wait can only ever time out, so they are excluded
  //     by asking the animation API which targets have infinite iterations.
  //
  // On timeout this RETURNS rather than throwing. Its job is to remove a
  // scanning race, not to assert on animation; failing the test here would
  // report "something is still moving" in place of the real finding.
  const sample = () =>
    page.evaluate(() => {
      const forever = new Set<Element>();
      document.getAnimations().forEach((a) => {
        const iterations = (a.effect?.getTiming().iterations ?? 1) as number;
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (!Number.isFinite(iterations) && target) forever.add(target);
      });
      return Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => !forever.has(el))
        .map((el) => getComputedStyle(el).opacity)
        .join(",");
    });
  const deadline = Date.now() + capMs;
  let prev = await sample();
  while (Date.now() < deadline) {
    await page.waitForTimeout(180);
    const next = await sample();
    if (next === prev) return;
    prev = next;
  }
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

async function dismissNudge(page: Page) {
  const notNow = page.getByRole("button", { name: "Not now" });
  if (await notNow.count()) await notNow.first().click().catch(() => {});
  await page.waitForTimeout(350);
}

/**
 * Close the onboarding tour before scanning.
 *
 * It is a first-run overlay that mounts on its own delay — AFTER
 * `settleAnimations` has already returned — so axe intermittently scanned it
 * mid-fade and reported the transitional composite as a contrast failure
 * (measured: "Step 1 of 5" at 1.01:1, one run in six under parallel load).
 * That is a finding about an animation frame, not about the design, and it is
 * the same trap `activity-card-density.spec.ts` documents for the push toast.
 *
 * Dismissed rather than waited out: the tour covers most of the dashboard, so
 * scanning with it up measures the tour instead of the screen underneath.
 */
async function dismissOnboardingTour(page: Page) {
  const close = page.getByRole("button", { name: "Close tour for now" });
  for (let i = 0; i < 3; i++) {
    if (!(await close.count())) break;
    await close.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.getByRole("button", { name: "Close tour for now" })).toHaveCount(0);
  await page.waitForTimeout(250);
}

/** Open every collapsed status section in the grouped "All" view. */
async function expandAllSections(page: Page) {
  const toggles = page.getByRole("button", { name: /^Toggle .* section$/ });
  for (let i = 0; i < (await toggles.count()); i++) {
    const t = toggles.nth(i);
    if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  }
  await page.waitForTimeout(250);
}

/**
 * The gap between the bottom of the LAST card and the top of the dock.
 *
 * Scrolls the internal container to its true end first — the dock auto-hides on
 * scroll-DOWN, so a naive measurement mid-scroll reads a dock that is not there.
 * After hitting the end we nudge upward, which is the gesture that pins the dock
 * back, and only then measure. Negative = the dock is sitting on the content.
 */
async function measureDockClearance(page: Page, cardSelector: string) {
  // Scroll every plausible internal container to the end.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
    });
  });
  await page.waitForTimeout(600);
  // PIN the dock rather than scrolling to reveal it.
  //
  // First attempt nudged the scroller up 40px so the hide-on-scroll dock would
  // slide back in — and that 40px moved the content down by exactly 40px too,
  // so the measured gap was 40px worse than the real one (it read -8px where
  // the true end-of-list gap was +32px). The dock is `position: fixed`: its
  // resting geometry does not depend on scroll position at all, only on the
  // hide transform. Killing the transform gives the pinned dock's real top edge
  // while the list stays at its true end, which is the geometry that matters.
  await page.addStyleTag({
    content: `nav[aria-label="Bottom navigation"] { transform: none !important; transition: none !important; }`,
  });
  await page.waitForTimeout(250);

  return page.evaluate((sel) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Bottom navigation"]');
    if (!cards.length || !nav) return null;
    // The dock's visible top edge is the top of its pill row, not the <nav>
    // box (which includes the invisible frosted curtain reaching further up).
    const pill = nav.querySelector<HTMLElement>(".rounded-full");
    const dockTop = (pill ?? nav).getBoundingClientRect().top;
    const last = cards[cards.length - 1];
    const lastBottom = last.getBoundingClientRect().bottom;
    // Anything actually painted under the dock right now.
    const overlapped: string[] = [];
    document.querySelectorAll<HTMLElement>("main *, section *").forEach((el) => {
      if (!el.textContent?.trim()) return;
      if (el.children.length) return;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) return;
      if (r.bottom > dockTop && r.top < dockTop + 56) {
        overlapped.push(`${el.tagName}:${el.textContent.trim().slice(0, 40)}`);
      }
    });
    return {
      cardCount: cards.length,
      dockTop: Math.round(dockTop),
      lastCardBottom: Math.round(lastBottom),
      clearancePx: Math.round(dockTop - lastBottom),
      overlappedSample: overlapped.slice(0, 6),
      viewportH: window.innerHeight,
    };
  }, cardSelector);
}

/** Heights of the job cards currently rendered. */
async function measureCardHeights(page: Page, sel: string) {
  return page.evaluate((s) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(s));
    return cards.map((c) => ({
      height: Math.round(c.getBoundingClientRect().height),
      title: (c.querySelector("h3")?.textContent ?? "").trim().slice(0, 44),
    }));
  }, sel);
}

async function assertFits(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const wide: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      // Leaflet's own tile/pane layers are deliberately larger than their
      // clipping container — that is how a slippy map works, and the map box
      // itself is `overflow:hidden`, so they cannot push the page sideways.
      // Flagging them would be a finding about Leaflet, not about our layout.
      if (typeof el.className === "string" && el.className.includes("leaflet-")) return;
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1) wide.push(`${el.tagName}.${el.className}`.slice(0, 120));
    });
    return { scrollWidth: de.scrollWidth, clientWidth: vw, wide: wide.slice(0, 5) };
  });
  expect(overflow.wide, `${label}: elements wider than the viewport: ${overflow.wide.join(" | ")}`).toEqual([]);
  expect(overflow.scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(overflow.clientWidth);
}

async function assertOneH1(page: Page, label: string) {
  await expect(page.locator("h1"), `${label}: exactly one h1`).toHaveCount(1);
}

async function assertNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const detail = results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.failureSummary?.replace(/\n/g, " ")).join("\n  ")}`)
    .join("\n");
  expect(results.violations, `${label} axe violations:\n${detail}`).toEqual([]);
}

/**
 * axe's OWN measured contrast for each status stripe, per status.
 *
 * Scoped one run per band on purpose: a single page-wide scan folds every
 * stripe sharing a tone into one result and silently leaves the rest
 * unmeasured. The ratio is still axe's — this only tells it where to look.
 */
async function recordStripeContrast(page: Page, variant: string, record: (r: Row) => void) {
  const count = await page.locator("[data-status-stripe]").count();
  for (let i = 0; i < count; i++) {
    const band = page.locator("[data-status-stripe]").nth(i);
    const label = (await band.innerText()).trim();
    // SCROLL IT INTO VIEW FIRST. axe's color-contrast rule matcher runs
    // `isVisibleOnScreen`, which is false for anything clipped out of a
    // scrolling ancestor — and this page scrolls INTERNALLY, so five of the
    // seven bands were reported `inapplicable` (no result at all, not even a
    // failure) purely because they were parked outside the scroll window.
    // Measured that directly before fixing it: only the two bands that
    // happened to be on screen came back with a ratio.
    await band.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);
    await page.evaluate((n) => document.querySelectorAll("[data-status-stripe]")[n]?.setAttribute("data-probe", "1"), i);
    const results = await new AxeBuilder({ page })
      .include("[data-probe]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const scan = (bucket: unknown[], outcome: string) => {
      for (const rule of bucket as { id: string; nodes: { any: { data?: Record<string, unknown> }[] }[] }[]) {
        if (rule.id !== "color-contrast") continue;
        for (const node of rule.nodes) {
          const data = node.any.find((a) => a.data)?.data ?? {};
          record({
            kind: "stripe-contrast",
            variant,
            label,
            outcome,
            ratio: data.contrastRatio,
            fg: data.fgColor,
            bg: data.bgColor,
            needs: data.expectedContrastRatio,
          });
        }
      }
    };
    scan(results.passes, "pass");
    scan(results.incomplete, "incomplete");
    scan(results.violations, "violation");
    await page.evaluate((n) => document.querySelectorAll("[data-status-stripe]")[n]?.removeAttribute("data-probe"), i);
  }
}

/** Serve a controlled `jobs` table (the fixture's filter emulation is private). */
function jobsRule(rows: Row[]): MockRule {
  return {
    match: (url, method) => method === "GET" && url.pathname === "/rest/v1/jobs",
    handle: (url) => {
      if (url.searchParams.has("offered_to_helper_id")) return { status: 200, body: [] };
      const idFilter = url.searchParams.get("id") ?? "";
      if (idFilter.startsWith("in.")) {
        const wanted = new Set(
          idFilter.slice(3).replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")),
        );
        return { status: 200, body: rows.filter((r) => wanted.has(String(r.id))) };
      }
      return { status: 200, body: rows };
    },
  };
}

/** The single open job — the SHORTEST possible list, where clearance is tightest. */
const ONE_JOB = [{ ...(SEED_JOBS[0] as Row), customer_id: CUSTOMER_ID }];

/**
 * Two OPEN jobs the helper has applied to, both still awaiting a decision.
 *
 * The shared seed gives FAKE_HELPER exactly one application, so the owner's
 * actual complaint — "both cards should fit on screen together, why doesn't the
 * bottom one have [actions]" — was not reproducible from it. These two rows are
 * deliberately in the SAME state so any difference between the cards is a
 * rendering difference, not a data one.
 */
const SECOND_OPEN_JOB: Row = {
  ...(SEED_JOBS[0] as Row),
  id: "10000000-0000-4000-8000-0000000000f2",
  title: "Pressure-wash a driveway and a back patio",
  description: "Both are stained. Water spigot is on the side of the house.",
  budget: 140,
  location: "Kenner, LA",
  customer_id: CUSTOMER_ID,
};
const TWO_OPEN_JOBS = [{ ...(SEED_JOBS[0] as Row), customer_id: CUSTOMER_ID }, SECOND_OPEN_JOB];
const TWO_PENDING_APPS: Row[] = TWO_OPEN_JOBS.map((j, i) => ({
  id: `20000000-0000-4000-8000-0000000000f${i + 1}`,
  job_id: j.id,
  helper_id: HELPER_ID,
  status: "pending",
  message: i === 0 ? "I clean three move-outs a week." : "Free this weekend, own equipment.",
  proposed_price: null,
  attachment_urls: null,
  negotiation_status: "none",
  poster_viewed_at: null,
  created_at: "2026-08-13T12:00:00.000Z",
  updated_at: "2026-08-13T12:00:00.000Z",
}));

function applicationsRule(rows: Row[]): MockRule {
  return {
    match: (url, method) => method === "GET" && url.pathname === "/rest/v1/applications",
    handle: () => ({ status: 200, body: rows }),
  };
}

const CARD = ".rounded-2xl.liquid-glass";

const VARIANTS = [
  // 320 is the narrowest width this app supports and the one where a wrapped
  // meta row, a three-up action row or a step label fails first.
  { tag: "320-light", width: 320, height: 640, theme: "light" as const },
  { tag: "375-light", width: 375, height: 812, theme: "light" as const },
  { tag: "375-dark", width: 375, height: 812, theme: "dark" as const },
  { tag: "1440-light", width: 1440, height: 900, theme: "light" as const },
  { tag: "1440-dark", width: 1440, height: 900, theme: "dark" as const },
];

test.describe("device pass — measured", () => {
  for (const v of VARIANTS) {
    test(`/my-posts @ ${v.tag}`, async ({ page, context, baseURL }, testInfo) => {
      const record = recorder(slugify(testInfo.title));
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto("/my-posts?filter=all");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settleAnimations(page);
      await dismissOnboardingTour(page);
      await expandAllSections(page);
      // Dismissing the tour and opening the sections both re-animate, so the
      // settle has to happen AFTER them, not before.
      await waitForNoAnimations(page);

      await assertOneH1(page, `/my-posts ${v.tag}`);
      await assertFits(page, `/my-posts ${v.tag}`);
      await assertNoAxeViolations(page, `/my-posts ${v.tag}`);
      await recordStripeContrast(page, `my-posts-${v.tag}`, record);

      record({
        kind: "card-heights",
        screen: "my-posts",
        variant: v.tag,
        cards: await measureCardHeights(page, CARD),
      });

      await dismissNudge(page);
      await page.screenshot({ path: `${SHOTS}/${LABEL}-my-posts-${v.tag}.png`, fullPage: true });
    });

    test(`/my-jobs @ ${v.tag}`, async ({ page, context, baseURL }, testInfo) => {
      const record = recorder(slugify(testInfo.title));
      await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto("/my-jobs?filter=all");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settleAnimations(page);
      await dismissOnboardingTour(page);
      await expandAllSections(page);
      // Dismissing the tour and opening the sections both re-animate, so the
      // settle has to happen AFTER them, not before.
      await waitForNoAnimations(page);

      await assertOneH1(page, `/my-jobs ${v.tag}`);
      await assertFits(page, `/my-jobs ${v.tag}`);
      await assertNoAxeViolations(page, `/my-jobs ${v.tag}`);
      await recordStripeContrast(page, `my-jobs-${v.tag}`, record);

      const cards = await measureCardHeights(page, CARD);
      record({
        kind: "card-heights",
        screen: "my-jobs",
        variant: v.tag,
        cards,
        // The owner's ask: two applied cards on screen together at 375.
        firstTwoStack: cards.slice(0, 2).reduce((a, c) => a + c.height, 0),
        viewportH: v.height,
      });

      await page.screenshot({ path: `${SHOTS}/${LABEL}-my-jobs-${v.tag}.png`, fullPage: true });
    });

    test(`/dashboard @ ${v.tag}`, async ({ page, context, baseURL }, testInfo) => {
      const record = recorder(slugify(testInfo.title));
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto("/dashboard");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settleAnimations(page);
      await dismissOnboardingTour(page);
      await waitForNoAnimations(page);

      await assertOneH1(page, `/dashboard ${v.tag}`);
      await assertFits(page, `/dashboard ${v.tag}`);
      await assertNoAxeViolations(page, `/dashboard ${v.tag}`);
      record({ kind: "page", screen: "dashboard", variant: v.tag, ok: true });
      await dismissNudge(page);
      await page.screenshot({ path: `${SHOTS}/${LABEL}-dashboard-${v.tag}.png`, fullPage: true });
    });
  }

  /**
   * THE dock-overlap measurement. Under the device-inset simulation, at the
   * true end of the list, with the dock pinned.
   *
   * Run for the full seeded list AND for a single-card list — the owner asked
   * for both the long and the shortest case, and they fail differently: a long
   * list ends mid-scroll, a one-card list never scrolls at all.
   */
  for (const listCase of [
    { name: "full-list", rows: undefined as Row[] | undefined },
    { name: "one-card", rows: ONE_JOB },
  ]) {
    test(`dock clearance @ 375 — ${listCase.name}`, async ({ page, context, baseURL }, testInfo) => {
      const record = recorder(slugify(testInfo.title));
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, {
        user: FAKE_CUSTOMER,
        seed: true,
        ...(listCase.rows ? { rules: [jobsRule(listCase.rows)] } : {}),
      });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/my-posts?filter=all");
      await page.waitForSelector("h1");
      await settleAnimations(page);
      await dismissNudge(page);
      await withDeviceInsets(page);
      if (!listCase.rows) await expandAllSections(page);

      const m = await measureDockClearance(page, CARD);
      record({ kind: "dock-clearance", listCase: listCase.name, insetBottom: INSET_BOTTOM, ...(m ?? {}) });
      await page.screenshot({ path: `${SHOTS}/${LABEL}-dock-${listCase.name}-375.png` });

      // Assert only on the AFTER run — the BEFORE run exists to record the
      // failure, and a hard assertion there would abort before it wrote it.
      if (LABEL === "after") {
        expect(m, "no cards or no dock found").not.toBeNull();
        expect(
          m!.clearancePx,
          `dock sits ${-m!.clearancePx}px into the last card (overlapping: ${m!.overlappedSample.join(", ")})`,
        ).toBeGreaterThanOrEqual(0);
        expect(m!.overlappedSample, "content painted under the dock").toEqual([]);
      }
    });
  }

  /**
   * The owner's applied-card ask, measured: two applications in the SAME state,
   * both fitting a 375x812 screen at once, and BOTH offering the same actions.
   */
  test("two pending applications fit together @ 375", async ({ page, context, baseURL }, testInfo) => {
    const record = recorder(slugify(testInfo.title));
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      seed: true,
      rules: [jobsRule(TWO_OPEN_JOBS), applicationsRule(TWO_PENDING_APPS)],
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/my-jobs?filter=all");
    await page.waitForSelector("h1");
    await settleAnimations(page);
    await expandAllSections(page);

    const cards = await measureCardHeights(page, CARD);
    const stack = cards.slice(0, 2).reduce((a, c) => a + c.height, 0);
    const withdraws = await page.getByRole("button", { name: "Withdraw application" }).count();
    const edits = await page.getByRole("button", { name: "Edit your application" }).count();
    record({
      kind: "applied-pair",
      cards,
      firstTwoStack: stack,
      viewportH: 812,
      withdrawButtons: withdraws,
      editButtons: edits,
    });
    await page.screenshot({ path: `${SHOTS}/${LABEL}-applied-pair-375.png`, fullPage: true });

    if (LABEL === "after") {
      expect(cards.length, "expected two applied cards").toBeGreaterThanOrEqual(2);
      // Two cards in the same state must offer the SAME affordances.
      expect(withdraws, "both cards must offer Withdraw").toBe(cards.length);
      expect(edits, "both cards must offer Edit").toBe(cards.length);
    }
  });

  /**
   * The top inset, the same bug at the other edge — Add-a-pet, Schedule and
   * helper Analytics all rendered their titles up under the status bar because
   * `pt-safe-top` resolved to 0 inside <PageTransition>. Measure that the first
   * painted text starts BELOW the simulated notch.
   */
  for (const route of ["/my-posts?filter=all", "/analytics", "/profile"]) {
    test(`top safe-area inset @ 375 — ${route}`, async ({ page, context, baseURL }, testInfo) => {
      const record = recorder(slugify(testInfo.title));
      await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);
      await page.waitForLoadState("networkidle").catch(() => {});
      await settleAnimations(page);
      await withDeviceInsets(page);

      const top = await page.evaluate(() => {
        let min = Infinity;
        let who = "";
        document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
          if (el.children.length) return;
          const text = el.textContent?.trim();
          if (!text) return;
          // Skip-to-content and other sr-only affordances are parked off-screen
          // ON PURPOSE until focused. Measuring them would report every screen
          // as painting above the notch.
          if (el.closest(".sr-only, [class*='sr-only']")) return;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.opacity === "0") return;
          const r = el.getBoundingClientRect();
          if (r.height === 0 || r.width === 0) return;
          // Ignore anything scrolled off the top, and anything parked far
          // off-screen (the skip link sits at a negative offset).
          if (r.top < -50 || r.bottom < 0) return;
          if (r.top < min) { min = r.top; who = `${el.tagName}:${text.slice(0, 40)}`; }
        });
        return { firstTextTop: Math.round(min), who };
      });
      record({ kind: "top-inset", route, insetTop: INSET_TOP, ...top });
      await page.screenshot({ path: `${SHOTS}/${LABEL}-topinset-${route.replace(/\W+/g, "_")}.png` });

      if (LABEL === "after") {
        expect(
          top.firstTextTop,
          `${route}: first text starts at y=${top.firstTextTop}, inside the ${INSET_TOP}px status bar (${top.who})`,
        ).toBeGreaterThanOrEqual(INSET_TOP);
      }
    });
  }
});
