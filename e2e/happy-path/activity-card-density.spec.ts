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
import { settleAnimations } from "./auditRoutes";
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

/**
 * Settle the scaffold's page-entry transition before measuring or shooting.
 *
 * Uses the suite's shared helper, not a bare timeout: axe measuring an element
 * mid-fade reports the transitional opacity as a contrast failure, which is a
 * finding about the animation frame rather than about the design.
 */
async function settle(page: Page) {
  await settleAnimations(page);
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

/**
 * Dismiss the push-permission nudge.
 *
 * The seeded state has bids on a posted job, which fires the customer-first-bid
 * nudge — a toast parked over the header card. Left up, it is most of what any
 * screenshot of this screen shows. Called AFTER the axe scan, never before: the
 * toast is part of the page and has to be scanned with it.
 */
async function dismissNudge(page: Page) {
  const notNow = page.getByRole("button", { name: "Not now" });
  if (await notNow.count()) await notNow.first().click();
  // …and wait for it to finish LEAVING. A dismissed toast animates out over the
  // header for another beat, which is all an element screenshot would catch.
  await expect(page.getByText("Turn on notifications?")).toHaveCount(0);
  await page.waitForTimeout(400);
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
      await dismissNudge(page);
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

    // The whole card is the click/tap toggle. The sr-only button inside
    // JobCardShell is the keyboard/screen-reader affordance — it is intentionally
    // not visually interactive, so { force: true } bypasses Playwright's
    // "element is on top" check, which sr-only elements always fail.
    const toggle = page.getByRole("button", { name: "Expand Job Details" }).first();
    await expect(toggle).toBeAttached();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await dismissNudge(page);
    await page.screenshot({ path: `${SHOTS}/card-collapsed-375.png`, fullPage: true });

    await toggle.click({ force: true });
    await expect(description.first()).toBeVisible();
    // Same card — the toggle expanded in place rather than navigating.
    await expect(page).toHaveURL(/\/my-posts/);
    await page.screenshot({ path: `${SHOTS}/card-expanded-375.png`, fullPage: true });

    const collapse = page.getByRole("button", { name: "Collapse Job Details" }).first();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click({ force: true });
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

    await dismissNudge(page);
    // The card is identified by its live tracker, not by a status band: the
    // per-card stripe was removed once the filter tabs took over saying what
    // state a job is in. See ActivityBucket in activityFilters.ts.
    await expect(page.getByRole("group", { name: "Job progress" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /no-show/i })).toHaveCount(0);
    // The rest of the row is still there — this is a gate, not an empty state,
    // and a two-item row must still look deliberate. Share is NOT among them:
    // a job that already has a helpr has nothing left to advertise.
    await expect(page.getByRole("button", { name: "Message Helpr" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /share|copy link/i })).toHaveCount(0);
    // This page is a fixed 100dvh shell — the DOCUMENT does not scroll, so
    // `fullPage` captures the viewport and nothing else. Bring the row into it.
    await page.getByRole("button", { name: "Message Helpr" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/actions-2up-no-noshow-375.png` });
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

    await dismissNudge(page);
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

  // ── The owner's card reorganisation, frozen ────────────────────────────
  // Five asks that are only provable by rendering: the tracker became one
  // scrolling line, the action row was reordered around SOS, Message stopped
  // changing colour between cards, Message deep-links into the thread, and the
  // description toggle lost its words.

  test("the live tracker is ONE scrollable line and the helpr is named in its heading", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([{ ...inProgressJobStarting(-1), helper_on_the_way_at: new Date().toISOString() }])],
    });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);

    const row = page.getByRole("group", { name: "Job progress" });
    await expect(row).toHaveCount(1);
    await row.scrollIntoViewIfNeeded();

    // ONE line: every step shares a top edge. A wrapped 4+3 grid puts the
    // second row at a different offsetTop, so this is the assertion that the
    // old layout cannot pass.
    const tops = await row.evaluate((el) =>
      Array.from(el.children).map((c) => (c as HTMLElement).offsetTop),
    );
    // EIGHT, not seven: this is the POSTER's own card, and a poster's tracker
    // prepends ONE pre-offer step (Posted) to the seven shared ones. It used to
    // prepend two — Posted and Applicants — until they were merged, because
    // applications arrive against the posted job rather than after it, so the
    // pair described one state and pushed the row past the card's width. The
    // count is asserted rather than loosened to "greater than one" because the
    // wrap this test exists to catch is only visible at the full step count.
    expect(tops.length, "eight tracker steps (1 posting + 7 shared)").toBe(8);
    expect(new Set(tops).size, `steps sit on ${new Set(tops).size} lines, expected 1`).toBe(1);

    // ...and it genuinely SCROLLS rather than squeezing seven steps into 375px.
    const { scrollWidth, clientWidth, focusable } = await row.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      focusable: el.tabIndex >= 0,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    // A scrollable region must be keyboard-reachable (axe scrollable-region-focusable).
    expect(focusable, "tracker row must be focusable").toBe(true);

    // The status sentence is gone from the card; the name now rides the row.
    await expect(page.getByText(/is on the way|finished the job|Offered to/i)).toHaveCount(0);
    // ...and it is re-stated in the tracking card's HEADING, not as a caption
    // under the live step. The caption gave every step column a third line of
    // vertical space to accommodate one word on one of them, and it moved down
    // the row as the job advanced (owner: "can we move this somewhere else so
    // we can tighten up the spacing"). Up in the heading it holds still.
    //
    // So the assertion inverts: NO step carries a second line, and the name is
    // on the card heading instead. Asserted structurally rather than by name —
    // what the helpr resolves to here is the card's own display fallback, so
    // matching a literal would test the fixture, not the feature.
    const captioned = await row.evaluate((el) =>
      Array.from(el.children).filter((c) => c.querySelectorAll("span").length > 1).length,
    );
    expect(captioned, "no tracker step carries a caption line").toBe(0);
    const headingRow = page.locator("h3", { hasText: "Job tracking" }).first().locator("..");
    await expect(headingRow, "the helpr's name rides the tracking heading").not.toHaveText(
      /^Job tracking$/,
    );

    await page.screenshot({ path: `${SHOTS}/tracker-one-line-375.png` });
  });

  test("the action row reads SOS then Message, and Message is one colour everywhere", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    // `helper_arrived_at`, not just `helper_on_the_way_at`. SOS is gated on the
    // helper having ARRIVED — it is the control for something going wrong on
    // site, so it appears when they are on site, not while they are still
    // driving. The fixture only set on-the-way, so the row it measured had no
    // SOS in it at all and the order assertion below was reading Share first.
    const arrivedAt = new Date().toISOString();
    const base = {
      ...inProgressJobStarting(-1),
      helper_on_the_way_at: arrivedAt,
      helper_arrived_at: arrivedAt,
    };
    // BOTH Message states on ONE page: the left card has no helper completion
    // (Message used to be solid bark), the right one does (Message used to
    // demote to a muted tint, and "Approve & release payment" appears above
    // it). Same page means the two colours can be compared directly instead of
    // across contexts, which is what the owner's "same color for all places"
    // actually asserts.
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([
        { ...base, id: "job-msg-plain", title: "Tracker colour A" },
        { ...base, id: "job-msg-done", title: "Tracker colour B", helper_completed_at: new Date().toISOString() },
      ])],
    });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);

    const messages = page.getByRole("button", { name: "Message Helpr" });
    await expect(messages).toHaveCount(2);
    const colours = await messages.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(colours[0], `Message renders ${colours[0]} vs ${colours[1]}`).toBe(colours[1]);

    // Order within the first card's row: SOS · Message.
    //
    // Share used to sit between them and no longer does — a job that already
    // has a helpr has nothing left to advertise, so the link it copied led
    // somewhere nobody else could take. It is still one of the four main
    // actions on an OPEN job, which is where it does work.
    const order = await page.evaluate(() => {
      const msg = document.querySelector('button[aria-label="Message Helpr"]');
      const row = msg?.parentElement;
      return Array.from(row?.children ?? []).map(
        (c) => c.getAttribute("aria-label") ?? c.textContent?.trim() ?? "",
      );
    });
    expect(order[0]).toMatch(/SOS/i);
    expect(order[1]).toMatch(/message/i);
    // No JOB-share control anywhere in the row. Matched on its exact accessible
    // name rather than a loose /share/ — the SOS chip's own label is about
    // sharing your LOCATION, and a loose match reads that as a hit.
    expect(order.some((l) => /^(share this job|copy a link to this job)$/i.test(l))).toBe(false);

    await page.screenshot({ path: `${SHOTS}/actions-sos-message-375.png`, fullPage: true });
  });

  test("Message opens the thread with THIS helpr on THIS job", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([inProgressJobStarting(-1)])],
    });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);

    await page.getByRole("button", { name: "Message Helpr" }).first().click();
    await page.waitForURL(/\/messages\?/);
    const url = new URL(page.url());
    // Landing on the bare list — the old behaviour — leaves both params null.
    expect(url.searchParams.get("userId"), "helpr not addressed").toBe(HELPER_ID);
    expect(url.searchParams.get("jobId"), "job not addressed").toBeTruthy();
  });

  test("the card-level toggle carries aria-expanded and flips on click", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);

    // The visible chevron button was removed by owner direction — "remove the
    // chevron entirely". The whole card is now the click/tap affordance.
    // The keyboard/screen-reader affordance is a sr-only button inside
    // JobCardShell whose text and aria-expanded track the expand state.
    // { force: true } is required because sr-only elements are never "on top"
    // in Playwright's actionability check — they're intentionally visually hidden.
    const toggle = page.getByRole("button", { name: "Expand Job Details" }).first();
    await expect(toggle).toBeAttached();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click({ force: true });
    await expect(page.getByRole("button", { name: "Collapse Job Details" }).first()).toBeAttached();
  });

  test("the active bucket is the selected tab, not a caption beside the title", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });

    // The four buckets replaced Active / All / Completed / Cancelled — they
    // sort by whose move it is rather than by the job's own lifecycle. See
    // ActivityBucket in src/pages/activity/activityFilters.ts for why.
    //
    // "all" is gone from the chip set and deliberately NOT asserted here: it
    // still resolves as a filter VALUE so notification deep links keep working,
    // but it has no chip and therefore no label to name.
    for (const [filter, label] of [
      ["needs_you", "Needs You"],
      ["scheduled", "Scheduled"],
      ["waiting", "Waiting"],
      ["done", "Done"],
    ] as const) {
      await page.goto(`/my-posts?filter=${filter}`);
      await page.waitForSelector("h1");
      await settle(page);
      await dismissNudge(page);
      /* The bucket is now a TAB, not a caption. It used to render as
         "· 2 Needs you" beside the h1 while the actual control hid behind a
         sliders icon and a "Refine your search" sheet — a label naming
         whichever bucket the hidden sheet had selected. The sheet is gone and
         the four tabs sit above the cards on every surface (owner: "put the
         needs you etc at the top oiver the job card same for search and remove
         the filter since they will all be ther"), so what has to be true is
         that the deep link SELECTS the right tab.

         The tabs then went BEHIND A CHEVRON next to search (owner: "add a
         dropdown arrow next to search so these aren't always showing"). A
         non-default `?filter=` is supposed to open that disclosure on its own,
         precisely so a filtered screen never hides why it is filtered — but
         `needs_you` IS the default, so that one arrives collapsed and has to be
         opened here. Asserting the toggle's state first is what proves the
         auto-open rule rather than silently papering over it. */
      const toggle = page.getByRole("button", { name: /Filter by status|Hide status filters/ }).first();
      const alreadyOpen = (await toggle.getAttribute("aria-expanded")) === "true";
      expect(
        alreadyOpen,
        `filter=${filter}: a non-default filter must open the disclosure itself`,
      ).toBe(filter !== "needs_you");
      if (!alreadyOpen) await toggle.click();

      const tab = page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: new RegExp(`^${label}`) });
      await expect(tab, `filter=${filter} tab is present`).toBeVisible();
      await expect(tab, `filter=${filter} tab is selected`).toHaveAttribute("aria-pressed", "true");
      // Still exactly one heading — the indicator is a span, never an h2.
      await assertOneH1(page);
      if (filter === "needs_you") {
        // The HEADER CARD itself, not the viewport — a plain screenshot here
        // caught wherever the list happened to be scrolled to and showed no
        // header at all.
        await page.locator("h1").locator("../..").screenshot({ path: `${SHOTS}/header-filter-needs-you-375.png` });
      }
    }
  });

  test("a posted card carries NO status band — the tabs say it instead", async ({ page, context, baseURL }) => {
    // This replaces a test that asserted the opposite. The per-card coloured
    // stripe existed because one "Active" bucket held open, offered,
    // in-progress and awaiting-decision jobs, so every card had to label
    // itself. The filter tabs sort by whose move it is now (see ActivityBucket),
    // which says the same thing once at the top instead of once per card — and
    // on the Completed and Cancelled tabs the band was repeating the tab the
    // reader was already standing in, all the way down the page.
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await page.goto("/my-posts?filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await expandAllSections(page);
    await dismissNudge(page);

    // The stripe carried a `data-status-stripe` hook. Zero of them on a posted
    // list is the assertion — a text search would false-negative on the
    // section headers, which legitimately name the same statuses.
    await expect(page.locator("[data-status-stripe]")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/statuses-side-by-side-375.png`, fullPage: true });
    await recordContrast(page, "statuses-375-light");
  });

  test("an open job nobody has applied to is Waiting, not Needs you", async ({ page, context, baseURL }) => {
    // The distinction the whole `applicantCount` argument exists for: a queue
    // of people waiting on a reply is the poster's move, an empty one is not.
    // It used to be carried by a neutral "Open · no applicants yet" stripe on
    // the card; it is a tab now, which is the version you can filter by.
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    const lonely: Row = { ...(SEED_JOBS.find((j) => j.status === "open") as Row), id: "10000000-0000-4000-8000-0000000000ff" };
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: [jobsRule([lonely])] });
    await page.goto("/my-posts?filter=waiting");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);
    await expect(page.getByText(lonely.title as string).first()).toBeVisible();
    await recordContrast(page, "neutral-375-light");
  });

  test("My Jobs: the applied card carries the same stripe and one description toggle", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
    await page.goto("/my-jobs?filter=all");
    await page.waitForSelector("h1");
    await settle(page);

    // Both posted and applied cards share the same JobCardShell expand affordance:
    // the whole card is the click/tap toggle; the keyboard/screen-reader handle
    // is a sr-only button whose text is "Expand Job Details" / "Collapse Job Details".
    // The visible chevron and the per-card naming ("job description" vs "job
    // details") were removed by owner direction ("remove the chevron entirely").
    const show = page.getByRole("button", { name: "Expand Job Details" });
    const hide = page.getByRole("button", { name: "Collapse Job Details" });
    expect(await show.count() + await hide.count()).toBeGreaterThan(0);
    await expect(hide).toHaveCount(0);

    const first = show.first();
    // { force: true } required: sr-only elements are never "on top" in Playwright's
    // actionability check (they're intentionally not visually interactive).
    await first.click({ force: true });
    await expect(page.getByRole("button", { name: "Collapse Job Details" })).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/my-jobs-expanded-375.png`, fullPage: true });

    // The withdraw action is the icon-over-label chip now, still destructive.
    void SEED_APPLICATIONS;
  });
});
