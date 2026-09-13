/**
 * Shared plumbing for the PROD audit suites (e2e/prod-audit/*): messy input
 * and deep-link / interruption journeys, driven against the deployed app as
 * the two shared test accounts (owner, 2026-09-12: "no mock mode ever").
 *
 * Sessions and contexts come from e2e/journeys/fixtures.ts (password grant in
 * CI, service-role magic link locally). Every write these suites cause lands
 * on rows the test accounts own and carries MARKER in its text, so
 * `cleanupMarked` can remove exactly what a run created.
 */
import type { APIRequestContext, Page, Request, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { detectStuckOrBlank, findErrorScreen } from "../errorScreens";
import { measureLayout } from "../happy-path/auditRoutes";
import { ANON, SUPABASE_URL, getSession, newUserContext, rest, type Role, type Session } from "../journeys/fixtures";

export { getSession, newUserContext, rest, SUPABASE_URL, ANON };
export type { Role, Session };

/** Every row a spec writes carries this in its text, so cleanup finds it. */
export const MARKER = "[E2E-PRODAUDIT]";

export const POSTER_ID = "71c56dfb-b326-4010-b960-b18dd3966e7f";
export const HELPER_ID = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

/** REST call as a test account. RLS decides what that account may touch; nothing here escalates. */
export async function restAs(api: APIRequestContext, s: Session, method: "get" | "post" | "patch" | "delete", pathAndQuery: string, data?: unknown) {
  return api[method](`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: rest(s, method === "get" ? {} : { Prefer: "return=representation" }),
    ...(data === undefined ? {} : { data }),
  });
}

export async function selectAs<T>(api: APIRequestContext, s: Session, pathAndQuery: string): Promise<T> {
  const r = await restAs(api, s, "get", pathAndQuery);
  expect(r.ok(), `select ${pathAndQuery}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}

/** Delete this run's rows: messages and applications carrying MARKER, as the account that owns them. */
export async function cleanupMarked(api: APIRequestContext, s: Session): Promise<string[]> {
  const removed: string[] = [];
  const enc = encodeURIComponent(`*${MARKER}*`);
  for (const [table, col] of [["messages", "content"], ["applications", "message"]] as const) {
    const r = await restAs(api, s, "delete", `${table}?${col}=like.${enc}&select=id`);
    if (r.ok()) {
      const rows = (await r.json()) as { id: string }[];
      removed.push(...rows.map((x) => `${table}/${x.id}`));
    }
  }
  return removed;
}

/**
 * The post-action assertion set: no error screen, not stuck/blank, typed
 * markup never executed, and (when asked) zero horizontal overflow.
 */
export async function health(page: Page, ctx: string, opts: { layout?: boolean; allow?: string[]; settleMs?: number } = {}): Promise<string[]> {
  const problems: string[] = [];
  // A loader is only "stuck" once a real user's patience has run out.
  const deadline = Date.now() + (opts.settleMs ?? 8_000);
  let stuck: string | null = null;
  for (;;) {
    stuck = await page.evaluate(detectStuckOrBlank).catch(() => "page not evaluable");
    if (!stuck || Date.now() > deadline) break;
    await page.waitForTimeout(300);
  }
  if (stuck) problems.push(`${ctx}: ${stuck}`);
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  const err = findErrorScreen(text, opts.allow ?? []);
  if (err) problems.push(`${ctx}: error screen "${err.name}" — ${err.excerpt}`);
  const xss = await page
    .evaluate(() => ({ ran: (window as unknown as { __lhXss?: number }).__lhXss ?? 0, img: document.querySelectorAll('img[src="x"]').length }))
    .catch(() => ({ ran: 0, img: 0 }));
  if (xss.ran || xss.img) problems.push(`${ctx}: typed markup EXECUTED/INJECTED (ran=${xss.ran}, img=${xss.img})`);
  if (opts.layout) {
    const l = await measureLayout(page).catch(() => null);
    if (l && (l.overflowPx > 0 || l.overflowOffenders.length)) {
      problems.push(`${ctx}: horizontal overflow ${l.overflowPx}px — ${l.overflowOffenders.slice(0, 3).join(" | ")}`);
    }
  }
  return problems;
}

/** Screenshot to disk under the test's output dir AND attach it, so a human can open and LOOK. */
export async function shoot(page: Page, info: TestInfo, name: string): Promise<string> {
  const safe = name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
  const path = info.outputPath(`${safe}.png`);
  await page.screenshot({ path, fullPage: false }).catch(() => {});
  await info.attach(`${safe}.png`, { path, contentType: "image/png" }).catch(() => {});
  return path;
}

/** Health check that fails the step, with a screenshot named after it. */
export async function assertHealthy(page: Page, info: TestInfo, step: string, opts: { layout?: boolean; allow?: string[]; settleMs?: number } = {}): Promise<void> {
  const problems = await health(page, step, { layout: true, ...opts });
  await shoot(page, info, problems.length ? `FAIL-${step}` : step);
  expect(problems, `[${step}] at ${page.url()}\n${problems.join("\n")}`).toEqual([]);
}

/** Collect non-GET requests to URLs matching `re` from now on. */
export function watchWrites(page: Page, re: RegExp): Request[] {
  const hits: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "OPTIONS" && re.test(r.url())) hits.push(r);
  });
  return hits;
}

