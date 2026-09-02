/**
 * state-sweep — drive every cell of the state matrix and capture it.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE SWEEPS ALREADY IN THIS FOLDER
 * ----------------------------------------------------------------
 * `visual-audit-sweep.spec.ts` walks ROUTES. `overlay-sweep.spec.ts` walks
 * TRIGGERS. Both photograph whatever state the seed data happened to produce,
 * which for `e2e/happy-path/seedData.ts` is one job per status, all in their
 * resting shape, all on time, none expanded, none disputed, none past due, and
 * — a real gap, found while writing this — `pending_approval` missing entirely,
 * so one of the eight statuses has never appeared in any screenshot this repo
 * has ever produced.
 *
 * This sweep walks STATES. Each cell in `stateMatrix.ts` names a job row down
 * to the nullable columns the cards branch on; this file turns that row into
 * `page.route()` responses, loads the surface, forces expansion or opens the
 * dialog, and captures the frame. Nothing depends on production data being in
 * a convenient shape — which is precisely why the convenient shapes were the
 * only ones ever audited.
 *
 * Run:
 *   # against an already-running dev or preview server
 *   RUN_STATE_SWEEP=1 HAPPY_PATH_BASE_URL=http://127.0.0.1:5233 \
 *     npx playwright test --project=happy-path state-sweep
 *
 *   # or let Playwright build and serve a production bundle itself
 *   RUN_STATE_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
 *     npx playwright test --project=happy-path state-sweep
 *
 *   # manifest only, no browser work
 *   EMIT_STATE_MATRIX=1 npx playwright test --project=happy-path state-sweep -g "emit manifest"
 *
 * Output (STATE_SWEEP_OUT, default /tmp/lh-state-sweep):
 *   <cell-id>__<shot>.png    the frame
 *   <cell-id>__<shot>.json   the review record (cell metadata + observations)
 *   index.json               every record, plus the cells that could not be driven
 *
 * The records are input to `scripts/state-review.mjs`, which is what actually
 * LOOKS. This file deliberately asserts almost nothing: the one thing it fails
 * on is a cell it could not reach, because an unreachable cell must be visible
 * as UNVERIFIED rather than silently absent.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page, BrowserContext } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  mockTable,
  mockRpc,
  seedAuthedSession,
  type MockRule,
} from "../fixtures";
import {
  enumerateStates,
  summarize,
  COLLAPSING_RULES,
  BASE_JOB,
  BASE_APPLICATION,
  CELL_JOB_ID,
  POSTER_ID,
  HELPER_ID,
  OTHER_ID,
  CLOCK,
  type StateCell,
  type Shot,
} from "./stateMatrix";
import { observe, tagRegion, type StateObservation } from "./observe";

const OUT = process.env.STATE_SWEEP_OUT || "/tmp/lh-state-sweep";
// Only touch the filesystem when this spec is actually going to run. Both
// describes below are skipped without one of these env vars, and the normal
// `npm run test:e2e:happy` run should not create directories for a sweep it is
// not performing.
if (process.env.RUN_STATE_SWEEP || process.env.EMIT_STATE_MATRIX) {
  mkdirSync(OUT, { recursive: true });
}

const CELLS = enumerateStates();

interface ReviewRecord {
  cellId: string;
  shot: string;
  surface: string;
  route: string;
  describe: string;
  axes: Record<string, string>;
  status?: string | null;
  derived?: string;
  expanded: boolean;
  screenshot: string;
  driven: boolean;
  /** Populated when the cell could not be driven — this is the UNVERIFIED reason. */
  unverified?: string;
  observation?: StateObservation;
}

const records: ReviewRecord[] = [];
const unverified: { cellId: string; reason: string }[] = [];

// ---------------------------------------------------------------------------
// Fixtures -> mock rules
// ---------------------------------------------------------------------------

