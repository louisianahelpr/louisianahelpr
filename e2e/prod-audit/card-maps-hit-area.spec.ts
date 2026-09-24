/**
 * NO CARD MAY BE A MAP LINK — the class check for the owner's 2026-09-21
 * report: "any time i click in this job card, it opens apple maps. ths is not
 * correct."
 *
 * ── THE CLASS, not the instance ───────────────────────────────────────────
 * The instance was /jobs. The CLASS is: a job card's primary tap action is
 * "open this job", and a maps link — a control whose activation LEAVES THE APP
 * — may not own a meaningful share of that card's tap area on any surface. It
 * is a class and not a one-off because the address is drawn by one shared
 * component (`src/components/job-card/JobCardMetaRow.tsx`) whose location slot
 * can be either a link or a press-to-map button, decided per call site by the
 * `locationPressToMap` prop. Every future consumer of that row inherits the
 * defect by default, and two of them (`PostedJobCard`, `AppliedJobCard`)
 * disagreed for a week.
 *
 * ── WHAT IS MEASURED, AND WHY GEOMETRY AND NOT MARKUP ────────────────────
 * `document.elementFromPoint` on a grid over each card, asking each point:
 * would a tap here activate a maps link? That is the user's own question, and
 * it is the one a class-contract test in jsdom cannot answer — the shipped
 * defect was NOT "the address is a link" on its own but "the address is a link
 * that `basis-full` stretched across 89% of the card", and no amount of
 * reading classes finds the 89%. jsdom computes no layout;
 * `src/pages/jobs/AppliedJobCard.locationTapExpands.test.tsx` pins the
 * markup half, this file pins the geometry.
 *
 * ── MEASURED, before → after (prod Supabase, local build of this checkout,
 *    Chromium, helper-e2e / poster-e2e, 2026-09-21) ───────────────────────
 *
 *   /jobs  @375   15% of each 301x139 card, one live 267x32 anchor
 *                    (89% of the card's width)         →  0%, anchor 1x1
 *   /posts @375    0% (already fixed 2026-09-14)     →  0%
 *
 * ── THE BUDGET ───────────────────────────────────────────────────────────
 * Zero is the wrong number to demand, and demanding it is how a check like
 * this gets deleted: the `focus:not-sr-only` map anchor JobCardMetaRow keeps
 * for keyboard users legitimately paints itself over the card the moment it is
 * focused, and a genuinely chip-sized "Directions" button in an action row is
 * a control the user aimed at. MAX_MAPS_AREA_PCT is set at 4% — measured, the
 * Directions chip is ~2% of an expanded card — so a chip passes and a band
 * across the card cannot.
 *
 * Read-only against prod: navigates and reads geometry. Presses nothing,
 * writes no row. Shots land in LH_CARD_SHOTS when set; per CLAUDE.md they are
 * not evidence until someone has LOOKED
 * (`npm run review:record -- <png> <screen> <checked> <ok|defect>`).
 *
 * Run:
 *   PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit \
 *     card-maps-hit-area
 */
// SHOWN ABLE TO FAIL: dropping the prop restores the original defect verbatim
// — the location slot goes back to being the full-width anchor, and /jobs
// measures 15% again at 375.
// @mutate src/pages/jobs/AppliedJobCard.tsx | locationPressToMap | locationPressToMap={false}

import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, expect, type Browser, type Page, type TestInfo } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

const SHOTS = process.env.LH_CARD_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/**
 * The share of a card's tap area a maps link may own.
 *
 * 4%. Measured: the "Directions" chip on an expanded confirmed card is ~2% of
 * that card, and the focus-only address anchor is ~3% once a keyboard focuses
 * it. The shipped defect was 15%, and the anchor behind it was 89% of the
 * card's WIDTH — so the gap between "a chip the user aimed at" and "a band
 * across the card" is an order of magnitude, not a few pixels. A budget of 0
 * would fail on the accessible affordances this app deliberately keeps.
 */
const MAX_MAPS_AREA_PCT = 4;

/** Anything whose activation hands the address to a maps app or a maps site. */
const MAPS_SELECTOR =
  'a[href^="https://maps.apple.com"], a[href^="maps:"], a[href^="geo:"], a[href*="google.com/maps"], a[href*="google.com/maps"]';

