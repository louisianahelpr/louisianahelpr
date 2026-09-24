/**
 * PHONE-WIDTH SHELL SPACING — every route, one rhythm (Q176).
 *
 * ─── THE REPORT ────────────────────────────────────────────────────────────
 * Owner, 2026-09-23, with a 375px screenshot of the public /browse page: "Do
 * you think it's too much space above and below for phone width? If so fix
 * these page shells for public and authed so they are all consistent on phone
 * width." Measured on the built app against prod, before the fix
 * (~/.lh-shots/shell-spacing/before.json), header→title / title→content:
 *
 *     public PageHeader pages (/browse, /help, /legal…)   28 / 16
 *     signed-in PageHeader pages (Profile tabs, /post-job) 16 / 16
 *     AuthShell (/login, /signup…)                         24 / 16
 *     PageScaffold (Dashboard, My Jobs, Messages)          12 / 12
 *
 * Four shells, four rhythms. After: every one is `--shell-gap` (12) / 12.
 *
 * ─── THE CLAIM ─────────────────────────────────────────────────────────────
 * For every route in the audit catalog (which auditCatalogRoutes.test.ts
 * proves is every route in src/App.tsx), at 320, 375, 390 and 430:
 *   headerToTitle and titleToContent equal `--shell-gap` (read from
 *   src/index.css, so the token and the guard cannot disagree) within ±TOL,
 *   unless the route is a listed exception whose EXACT measured value is
 *   asserted (so a page that fixes itself fails here until the list shrinks).
 * At 1440: every title-row page sits 24px under its chrome (the desktop value
 * every shell shares), and at every width nothing overflows sideways.
 *
 * Read-only against prod: navigates and measures as a guest and as poster-e2e.
 * The vacuity leg shifts one title row in its own DOM and asserts the number
 * moves.
 *
 * Red on the original: serve the pre-fix build and run
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:<port> npx playwright test --project=prod-audit shell-spacing
 * (proven 2026-09-23 against the build of origin/main 3f0c504ef).
 *
 * LH_SHELL_SPACING_OUT writes the full table (JSON); LH_SHELL_SPACING_SHOTS
 * saves 375 + 1440 shots of a representative set. Shots are not evidence until
 * someone LOOKED: `npm run review:record -- <png> <screen> <checked> <ok|defect>`.
 */
import { test, expect, type Browser, type Page } from "../prodTest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
import { readSectionSpacing, readShellSpacing, spacingScreens, type SpacingRow, type SpacingScreen } from "./shellSpacing";

const OUT = process.env.LH_SHELL_SPACING_OUT;
const SHOTS = process.env.LH_SHELL_SPACING_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SHOT_NAMES = new Set(["browse-guest", "dashboard", "jobs", "messages", "profile-landing", "legal-terms", "help", "login"]);

const PHONES = [375, 320, 390, 430] as const;
const TOL = 2;
const DESKTOP_GAP = 24;
const SCREENS = spacingScreens();

/** The token, read from the stylesheet the shells use. */
function shellGapPx(): number {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const m = /--shell-gap:\s*([\d.]+)rem;/.exec(css);
  if (!m) throw new Error("--shell-gap not found in src/index.css");
  return Math.round(parseFloat(m[1]) * 16);
}
const GAP = shellGapPx();

/**
 * Screens with no header→title rhythm to hold: a centred composition, not a
 * title row under chrome. The landing hero is LOCKED (CLAUDE.md).
 */
const NOT_A_TITLE_ROW = new Set(["landing", "not-found", "payment-success"]);

/**
 * Page-owned offsets BELOW the title, exact. EMPTY since Q190 (2026-09-23):
 * the three pages that sat further down — /legal (and /terms, /privacy, /rules)
 * 20px, Profile Legal 16px, Wrapped 20px, each because of its own first
 * element — were folded into the 12px rhythm (owner: tighter everywhere). A
 * page that needs an exception again lists its EXACT value here, with why.
 */