const PROFILE_ROWS = [
  {
    user_id: HELPER_ID,
    id: `${HELPER_ID}-profile`,
    full_name: "Marcus Thibodeaux",
    avatar_url: null,
    location: "New Orleans, LA",
    bio: "Ten years of moving and handyman work across the parish.",
    subscription_tier: "pro",
    is_verified: true,
    approval_status: "approved",
    ban_status: "active",
    is_id_verified: true,
    is_payout_ready: true,
    is_licensed: false,
    is_insured: false,
  },
  {
    user_id: OTHER_ID,
    id: `${OTHER_ID}-profile`,
    // Accented + long: the name-truncation probe.
    full_name: "Renée Beauchêne-Landry",
    avatar_url: null,
    location: "Baton Rouge, LA",
    bio: "Detail cleaning, move-outs and post-renovation work.",
    subscription_tier: "free",
    is_verified: true,
    approval_status: "approved",
    ban_status: "active",
    is_id_verified: false,
    is_payout_ready: true,
  },
  {
    user_id: POSTER_ID,
    id: `${POSTER_ID}-profile`,
    full_name: "Smoke Customer",
    avatar_url: null,
    location: "Baton Rouge, LA",
    subscription_tier: "free",
    is_verified: true,
    approval_status: "approved",
    ban_status: "active",
  },
];

const CATEGORIES = [
  "cleaning", "yard_work", "moving", "errands", "handyman", "painting",
  "delivery", "pet_care", "assembly", "storm_prep", "events", "other",
];

/** A spread of jobs covering every bucket, for the "rich" activity-shell cells. */
function densityJobs(): Record<string, unknown>[] {
  return [
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d1", status: "open", title: "Mow and edge a corner lot", category: "yard_work" },
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d2", status: "accepted", helper_id: HELPER_ID, helper_confirmed_at: CLOCK.ISO(-CLOCK.HOURS(6)), title: "Assemble a crib and a changing table", category: "assembly", date_needed: CLOCK.DATE_ONLY(CLOCK.DAYS(1)) },
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d3", status: "in_progress", helper_id: HELPER_ID, helper_confirmed_at: CLOCK.ISO(-CLOCK.DAYS(1)), helper_arrived_at: CLOCK.ISO(-CLOCK.HOURS(2)), helper_arrival_verified_at: CLOCK.ISO(-CLOCK.HOURS(2)), title: "Pre-storm yard prep", category: "storm_prep", date_needed: CLOCK.DATE_ONLY(0) },
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d4", status: "completed", helper_id: HELPER_ID, poster_completed_at: CLOCK.ISO(-CLOCK.DAYS(2)), helper_completed_at: CLOCK.ISO(-CLOCK.DAYS(2)), payment_status: "released", title: "Touch-up paint in a hallway", category: "painting", date_needed: CLOCK.DATE_ONLY(-CLOCK.DAYS(2)) },
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d5", status: "cancelled", title: "Weekly grocery run and pharmacy pickup", category: "errands", date_needed: CLOCK.DATE_ONLY(-CLOCK.DAYS(3)) },
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d6", status: "disputed", helper_id: HELPER_ID, has_active_dispute: true, dispute_status: "open", disputed_by: POSTER_ID, dispute_reason: "Half the yard was left.", helper_completed_at: CLOCK.ISO(-CLOCK.DAYS(1)), title: "Deep clean a two-bedroom before move-out", category: "cleaning", date_needed: CLOCK.DATE_ONLY(-CLOCK.DAYS(1)) },
    { ...BASE_JOB, id: "10000000-0000-4000-8000-0000000000d7", status: "pending_approval", title: "Replace three interior door handles", category: "handyman" },
  ];
}

