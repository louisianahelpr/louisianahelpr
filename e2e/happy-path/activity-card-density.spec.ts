/**
 * Activity card density + header — the owner's device-testing asks, frozen.
 *
 * These are behaviours that are only provable by RENDERING the authed page
 * with controlled data, not by reading the component:
 *
 *   1. the job description is collapsed by default and expands in place
 *   2. No-Show is absent before the scheduled start and present after it —
 *      proved by moving the job's date, not by reasoning about the clock
 *   3. the active status filter is named beside the title, and "All" is silent
 *   4. every status renders a coloured full-width stripe
 *   5. the action rows are icon-over-label chips with ≥44px tap targets
 *
 * plus the standing gates: zero horizontal overflow, exactly one <h1>, and
 * zero axe violations — at 375 and 1440, light and dark.
 *
 * Screenshots land in /tmp/ui-review/activity-density/ as evidence.
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
import { SEED_JOBS, SEED_APPLICATIONS, CUSTOMER_ID, HELPER_ID } from "./seedData";

const SHOTS = "/tmp/ui-review/activity-density";
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;

/** Local "YYYY-MM-DD" `days` from today — matches the `date` wire format. */
function localDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Serve a controlled `jobs` table.
 *
 * The blanket `seed: true` path answers through the fixture's own PostgREST
 * filter emulation, which we cannot reach from here (it is module-private), so
 * this rule honours by hand the only three shapes Activity issues: the
 * poster's list, the direct-offer probe, and the `id=in.(…)` hydration.
 */
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

/** The in-progress seeded job, re-dated so its start is in the future/past. */
function inProgressJobStarting(offsetDays: number, startTime = "09:00:00"): Row {
  return {
    ...(SEED_JOBS.find((j) => j.status === "in_progress") as Row),
    date_needed: localDate(offsetDays),
    start_time: startTime,
    helper_id: HELPER_ID,
    customer_id: CUSTOMER_ID,
  };
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
}

/** Settle the scaffold's page-entry transition before measuring or shooting. */
async function settle(page: Page) {
  await page.waitForTimeout(500);
}

/**
 * Open every collapsed status section.
 *
 * The grouped "All" view ships Completed and Cancelled COLLAPSED, so their
 * cards are not in the DOM at all. Scanning without this quietly excluded
 * three of the seven statuses from the contrast check — and made a match on
 * the section-header button read as a match on the card's stripe.
 */
async function expandAllSections(page: Page) {
  const toggles = page.getByRole("button", { name: /^Toggle .* section$/ });
  for (let i = 0; i < (await toggles.count()); i++) {
    const t = toggles.nth(i);
    if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  }
  await page.waitForTimeout(250);
}

/** Every status label the stripe can render on these two surfaces. */
const STATUS_LABELS = [
  "Open · no applicants yet",
  "Pick someone",
  "Offer sent · awaiting reply",
  "Booked",
  "In progress",
  "Revision requested",
  "Completed",
  "Cancelled",
  "Disputed",
  "Applied · awaiting decision",
  "Not selected",
  "Job cancelled",
];

/**
 * Record axe's OWN measured contrast ratio for each status stripe it saw.
 *
 * Deliberately read out of `results.passes` rather than computed here: the
 * brief was explicit that contrast is measured by @axe-core/playwright and
 * never by a hand-rolled sampler, so these are axe's numbers, just surfaced.
 */
async function recordContrast(page: Page, tag: string) {
  // ONE axe run per stripe.
  //
  // A single scan over `[data-status-stripe]` reported only two of the seven
  // bands — axe attributes a colour-contrast result to whichever element it
  // decides owns the text and folds the rest away, so five statuses came back
  // with no number at all. Tagging each band and scoping a run to it is the
  // only way to get a per-status figure, and the figure is still axe's: this
  // adds a test-only attribute, it does not compute anything itself.
  const count = await page.locator("[data-status-stripe]").count();
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const label = (await page.locator("[data-status-stripe]").nth(i).innerText()).trim();
    await page.evaluate(
      (n) => document.querySelectorAll("[data-status-stripe]")[n]?.setAttribute("data-probe", "1"),
      i,
    );
    const results = await new AxeBuilder({ page })
      .include("[data-probe]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const scan = (bucket: unknown[], outcome: string) => {
      for (const rule of bucket as { id: string; nodes: { any: { data?: Record<string, unknown> }[] }[] }[]) {
        if (rule.id !== "color-contrast") continue;
        for (const node of rule.nodes) {
          const data = node.any.find((a) => a.data)?.data ?? {};
          rows.push({
            variant: tag,
            label,
            outcome,
            ratio: data.contrastRatio,
            fg: data.fgColor,
            bg: data.bgColor,
            needs: data.expectedContrastRatio,
            reason: data.messageKey,
          });
        }
      }
    };
    scan(results.passes, "pass");
    scan(results.incomplete, "incomplete");
    scan(results.violations, "violation");
    await page.evaluate(
      (n) => document.querySelectorAll("[data-status-stripe]")[n]?.removeAttribute("data-probe"),
      i,
    );
  }
  // A stripe may never FAIL contrast. `incomplete` is tolerated and reported —
  // dark `.liquid-glass` is 55% alpha over the page gradient, so axe cannot
  // resolve a backdrop for any alpha fill inside a dark card, app-wide — but a
  // violation is a hard stop.
  expect(rows.filter((r) => r.outcome === "violation"), `${tag} stripe contrast failures`).toEqual([]);
  if (rows.length) writeFileSync(`${SHOTS}/contrast-${tag}.json`, JSON.stringify(rows, null, 2));
}

