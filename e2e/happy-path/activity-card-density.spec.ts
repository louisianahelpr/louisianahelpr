/**
 * Activity card density + header — the owner's device-testing asks, frozen.
 *
 * These are behaviours that are only provable by RENDERING the authed page
 * with controlled data, not by reading the component:
 *
 *   1. the job description is not on the card face and opens in place (Manage job)
 *   2. No-Show is absent before the scheduled start and present after it —
 *      proved by moving the job's date, not by reasoning about the clock
 *   3. the active status filter is named beside the title, and "All" is silent
 *   4. every status renders a coloured full-width stripe
 *   5. the action rows are icon-over-label chips with ≥44px tap targets
 *
 * plus the standing gates: zero horizontal overflow, exactly one <h1>, and
 * zero axe violations — at 375 and 1440, light and dark.
 *
 * Screenshots land in ~/.lh-shots/ui-review/activity-density/ as evidence.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
  desktopScaleFor,
  type MockRule,
} from "./fixtures";
import { settleAnimations } from "./auditRoutes";
import { AXE_TAGS } from "./axeTags";
import { SEED_JOBS, SEED_APPLICATIONS, CUSTOMER_ID, HELPER_ID } from "./seedData";
/* THE TAB VOCABULARY COMES FROM THE APP, NEVER FROM A COPY IN HERE.
   Two words exist per bucket and which one is painted depends on the viewport
   (see SHORT_LABEL_BELOW_PX). A spec that hand-typed either spelling would go
   red the next time a breakpoint or a word moves — which is exactly how this
   test broke: it named "Needs You"/"Scheduled" while a 375 phone paints
   "You"/"Soon". `activityBuckets` and `shortLabelBreakpoint` are leaf modules
   with no React imports precisely so specs can read them.
   Same reason e2e/prod-audit/activity-tabs-visible.spec.ts imports them. */
import { POSTED_GROUP_LABEL } from "../../src/lib/activityBuckets";

const SHOTS = join(homedir(), ".lh-shots", "ui-review", "activity-density");
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;