/**
 * THE INVENTORY, FROM SOURCE. Every file that renders the shared meta row is
 * a surface that can carry this defect, so the list is read out of `src/` and
 * the spec fails when a consumer appears that no route below drives. A
 * hand-kept list is exactly how the class half of a class check rots.
 */
function metaRowConsumers(): string[] {
  const root = resolve(process.cwd(), "src");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx$/.test(entry) || /\.test\.tsx$/.test(entry)) continue;
      const src = readFileSync(p, "utf8");
      // The row's own file and the chip-only import (dashboard/JobCard imports
      // JobHelprsChip, not the row) are not consumers of the location slot.
      if (/<JobCardMetaRow[\s>]/.test(src)) out.push(p.slice(root.length + 1));
    }
  };
  walk(root);
  return out.sort();
}

/** Per-card maps hit area, by asking elementFromPoint the user's question. */
async function probeCards(page: Page) {
  return page.evaluate((mapsSel) => {
    /* A card is the frame JobCardShell draws (`rounded-2xl liquid-glass`)
       around a title. Resolved from the TITLE outwards so a nested rounded box
       inside a card can never be mistaken for one. */
    const cards = [
      ...new Set(
        [...document.querySelectorAll("h2.font-display")]
          .map((h) => h.closest<HTMLElement>("div.rounded-2xl"))
          .filter((c): c is HTMLElement => !!c),
      ),
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return cards.map((card) => {
      const r = card.getBoundingClientRect();
      const cols = 20;
      const rows = Math.max(8, Math.min(40, Math.round(r.height / 8)));
      let sampled = 0;
      let maps = 0;
      const hits = new Set<string>();
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = r.left + ((i + 0.5) / cols) * r.width;
          const y = r.top + ((j + 0.5) / rows) * r.height;
          if (x < 0 || x > vw - 1 || y < 0 || y > vh - 1) continue;
          sampled++;
          const el = document.elementFromPoint(x, y);
          const a = el?.closest<HTMLAnchorElement>(mapsSel);
          if (a && card.contains(a)) {
            maps++;
            hits.add(`${a.className.split(" ")[0]}:${(a.textContent ?? "").trim().slice(0, 30)}`);
          }
        }
      }
      /* The widest maps anchor in the card, as a share of the card's width.
         The area number can be diluted by a tall card; the WIDTH number is
         what "a band across the card" actually looks like, and it was 89%. */
      const widest = Math.max(
        0,
        ...[...card.querySelectorAll<HTMLAnchorElement>(mapsSel)].map((a) => {
          const ar = a.getBoundingClientRect();
          // The sr-only anchor is a real 1x1 clipped box; it is not a band.
          return a.classList.contains("sr-only") ? 0 : ar.width;
        }),
      );
      return {
        title: (card.querySelector("h2")?.textContent ?? "?").trim().slice(0, 44),
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        sampled,
        areaPct: sampled ? (maps / sampled) * 100 : 0,
        widestPctOfCard: r.width ? (widest / r.width) * 100 : 0,
        hits: [...hits],
      };
    });
  }, MAPS_SELECTOR);
}

function note(info: TestInfo, type: string, description: string) {
  info.annotations.push({ type, description });
  console.log(`[card-maps] ${type}  ${description}`);
}

let poster: Session;
let helper: Session;
test.beforeAll(async ({ request }) => {
  [poster, helper] = await Promise.all([getSession(request, "poster"), getSession(request, "helper")]);
});

