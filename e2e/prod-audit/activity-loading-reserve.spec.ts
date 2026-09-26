/**
 * WHAT THE PLACEHOLDER RESERVES MUST BE WHAT ARRIVES — the class check for the
 * second half of the owner's 2026-09-21 report: "check into jobs exhaustivly
 * bc it stills jumps really bad and takes long to load."
 *
 * ── WHY CLS COULD NOT SEE IT, AND WHY THIS FILE EXISTS ───────────────────
 * Measured on /jobs at 375 against prod: CLS 0.0000 across ZERO
 * layout-shift entries, while every card on the page moved up to 195px the
 * instant the data landed. That is not a bug in the measurement — the Layout
 * Instability API scores elements that were in the previous frame and MOVED,
 * and a skeleton→content swap REMOVES one subtree and INSERTS another. A page
 * can jump as hard as you like and score a perfect CLS.
 *
 * So the jump is measured the only way it can be: the placeholder's row box
 * and the real row's box, in the same run, on the same page, with the list
 * response held back long enough to capture the first one.
 *
 * ── MEASURED, before → after (prod Supabase, this checkout's local build,
 *    Chromium at 375, helper-e2e / poster-e2e, 2026-09-21) ─────────────────
 *
 *   /jobs   row height   220px → 150px   (real 151px)   jump -81px → -1px
 *              row pitch    230px → 162px   (real 163px)
 *              first card y   95px → 138px  (real 138px)   jump +43px →  0px
 *              4th card y    785px → 624px  (real 627px)   jump -195px → -3px
 *
 *   /posts  first card y   95px → 138px  (real 202px)   jump +107px → +64px
 *              row height   106px → the shared card (expected 150px against a
 *                           real 151px, NOT re-measured — see the note below)
 *
 * The /jobs numbers come from two fixes: `ApplicationCardSkeleton` now
 * draws the collapsed card's two blocks instead of six bone rows and a footer
 * button, and `ActivityPageSkeleton` reserves the status-tab line that the
 * page header (PostsHeader / JobsHeader) renders on phone when the row is
 * open (and uses the lists' own `space-y-3`, not `space-y-2.5`).
 *
 * The /posts row height comes from one more: `ActivityCardSkeleton` is no
 * longer a hand-drawn box but `CollapsedActivityCardSkeleton`, the same
 * shell-derived drawing — one card, one drawing.
 *
 * ── WHAT THIS DOES NOT CLAIM ─────────────────────────────────────────────
 * `scripts/check-loading-state-shape.mjs` is the repo's own check for this
 * class, and it reads COMMITTED evidence
 * (`docs/audit/loading-states/measurements.json`) produced by a full sweep of
 * every route. That evidence is now STALE for /jobs — it still records the
 * pre-fix `row 206px → 154px`, and its baseline entry with it. Re-running the
 * whole sweep needs the browser lock for every route and both personas, so it
 * is filed in docs/OPEN.md rather than half-done here. This spec is the live
 * repro of the two surfaces the owner named, which the committed evidence
 * cannot be until that sweep runs.
 *
 * Read-only against prod: navigates, delays two GET/RPC reads on the wire,
 * writes nothing.
 *
 * Run:
 *   PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit \
 *     activity-loading-reserve
 */
// SHOWN ABLE TO FAIL: each fix, reverted, brings its own number back.
// The money bone's own height CLASS, not an appended `style` prop: the bone
// already carries a `style` for its background, and a second one appended after
// `className` is a DUPLICATE JSX prop — React keeps the last, so the mutation
// changed the source text and nothing else. It registered, ran, and SURVIVED on
// main (placeholder row 150px, byte-identical to unmutated). Mutating the class
// moves the real box: 26px -> 96px takes the row 150px -> ~220px, far outside
// the 8px budget.
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | className="h-[26px] w-16 rounded-ds-md shrink-0 ml-3" | className="h-[96px] w-16 rounded-ds-md shrink-0 ml-3"
// @mutate src/components/ActivityPageSkeleton.tsx | {!isWebDesktop && tabRowOpens && ( | {false && (
// The gap assertion, shown able to fail (it was the pitch assertion until
// 2026-09-26; see "THE GAP WITHIN A LIST" below). `space-y-8` and not the real
// regression it guards (`space-y-2.5`, the 10px gap this fix replaced with the
// lists' own 12px): 10 vs 12 is a 2px gap error, INSIDE the 8px budget by
// design — a gap that close is not a visible step on its own, it is an error
// that compounds, and the row-height and first-y assertions are what hold the
// surface. The mutation therefore proves the assertion is live, at a size that
// is genuinely out of budget.
// @mutate src/components/ActivityPageSkeleton.tsx | pb-0 space-y-3" aria-hidden | pb-0 space-y-8" aria-hidden

