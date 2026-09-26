/**
 * DESKTOP RIGHT RAIL — nothing under it, one shared inset, every signed-in
 * route, every desktop width (Q151, owner 2026-09-23: "you audit it and
 * check"; carried from Q10's "right-panel overlap").
 *
 * ─── THE CLAIM ─────────────────────────────────────────────────────────────
 * Signed in as poster-e2e, right panel OPEN, at 1024, 1280, 1440 and 1920, for
 * every signed-in route in the audit catalog (spacingScreens(), which
 * auditCatalogRoutes.test.ts proves is every route in src/App.tsx):
 *   1. the rail is actually there (<html> carries desktop-rail side-panel-open
 *      and nav[aria-label="Primary"] sits flush on the right edge, 248 wide),
 *      so a route that lost its rail cannot pass by having nothing to overlap;
 *   2. the ONE shared inset is exactly --desktop-sidebar-w: `.app-shell-frame`
 *      ends 248px from the right on fixed-shell pages, `#root` carries
 *      padding-right 248 on document-scroll pages (CLAUDE.md "desktop rail");
 *   3. nothing visible outside the rail extends past innerWidth - 248;
 *   4. zero horizontal overflow;
 *   5. the h1's column is centred in the post-rail area (left and right gaps
 *      within 2px), measured on the column, not on <main>.
 * Routes the rail does not serve (isDesktopRailRoute false) are printed as
 * "no rail on"; at least two thirds of the route x width cells must carry it.
 *
 * Red on the original class: the @mutate below drops the shared frame inset;
 * every fixed-shell route then fails claim 2 and 3.
 *
 * Read-only against prod. LH_RAIL_SHOTS=<dir> saves every failing route's
 * frame plus the 1440 sample of three routes as PNGs; shots are not evidence
 * until someone LOOKED (`npm run review:record`). Every measured cell prints a
 * `RAIL` line, so the run log is the measurement.
 */
import { test, expect, type Page } from "../prodTest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
import { spacingScreens } from "./shellSpacing";

// @mutate src/index.css | right: var(--desktop-sidebar-w); | right: 0;
// @mutate src/index.css | padding-right: var(--desktop-sidebar-w); | padding-right: 0;

const RAIL = 248;
const WIDTHS = [1024, 1280, 1440, 1920] as const;
const TOL = 2;
const SCREENS = spacingScreens().filter((s) => s.auth === "poster");
const SHOTS = process.env.LH_RAIL_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SAMPLES = new Set(["dashboard", "profile-gift-card", "messages"]);

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

interface RailRow {
  path: string;
  railOn: boolean;
  railRect: { left: number; right: number; width: number } | null;
  frameRight: number | null;
  rootPadRight: number;
  overflow: number;
  under: string[];
  col: { left: number; right: number; area: number; what: string } | null;
}

function readRail(rail: number): RailRow {
  const vw = document.documentElement.clientWidth;
  const html = document.documentElement.className;
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
  const railVisible = !!nav && getComputedStyle(nav).visibility !== "hidden";
  const nr = nav?.getBoundingClientRect();
  const frame = document.querySelector<HTMLElement>(".app-shell-frame");
  const limit = vw - rail;
  const under: string[] = [];
  const seen: Element[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (nav && (nav === el || nav.contains(el))) continue;
    if (seen.some((s) => s.contains(el))) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight) continue;
    if (r.right <= limit + 0.5) continue;
    // A layout box that paints nothing (no background, border, shadow, text,
    // or replaced content) is not "under" the rail in any way a user sees.
    const paints =
      (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
      cs.backgroundImage !== "none" ||
      parseFloat(cs.borderRightWidth) > 0 ||
      cs.boxShadow !== "none" ||
      /^(IMG|SVG|INPUT|BUTTON|TEXTAREA|SELECT|VIDEO|CANVAS|IFRAME|A)$/i.test(el.tagName) ||
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (!paints) continue;
    seen.push(el);
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
    under.push(`${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""} right=${Math.round(r.right)} pos=${cs.position}`);
  }
  let col: RailRow["col"] = null;
  const h1 = Array.from(document.querySelectorAll("h1")).find((h) => (h.textContent || "").trim() && h.getBoundingClientRect().width > 0);
  const areaW = document.documentElement.classList.contains("desktop-rail") ? vw - rail : vw;
  if (h1) {
    let c: HTMLElement | null = h1;
    // The column is the widest ancestor of the title that is still narrower
    // than the area it sits in; if none is, the column fills the area.
    let best: HTMLElement | null = null;
    while (c && c !== document.body) {
      const w = c.getBoundingClientRect().width;
      if (w < areaW - 2 * TOL) best = c;
      else break;
      c = c.parentElement;
    }
    const r = (best ?? h1).getBoundingClientRect();
    col = best
      ? { left: Math.round(r.left), right: Math.round(areaW - r.right), area: areaW, what: best.tagName.toLowerCase() + "." + String(best.className).split(/\s+/).slice(0, 3).join(".") }
      : { left: 0, right: 0, area: areaW, what: "fills the area" };
  }
  return {
    path: location.pathname + location.search,
    railOn: /\bdesktop-rail\b/.test(html) && /\bside-panel-open\b/.test(html) && railVisible,
    railRect: nr ? { left: Math.round(nr.left), right: Math.round(nr.right), width: Math.round(nr.width) } : null,
    frameRight: frame ? Math.round(vw - frame.getBoundingClientRect().right) : null,
    rootPadRight: parseFloat(getComputedStyle(document.getElementById("root")!).paddingRight) || 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    under,
    col,
  };
}