// @mutate src/pages/info/Legal.tsx | className="sticky z-30 -mx-5 px-5 py-2 -my-2" | className="sticky z-30 -mx-5 px-5 py-2"
// @mutate src/pages/profile/HelprWrapped.tsx | <div className="pb-2 flex flex-col items-center"> | <div className="py-2 flex flex-col items-center">
const TITLE_TO_CONTENT_EXCEPTIONS: Record<string, { px: number; why: string }> = {};

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

async function ctxFor(browser: Browser, auth: SpacingScreen["auth"], vw: number, baseURL?: string) {
  const desktop = vw >= 900;
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: vw, height: desktop ? 900 : 812 },
    hasTouch: !desktop,
    serviceWorkers: "block",
    ...(desktop ? {} : { userAgent: test.info().project.use.userAgent }),
  });
  if (auth === "poster") {
    await ctx.addInitScript(
      ({ key, val }) => {
        try {
          localStorage.setItem(key, val);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch {
          /* signed out: the route lands on /login and is measured as that */
        }
      },
      { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
    );
  }
  return ctx;
}

async function settle(page: Page) {
  // A real title (or PageScaffold's card), not skeleton bones.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("h1")].some((h) => (h.textContent || "").trim()) ||
        !!document.querySelector(".app-shell-frame .liquid-glass.shrink-0"),
      undefined,
      { timeout: 45_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1200);
}

async function scrollHome(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>("body *").forEach((e) => {
      if (e.scrollTop) e.scrollTop = 0;
    });
  });
}

test("the route inventory is the app's own, and is not empty", () => {
  expect(SCREENS.length, "spacingScreens() came back short — the catalog import has rotted").toBeGreaterThan(40);
  expect(GAP, "--shell-gap is the 12px phone rhythm").toBe(12);
  for (const n of [...NOT_A_TITLE_ROW, ...Object.keys(TITLE_TO_CONTENT_EXCEPTIONS)]) {
    expect(SCREENS.map((s) => s.name), `exception "${n}" names no catalog screen — stale`).toContain(n);
  }
});