import { test, expect, type Browser, type Page, type TestInfo } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

/**
 * How far a placeholder row may differ from the row that replaces it.
 *
 * 8px, the same number `scripts/check-loading-state-shape.mjs` uses and for
 * the same reason (ROW_BUDGET: a row whose content wraps genuinely cannot be
 * predicted, and sub-pixel rounding costs a pixel either way). Imported as a
 * literal rather than from that module because it is a `.mjs` script with its
 * own prod-evidence dependencies; `src/test/` has no copy to share.
 */
const ROW_BUDGET = 8;

/**
 * How far the FIRST row may start from where the real first row starts.
 *
 * Looser than ROW_BUDGET on purpose, and declared per surface below rather
 * than shared: this is everything ABOVE the list — the title card, the tab
 * line, and on a grouped list the section heading — and a section heading the
 * placeholder cannot know about is a legitimate offset, not a lie about a row.
 */
const OFFSET_BUDGET = 8;

/*
 * THE /posts PIN IS GONE (2026-09-21, later the same night).
 *
 * It read `POSTED_ROW_PIN = 106` — the measured height of `ActivityCardSkeleton`
 * (src/components/SkeletonLoaders.tsx), a hand-drawn `rounded-ds-md p-4` box
 * with no frame, no category rail and no category tab, standing in for a real
 * 151px PostedJobCard. The pin existed because fixing it meant touching a
 * component shared with Activity's posted Suspense fallback.
 *
 * Both call sites now render `CollapsedActivityCardSkeleton` — the same
 * shell-derived drawing /jobs took, because PostedJobCard and AppliedJobCard
 * are the same JobCardShell at the same 151px. So /posts is held to the same
 * ROW_BUDGET every other surface is, and the pin would now be a ceiling the
 * surface has legitimately risen through rather than a floor it must not fall
 * below.
 *
 * NOT RE-MEASURED IN A BROWSER BY THE LANE THAT MADE THIS CHANGE — another lane
 * held the browser lock for a journey run. The expected number is /jobs'
 * own, since it is now literally the same component: placeholder 150px against
 * a real 151px row. Running this spec is the confirmation, and it is filed in
 * docs/OPEN.md.
 */

interface Surface {
  name: string;
  url: string;
  as: "poster" | "helper";
  /** The reads whose delay opens the capture window for the loading frame. */
  hold: RegExp;
  /**
   * Declared expected row height, when the surface is knowingly below budget.
   * No surface sets it today — /posts was the last, and its placeholder is
   * now the shared shell-derived card. Kept because the next surface found
   * below budget needs a way to record the measurement rather than exempt it.
   */
  pinnedRow?: number;
  /** Why the first row legitimately starts somewhere else. */
  offsetNote?: string;
  offsetBudget?: number;
  /**
   * The phone status-tab row is OPEN on this URL (a non-default `?filter=`),
   * so the loaded header draws it and ActivityPageSkeleton must reserve it
   * (`tabRowOpens`). Asserted on the loaded page, so the surface cannot go
   * quietly vacuous if the header stops opening the row.
   */
  tabRowOpen?: boolean;
}

const SURFACES: Surface[] = [
  {
    name: "jobs",
    url: "/jobs",
    as: "helper",
    hold: /supabase\.co\/rest\/v1\/(rpc\/get_jobs_for_my_applications|applications\?select=\*)/,
  },
  /* THE TAB-ROW RESERVATION (2026-09-26). The two surfaces above open on the
     DEFAULT filter, where the phone tab row starts folded (owner, 2026-09-25)
     and `tabRowOpens` is false in the skeleton — so removing the reservation
     (`{false && (`, the @mutate above) changed nothing either surface draws,
     and PR #1797's vacuity run (job 108326395029) reported it SURVIVED. A
     non-default filter is the state in which the loaded header shows the row
     and the skeleton must reserve it; without the reservation the placeholder
     list starts one tab line higher than the real one, and first-y holds it to
     OFFSET_BUDGET. */
  {
    name: "jobs-done",
    url: "/jobs?filter=done",
    as: "helper",
    hold: /supabase\.co\/rest\/v1\/(rpc\/get_jobs_for_my_applications|applications\?select=\*)/,
    tabRowOpen: true,
  },
  {
    name: "posts",
    url: "/posts",
    as: "poster",
    hold: /supabase\.co\/rest\/v1\/jobs\?select=accepted_at/,
    /* The poster's default bucket renders the GROUPED view, so a section
       heading ("Active", "Completed", …) sits above the first card and the
       placeholder draws none. 64px, measured. */
    offsetBudget: 72,
    offsetNote:
      "the grouped posted list puts a section heading above the first card (ActivitySectionedView); the placeholder draws a flat list, so 64px of heading is a legitimate offset, not a row lying about its size",
  },
];