/** Local "YYYY-MM-DD" `days` from today — matches the `date` wire format. */
/** A job start `minutes` from now, as Louisiana's date and wall-clock time (the app reads both in America/Chicago). */
function startInLouisiana(minutes: number): { date_needed: string; start_time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(Date.now() + minutes * 60_000))
      .map((x) => [x.type, x.value]),
  );
  return { date_needed: `${parts.year}-${parts.month}-${parts.day}`, start_time: `${parts.hour}:${parts.minute}:00` };
}

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
      // The job page reads ONE job by id two ways: its own maybeSingle read (one OBJECT, as PostgREST answers
      // `Accept: vnd.pgrst.object`) and the Posted card's flows read (`.limit(1)`, a list: usePosterPageFlows).
      // A rule cannot see the Accept header, so `limit` tells them apart.
      if (idFilter.startsWith("eq.")) {
        const hit = rows.filter((r) => String(r.id) === idFilter.slice(3));
        if (url.searchParams.has("limit")) return { status: 200, body: hit };
        return hit.length === 1 ? { status: 200, body: hit[0] } : { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${hit.length} rows`, hint: null } };
      }
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
      .withTags(AXE_TAGS)
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

/**
 * Open ONE posted job's page, where its live controls are now.
 *
 * Owner decision (2026-10-31, one screen): "Manage job" folded into the job page, and the Posted list's deep link
 * `?highlight=<id>&manage=1` now redirects to /jobs/<id> (ec662e446e). So the tracker, Message, the step row and
 * its More (No-Show, SOS, Edit) are read on the job page: the page's own buttons ([data-poster-actions], Message as
 * the main button when nothing is due) and "More options", which opens the Posted card's own PostedJobActions in
 * place ([data-poster-more], posterPageActions.tsx / usePosterPageFlows.tsx).
 */
async function openJobPage(page: Page, jobId: string) {
  await page.goto(`/jobs/${encodeURIComponent(jobId)}`);
  await page.waitForSelector("h1");
  await settle(page);
  await dismissNudge(page);
  // Job page v2 (owner 11-01, JobPageActionRow.tsx): ONE row of buttons, the green one on the right.
  await expect(page.locator(POSTER_ROW), `job page ${jobId} drew no poster actions`).toHaveCount(1);
}

/** The poster's one row of page buttons (job page v2). */
const POSTER_ROW = '[data-job-row="poster"]';

/** The job page's "More options": the Posted card's own step controls, drawn in place under the buttons. */
async function openMoreOptions(page: Page) {
  // Job page v2: "More options" opens every other action in one sheet ([data-row-options]); with only ONE other
  // action there is no More options, and that action sits on the row itself.
  const more = page.locator(POSTER_ROW).getByRole("button", { name: "More options" });
  if (!(await more.count())) return page.locator(POSTER_ROW);
  await more.click();
  const panel = page.locator('[data-row-options="poster"]');
  await expect(panel).toBeVisible();
  return panel;
}

/** "More options", then the step row's own More (when the row has one): every move the card offers is then on screen. */
async function openEveryMove(page: Page) {
  const panel = await openMoreOptions(page);
  const overflow = panel.locator("[data-job-step-overflow]");
  if (await overflow.count()) {
    await overflow.first().click();
    await expect(page.locator("[data-job-step-overflow-panel]")).toBeVisible();
  }
  return panel;
}

/** Shut the open card with its own Close (MineOpenMeta); the face comes back. */
async function closeCard(page: Page) {
  await page.locator("[data-mine-close]").first().click();
  await expect(page.locator("[data-mine-close]")).toHaveCount(0);
}

/** The seeded in-progress job's id: inProgressJobStarting keeps it. */
const IN_PROGRESS_ID = String((SEED_JOBS.find((j) => j.status === "in_progress") as Row).id);

/**
 * An open job nobody has applied to: its face button is the fallback
 * "Manage job" (posterFaceAction, no_applicants), the face that opens the card
 * in place from the list itself. A copy of the seeded open job (the Deep clean
 * brief) under an id no seeded application names.
 */
const LONELY_OPEN: Row = { ...(SEED_JOBS.find((j) => j.status === "open") as Row), id: "10000000-0000-4000-8000-0000000000ff" };

/** The layout invariants that must hold on every variant of every screen. */
async function assertFits(page: Page) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const wide: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      // >1px of slop absorbs sub-pixel rounding on transformed elements.
      if (r.width <= vw + 1) return;
      // Same exemption as device-pass-measure: a row inside a horizontal
      // SCROLLER is wider than the viewport on purpose (UnderlineTabs' five
      // status labels measure ~382px at 375 since 0c90334dc) and the user can
      // reach all of it. Exempt an element whose nearest overflow-x
      // auto/scroll ancestor itself fits; `hidden` stays a failure because
      // content clipped by a hidden ancestor is unreachable. CI fonts render
      // the row a few px wider than local, which is how this passed 108/108
      // in the gate and went red on the runner.
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") {
          if (p.getBoundingClientRect().width <= vw + 1) return;
          break;
        }
        p = p.parentElement;
      }
      wide.push(`${el.tagName}.${el.className}`.slice(0, 120));
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
    .withTags(AXE_TAGS)
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
   // Anonymous group: only here to give a desktop width a desktop pixel
   // density (see desktopScaleFor); test titles are unchanged.
   test.describe(() => {
    const scale = desktopScaleFor(v.width);
    if (scale) test.use(scale);
    test(`fits, has one h1 and zero axe violations @ ${v.tag}`, async ({ page, context, baseURL }) => {
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      // "all" so every seeded status — open / accepted / in_progress /
      // revision_requested / completed / cancelled / disputed — is on screen at
      // once and the colour system can be judged as a set.
      await page.goto("/jobs?tab=posted&filter=all");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settle(page);
      await expandAllSections(page);

      await assertOneH1(page);
      await assertFits(page);
      await assertNoAxeViolations(page, `/posts ${v.tag}`);
      await recordContrast(page, `posts-${v.tag}`);
      await dismissNudge(page);
      await page.screenshot({ path: `${SHOTS}/posts-all-${v.tag}.png`, fullPage: true });
    });

    test(`My Jobs fits, has one h1 and zero axe violations @ ${v.tag}`, async ({ page, context, baseURL }) => {
      await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto("/jobs?tab=working&filter=all");
      await page.waitForSelector("h1");
      await setTheme(page, v.theme);
      await settle(page);
      await expandAllSections(page);

      await assertOneH1(page);
      await assertFits(page);
      await assertNoAxeViolations(page, `/jobs ${v.tag}`);
      await recordContrast(page, `jobs-${v.tag}`);
      await page.screenshot({ path: `${SHOTS}/jobs-all-${v.tag}.png`, fullPage: true });
    });
   });
  }

  test("the description is not on the card face; Manage job opens it in place and Close shuts it", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: [jobsRule([LONELY_OPEN])] });
    await page.goto("/jobs?tab=posted&filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);

    // The open job's brief. Present in the DOM only once the card is open.
    const description = page.getByText("Full clean — kitchen, two bathrooms", { exact: false });
    await expect(description).toHaveCount(0);

    // The face (boards 14/21): one button, here the fallback "More options" (JA-35, posterFaceAction.ts; it was "Manage job")
    // because nobody has applied yet. It opens the card's controls IN PLACE;
    // the face's own link is the way to the job page.
    const card = page.locator("[data-activity-card]").filter({ hasText: "Deep clean a two-bedroom before move-out" });
    await expect(card).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/card-collapsed-375.png`, fullPage: true });

    await card.getByRole("button", { name: "More options" }).click();
    await expect(description.first()).toBeVisible();
    // Same card — it opened in place rather than navigating to /jobs/:id.
    await expect(page).toHaveURL(/\/jobs\?tab=posted/); // /posts lives at Jobs > Posted since 2026-10-19
    // Open, the face's button stands down (its step row carries the action).
    await expect(card.getByRole("button", { name: "More options" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/card-expanded-375.png`, fullPage: true });

    await closeCard(page);
    await expect(description).toHaveCount(0);
    await expect(card.getByRole("button", { name: "More options" })).toHaveCount(1);
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
    await openJobPage(page, IN_PROGRESS_ID);
    // The job page's tracker is THE one JobProgress (owner, 2026-10-21: "we need 1 tracker").
    await expect(page.locator("[data-job-progress]").first()).toBeVisible();
    // Nothing to confirm yet, so Message is the page's MAIN button (never a greyed future step).
    await expect(page.locator(POSTER_ROW).getByRole("button", { name: /^Message\b/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Message\b/ })).toHaveCount(1);
    // Every move the card offers, opened (More options, then the step row's own More): no No-Show before the start.
    const moves = await openEveryMove(page);
    await expect(page.getByRole("button", { name: /no-show/i })).toHaveCount(0);
    // Share is NOT among the moves: a job that already has a helpr has nothing to advertise.
    await expect(moves.getByRole("button", { name: /share|copy link/i })).toHaveCount(0);
    await expect(page.locator("[data-job-step-overflow-panel]").getByRole("button", { name: /share|copy link/i })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/actions-2up-no-noshow-375.png` });
    await page.keyboard.press("Escape");
  });

  test("No-Show APPEARS once the start time has passed", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    // Identical job, started YESTERDAY at 9:00 AM. Nothing else changed.
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([inProgressJobStarting(-1)])],
    });
    await openJobPage(page, IN_PROGRESS_ID);
    await openEveryMove(page);
    await expect(page.getByRole("button", { name: /no-show/i })).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/actions-3up-with-noshow-375.png`, fullPage: true });

    // Every chip clears the 44px tap target, and no label truncates at 320px —
    // the narrowest width this app supports, where a three-up row fails first.
    await page.setViewportSize({ width: 320, height: 640 });
    await settle(page);
    // Matched on the ACCESSIBLE-NAME PREFIX, not on one full spelling of it.
    // `JobActionChip`'s `ariaLabel` REPLACES the chip's accessible name rather
    // than adding to it, so 7ef7de98 rewrote every chip in PostedJobActions.tsx
    // to "<visible label> — <context>" (WCAG 2.5.3 Label in Name: the name must
    // start with the visible text, or voice control cannot speak the control).
    // The no-show chip's name went from "Report the Helpr as a no-show" to
    // "No-Show — report that the Helpr never turned up" and this loop was never
    // updated, so it sat waiting 30s for a name nothing has had since. The
    // assertion here is about tap-target height, not wording — anchoring it to
    // the visible label keeps it green through the next re-phrasing of the
    // trailing context while still failing if the chip disappears.
    for (const name of [/^Message\b/, /^No-Show\b/]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box, `${name} has no box`).not.toBeNull();
      expect(box!.height, `${name} tap target`).toBeGreaterThanOrEqual(44);
    }
    // SCOPED TO THE ACTION CHIPS, which is what the sentence above claims.
    //
    // This used to sweep every `button span` in the document. It had never once
    // run to completion — the loop above it timed out on a stale aria-label for
    // days — and the first time it did, it flagged "Lafayette": JobCardMetaRow's
    // location chip, measured at scrollWidth 49 in clientWidth 32. That chip is
    // the ONE `min-w-0 shrink` item in a meta row whose date and time chips are
    // `shrink-0 whitespace-nowrap`; it is deliberately the thing that gives way
    // when the row runs out of width, and it carries `truncate` so it ellipses
    // rather than overflows. Asserting it never truncates would be asserting the
    // opposite of the design.
    //
    // An action label has no such fallback — the chips are a fixed-column grid,
    // so a label that does not fit is simply unreadable, which is the failure
    // this gate exists to catch. `[data-job-action-chip]` is the hook that
    // separates the two (JobActionRow.tsx).
    //
    // NO EXEMPTION FOR THE TIGHT ROW ANY MORE, 2026-09-19. This filter used to
    // skip every chip inside `[data-job-step-row][data-compact="true"]`,
    // because such a chip was icon-only BY DESIGN — its label was clipped to
    // 1×1 by index.css and survived only as the accessible name. That design
    // is what the owner reported twice: at 414 and below every non-primary
    // label was screen-reader-only while the primary kept its own, so a phone
    // row was four anonymous icon squares beside one green button.
    //
    // Labels win now (`allocateJobStepRow`): a chip that cannot show its label
    // LEAVES THE ROW, into `More`, where it is labelled two-up. So every chip
    // that IS in the row must show its label in full, at 320, and this gate
    // holds them all to it.
    // Job page v2 (owner 11-01): the card is mounted HIDDEN ([data-poster-more]) and its actions are drawn as the
    // page's own buttons ([data-row-action] on the row, [data-menu-action] for a handed-over chip); a control inside
    // a hidden subtree is not on screen and is not measured.
    const ACTIONS = "[data-job-action-chip], [data-row-action], [data-menu-action]";
    const clipped = await page.evaluate((sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => !el.closest("[hidden]"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent ?? ""),
    ACTIONS);
    expect(clipped, `truncated action labels at 320px: ${clipped.join(", ")}`).toEqual([]);
    // …AND THE LABEL IS ACTUALLY PAINTED. A clipped-to-1×1 label is not a
    // truncation — `scrollWidth <= clientWidth` on a 1px box — so the check
    // above passed on the shipped bug. This is the one that would not have.
    const invisible = await page.evaluate((sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => !el.closest("[hidden]"))
        .filter((el) => (el.textContent ?? "").trim().length > 0)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width < 8 || r.height < 6 || cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.visibility === "hidden";
        })
        .map((el) => `${el.textContent} (${el.getBoundingClientRect().width}x${el.getBoundingClientRect().height})`),
    ACTIONS);
    expect(
      invisible,
      `chip labels rendered screen-reader-only at 320px: ${invisible.join(", ")}`,
    ).toEqual([]);
    // …and the gate must actually have chips to look at, or it passes vacuously
    // the day someone drops the attribute. Since Q1080 every self-drawn chip
    // (SOS, Directions, Share, the photo chip) carries the hook too, and
    // src/test/jobRowControlSameness.test.tsx fails on a row chip without it;
    // two is the floor the tap-target loop above names.
    expect(
      await page.locator(`:is(${ACTIONS}):not([hidden] *)`).count(),
      "no action chips found at 320px — the gate above would pass on an empty row",
    ).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${SHOTS}/actions-3up-320.png`, fullPage: true });
  });

  // ── The owner's card reorganisation, frozen ────────────────────────────
  // Five asks that are only provable by rendering: the tracker became one
  // scrolling line, the action row was reordered around SOS, Message stopped
  // changing colour between cards, Message deep-links into the thread, and the
  // description toggle lost its words.

  test("the live tracker is the ONE four-segment line, and its next line names the step", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      // A HIRED job: the Helpr accepted (helper_confirmed_at), both confirmed, then set off. It starts 90 minutes
      // from now: a start already past with no arrival is a No-show on the tracker (owner 2026-10-22), not "Arr.".
      rules: [jobsRule([{ ...inProgressJobStarting(0), ...startInLouisiana(90),helper_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(), helper_dayof_confirmed_at: new Date(Date.now() - 3_600_000).toISOString(), poster_confirmed_at: new Date(Date.now() - 3_600_000).toISOString(), helper_on_the_way_at: new Date().toISOString() }])],
    });
    await openJobPage(page, IN_PROGRESS_ID);

    // ONE tracker (owner, 2026-10-21: "we need 1 tracker"; 8 steps 2026-10-22): chat, the job page and both
    // cards draw JobProgress, Posted · Offered · Hired · Confirmed · On the way · Arrived · Working · Done, in
    // short words at 375 (src/components/tracker/jobProgressState.ts).
    const tracker = page.locator("[data-job-progress]");
    await expect(tracker).toHaveCount(1);
    await tracker.scrollIntoViewIfNeeded();
    const row = tracker.locator("[data-job-steps]");
    await expect(row).toHaveCount(1);
    const steps = await row.evaluate((el) =>
      Array.from(el.children).map((c) => ({ top: (c as HTMLElement).offsetTop, text: ((c as HTMLElement).innerText ?? "").trim() })),
    );
    expect(steps.map((s) => s.text), "the eight steps, in order").toEqual(["Post", "Offer", "Hired", "Conf.", "Way", "Arr.", "Work", "Done"]);
    // ONE line, and it FITS: no step wraps, nothing scrolls sideways at 375.
    expect(new Set(steps.map((s) => s.top)).size, "steps sit on more than one line").toBe(1);
    const { scrollWidth, clientWidth } = await row.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth, "the tracker overflows its card").toBeLessThanOrEqual(clientWidth);

    // Job page v2 (owner 11-01): who is on the way and since when sits ABOVE the tracker ([data-on-the-way],
    // OnTheWayNow.tsx), and the tracker no longer repeats it in its own next line.
    await expect(page.locator("[data-on-the-way]")).toContainText(/is on the way/);
    await expect(tracker.locator("[data-job-progress-next]")).toHaveCount(0);
    // Status wording appears only in a step's note host or the tracker's next line;
    // a free-floating caption anywhere else on the card is the regression.
    const orphanStatusLines = await page.evaluate(() => {
      const re = /is on the way|finished the job|Offered to/i;
      return Array.from(document.querySelectorAll<HTMLElement>("*"))
        .filter((el) => el.children.length === 0 && re.test(el.textContent ?? ""))
        .filter((el) => !el.closest("[data-job-step-note]") && !el.closest("[data-job-progress-next]") && !el.closest("[data-on-the-way]"))
        .map((el) => (el.textContent ?? "").trim());
    });
    expect(
      orphanStatusLines,
      "status wording outside a step's note host or the tracker's next line — the free-floating caption is back",
    ).toEqual([]);

    await page.screenshot({ path: `${SHOTS}/tracker-one-line-375.png` });
  });

  test("the page row draws Message once, SOS as an outlined option, and no job share", async ({ page, context, baseURL }) => {
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
    // Job page v2 (owner 11-01: one row, the green one on the right, short pair labels; JobPageActionRow.tsx). The
    // card is mounted hidden and hands its options to the page minus Message (jobStepMenu.tsx), so on each page:
    // Message is ONE button (never the card's too), SOS is an ordinary outlined option (never the lead, never a big
    // red button), and no job-share control is offered on a job that already has its Helpr.
    // (Message's colour now follows its place by the owner's 11-01 rule: green when it leads, outlined beside a step.)
    for (const jobId of ["job-msg-plain", "job-msg-done"]) {
      await openJobPage(page, jobId);
      const options = await openMoreOptions(page);
      await expect(page.getByRole("button", { name: /^Message\b/ }), `${jobId}: Message is drawn once`).toHaveCount(1);
      // SOS while the Helpr is on site and the work is not marked done (the finished job's card no longer offers it).
      const sos = options.getByRole("button", { name: /^SOS\b/ });
      if (jobId === "job-msg-plain") {
        await expect(sos, `${jobId}: SOS is one of the options`).toHaveCount(1);
        await expect(sos).toHaveAttribute("data-sos-secondary", "");
      }
      const labels = await options.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim() ?? ""));
      expect(labels.some((l) => /^(share this job|copy a link to this job)$/i.test(l)), `${jobId}: a job-share control: ${labels.join(" | ")}`).toBe(false);
      if (jobId === "job-msg-done") {
        await page.keyboard.press("Escape");
        await expect(page.locator(POSTER_ROW).getByRole("button", { name: /Approve/ }), "the finished job's lead is Approve").toHaveCount(1);
      }
      await page.screenshot({ path: `${SHOTS}/actions-sos-message-${jobId}-375.png`, fullPage: true });
      await page.keyboard.press("Escape");
    }
  });

  test("Message opens the thread with THIS helpr on THIS job", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [jobsRule([inProgressJobStarting(-1)])],
    });
    await openJobPage(page, IN_PROGRESS_ID);

    // Message is the job page's main button while nothing is confirmable (owner rule 2026-10-21).
    await page.getByRole("button", { name: /^Message\b/ }).first().click();
    await page.waitForURL(/\/messages\?/);
    const url = new URL(page.url());
    // Landing on the bare list — the old behaviour — leaves both params null.
    expect(url.searchParams.get("userId"), "helpr not addressed").toBe(HELPER_ID);
    expect(url.searchParams.get("jobId"), "job not addressed").toBeTruthy();
  });

  // The action row must not toggle the card it sits in.
  //
  // JobCardShell owns the expand handler on the whole card — a deliberate
  // decision (the chevron was dropped in favour of it) — so every click inside
  // a card bubbles up to it unless something stops it. Tapping Share, Boost,
  // Edit or Cancel therefore fired the action AND toggled the card (owner,
  // 2026-08-27: "the job card shouldn't expand every time a button is clicked
  // at the bottom of the card"). Now that cards open collapsed, that stray
  // toggle COLLAPSES the row under the finger that just used it.
  //
  // This asserts both halves, because asserting only that the tap landed is
  // exactly the failure mode that let it ship: the action does its thing, AND
  // the card is still open afterwards.
  test("an action in the bottom row does not toggle the card", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    // Only the open job: the default seed includes an overdue
    // revision_requested card that does not render Edit (only "open" cards do).
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: [jobsRule([SEED_JOBS[0] as Row])] });
    const openId = String(SEED_JOBS[0].id);
    await openJobPage(page, openId);

    // Edit — the one that opens something we can assert on. On the job page (owner 2026-10-31: Manage job is the
    // job page) it is the page's own "Edit job", which runs the Posted card's own edit flow (usePosterPageFlows).
    // Job page v2: Edit is on the row, or under the row's "More options" when there are several.
    const editHost = await openMoreOptions(page);
    const edit = editHost.getByRole("button", { name: "Edit job" });
    await expect(edit).toBeEnabled();
    await edit.click();

    // The action happened...
    //
    // `dialog, alertdialog` — NOT `getByRole("dialog")`. Edit opens
    // EditJobDialog, which is a CONFIRM and therefore carries
    // `role="alertdialog"` since ui/alert-dialog.tsx was merged into
    // ui/dialog.tsx. ARIA treats alertdialog as its own role, not a subtype of
    // dialog, so `getByRole("dialog")` stops matching it — and the failure
    // reads as "element(s) not found", i.e. indistinguishable from the card
    // having collapsed, which is the very thing this test exists to detect.
    // The More panel is a Radix popover (role=dialog too) and can still be in
    // the DOM, closing, when Edit's sheet opens: main went red on exactly that
    // ("resolved to 2 elements", 2026-10-09). The overflow panel is not the modal.
    // Job page v2: the More options sheet ([data-row-options]) can still be in the DOM, closing, when Edit's sheet opens.
    const modal = page.locator('[role="dialog"]:not([data-job-step-overflow-panel]):not([data-row-options]), [role="alertdialog"]');
    await expect(modal).toBeVisible();

    // ...and the card underneath did NOT collapse. Dismiss the modal first:
    // Radix marks everything outside an open dialog aria-hidden, so the card's
    // own toggle is unreachable by role while it is up — and an "element not
    // found" there would look exactly like a collapse.
    await page.keyboard.press("Escape");
    // Escape on the Edit sheet does NOT discard silently: the form guards
    // unsaved changes with a "Discard Your Changes?" confirm, so a second
    // dialog is stacked and `toHaveCount(0)` never arrives — the app being
    // careful read as this test's own failure (WebKit, 2026-09-15). Answer the
    // guard the way a user would, then assert the card is still expanded.
    const discard = page.getByRole("button", { name: /^Discard Changes$/ });
    if (await discard.count()) await discard.first().click();
    // The More panel (a Radix popover, role=dialog) can take the first Escape;
    // close whatever is still up, the way a user would, before judging the card.
    for (let i = 0; i < 4 && (await modal.count()); i++) {
      await page.keyboard.press("Escape");
      // The discard guard animates in: wait for it briefly rather than sampling once.
      await discard.first().click({ timeout: 1500 }).catch(() => {});
    }
    await expect(modal).toHaveCount(0);
    // The page underneath did not move or fold: same job page, its actions still there.
    await expect(page).toHaveURL(new RegExp(`/jobs/${openId}$`));
    await expect(page.locator(POSTER_ROW)).toHaveCount(1);
  });

  test("the card face is a link to its job page, and no card carries the retired sr-only toggle", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: [jobsRule([LONELY_OPEN])] });
    await page.goto("/jobs?tab=posted&filter=all");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);

    // Boards 14/21 (2026-10-20): the face replaced JobCardShell's whole-card
    // toggle and its sr-only "Expand job details" button. Two ways in, each a
    // real control: the face's link to /jobs/:id, and its one button.
    await expect(page.getByRole("button", { name: /^(Expand|Collapse) Job Details$/ })).toHaveCount(0);
    const face = page.getByRole("link", { name: `Open ${String(LONELY_OPEN.title)}` });
    await expect(face).toHaveAttribute("href", `/jobs/${String(LONELY_OPEN.id)}`);
    await face.click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${String(LONELY_OPEN.id)}$`));
  });

  test("the active bucket is the selected tab, not a caption beside the title", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });

    // The four buckets replaced Active / All / Completed / Cancelled — they
    // sort by whose move it is rather than by the job's own lifecycle. See
    // ActivityBucket in src/components/job-card/activityFilters.ts for why.
    //
    // "all" is gone from the chip set and deliberately NOT asserted here: it
    // still resolves as a filter VALUE so notification deep links keep working,
    // but it has no chip and therefore no label to name.
    /* Jobs > Posted (2026-10-19): the buckets are STATUS BOXES, always on
       screen (no chevron, no folded row), each a count over its group's word
       from POSTED_GROUP_LABEL, the app's own vocabulary. */
    for (const filter of ["needs_you", "scheduled", "waiting", "done"] as const) {
      const label = POSTED_GROUP_LABEL[filter];
      await page.goto(`/jobs?tab=posted&filter=${filter}`);
      await page.waitForSelector("h1");
      await settle(page);
      await dismissNudge(page);
      const tab = page.getByRole("group", { name: "Filter by status" }).locator(`[data-status-box="${filter}"]`);
      await expect(tab, `filter=${filter} tab is present`).toBeVisible();
      await expect(tab, `filter=${filter} box names its group`).toContainText(label);
      await expect(tab, `filter=${filter} tab is selected`).toHaveAttribute("aria-pressed", "true");
      // Still exactly one heading — the indicator is a span, never an h2.
      await assertOneH1(page);
      if (filter === "needs_you") {
        /* The HEADER CARD itself, not the viewport — a plain screenshot here
           caught wherever the list happened to be scrolled to and showed no
           header at all.

           `h1`'s grandparent (`../..`) is NOT that card: it captured the title
           and the two icon buttons and cropped the tab row straight off, so
           the evidence for this test showed none of what the test asserts.
           Anchored on the two things that must BOTH be in frame instead —
           the innermost element holding the heading and the tab group. */
        await page
          .locator("div")
          .filter({ has: page.locator("h1") })
          .filter({ has: page.getByRole("group", { name: "Filter by status" }) })
          .last()
          .screenshot({ path: `${SHOTS}/header-filter-needs-you-375.png` });
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
    await page.goto("/jobs?tab=posted&filter=all");
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
    await page.goto("/jobs?tab=posted&filter=waiting");
    await page.waitForSelector("h1");
    await settle(page);
    await dismissNudge(page);
    await expect(page.getByText(lonely.title as string).first()).toBeVisible();
    await recordContrast(page, "neutral-375-light");
  });

  test("My Jobs: the applied card is the same face, and Manage job opens one card at a time", async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
    await page.goto("/jobs?tab=working&filter=all");
    await page.waitForSelector("h1");
    await settle(page);

    // Posted and Working draw ONE card (MineJobFace, boards 14/21): every card
    // arrives as a face, none open, and the face's fallback button "Manage job"
    // opens that card's tracker and step row in place (helperFaceAction).
    await expect(page.locator("[data-mine-face]").first()).toBeVisible();
    await expect(page.locator("[data-mine-close]")).toHaveCount(0);
    const manage = page.getByRole("button", { name: "Manage job" });
    expect(await manage.count(), "no Working card offers Manage job").toBeGreaterThan(0);

    await manage.first().click();
    await expect(page.locator("[data-mine-close]")).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/jobs-expanded-375.png`, fullPage: true });
    await closeCard(page);

    // The withdraw action is the icon-over-label chip now, still destructive.
    void SEED_APPLICATIONS;
  });
});

// The No-Show gate is a CLOCK, not a status: `hasJobStarted` is the single
// line that keeps a 9:00 AM job from offering No-Show at 8:00 AM (owner's
// rule, src/lib/dateUtils.ts). Forcing it true makes the chip appear on a job
// that starts tomorrow — the accusation-before-the-fact defect this spec pins
// by MOVING THE JOB'S DATE rather than reasoning about the clock.
// @mutate src/lib/dateUtils.ts | return now.getTime() >= start.getTime(); | return true;