// Shown able to fail on the owner's report itself — the public nav spacer's
// extra 12px (red on every public page), and AuthShell's old 24px top:
// @mutate src/components/marketing/PublicLayout.tsx | style={{ height: "calc(max(var(--safe-area-top, 0px), 0.25rem) + var(--public-nav-h))" }} | style={{ height: "calc(max(var(--safe-area-top, 0px), 1.5rem) + 3rem)" }}
// @mutate src/components/auth/AuthShell.tsx | "pt-[calc(var(--safe-area-top,0px)_+_var(--shell-gap))] sm:pt-8 lg:pt-6" | "pt-[calc(var(--safe-area-top,0px)_+_24px)] sm:pt-8 lg:pt-6"
test("every route holds the one phone rhythm, and 1440 holds 24", async ({ browser }, info) => {
  test.setTimeout(40 * 60_000);
  const table: Record<string, Record<string, SpacingRow & { url: string; auth: string }>> = {};
  const wrong: string[] = [];
  let lastPhone: Page | null = null;

  for (const auth of ["guest", "poster"] as const) {
    const phoneCtx = await ctxFor(browser, auth, 375, info.project.use.baseURL);
    const deskCtx = await ctxFor(browser, auth, 1440, info.project.use.baseURL);
    const phone = await phoneCtx.newPage();
    const desk = await deskCtx.newPage();
    for (const s of SCREENS.filter((x) => x.auth === auth)) {
      table[s.name] = {};
      await phone.setViewportSize({ width: 375, height: 812 });
      await phone.goto(s.url, { waitUntil: "domcontentloaded" });
      await settle(phone);
      for (const vw of PHONES) {
        await phone.setViewportSize({ width: vw, height: 812 });
        await phone.waitForTimeout(250);
        if (SHOTS && vw === 375 && SHOT_NAMES.has(s.name)) await phone.screenshot({ path: join(SHOTS, `${s.name}-375.png`) });
        const row = await phone.evaluate(readShellSpacing);
        await scrollHome(phone);
        table[s.name][String(vw)] = { ...row, url: s.url, auth };
        const at = `${s.name}@${vw} (${row.landedOn})`;
        if (row.overflow > 0) wrong.push(`${at}: scrolls sideways by ${row.overflow}px`);
        if (row.pastRightEdge.length) wrong.push(`${at}: past the right edge ${row.pastRightEdge.join(", ")}`);
        if (NOT_A_TITLE_ROW.has(s.name)) continue;
        if (row.headerToTitle === null || row.titleToContent === null) {
          wrong.push(`${at}: no title block / no content under it (title=${row.title}) — nothing measured`);
          continue;
        }
        if (Math.abs(row.headerToTitle - GAP) > TOL) {
          wrong.push(`${at}: header→title ${row.headerToTitle}px, the shells' --shell-gap is ${GAP}`);
        }
        const exc = TITLE_TO_CONTENT_EXCEPTIONS[s.name];
        const want = exc?.px ?? GAP;
        if (Math.abs(row.titleToContent - want) > (exc ? 1 : TOL)) {
          wrong.push(
            `${at}: title→content ${row.titleToContent}px, want ${want}` +
              (exc ? ` (listed exception: ${exc.why} — if the page changed, update the list)` : ` (--shell-gap); first content ${row.firstContent}`),
          );
        }
      }
      await desk.goto(s.url, { waitUntil: "domcontentloaded" });
      await settle(desk);
      if (SHOTS && SHOT_NAMES.has(s.name)) await desk.screenshot({ path: join(SHOTS, `${s.name}-1440.png`) });
      const d = await desk.evaluate(readShellSpacing);
      table[s.name]["1440"] = { ...d, url: s.url, auth };
      const at = `${s.name}@1440 (${d.landedOn})`;
      if (d.overflow > 0) wrong.push(`${at}: scrolls sideways by ${d.overflow}px`);
      if (d.pastRightEdge.length) wrong.push(`${at}: past the right edge ${d.pastRightEdge.join(", ")}`);
      // Desktop PageScaffold pages have no title card (merged into the app bar), so only title rows are held.
      if (!NOT_A_TITLE_ROW.has(s.name) && d.titleKind === "row" && d.headerToTitle !== null && Math.abs(d.headerToTitle - DESKTOP_GAP) > TOL) {
        wrong.push(`${at}: header→title ${d.headerToTitle}px, every desktop shell holds ${DESKTOP_GAP}`);
      }
      const r = table[s.name];
      console.log(
        `[shell-spacing] ${s.name.padEnd(26)} 375 ${r["375"].headerToTitle}/${r["375"].titleToContent}/${r["375"].bottomGap} (${r["375"].titleKind})  1440 ${d.headerToTitle}/${d.titleToContent}`,
      );
    }
    lastPhone = phone;
    if (auth === "guest") await phoneCtx.close();
    await deskCtx.close();
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(table, null, 2));
  info.annotations.push({ type: "shell-spacing", description: `${Object.keys(table).length} screens, gap ${GAP}px` });

  expect(
    wrong,
    `Phone-width shell spacing drifted from the one rhythm (--shell-gap = ${GAP}px above and below every ` +
      `page title; owner 2026-09-23: "fix these page shells for public and authed so they are all ` +
      `consistent on phone width"). Fix the SHARED shell (PageHeader, PageScaffold, AuthShell, ` +
      `PublicLayout's nav spacer) — never a per-page padding.`,
  ).toEqual([]);

  // ── VACUITY: a title row 8px too low must move the compared number ──────
  const page = lastPhone!;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/profile?tab=security", { waitUntil: "domcontentloaded" });
  await settle(page);
  const before = await page.evaluate(readShellSpacing);
  await scrollHome(page);
  await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const row = h1?.closest("div.flex.items-center");
    if (row) (row as HTMLElement).style.marginTop = "8px";
  });
  const after = await page.evaluate(readShellSpacing);
  expect(before.headerToTitle, "vacuity page measured no title").not.toBeNull();
  expect(after.headerToTitle! - before.headerToTitle!, "an 8px shift did not move header→title — the measure is blind").toBe(8);
  await page.context().close();
});