/**
 * The list's ROWS, in order — real job cards once loaded, placeholder cards
 * while loading.
 *
 * ── TWO WRONG VERSIONS OF THIS, BOTH OF WHICH LOOKED FINE ────────────────
 * Getting the row SET right is most of this file's difficulty, and both
 * mistakes produced numbers rather than errors:
 *
 *   1. "a rounded box with no rounded descendant" threw the /jobs
 *      placeholder card away, because the money-pill bone inside it is also
 *      `rounded-ds-md`. Zero rows reads exactly like a clean result, which is
 *      what the vacuity floor below exists to catch.
 *   2. "any card-sized rounded box" picked up boxes INSIDE a card — the
 *      offer-message panel on an expanded offered card is `rounded-ds-md`,
 *      301px wide and 82px tall. One run read `real row 82px pitch 347px`
 *      off a page whose cards are 151px.
 *
 * So the two frames are resolved by what identifies a row in each: a real job
 * card is the shell around a card TITLE (`h2.font-display`, JobCardTitleBar's
 * own heading), and a placeholder card is the outermost card-sized rounded box
 * holding a placeholder BONE. Neither rule can wander inside a card.
 */
async function rows(page: Page) {
  return page.evaluate(() => {
    // `list`: which LIST the row sits in — its nearest `space-y-*` ancestor,
    // numbered in document order. The grouped view (ActivitySectionedView,
    // /jobs' default "All" and the poster's buckets) is several lists, one per
    // section, with the section's heading button between them; see `gaps`.
    const lists: Element[] = [];
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      const l = e.parentElement?.closest('[class*="space-y-"]') ?? null;
      let list = l ? lists.indexOf(l) : -1;
      if (l && list < 0) list = lists.push(l) - 1;
      return { h: Math.round(r.height), y: Math.round(r.top), list };
    };
    const cardSized = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 150 && r.height > 60;
    };

    // LOADED: one row per card title.
    const real = [
      ...new Set(
        [...document.querySelectorAll("h2.font-display")]
          .map((h) => h.closest<HTMLElement>("div.rounded-2xl"))
          .filter((c): c is HTMLElement => !!c && !c.closest("nav")),
      ),
    ];
    if (real.length) return real.map(box);

    // LOADING: the outermost card-sized rounded box that holds a bone. The
    // ANCESTOR test (not the descendant one) is what keeps the money pill from
    // discarding its own card.
    const BONE = '[class*="shimmer"], [class*="animate-pulse"]';
    const all = [...document.querySelectorAll<HTMLElement>("div.rounded-2xl, div.rounded-ds-md")];
    const placeholders = all.filter((e) => {
      if (!cardSized(e) || e.closest("nav") || !e.querySelector(BONE)) return false;
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (p.matches("div.rounded-2xl, div.rounded-ds-md") && cardSized(p)) return false;
      }
      return true;
    });
    return placeholders.map(box);
  });
}

