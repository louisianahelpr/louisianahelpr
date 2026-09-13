/**
 * THE USABILITY SCORECARD (owner-approved gap, 2026-09-12): nothing tracked
 * whether the app gets EASIER or HARDER to use over time. A separate,
 * unscripted persona pass (docs/audit/first-time-users-2026-09-12.md) finds
 * NEW friction. This spec is the repeatable half: 8 core goals, walked the
 * same way every run, on mocked seeded data at 375, so a regression in step
 * count or required input shows up as a number that moved — not a vibe.
 *
 * For each goal we record:
 *   - clicks/taps
 *   - screens visited (distinct pathnames)
 *   - text inputs required
 *   - wall-clock time to complete the scripted path
 *   - a "guided" heuristic per step: was the next control visible without
 *     scrolling, with a clear accessible name (see usabilityJourney.ts)
 * plus the app-wide error-screen/stuck-page checks after every step
 * (findErrorScreen / detectStuckOrBlank from e2e/errorScreens.ts).
 *
 * Results land in docs/audit/usability-scorecard.json (with a `history`
 * array: date, commit sha, numbers) and docs/audit/usability-scorecard.md
 * (a readable table with trend arrows vs the last run). See
 * writeScorecard() below for the regression gate: a goal's step count or
 * input count may never INCREASE over the last recorded run unless that
 * run's entry carries an "accepted" note — a regression must be a decision.
 */
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
  mockRpc,
} from "./fixtures";
import { SEED_JOBS, CUSTOMER_ID, HELPER_ID } from "./seedData";
import { Journey, type GoalResult } from "./usabilityJourney";

const DOCS_DIR = join(process.cwd(), "docs", "audit");
const JSON_PATH = join(DOCS_DIR, "usability-scorecard.json");
const MD_PATH = join(DOCS_DIR, "usability-scorecard.md");
const SHOTS_DIR = "/tmp/ui-review/usability-scorecard";
mkdirSync(SHOTS_DIR, { recursive: true });

const VIEWPORT = { width: 375, height: 812 };

async function commonSetup(page: Page) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
      localStorage.setItem("helpr_welcomed", "1");
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
}

const STANDARD_RPCS = [
  mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
  mockRpc("get_safe_profiles", []),
  mockRpc("get_jobs_for_my_applications", []),
  mockRpc("get_user_credential_tier", [{ tier: "standard" }]),
  mockRpc("get_neighbor_hire_count", [{ count: 0 }]),
];

// Module-level accumulator — every `test()` below pushes one GoalResult, and
// the final `test.afterAll` in this describe.serial block writes both output
// files once all 8 goals have run. Serial mode guarantees ordering and that
// afterAll only fires after every goal test has finished (pass or fail).
const results: GoalResult[] = [];