// ─── IN-PAGE SECTION RHYTHM (Q191) ─────────────────────────────────────────
// Owner, 2026-09-23: "update the spacing on every other phone width. Like all
// the profile tabs everything that you think needs to be tighter." Below the
// title, the gap between a page's sections is `--section-gap` (12px on a
// phone; src/index.css), read by ProfileTabBody and Tailwind's `section`
// spacing key. Measured before/after on the built app against prod
// (~/.lh-shots/q191/{before,after}.json): Profile tabs 16 → 12, After a Job /
// Home History / Legal 20 → 12, Gift Card / Help 24 → 12, My Posts 16 → 12.
//
// The claim, at 320/375/390/430 on every catalog screen: every gap between the
// sections of the page's own stack (readSectionSpacing) equals --section-gap
// ±1, unless the screen is listed below with its EXACT gaps (two-way: a listed
// screen that measures the default fails until its entry goes), and every
// screen either has a stack or is listed as having none (two-way again).
//
// Red on the original: the build of origin/main 80ef9f186 fails this test with
// 91 violations (every Profile tab at 16, Legal 20, Help / Gift Card 24, After
// a Job / Home History 20, My Posts 16) and the rhythm test above with 32 (the
// Q190 pages); both green on the fix, vacuity leg included (2026-09-23).

/** The token, read from the stylesheet. */
function sectionGapPx(): number {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const m = /--section-gap:\s*([\d.]+)rem;/.exec(css);
  if (!m) throw new Error("--section-gap not found in src/index.css");
  return Math.round(parseFloat(m[1]) * 16);
}
const SECTION_GAP = sectionGapPx();

/**
 * Stacks whose gaps are NOT section gaps, with their exact phone value.
 * `first: true` holds only the first gap (the rest is a flexible filler).
 */
const SECTION_EXCEPTIONS: Record<string, { px: number; first?: boolean; why: string }> = {
  "browse-guest": { px: 10, why: "the guest job feed is a LIST (GUEST_FEED_GRID_CLASS gap-2.5), not page sections; unifying the job-card list rhythm (8 dashboard, 10 here, 12 Activity) is Q213" },
  dashboard: { px: 8, why: "the virtualized job feed's own row pitch (BrowseTasksFeed pb-2) — a list, not sections" },
  "complete-profile": { px: 8, why: "a complete account lands on /home: same feed" },
  "job-detail-1": { px: 8, why: "the catalog's fake job id lands on /home: same feed" },
  "job-detail-missing": { px: 8, why: "a missing job lands on /home: same feed" },
  messages: { px: 20, why: "conversation rows are a divided list (row padding either side of a hairline), not cards" },
  "posts": { px: SECTION_GAP, first: true, why: "after the list, ListTail's mt-auto fills the panel's leftover height — a filler, not a gap" },
  "profile-support": { px: 24, why: "the Help Center row sits a deliberate DOUBLE rhythm (!mt-6) below the form so it does not read as part of it" },
};

/** Screens with no multi-section stack under the title (one card, a form, a centred composition). */
const NO_SECTION_STACK = new Set([
  "signup", "login", "forgot-password", "reset-password", "signup-pending", "account-banned", "support",
  "jobs", "user-profile", "user-profile-customer", "user-profile-missing",
  "profile-notifications", "profile-warnings", "analytics", "str-settings", "work-record", "wrapped",
]);