/** The middle value — the row height/pitch a list of cards mostly IS. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function note(info: TestInfo, type: string, description: string) {
  info.annotations.push({ type, description });
  console.log(`[loading-reserve] ${type}  ${description}`);
}

let poster: Session;
let helper: Session;
test.beforeAll(async ({ request }) => {
  [poster, helper] = await Promise.all([getSession(request, "poster"), getSession(request, "helper")]);
});

for (const surface of SURFACES) {
  test(`${surface.name}: the placeholder reserves the row that arrives`, async ({ browser }, info) => {
    const ctx = await (async (b: Browser) => {
      const c = await b.newContext({
        baseURL: info.project.use.baseURL,
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        serviceWorkers: "block",
      });
      await c.addInitScript(
        ({ key, val }) => {
          try {
            localStorage.setItem(key, val);
            localStorage.setItem(
              "helpr_onboarding",
              JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
            );
          } catch {
            /* signed out: the assertions below fail visibly */
          }
        },
        { key: AUTH_STORAGE_KEY, val: JSON.stringify(surface.as === "poster" ? poster : helper) },
      );
      return c;
    })(browser);
    const page = await ctx.newPage();
    try {
      /* HELD ON THE WIRE, NOT MOCKED (owner: no mock mode, ever). The bytes
         that arrive are the bytes prod sent; the only intervention is a 7s
         delay, so the loading frame exists long enough to measure. */
      await page.route(surface.hold, async (route) => {
        await new Promise((r) => setTimeout(r, 7_000));
        await route.continue();
      });

      await page.goto(surface.url, { waitUntil: "commit" });
      await page.waitForFunction(() => !document.getElementById("boot-loader"), null, { timeout: 45_000 });
      // Wait on the SAME predicate the measurement uses, so a window that
      // opened for the waiter but not for `rows()` cannot happen.
      await page.waitForFunction(
        () => {
          const BONE = '[class*="shimmer"], [class*="animate-pulse"]';
          const cardSized = (e: Element) => {
            const r = e.getBoundingClientRect();
            return r.width > 150 && r.height > 60;
          };
          return (
            [...document.querySelectorAll("div.rounded-2xl, div.rounded-ds-md")].filter((e) => {
              if (!cardSized(e) || e.closest("nav") || !e.querySelector(BONE)) return false;
              for (let p = e.parentElement; p; p = p.parentElement) {
                if (p.matches("div.rounded-2xl, div.rounded-ds-md") && cardSized(p)) return false;
              }
              return true;
            }).length >= 2
          );
        },
        null,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(400);
      const loading = await rows(page);
      await info.attach(`${surface.name}-loading.png`, { body: await page.screenshot(), contentType: "image/png" });

      await page.waitForSelector("h2.font-display", { state: "visible", timeout: 45_000 });
      await page.waitForTimeout(2_000);
      const loaded = await rows(page);
      await info.attach(`${surface.name}-loaded.png`, { body: await page.screenshot(), contentType: "image/png" });

      if (surface.tabRowOpen) {
        await expect(
          page.getByRole("button", { name: "Hide status filters" }).first(),
          `${surface.name}: the loaded header did not open the phone status-tab row on ${surface.url} — ` +
            `this surface exists to measure that row's reservation, and measured nothing`,
        ).toBeVisible();
      }

      // VACUITY FLOOR, both frames. An empty set passes every comparison
      // below, and a capture window that closed too early looks exactly like
      // a clean result.
      expect(loading.length, `${surface.name}: no placeholder rows captured — the hold did not open a window`).toBeGreaterThanOrEqual(2);
      expect(loaded.length, `${surface.name}: no real rows — nothing was compared`).toBeGreaterThanOrEqual(2);

      /* MEDIANS, not the first row.
         An EXPANDED card is a legitimate row (a pending direct offer opens
         with its message, deadline and Accept/Decline pair — measured at
         456px against a collapsed 151px), and which card is first depends on
         what the shared test accounts happen to hold that minute. The
         placeholder reserves the row a list of cards mostly IS, so that is
         what it is judged against. */
      const heights = (r: { h: number }[]) => median(r.map((x) => x.h));
      /* THE GAP WITHIN A LIST, not the pitch (2026-09-26).
         Pitch is row height + gap. Comparing pitches judged the ROW HEIGHT a
         second time, over a different subset of rows than the height check
         (adjacent same-list pairs drop each list's last row), and on a list
         of two card shapes its median is a coin flip. Measured in prod-audit
         36211342059 (this spec, helper /jobs at 375): 17 real rows, 9 at 131px
         and 8 at 151px, interleaved; same-list pitches 8x143 and 8x162/163,
         so the "real pitch" printed 162 while the height median read 131 —
         and the vacuity run of PR #1797 (job 108310368705) was red on PITCH
         the day the mix fell the other way. The GAP (next row's top minus
         this row's bottom) is 12px on every one of those pairs, placeholder
         and real, which is what this assertion was written to hold ("the
         lists use space-y-3"). Only same-list pairs count: the grouped view
         is one list per section with a heading between them. */
      const gaps = (r: { h: number; y: number; list: number }[]) =>
        r.slice(1).flatMap((x, i) => (x.list === r[i].list ? [x.y - (r[i].y + r[i].h)] : []));
      const gap = (r: { h: number; y: number; list: number }[]) => (gaps(r).length ? median(gaps(r)) : 0);
      /* THE SHAPES THE LIST ACTUALLY HAS. A collapsed card is one of TWO
         heights by design, not by accident: JobCardMetaRow gives a street
         address a line of its own (`basis-full`, `flex-wrap gap-y-1`), so a
         card whose reader may see the street is one 16px line + 4px taller
         than a card that prints a city. Measured 36211342059: /jobs 131px x9
         and 151px x8, /posts 131px x10 and 151px x10, one list each. The two
         shapes are 20px apart, so NO static placeholder is within the 8px
         ROW_BUDGET of both; which one the median lands on is decided by
         whatever the shared accounts hold that hour (the location string's
         street part, and for the Helpr, the application's state). The
         placeholder is therefore held to the shape it is nearest to, and
         that shape must be one the list really contains (held by at least
         two rows) — a placeholder of neither shape (the six-bone 220px card
         this replaced, or the 96px-bone mutation below) is still red. The
         residual jump for the OTHER shape is real and printed; it is a
         product question (docs/OPEN.md Q700), not something a budget hides. */
      const shapes = (r: { h: number }[]) => {
        const counts = new Map<number, number>();
        for (const x of r) counts.set(x.h, (counts.get(x.h) ?? 0) + 1);
        return [...counts.entries()].filter(([, n]) => n >= 2).map(([h]) => h);
      };
      const loadingH = heights(loading);
      const loadedH = heights(loaded);
      const realShapes = shapes(loaded);
      const nearest = realShapes.length
        ? realShapes.reduce((a, b) => (Math.abs(b - loadingH) < Math.abs(a - loadingH) ? b : a))
        : loadedH;
      const trail = (r: { h: number; y: number; list: number }[]) => r.map((x) => `${x.y}+${x.h}@L${x.list}`).join(" ");
      const shapeMix = realShapes
        .map((h) => `${h}px x${loaded.filter((x) => x.h === h).length}`)
        .join(", ");
      note(
        info,
        surface.name,
        `placeholder row ${loadingH}px gap ${gap(loading)}px first-y ${loading[0].y} (${loading.length} rows) · ` +
          `real row median ${loadedH}px, shapes [${shapeMix}], nearest ${nearest}px, gap ${gap(loaded)}px first-y ${loaded[0].y} (${loaded.length} rows)` +
          (surface.pinnedRow ? ` · PINNED at ${surface.pinnedRow}px (see POSTED_ROW_PIN)` : "") +
          ` · rows y+h@list: placeholder [${trail(loading)}] real [${trail(loaded)}]`,
      );
      expect(gaps(loading).length, `${surface.name}: no two placeholder rows share a list — no gap to compare`).toBeGreaterThanOrEqual(1);
      expect(gaps(loaded).length, `${surface.name}: no two real rows share a list — no gap to compare`).toBeGreaterThanOrEqual(1);
      // VACUITY FLOOR for the shape set: a list of all-different heights (every
      // card expanded) has no shape to judge against, and must not pass.
      expect(realShapes.length, `${surface.name}: no row height is held by two real rows — no card shape to compare`).toBeGreaterThanOrEqual(1);

      if (surface.pinnedRow !== undefined) {
        // A pin records the measurement, so it can only be held or improved.
        expect(
          loadingH,
          `${surface.name}: the placeholder row is ${loadingH}px, past its pinned ${surface.pinnedRow}px. ` +
            `This surface is knowingly below budget (see POSTED_ROW_PIN) — it may be FIXED, never made worse.`,
        ).toBeLessThanOrEqual(surface.pinnedRow);
      } else {
        expect(
          Math.abs(loadingH - nearest),
          `${surface.name}: the placeholder reserves ${loadingH}px, and the nearest card shape the list ` +
            `actually has is ${nearest}px (shapes: ${shapeMix}) — every card below the first one moves by the ` +
            `difference, compounding down the list. Budget ${ROW_BUDGET}px.`,
        ).toBeLessThanOrEqual(ROW_BUDGET);
        expect(
          Math.abs(gap(loading) - gap(loaded)),
          `${surface.name}: placeholder rows are ${gap(loading)}px apart, real rows ${gap(loaded)}px. The gap ` +
            `between rows is part of the reservation — the lists use \`space-y-3\`.`,
        ).toBeLessThanOrEqual(ROW_BUDGET);
      }

      expect(
        Math.abs(loading[0].y - loaded[0].y),
        `${surface.name}: the first row starts at y=${loading[0].y} while loading and y=${loaded[0].y} once ` +
          `loaded — the WHOLE list slides by the difference. Everything above the list is reserved by ` +
          `ActivityPageSkeleton.${surface.offsetNote ? ` Declared offset: ${surface.offsetNote}.` : ""}`,
      ).toBeLessThanOrEqual(surface.offsetBudget ?? OFFSET_BUDGET);
    } finally {
      await ctx.close();
    }
  });
}