test.describe.serial("usability scorecard — 8 core goals", () => {
  test("post a job", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: STANDARD_RPCS,
    });
    const j = new Journey(page, "post a job");
    await j.goto("/post-job");
    await expect(page.getByRole("heading", { name: /post a job/i })).toBeVisible({ timeout: 15_000 });

    const startFresh = page.getByRole("button", { name: /start fresh/i });
    await j.click(startFresh, "Start fresh");
    await expect(page.getByRole("heading", { name: /job details/i })).toBeVisible({ timeout: 10_000 });

    const titleInput = page.getByLabel(/title/i).or(page.getByPlaceholder(/title/i)).first();
    await j.type(titleInput, "Scorecard test job: yard cleanup", "Job title");

    const descInput = page.getByLabel(/description/i).or(page.getByPlaceholder(/description/i)).first();
    await j.type(descInput, "Scripted usability-scorecard job description, twenty-plus chars.", "Job description");

    await page.screenshot({ path: `${SHOTS_DIR}/post-a-job-hardest-step.png` }).catch(() => {});
    results.push(j.finish());
  });

  test("find and apply to a job", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    const openJob = SEED_JOBS.find((row) => row.status === "open") ?? SEED_JOBS[0];
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      seed: true,
      rules: STANDARD_RPCS,
    });
    const j = new Journey(page, "find and apply to a job");
    await j.goto("/dashboard");

    const card = page.getByText(String(openJob.title)).first();
    await card.waitFor({ timeout: 15_000 });
    await j.click(card, "Job card");

    const applyBtn = page.getByRole("button", { name: /^(apply|continue|book)\b/i }).first();
    await expect(applyBtn).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/find-and-apply-to-a-job-hardest-step.png` }).catch(() => {});
    await j.click(applyBtn, "Apply");

    results.push(j.finish());
  });

  test("hire an applicant", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    const postedJobId = "60000000-0000-4000-8000-000000000001";
    const applicantId = HELPER_ID;
    const postedJob = {
      ...SEED_JOBS[0],
      id: postedJobId,
      customer_id: CUSTOMER_ID,
      status: "open",
      title: "Scorecard job with an applicant",
    };
    const application = {
      id: "60000000-0000-4000-8000-000000000002",
      job_id: postedJobId,
      helper_id: applicantId,
      customer_id: CUSTOMER_ID,
      status: "pending",
      message: "I'd love to help with this.",
      created_at: new Date().toISOString(),
    };
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: [
        ...STANDARD_RPCS,
        { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/jobs", handle: () => ({ status: 200, body: [postedJob] }) },
        { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/applications", handle: () => ({ status: 200, body: [application] }) },
        mockRpc("get_safe_profiles", [{ user_id: applicantId, full_name: "Scorecard Applicant", avatar_url: null }]),
      ],
    });
    const j = new Journey(page, "hire an applicant");
    await j.goto("/my-posts?filter=waiting");
    await expect(page.getByText(postedJob.title, { exact: false })).toBeVisible({ timeout: 15_000 });

    const applicantsBtn = page.getByRole("button", { name: /applicant/i }).first();
    await j.click(applicantsBtn, "View applicants");

    const hireBtn = page.getByRole("button", { name: /^hire\b/i }).first();
    await expect(hireBtn).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/hire-an-applicant-hardest-step.png` }).catch(() => {});
    await j.click(hireBtn, "Hire");

    results.push(j.finish());
  });

  test("message someone", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: STANDARD_RPCS });
    const j = new Journey(page, "message someone");
    await j.goto("/messages");

    const row = page.locator("button").filter({ hasText: String(SEED_JOBS[1].title).slice(0, 40) }).first();
    await row.waitFor({ timeout: 15_000 });
    await j.click(row, "Open conversation");
    await expect(page.locator(".glass-dock")).toBeVisible({ timeout: 10_000 });

    const composer = page.getByPlaceholder(/message/i).or(page.getByRole("textbox")).first();
    await page.screenshot({ path: `${SHOTS_DIR}/message-someone-hardest-step.png` }).catch(() => {});
    await j.type(composer, "Scorecard scripted message.", "Message composer");

    results.push(j.finish());
  });

  test("check earnings", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER, rules: STANDARD_RPCS });
    const j = new Journey(page, "check earnings");
    await j.goto("/profile?tab=earnings");

    const tabs = page.getByRole("tab");
    await tabs.first().waitFor({ timeout: 20_000 });
    await j.note(page.getByRole("tab", { name: "Earnings" }));
    await expect(page.getByRole("tab", { name: "Earnings" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/total earned/i).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/check-earnings-hardest-step.png` }).catch(() => {});

    results.push(j.finish());
  });

  test("leave a review", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    const posterId = CUSTOMER_ID;
    const completedJob = {
      ...SEED_JOBS[0],
      id: "60000000-0000-4000-8000-000000000003",
      customer_id: posterId,
      helper_id: HELPER_ID,
      status: "completed",
      title: "Scorecard completed job",
      payment_status: "released",
    };
    const application = {
      id: "60000000-0000-4000-8000-000000000004",
      job_id: completedJob.id,
      helper_id: HELPER_ID,
      customer_id: posterId,
      status: "accepted",
    };
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      rules: [
        ...STANDARD_RPCS,
        { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/jobs", handle: () => ({ status: 200, body: [completedJob] }) },
        { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/applications", handle: () => ({ status: 200, body: [application] }) },
        { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/reviews", handle: () => ({ status: 200, body: [] }) },
        mockRpc("get_safe_profiles", [{ user_id: posterId, full_name: "Scorecard Poster", avatar_url: null }]),
      ],
    });
    const j = new Journey(page, "leave a review");
    await j.goto("/my-jobs?filter=completed");
    await expect(page.getByText(completedJob.title, { exact: false })).toBeVisible({ timeout: 15_000 });

    const reviewBtn = page.getByRole("button", { name: /review poster/i }).first();
    await page.screenshot({ path: `${SHOTS_DIR}/leave-a-review-hardest-step.png` }).catch(() => {});
    await j.click(reviewBtn, "Review Poster");

    results.push(j.finish());
  });

  test("change a notification setting", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: [
        ...STANDARD_RPCS,
        { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/notification_preferences", handle: () => ({ status: 200, body: [{ user_id: CUSTOMER_ID, job_matches: true, email_job_matches: true }] }) },
      ],
    });
    const j = new Journey(page, "change a notification setting");
    await j.goto("/profile?tab=notifications");

    const jobMatchesSwitch = page.getByRole("switch", { name: /job matches/i }).first();
    await expect(jobMatchesSwitch).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/change-a-notification-setting-hardest-step.png` }).catch(() => {});
    await j.click(jobMatchesSwitch, "Job Matches toggle");

    results.push(j.finish());
  });

  test("get help / contact support", async ({ page, context, baseURL }) => {
    await commonSetup(page);
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, rules: STANDARD_RPCS });
    const j = new Journey(page, "get help / contact support");
    await j.goto("/profile");

    const helpLink = page.getByRole("link", { name: /help|support/i }).first();
    await j.click(helpLink, "Help / Support");

    await expect(page).toHaveURL(/\/(help|support)/, { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS_DIR}/get-help-contact-support-hardest-step.png` }).catch(() => {});

    results.push(j.finish());
  });

  test.afterAll(async () => {
    writeScorecard(results);
  });
});

// --- scorecard persistence -------------------------------------------------

interface HistoryEntry {
  date: string;
  sha: string;
  goals: Record<string, { clicks: number; textInputs: number; screens: number; timeMs: number; guidedSteps: number; totalSteps: number; accepted?: string }>;
}

interface ScorecardFile {
  history: HistoryEntry[];
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return "unknown";
  }
}

function loadPrevious(): HistoryEntry | null {
  if (!existsSync(JSON_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(JSON_PATH, "utf8")) as ScorecardFile;
    return data.history?.at(-1) ?? null;
  } catch {
    return null;
  }
}

function arrow(current: number, previous: number | undefined): string {
  if (previous === undefined) return "—";
  if (current > previous) return `↑ (was ${previous})`;
  if (current < previous) return `↓ (was ${previous})`;
  return "→";
}

function writeScorecard(all: GoalResult[]) {
  mkdirSync(DOCS_DIR, { recursive: true });
  const previous = loadPrevious();
  const sha = gitSha();
  const date = new Date().toISOString().slice(0, 10);

  const entry: HistoryEntry = { date, sha, goals: {} };
  for (const r of all) {
    entry.goals[r.goal] = {
      clicks: r.clicks,
      textInputs: r.textInputs,
      screens: r.screens.length,
      timeMs: r.timeMs,
      guidedSteps: r.guidedSteps,
      totalSteps: r.totalSteps,
    };
  }

  let file: ScorecardFile = { history: [] };
  if (existsSync(JSON_PATH)) {
    try {
      file = JSON.parse(readFileSync(JSON_PATH, "utf8")) as ScorecardFile;
    } catch {
      file = { history: [] };
    }
  }
  file.history.push(entry);
  writeFileSync(JSON_PATH, JSON.stringify(file, null, 2) + "\n");

  const rows = all.map((r) => {
    const prevGoal = previous?.goals[r.goal];
    const stepsNow = r.clicks + r.textInputs;
    const stepsPrev = prevGoal ? prevGoal.clicks + prevGoal.textInputs : undefined;
    return `| ${r.goal} | ${r.clicks} ${arrow(r.clicks, prevGoal?.clicks)} | ${r.textInputs} ${arrow(r.textInputs, prevGoal?.textInputs)} | ${r.screens.length} ${arrow(r.screens.length, prevGoal?.screens)} | ${(r.timeMs / 1000).toFixed(1)}s | ${r.guidedSteps}/${r.totalSteps} | ${stepsPrev !== undefined ? arrow(stepsNow, stepsPrev) : "—"} |`;
  });

  const md = [
    "# Usability scorecard",
    "",
    `Latest run: ${date} @ \`${sha.slice(0, 9)}\``,
    "",
    "8 core goals, walked the same scripted way every run at 375px on mocked seeded data. Arrows compare against the immediately preceding recorded run.",
    "",
    "| Goal | Clicks/taps | Text inputs | Screens | Time | Guided steps | Trend |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "Guided steps = the next control was visible without scrolling and had a clear accessible name (heuristic).",
    "",
    "A regression (step count or required inputs increasing vs the last recorded run) fails the spec unless that run's JSON entry carries an `accepted` note explaining the deliberate tradeoff.",
  ].join("\n");
  writeFileSync(MD_PATH, md + "\n");

  // Regression gate: fail if any goal's total steps (clicks + textInputs)
  // increased vs the last recorded run, unless PREVIOUS entry marked it accepted.
  const regressions: string[] = [];
  if (previous) {
    for (const r of all) {
      const prevGoal = previous.goals[r.goal];
      if (!prevGoal) continue;
      if (prevGoal.accepted) continue;
      const stepsNow = r.clicks + r.textInputs;
      const stepsPrev = prevGoal.clicks + prevGoal.textInputs;
      if (stepsNow > stepsPrev) {
        regressions.push(`${r.goal}: steps ${stepsPrev} → ${stepsNow}`);
      }
      if (r.textInputs > prevGoal.textInputs) {
        regressions.push(`${r.goal}: text inputs ${prevGoal.textInputs} → ${r.textInputs}`);
      }
    }
  }

  const errorScreens = all.flatMap((r) => r.errorScreens);
  expect(errorScreens, "error/stuck screens hit during scripted goals").toEqual([]);
  expect(regressions, "usability regressions vs last recorded run (add an \"accepted\" note to close deliberately)").toEqual([]);
}