function buildRules(cell: StateCell): MockRule[] {
  const f = cell.fixture ?? {};
  const rules: MockRule[] = [];

  // The category-palette cell renders twelve sibling cards, one per category.
  if (f.tables?.__categoryPalette) {
    const jobs = CATEGORIES.map((c, i) => ({
      ...BASE_JOB,
      id: `10000000-0000-4000-8000-0000000000${(i + 20).toString(16).padStart(2, "0")}`,
      category: c,
      status: "open",
      title: `${c.replace(/_/g, " ")} — sibling card for palette comparison`,
    }));
    rules.push(mockTable("jobs", jobs));
  } else if (f.tables?.__density) {
    const density = String((f.tables.__density as unknown[])[0]);
    const jobs = density === "rich" ? densityJobs() : [];
    rules.push(mockTable("jobs", jobs));
    rules.push(
      mockRpc(
        "get_jobs_for_my_applications",
        jobs.map((j) => ({ ...j, customer_id: POSTER_ID })),
      ),
    );
    rules.push(
      mockTable(
        "applications",
        jobs.map((j, i) => ({
          ...BASE_APPLICATION,
          id: `20000000-0000-4000-8000-0000000000${(i + 40).toString(16).padStart(2, "0")}`,
          job_id: j.id,
          status: j.status === "open" ? "pending" : "accepted",
        })),
      ),
    );
  } else {
    const job = f.job ? { ...f.job } : null;
    rules.push(mockTable("jobs", job ? [job] : []));
    rules.push(mockRpc("get_jobs_for_my_applications", job ? [job] : []));

    if (cell.surface === "applied-card" || cell.route.startsWith("/my-jobs")) {
      rules.push(mockTable("applications", f.application ? [f.application] : []));
    } else {
      // Poster side: `applications` is the PENDING-APPLICANT count query.
      const n = f.applicants ?? 0;
      rules.push(
        mockTable(
          "applications",
          Array.from({ length: n }, (_, i) => ({
            ...BASE_APPLICATION,
            id: `20000000-0000-4000-8000-0000000000${(i + 10).toString(16).padStart(2, "0")}`,
            job_id: job?.id ?? CELL_JOB_ID,
            helper_id: i === 0 ? HELPER_ID : OTHER_ID,
            status: "pending",
            message:
              i === 0
                ? "I clean three move-outs a week and can bring my own supplies if that helps."
                : "Available this weekend. I have worked in Mid-City and can send references.",
          })),
        ),
      );
    }
  }

  rules.push(mockRpc("get_safe_profiles", PROFILE_ROWS));
  rules.push(mockRpc("get_my_pending_direct_offers", []));
  rules.push(mockTable("user_violations", []));
  rules.push(mockTable("group_job_helpers", []));
  rules.push(mockTable("job_tracking", f.tracking ? [f.tracking] : []));
  rules.push(mockTable("tips", (f.tippedJobIds ?? []).map((job_id) => ({ job_id }))));
  rules.push(mockTable("reviews", (f.reviewedJobIds ?? []).map((job_id) => ({ job_id }))));

  return rules;
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

/**
 * Which identity a cell is viewed as. Derived from the ROUTE, not from a flag,
 * so a cell can never claim to be a helper view while loading a poster route.
 */
function identityFor(cell: StateCell): typeof FAKE_CUSTOMER | typeof FAKE_HELPER | null {
  if (cell.route.startsWith("/browse")) return null; // guest
  if (cell.route.startsWith("/my-jobs")) return FAKE_HELPER;
  if (cell.axes.viewer === "guest") return null;
  return FAKE_CUSTOMER;
}

async function prepare(context: BrowserContext, page: Page, cell: StateCell, shot: Shot): Promise<void> {
  const user = identityFor(cell);
  if (user) await seedAuthedSession(context, user, "");
  // Theme, welcome modal and tour must all land BEFORE the app's first paint.
  await context.addInitScript(
    ({ theme }) => {
      try {
        localStorage.setItem("helpr-theme", theme);
        localStorage.setItem("helpr_welcomed", "1");
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
        );
        localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
      } catch {
        /* storage unavailable — the tour will show and the record will say so */
      }
    },
    { theme: shot.theme },
  );
  await page.setViewportSize({ width: shot.width, height: shot.height });
  await installSupabaseMocks(page, {
    user: user ?? undefined,
    seed: false,
    rules: buildRules(cell),
  });
}