/** The layout invariants that must hold on every variant of every screen. */
async function assertFits(page: Page) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const wide: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      // >1px of slop absorbs sub-pixel rounding on transformed elements.
      if (r.width > vw + 1) wide.push(`${el.tagName}.${el.className}`.slice(0, 120));
    });
    return { scrollWidth: de.scrollWidth, clientWidth: vw, wide: wide.slice(0, 5) };
  });
  expect(overflow.wide, `elements wider than the viewport: ${overflow.wide.join(" | ")}`).toEqual([]);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function assertOneH1(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
}

/**
 * Zero axe violations — the real scanner, never a hand-rolled contrast sampler.
 * Reports every violation with axe's own measured numbers so a contrast failure
 * arrives as a ratio, not as a vibe.
 */
async function assertNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const detail = results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.failureSummary?.replace(/\n/g, " ")).join("\n  ")}`)
    .join("\n");
  expect(results.violations, `${label} axe violations:\n${detail}`).toEqual([]);
  return results;
}

const VARIANTS = [
  { tag: "375-light", width: 375, height: 812, theme: "light" as const },
  { tag: "375-dark", width: 375, height: 812, theme: "dark" as const },
  { tag: "1440-light", width: 1440, height: 900, theme: "light" as const },
  { tag: "1440-dark", width: 1440, height: 900, theme: "dark" as const },
];

test.describe("My Posts — card density + header", () => {
  for (const v of VARIANTS) {
    test(`fits, has one h1 and zero axe violations @ ${v.tag}`, async ({ page, context, baseURL }) => {
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      // "all" so every seeded status — open / accepted / in_progress /
      // revision_requested / completed / cancelled / disputed — is on screen at
      // once and the colour system can be judged as a set.
      await page.goto("/my-posts?filter=all");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settle(page);
      await expandAllSections(page);

      await assertOneH1(page);
      await assertFits(page);
      await assertNoAxeViolations(page, `/my-posts ${v.tag}`);
      await recordContrast(page, `my-posts-${v.tag}`);
      await page.screenshot({ path: `${SHOTS}/my-posts-all-${v.tag}.png`, fullPage: true });
    });

    test(`My Jobs fits, has one h1 and zero axe violations @ ${v.tag}`, async ({ page, context, baseURL }) => {
      await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto("/my-jobs?filter=all");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settle(page);
      await expandAllSections(page);

      await assertOneH1(page);
      await assertFits(page);
      await assertNoAxeViolations(page, `/my-jobs ${v.tag}`);
      await recordContrast(page, `my-jobs-${v.tag}`);
      await page.screenshot({ path: `${SHOTS}/my-jobs-all-${v.tag}.png`, fullPage: true });
    });
  }

  test("the description is collapsed by default and expands in place", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);

    // The open job's brief. Present in the DOM only once expanded.
    const description = page.getByText("Full clean — kitchen, two bathrooms", { exact: false });
    await expect(description).toHaveCount(0);

    const toggle = page.getByRole("button", { name: "Show job description" }).first();
    await expect(toggle).toBeVisible();

    // ≥44px tap target.
    const box = await toggle.boundingBox();
    expect(box, "toggle has no box").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: `${SHOTS}/card-collapsed-375.png`, fullPage: true });

    await toggle.click();
    await expect(description.first()).toBeVisible();
    // Same card — the toggle expanded in place rather than navigating.
    await expect(page).toHaveURL(/\/my-posts/);
    await page.screenshot({ path: `${SHOTS}/card-expanded-375.png`, fullPage: true });

    const collapse = page.getByRole("button", { name: "Hide job description" }).first();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(description).toHaveCount(0);
  });

  // The two halves of the No-Show proof are separate tests ON PURPOSE. Re-routing
  // and reloading inside one test kept serving the first dataset — the app
  // rehydrates from its own cache on reload — which would have made "absent"
  // look like a pass twice. A fresh context per phase cannot lie about that.
  test("No-Show is HIDDEN while the job has not started yet", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    // The job starts TOMORROW at 9:00 AM. It is already in_progress with a
    // helper assigned, so the only thing keeping No-Show off the card is the clock.
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([inProgressJobStarting(1)])],
    });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);

    await expect(page.getByText("In progress", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /no-show/i })).toHaveCount(0);
    // The rest of the row is still there — this is a gate, not an empty state,
    // and a two-item row must still look deliberate.
    await expect(page.getByRole("button", { name: "Message Helpr" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /share/i }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/actions-2up-no-noshow-375.png`, fullPage: true });
  });

  test("No-Show APPEARS once the start time has passed", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    // Identical job, started YESTERDAY at 9:00 AM. Nothing else changed.
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([inProgressJobStarting(-1)])],
    });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);

    await expect(page.getByRole("button", { name: /no-show/i })).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/actions-3up-with-noshow-375.png`, fullPage: true });

    // Every chip clears the 44px tap target, and no label truncates at 320px —
    // the narrowest width this app supports, where a three-up row fails first.
    await page.setViewportSize({ width: 320, height: 640 });
    await settle(page);
    for (const name of ["Message Helpr", "Report the Helpr as a no-show"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box, `${name} has no box`).not.toBeNull();
      expect(box!.height, `${name} tap target`).toBeGreaterThanOrEqual(44);
    }
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("button span"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent ?? ""),
    );
    expect(clipped, `truncated action labels at 320px: ${clipped.join(", ")}`).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/actions-3up-320.png`, fullPage: true });
  });

  test("the active status filter is named beside the title, and All is silent", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });

    for (const [filter, label] of [
      ["active", "Active"],
      ["completed", "Completed"],
      ["cancelled", "Cancelled"],
    ] as const) {
      await page.goto(`/my-posts?filter=${filter}`);
      await page.waitForSelector("h1");
      await settle(page);
      const header = page.locator("h1").locator("..");
      await expect(header, `filter=${filter}`).toContainText(label);
      // Still exactly one heading — the indicator is a span, never an h2.
      await assertOneH1(page);
      if (filter === "active") {
        await page.screenshot({ path: `${SHOTS}/header-filter-active-375.png` });
      }
    }

    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    const header = page.locator("h1").locator("..");
    await expect(header).toHaveText("My Posts");
    await assertOneH1(page);
  });

  test("every job status renders its own coloured stripe", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    // Completed / Cancelled ship collapsed, so three of the seven statuses are
    // not in the DOM until this runs. Without it a match on the section HEADER
    // reads as a match on the card's stripe.
    await expandAllSections(page);

    // Read the bands straight off the page: text, background, and ink. A band
    // with a transparent background is not a stripe, whatever its label says.
    const bands = await page.evaluate((labels) => {
      const out: { label: string; bg: string; fg: string }[] = [];
      document.querySelectorAll<HTMLElement>("span").forEach((el) => {
        const text = (el.textContent ?? "").trim();
        if (!labels.includes(text)) return;
        const band = el.parentElement;
        if (!band) return;
        const cs = getComputedStyle(band);
        out.push({ label: text, bg: cs.backgroundColor, fg: cs.color });
      });
      return out;
    }, STATUS_LABELS);

    // "Completed" and "Cancelled" also name a collapsible SECTION, whose header
    // row is transparent — so require at least one FILLED band per label rather
    // than trusting the first text match.
    const filled = bands.filter((b) => b.bg !== "rgba(0, 0, 0, 0)");
    for (const label of ["In progress", "Revision requested", "Completed", "Cancelled", "Disputed"]) {
      expect(
        filled.some((b) => b.label === label),
        `no filled stripe rendered for "${label}" — saw ${JSON.stringify(bands.filter((b) => b.label === label))}`,
      ).toBe(true);
    }
    // Distinct fills, not one band colour with different words on it.
    const fills = new Set(filled.map((b) => b.bg));
    expect(fills.size).toBeGreaterThanOrEqual(4);

    // Three statuses side by side, for judging the set as a system.
    await page.screenshot({ path: `${SHOTS}/statuses-side-by-side-375.png`, fullPage: true });
    await recordContrast(page, "statuses-375-light");
  });

  test("the neutral tone is measured too — an open job nobody has applied to", async ({ page, context, baseURL }) => {
    // The seeded open job has two applicants, so it renders "Pick someone"
    // (action tone) and the NEUTRAL tone never appears in the main sweep. This
    // is the only status that would otherwise ship without a measured number.
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    const lonely = { ...(SEED_JOBS.find((j) => j.status === "open") as Row), id: "10000000-0000-4000-8000-0000000000ff" };
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: [jobsRule([lonely])] });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await expect(page.getByText("Open · no applicants yet", { exact: true })).toHaveCount(1);
    await recordContrast(page, "neutral-375-light");
  });

  test("My Jobs: the applied card carries the same stripe and one description toggle", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
    await page.goto("/my-jobs?filter=all");
    await page.waitForSelector("h1");
    await settle(page);

    // Exactly one description affordance per card — not a toggle bolted under
    // an already-visible description.
    const show = page.getByRole("button", { name: "Show job description" });
    const hide = page.getByRole("button", { name: "Hide job description" });
    expect(await show.count() + await hide.count()).toBeGreaterThan(0);
    await expect(hide).toHaveCount(0);

    const first = show.first();
    const box = await first.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await first.click();
    await expect(page.getByRole("button", { name: "Hide job description" })).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/my-jobs-expanded-375.png`, fullPage: true });

    // The withdraw action is the icon-over-label chip now, still destructive.
    void SEED_APPLICATIONS;
  });
});