// Shown able to fail on the original (every Profile tab back on its 16px, a
// page back on its 24px) and on the token:
// @mutate src/components/profile/ProfileTabBody.tsx | export const PROFILE_TAB_BODY_CLASS = "space-y-section"; | export const PROFILE_TAB_BODY_CLASS = "space-y-4";
// @mutate src/pages/info/HelpCenter.tsx | <div className="mx-auto page-measure space-y-section"> | <div className="mx-auto page-measure space-y-6">
// @mutate src/index.css | --section-gap: 0.75rem; | --section-gap: 1rem;
test("every page's sections sit --section-gap apart at every phone width", async ({ browser }, info) => {
  test.setTimeout(40 * 60_000);
  expect(SECTION_GAP, "--section-gap is the 12px phone rhythm").toBe(12);
  const names = SCREENS.map((s) => s.name);
  for (const n of [...Object.keys(SECTION_EXCEPTIONS), ...NO_SECTION_STACK]) {
    expect(names, `section exception "${n}" names no catalog screen — stale`).toContain(n);
  }
  const wrong: string[] = [];
  let measured = 0;
  let lastPhone: Page | null = null;
  for (const auth of ["guest", "poster"] as const) {
    const ctx = await ctxFor(browser, auth, 375, info.project.use.baseURL);
    const phone = await ctx.newPage();
    for (const s of SCREENS.filter((x) => x.auth === auth)) {
      await phone.setViewportSize({ width: 375, height: 812 });
      await phone.goto(s.url, { waitUntil: "domcontentloaded" });
      await settle(phone);
      // A centred composition has no title row to hang sections under (and the
      // landing hero is LOCKED): the same NOT_A_TITLE_ROW the shell test skips.
      if (NOT_A_TITLE_ROW.has(s.name)) continue;
      for (const vw of PHONES) {
        await phone.setViewportSize({ width: vw, height: 812 });
        await phone.waitForTimeout(250);
        const row = await phone.evaluate(readSectionSpacing);
        await scrollHome(phone);
        const at = `${s.name}@${vw} (${row.landedOn})`;
        if (NO_SECTION_STACK.has(s.name)) {
          if (row.stack) wrong.push(`${at}: listed as having no section stack, but ${row.stack} stacks ${row.sections} sections ${JSON.stringify(row.sectionGaps)} — take it off NO_SECTION_STACK`);
          continue;
        }
        if (!row.stack || !row.sectionGaps.length) {
          wrong.push(`${at}: no section stack found (${row.why ?? "no gaps"}) — list it in NO_SECTION_STACK if it genuinely has one section`);
          continue;
        }
        measured++;
        const exc = SECTION_EXCEPTIONS[s.name];
        const want = exc?.px ?? SECTION_GAP;
        const held = exc?.first ? row.sectionGaps.slice(0, 1) : row.sectionGaps;
        const off = held.filter((g) => Math.abs(g - want) > 1);
        if (off.length) {
          wrong.push(
            `${at}: section gaps ${JSON.stringify(row.sectionGaps)} in ${row.stack}, want ${want}` +
              (exc ? ` (listed: ${exc.why} — if the page changed, update the list)` : ` (--section-gap)`),
          );
        }
        if (exc && !exc.first && exc.px !== SECTION_GAP && row.sectionGaps.every((g) => Math.abs(g - SECTION_GAP) <= 1)) {
          wrong.push(`${at}: listed exception now measures the shared ${SECTION_GAP} — remove it from SECTION_EXCEPTIONS`);
        }
      }
    }
    lastPhone = phone;
    if (auth === "guest") await ctx.close();
  }
  expect(measured, "no section stack was measured anywhere — the probe is blind").toBeGreaterThan(80);
  expect(
    wrong,
    `In-page section spacing drifted from the one scale (--section-gap = ${SECTION_GAP}px on a phone; owner ` +
      `2026-09-23: "update the spacing on every other phone width … make sure nothing is hand rolled"). ` +
      `Use \`space-y-section\` / \`gap-section\` / <ProfileTabBody>, never a per-page space-y-N.`,
  ).toEqual([]);

  // ── VACUITY: one section 8px lower must move the measured gap by 8 ──────
  const page = lastPhone!;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/profile?tab=security", { waitUntil: "domcontentloaded" });
  await settle(page);
  const before = await page.evaluate(readSectionSpacing);
  expect(before.sectionGaps.length, "vacuity page measured no section gaps").toBeGreaterThan(1);
  await page.evaluate(() => {
    const kids = Array.from(document.querySelectorAll("h1")[0]?.closest(".space-y-section")?.children ?? []);
    const third = kids[2] as HTMLElement | undefined; // [header, section 1, section 2, …]
    if (third) third.style.marginTop = "calc(var(--section-gap) + 8px)";
  });
  const after = await page.evaluate(readSectionSpacing);
  expect(after.sectionGaps[0] - before.sectionGaps[0], "an 8px shift did not move the section gap — the measure is blind").toBe(8);
  await page.context().close();
});