/**
 * Expand the first job card by dispatching a click on its sr-only toggle.
 *
 * The explicit wait matters: `networkidle` fires when the HTTP mocks settle,
 * but the Activity page then runs several dependent React Query passes (jobs,
 * then applications, then get_safe_profiles, then tips/reviews) before a card
 * exists. Without the wait, a run under four parallel workers reported "no
 * expandable card rendered" for whole families of cells — a harness timing
 * artifact that would have been filed as an app defect.
 */
async function expandFirstCard(page: Page): Promise<boolean> {
  // Matched by the toggle's OWN LABEL, with a CSS locator plus a text filter.
  //
  // Two bugs are fixed here, both found by reading records rather than trusting
  // a green result:
  //
  //  1. A bare `button[aria-expanded]` matched ActivityHeader's filter chevron
  //     first, so every "expanded" cell collapsed the page header instead of
  //     opening the card — and still recorded `driven: true`. Caught by seeing
  //     "Expand Job Details" in the `copy` of a cell that was meant to be open.
  //  2. The obvious fix — `getByRole("button", { name, includeHidden: true })`
  //     — forces Playwright to compute the whole accessibility tree on every
  //     poll. On these pages that is tens of seconds per call, and with three
  //     calls per shot every test hit its ceiling and wrote no frame at all.
  //     A CSS locator with `hasText` reads textContent and costs nothing.
  //
  // `hasText` sees the sr-only label because it matches textContent, not
  // visible text.
  const toggle = page.locator("button[aria-expanded]").filter({ hasText: "Expand Job Details" }).first();
  await page
    .locator("button[aria-expanded]")
    .filter({ hasText: /(Expand|Collapse) Job Details/ })
    .first()
    .waitFor({ state: "attached", timeout: 8_000 })
    .catch(() => undefined);
  if ((await toggle.count()) === 0) return false;
  // dispatchEvent, not click(): the toggle is `sr-only`, so Playwright treats it
  // as invisible and click() would time out. The handler is identical — it is
  // the same onToggle the card wrapper calls.
  await toggle.dispatchEvent("click").catch(() => undefined);
  await page.waitForTimeout(600);
  // Confirm it actually opened. A dispatch that changed nothing must read as
  // "could not reach", never as a driven frame.
  const opened = await page
    .locator("button[aria-expanded]")
    .filter({ hasText: "Collapse Job Details" })
    .count();
  return opened > 0;
}

/**
 * Open the collapsed status GROUPS the Activity list renders under
 * `?filter=all`.
 *
 * `groupByStatus` (Activity.tsx) folds the list into Active / Completed /
 * Cancelled accordions and only Active starts open, so every `completed`,
 * `cancelled` and `disputed` cell loaded a page whose card was inside a shut
 * accordion, found no card toggle, and reported "the seeded row did not reach
 * the list" — wrong, and wrong in the direction of blaming the app. Cancelled
 * sits behind a second gate again: a "Show Cancelled" opt-in that is not an
 * accordion and carries no aria-expanded.
 *
 * Done as ONE `page.evaluate` that clicks in the page, not as a sequence of
 * Playwright locator calls.
 *
 * The locator version cost every test its entire budget: each `count()`,
 * `textContent()`, `boundingBox()` and `click()` is a separate round trip with
 * its own actionability polling, and against a Vite dev server that added up
 * past the timeout before a single frame was written. Twenty-plus round trips
 * became one. Nothing is lost by clicking directly — these are ordinary
 * buttons with React onClick handlers, and the sweep is not testing whether
 * they are clickable, it is trying to get past them.
 */
async function openCollapsedGroups(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const GROUP = /^(Active|Completed|Cancelled)\s*\d*$/i;
      const SHOW = /^Show (Cancelled|Completed|Done)/i;
      const buttons = [...document.querySelectorAll("#root button")] as HTMLElement[];
      let clicked = 0;
      for (const b of buttons) {
        const label = (b.textContent ?? "").trim();
        if (SHOW.test(label)) {
          b.click();
          clicked += 1;
          continue;
        }
        // Group headers only: named, full width, and currently shut.
        if (!GROUP.test(label)) continue;
        if (b.getAttribute("aria-expanded") !== "false") continue;
        if (b.getBoundingClientRect().width < 200) continue; // a tab chip
        b.click();
        clicked += 1;
      }
      return clicked;
    })
    .catch(() => 0);
  await page.waitForTimeout(400);

  // One more pass: revealing a group can mount another shut one.
  await page
    .evaluate(() => {
      const GROUP = /^(Active|Completed|Cancelled)\s*\d*$/i;
      for (const b of [...document.querySelectorAll('#root button[aria-expanded="false"]')] as HTMLElement[]) {
        const label = (b.textContent ?? "").trim();
        if (!GROUP.test(label)) continue;
        if (b.getBoundingClientRect().width < 200) continue;
        b.click();
      }
    })
    .catch(() => undefined);
  await page.waitForTimeout(350);
}