async function authedContext(browser: Browser, vw: number, baseURL: string | undefined, who: "poster" | "helper") {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: vw, height: vw >= 900 ? 900 : 812 },
    hasTouch: vw < 900,
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        localStorage.setItem(key, val);
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
        );
      } catch {
        /* signed out: the "cards were found" assertion fails visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(who === "poster" ? poster : helper) },
  );
  return ctx;
}

/** Route → which account sees cards there → which source file draws them. */
const SURFACES: { name: string; url: string; as: "poster" | "helper"; drawnBy: string }[] = [
  { name: "jobs", url: "/jobs", as: "helper", drawnBy: "pages/jobs/AppliedJobCard.tsx" },
  { name: "posts", url: "/posts", as: "poster", drawnBy: "pages/posts/PostedJobCard.tsx" },
];

test("every file that draws the shared meta row is on a route this spec measures", () => {
  const consumers = metaRowConsumers();
  // VACUITY FLOOR: a scan that finds nothing must fail, not pass. This is the
  // failure mode CLAUDE.md names — a broken scan reads as a clean sweep.
  expect(consumers.length, "no <JobCardMetaRow> consumers found — the scan is broken").toBeGreaterThan(0);
  const covered = new Set(SURFACES.map((s) => s.drawnBy));
  expect(
    consumers.filter((c) => !covered.has(c)),
    "a file renders JobCardMetaRow on a surface this spec does not drive — add it to SURFACES, " +
      "or the location slot there is unmeasured and may be a full-width maps link",
  ).toEqual([]);
});

for (const vw of [375, 1440] as const) {
  for (const surface of SURFACES) {
    test(`${surface.name}: no maps link owns the card's tap area @${vw}`, async ({ browser }, info) => {
      const ctx = await authedContext(browser, vw, info.project.use.baseURL, surface.as);
      const page = await ctx.newPage();
      try {
        await page.goto(surface.url, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !document.getElementById("boot-loader"), null, { timeout: 45_000 });
        await page.waitForSelector("h2.font-display", { state: "visible", timeout: 45_000 });
        await page.waitForTimeout(1_200);

        const cards = await probeCards(page);
        if (SHOTS) {
          await page.screenshot({ path: join(SHOTS, `${surface.name}-${vw}.png`), fullPage: false });
        }
        // A surface with no cards has not been measured. The two accounts are
        // seeded with jobs in both directions; an empty list is a fixture
        // problem and must fail rather than pass over nothing.
        expect(cards.length, `${surface.name}@${vw}: no job cards on the page — nothing was measured`).toBeGreaterThan(0);
        // Only cards actually IN the viewport can be probed; elementFromPoint
        // is blind to the rest, and a card with no samples proves nothing.
        const probed = cards.filter((c) => c.sampled > 20);
        expect(
          probed.length,
          `${surface.name}@${vw}: every card was off-screen (no card got >20 sample points)`,
        ).toBeGreaterThan(0);

        const worstArea = Math.max(...probed.map((c) => c.areaPct));
        const worstWidth = Math.max(...probed.map((c) => c.widestPctOfCard));
        note(
          info,
          `${surface.name}@${vw}`,
          `${probed.length} card(s) probed; worst maps tap area ${worstArea.toFixed(1)}% ` +
            `(budget ${MAX_MAPS_AREA_PCT}%); widest visible maps anchor ${worstWidth.toFixed(0)}% of card width; ` +
            `boxes ${[...new Set(probed.map((c) => c.box))].join(",")}`,
        );

        const offenders = probed.filter((c) => c.areaPct > MAX_MAPS_AREA_PCT);
        expect(
          offenders.map((c) => `"${c.title}" ${c.box}: ${c.areaPct.toFixed(1)}% → ${c.hits.join(" | ")}`),
          `${surface.name}@${vw}: a maps link owns more than ${MAX_MAPS_AREA_PCT}% of a job card's tap ` +
            `area, so a tap meant for the card leaves the app. Drawn by ${surface.drawnBy}; the fix is ` +
            `JobCardMetaRow's \`locationPressToMap\` (tap expands, hold opens the map), not a wider budget.`,
        ).toEqual([]);

        /* THE SECOND HALF, and the one the area percentage alone would miss: a
           32px band across a 400px-tall expanded card is only ~8% of its area
           but is still a band. No VISIBLE maps anchor may be more than a chip
           wide. 50%: the widest legitimate chip measured is the Directions
           control at ~30% of a 301px card. */
        const bands = probed.filter((c) => c.widestPctOfCard > 50);
        expect(
          bands.map((c) => `"${c.title}" ${c.box}: anchor is ${c.widestPctOfCard.toFixed(0)}% of card width`),
          `${surface.name}@${vw}: a visible maps anchor spans more than half the card's width — that is a ` +
            `band across the card, not a chip, whatever its share of the area works out to.`,
        ).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
}