async function settle(page: Page) {
  await page
    .waitForFunction(() => [...document.querySelectorAll("h1")].some((h) => (h.textContent || "").trim()), undefined, { timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test("the signed-in route inventory is the app's own, and is not empty", () => {
  expect(SCREENS.length, "spacingScreens() poster half came back short").toBeGreaterThan(25);
  expect(SCREENS.map((s) => s.name)).toContain("profile-gift-card");
});

test("rail inset: nothing under the open right rail on any signed-in route at 1024/1280/1440/1920", async ({ browser }, info) => {
  test.setTimeout(60 * 60_000);
  const wrong: string[] = [];
  const noRail: string[] = [];
  let measured = 0;
  for (const vw of WIDTHS) {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: vw, height: 900 }, serviceWorkers: "block" });
    await ctx.addInitScript(
      ({ key, val }) => {
        try {
          localStorage.setItem(key, val);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
          localStorage.setItem("helpr.sidePanelOpen", "1");
        } catch {
          /* storage blocked: the route lands signed out and fails claim 1 */
        }
      },
      { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
    );
    const page = await ctx.newPage();
    for (const s of SCREENS) {
      await page.goto(s.url, { waitUntil: "domcontentloaded" });
      await settle(page);
      const r = await page.evaluate(readRail, RAIL);
      const at = `${s.name}@${vw} (${r.path})`;
      if (!r.railOn) {
        noRail.push(at);
        continue;
      }
      measured++;
      const bad: string[] = [];
      if (!r.railRect || Math.abs(r.railRect.right - vw) > TOL || Math.abs(r.railRect.width - RAIL) > TOL) bad.push(`rail not flush right/${RAIL} wide: ${JSON.stringify(r.railRect)}`);
      if (r.frameRight !== null && Math.abs(r.frameRight - RAIL) > 0.5) bad.push(`.app-shell-frame ends ${r.frameRight}px from the right, want ${RAIL}`);
      if (r.frameRight === null && Math.abs(r.rootPadRight - RAIL) > 0.5) bad.push(`#root padding-right ${r.rootPadRight}, want ${RAIL}`);
      if (r.overflow > 0) bad.push(`scrolls sideways by ${r.overflow}px`);
      if (r.under.length) bad.push(`under the rail: ${r.under.slice(0, 4).join(" | ")}`);
      if (r.col && Math.abs(r.col.left - r.col.right) > TOL) bad.push(`column off-centre: left ${r.col.left} vs right ${r.col.right} in ${r.col.area} (${r.col.what})`);
      console.log(`RAIL ${at} frameRight=${r.frameRight} rootPad=${r.rootPadRight} overflow=${r.overflow} under=${r.under.length} col=${r.col ? `${r.col.left}/${r.col.right}` : "none"}`);
      if (bad.length) {
        wrong.push(`${at}: ${bad.join("; ")}`);
        await shot(page, `${s.name}-${vw}`);
      } else if (vw === 1440 && SAMPLES.has(s.name)) {
        await shot(page, `${s.name}-${vw}`);
      }
    }
    await ctx.close();
  }
  console.log(`RAIL no rail on: ${noRail.join(", ") || "(none)"}`);
  expect(measured, "the rail was open on too few routes to mean anything").toBeGreaterThan(Math.floor((SCREENS.length * WIDTHS.length * 2) / 3));
  expect(wrong, wrong.join("\n")).toEqual([]);
});