/** Click through a named trigger chain. Returns the step it failed at, if any. */
async function openChain(page: Page, chain: string[]): Promise<string | null> {
  for (const step of chain) {
    if (step === "card") {
      const ok = await expandFirstCard(page);
      if (!ok) return "card (no expandable card rendered)";
      continue;
    }
    if (step.startsWith("<")) {
      // "<first reason>" — pick the first radio/option inside the open overlay.
      const opt = page
        .locator('[role="dialog"] [role="radio"], [role="dialog"] button')
        .filter({ hasNotText: /cancel|close|back/i })
        .first();
      if ((await opt.count()) === 0) return step;
      await opt.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      continue;
    }
    const target = page
      .locator(`button:visible, a[href]:visible, [role="button"]:visible`)
      .filter({ hasText: new RegExp(step.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
      .first();
    if ((await target.count()) === 0) return step;
    await target.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  return null;
}

async function driveCell(
  context: BrowserContext,
  page: Page,
  cell: StateCell,
  shot: Shot,
): Promise<void> {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  await prepare(context, page, cell, shot);
  // One retry: a dev server shared with other sessions occasionally answers
  // ERR_EMPTY_RESPONSE mid-rebuild. A transport blip must not be recorded as an
  // unreachable state — those two things have to stay distinguishable.
  let navError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(cell.route, { waitUntil: "domcontentloaded", timeout: 30_000 });
      navError = null;
      break;
    } catch (e) {
      navError = String(e).slice(0, 160);
      await page.waitForTimeout(1500);
    }
  }
  if (navError) {
    const name = `${cell.id}__${shot.label}`;
    const rec: ReviewRecord = {
      cellId: cell.id, shot: shot.label, surface: cell.surface, route: cell.route,
      describe: cell.describe, axes: cell.axes, status: cell.status ?? null,
      derived: cell.derived, expanded: cell.expanded,
      screenshot: resolve(OUT, `${name}.png`), driven: false,
      unverified: `server did not answer ${cell.route}: ${navError}`,
    };
    records.push(rec);
    writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(rec, null, 2));
    unverified.push({ cellId: cell.id, reason: rec.unverified! });
    return;
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(700);

  let failedAt: string | null = null;
  let regionMode: "card" | "dialog" | "main";

  if (cell.surface === "dialog") {
    await openCollapsedGroups(page);
    failedAt = await openChain(page, cell.open ?? []);
    regionMode = "dialog";
  } else if (cell.surface === "job-detail") {
    // Open the detail dialog from the first feed card, then optionally advance.
    const card = page.locator('#root [role="button"], #root button').filter({ hasText: /clean|moving|mow|assemble/i }).first();
    if ((await card.count()) > 0) {
      await card.click({ timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
    if (cell.axes.step === "apply") {
      failedAt = await openChain(page, ["Apply"]);
    }
    if ((await page.locator('[role="dialog"][data-state="open"]').count()) === 0) {
      failedAt = failedAt ?? "job detail dialog did not open from a feed card";
    }
    regionMode = "dialog";
  } else if (cell.surface === "activity-shell") {
    regionMode = "main";
  } else {
    // `?filter=all` groups the list into collapsed accordions; open them first
    // or the seeded card is inside a shut one and looks like it never loaded.
    await openCollapsedGroups(page);
    if (cell.expanded) {
      const ok = await expandFirstCard(page);
      if (!ok) failedAt = "no expandable card rendered (the seeded row did not reach the list)";
    }
    // Not a ternary on activity-shell: the `else if` above already claimed
    // that surface, so this branch can only be a card surface.
    regionMode = "card";
  }

  const anchor = String((cell.fixture?.job as Record<string, unknown> | undefined)?.title ?? "");
  // A trigger that navigated instead of opening an overlay destroys the
  // execution context mid-evaluate. Recover to the route rather than losing the
  // frame: an unexamined state and a crashed harness look identical in a report
  // and must not.
  let tagged = await tagRegion(page, regionMode, anchor).catch(() => false);
  if (!tagged) {
    await page.goto(cell.route, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(800);
    if (cell.expanded) await expandFirstCard(page).catch(() => false);
    tagged = await tagRegion(page, regionMode, anchor).catch(() => false);
  }
  if (!tagged && regionMode !== "main") {
    // Fall back to the whole app rather than skipping the frame — a screenshot
    // of the wrong scope is still reviewable; a missing one is not.
    await tagRegion(page, "main", anchor).catch(() => false);
  }

  const name = `${cell.id}__${shot.label}`;
  const png = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: png, fullPage: false }).catch(() => undefined);

  const observation = await observe(page, consoleErrors).catch(() => ({
    region: null, colors: [], hueFamilies: [], nearMissAlignments: [], emptyBands: [],
    overlaps: [], sections: [], actions: [], copy: [], siblingColorSplits: [],
    consoleErrors,
  }));

  const record: ReviewRecord = {
    cellId: cell.id,
    shot: shot.label,
    surface: cell.surface,
    route: cell.route,
    describe: cell.describe,
    axes: cell.axes,
    status: cell.status ?? null,
    derived: cell.derived,
    expanded: cell.expanded,
    screenshot: png,
    driven: !failedAt && !!tagged,
    unverified: failedAt
      ? `could not reach: ${failedAt}`
      : !tagged
        ? "region could not be resolved; frame is the whole viewport"
        : undefined,
    observation,
  };
  records.push(record);
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(record, null, 2));
  if (record.unverified) unverified.push({ cellId: cell.id, reason: record.unverified });
}

// ---------------------------------------------------------------------------
// Manifest emitter — runs without a browser
// ---------------------------------------------------------------------------

const emitOnly = !!process.env.EMIT_STATE_MATRIX;
const sweepOn = !!process.env.RUN_STATE_SWEEP;
const manifestDescribe = emitOnly || sweepOn ? test.describe : test.describe.skip;

manifestDescribe("state matrix", () => {
  test("emit manifest", async () => {
    const summary = summarize(CELLS);
    const json = {
      generatedAt: new Date().toISOString(),
      summary,
      collapsingRules: COLLAPSING_RULES,
      cells: CELLS,
    };
    writeFileSync(resolve(OUT, "state-matrix.json"), JSON.stringify(json, null, 2));

    const md: string[] = [];
    md.push("# State matrix — generated");
    md.push("");
    md.push(`Generated ${json.generatedAt} by \`e2e/happy-path/state-matrix/stateMatrix.ts\`.`);
    md.push("Do not hand-edit: regenerate with");
    md.push("`EMIT_STATE_MATRIX=1 npx playwright test --project=happy-path state-sweep -g \"emit manifest\"`.");
    md.push("");
    md.push(`**${summary.total} state cells**, **${summary.shots} frames** to capture.`);
    md.push("");
    md.push("| Surface | Cells |");
    md.push("| --- | ---: |");
    for (const [k, v] of Object.entries(summary.bySurface)) md.push(`| ${k} | ${v} |`);
    md.push("");
    md.push("| Reachability | Cells |");
    md.push("| --- | ---: |");
    for (const [k, v] of Object.entries(summary.byReachability)) md.push(`| ${k} | ${v} |`);
    md.push("");
    md.push("| job_status | Cells |");
    md.push("| --- | ---: |");
    for (const [k, v] of Object.entries(summary.byStatus)) md.push(`| \`${k}\` | ${v} |`);
    md.push("");
    md.push("## Collapsing rules applied");
    md.push("");
    for (const r of COLLAPSING_RULES) md.push(`- **${r.id}** — ${r.rule}`);
    md.push("");
    md.push("## Cells");
    md.push("");
    md.push("| id | surface | status / derived | reachable | frames | what state this is |");
    md.push("| --- | --- | --- | --- | ---: | --- |");
    for (const c of CELLS) {
      md.push(
        `| \`${c.id}\` | ${c.surface} | ${c.status ?? c.derived ?? "—"} | ${c.reachable} | ${c.shots.length} | ${c.describe.replace(/\|/g, "\\|")} |`,
      );
    }
    writeFileSync(resolve(OUT, "state-matrix.md"), md.join("\n") + "\n");

    // A duplicate id would silently overwrite another cell's screenshot.
    const ids = CELLS.map((c) => c.id);
    expect(new Set(ids).size, "cell ids must be unique").toBe(ids.length);
    // Every non-auto cell must carry a reason. An unexplained gap is the exact
    // failure mode this whole exercise exists to correct.
    for (const c of CELLS) {
      if (c.reachable !== "auto") {
        expect(c.reason, `${c.id} must explain why it is ${c.reachable}`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const sweepDescribe = sweepOn ? test.describe : test.describe.skip;

sweepDescribe("state sweep", () => {
  test.describe.configure({ mode: "parallel" });

  for (const cell of CELLS.filter((c) => c.shots.length > 0)) {
    test(`${cell.surface} :: ${cell.id}`, async ({ context, page }) => {
      // A Vite DEV server compiles routes on demand, so the FIRST hit of a route
      // can take tens of seconds while later hits are fast. 30s per shot was
      // enough against a production preview and not enough against dev: tests
      // hit the 90s ceiling, Playwright tore the page down mid-drive, and the
      // records blamed the app. 90s per shot covers the cold path; a run against
      // `PLAYWRIGHT_WEB_SERVER=1` (production bundle) never approaches it.
      test.setTimeout(45_000 + cell.shots.length * 90_000);
      for (const shot of cell.shots) {
        await driveCell(context, page, cell, shot);
      }
    });
  }

  /**
   * Build the index from the FILES ON DISK, not from the in-memory `records`
   * array.
   *
   * Playwright runs each worker in its own process, so every worker has its own
   * module instance and its own (partial) `records`. The first version of this
   * wrote whichever worker finished last, and the index reported 60 frames out
   * of 334 with `framesDriven: 0` while 330 correct per-frame records sat
   * beside it. An index that undercounts its own evidence is precisely the kind
   * of quiet wrongness this tooling exists to stop, so it is derived from the
   * artifacts rather than from process-local state.
   */
  test.afterAll(() => {
    const files = readdirSync(OUT).filter(
      (f) => f.endsWith(".json") && !["index.json", "state-matrix.json"].includes(f),
    );
    const all: ReviewRecord[] = [];
    for (const f of files) {
      try {
        all.push(JSON.parse(readFileSync(resolve(OUT, f), "utf8")) as ReviewRecord);
      } catch {
        /* a half-written file from a killed worker — skip it, do not guess */
      }
    }
    const gaps = CELLS.filter((c) => c.shots.length === 0).map((c) => ({
      cellId: c.id,
      reason: `${c.reachable}: ${c.reason ?? "no reason recorded"}`,
    }));
    const undriven = all.filter((r) => r.unverified).map((r) => ({ cellId: r.cellId, reason: r.unverified! }));
    writeFileSync(
      resolve(OUT, "index.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          out: OUT,
          totals: {
            cells: CELLS.length,
            framesExpected: CELLS.reduce((n, c) => n + c.shots.length, 0),
            framesCaptured: all.length,
            framesDriven: all.filter((r) => r.driven).length,
            framesUnverified: undriven.length,
            declaredGaps: gaps.length,
          },
          records: all,
          unverified: [...undriven, ...gaps],
        },
        null,
        2,
      ),
    );
  });
});