/** Wait for the SPA to settle after a navigation: boot loader gone, network quiet. */
export async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForFunction(() => !document.getElementById("boot-loader"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Dismiss the onboarding tour / birthday / any stray modal that is not the one under test. */
export async function dismissChrome(page: Page): Promise<void> {
  const b = page.getByRole("button", { name: /skip tour|^skip$|not now|maybe later|got it/i }).filter({ visible: true }).first();
  if (await b.isVisible().catch(() => false)) await b.click({ timeout: 2_000 }).catch(() => {});
}

/** Real seeded records the specs open dialogs from. Resolved live, never hard-coded, so a reseed cannot strand a spec. */
export interface Fixtures {
  /** An open, escrowed job posted by poster-e2e that helper-e2e has NOT applied to (apply target). */
  openJob: { id: string; title: string } | null;
  /** A job in progress between the two accounts (complete / dispute / cancel dialogs). */
  inProgressJob: { id: string; title: string } | null;
  /** A job the poster has open with a pending application from helper-e2e (applicants panel). */
  jobWithPendingApplicant: { id: string; title: string } | null;
  /** A disputed job between the two (dispute timeline). */
  disputedJob: { id: string; title: string } | null;
  /** A completed job between the two (review form). */
  completedJob: { id: string; title: string } | null;
  /** A job with an existing message thread between the two accounts (thread deep link). */
  threadJob: { id: string; title: string } | null;
  /** A job id that does not exist. */
  goneJobId: string;
}

export async function resolveFixtures(api: APIRequestContext, poster: Session, helper: Session): Promise<Fixtures> {
  type J = { id: string; title: string; status: string; payment_status: string; helper_id: string | null };
  const jobs = await selectAs<J[]>(api, poster, `jobs?customer_id=eq.${poster.user.id}&select=id,title,status,payment_status,helper_id&order=created_at.desc&limit=200`);
  const apps = await selectAs<{ job_id: string; status: string }[]>(api, helper, `applications?helper_id=eq.${helper.user.id}&select=job_id,status`);
  const appliedIds = new Set(apps.map((a) => a.job_id));
  const msgs = await selectAs<{ job_id: string; sender_id: string; receiver_id: string }[]>(
    api, helper, `messages?select=job_id,sender_id,receiver_id&or=(sender_id.eq.${helper.user.id},receiver_id.eq.${helper.user.id})&order=created_at.desc&limit=100`,
  );
  const threadJobIds = new Set(msgs.filter((m) => m.sender_id === poster.user.id || m.receiver_id === poster.user.id).map((m) => m.job_id));
  const pick = (f: (j: J) => boolean) => {
    const j = jobs.find(f);
    return j ? { id: j.id, title: j.title } : null;
  };
  return {
    openJob: pick((j) => j.status === "open" && j.payment_status === "escrow" && !appliedIds.has(j.id)),
    inProgressJob: pick((j) => j.status === "in_progress" && j.helper_id === helper.user.id),
    jobWithPendingApplicant: pick((j) => j.status === "open" && apps.some((a) => a.job_id === j.id && a.status === "pending")),
    disputedJob: pick((j) => j.status === "disputed" && j.helper_id === helper.user.id),
    completedJob: pick((j) => j.status === "completed" && j.helper_id === helper.user.id),
    threadJob: pick((j) => threadJobIds.has(j.id)),
    goneJobId: "00000000-0000-4000-8000-00000000dead",
  };
}
