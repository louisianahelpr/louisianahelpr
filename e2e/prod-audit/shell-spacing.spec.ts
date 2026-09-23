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
import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
import { readShellSpacing, spacingScreens, type SpacingRow, type SpacingScreen } from "./shellSpacing";

const OUT = process.env.LH_SHELL_SPACING_OUT;
const SHOTS = process.env.LH_SHELL_SPACING_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SHOT_NAMES = new Set(["browse-guest", "dashboard", "my-jobs", "messages", "profile-landing", "legal-terms", "help", "login"]);

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
 * Page-owned offsets BELOW the title, exact (measured 2026-09-23, after the
 * fix). Each is the page's own first element, not a shell value; Q190 asks the
 * owner whether to fold them in. Asserted exactly so a page that changes is
 * noticed and this list shrinks with it.
 */
const TITLE_TO_CONTENT_EXCEPTIONS: Record<string, { px: number; why: string }> = {
  "legal-terms": { px: GAP + 8, why: "Legal's sticky tab band carries py-2 so pinned text has somewhere to disappear" },
  "legal-privacy": { px: GAP + 8, why: "same Legal page, other tab" },
  "legal-community": { px: GAP + 8, why: "same Legal page, other tab" },
  privacy: { px: GAP + 8, why: "renders Legal" },
  terms: { px: GAP + 8, why: "renders Legal" },
  rules: { px: GAP + 8, why: "renders Legal" },
  "profile-legal": { px: GAP + 4, why: "the Profile Legal tab's own tab band" },
  wrapped: { px: GAP + 8, why: "Wrapped's first card sits in its own padded hero" },
};

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
