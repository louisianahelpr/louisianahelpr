import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  POSTED_STATUS_FILTERS,
  APPLIED_STATUS_FILTERS,
  BUCKET_LABEL,
} from "@/components/job-card/activityFilters";
import { SHORT_LABEL_BELOW_PX } from "@/components/ui/UnderlineTabs";
import { NARROW_TITLE_ASIDE_PX } from "@/components/ui/ScreenHeaderRow";
import { MIN_TYPABLE_FIELD_PX } from "@/lib/searchFieldFloor";

/**
 * THE ACTIVITY HEADER'S PHONE WIDTH BUDGET — both claims on one row.
 *
 *   (1) SEARCH CLOSED: every status-tab label is FULLY ON THE SCREEN at 320,
 *       375 and 414.
 *   (2) SEARCH OPEN: the field is wide enough to read what you typed.
 *
 * ── WHY NO EXISTING GUARD COULD SEE EITHER ─────────────────────────────────
 * The tab row is a horizontal scroller. When five labels need 372px inside a
 * 278px clip, the row scrolls — so `documentElement.scrollWidth -
 * clientWidth` is 0, no element is wider than the viewport, the column is
 * centred, and EVERY overflow guard in this repo passes while two of the five
 * tabs are not on the screen at all. Measured on prod, 2026-09-19, signed in:
 *
 *      width   clip    content   what you could actually read
 *       320    278px    372px    "Needs You Waiting Scheduled Do"
 *       375    333px    372px    "…Scheduled Done Ca"
 *       414    372px    372px    "…Done Cancelled" cut at the final letter
 *      1440    372px    372px    all five (desktop row, never the problem)
 *
 * The open field is the same budget seen from the other side. Everything else
 * on that row is fixed-width — a 20px display title, a 44px held-open
 * magnifier slot, a 44px status chevron, three 12px gaps — so the field, the
 * only flexible item, absorbs whatever is left. Measured the same day:
 * 76px at 320 (with the ✕ drawn ON TOP of the magnifier, a -26px gap) and
 * 95px at 375, where "oak tree" rendered as "ree".
 *
 * ── WHAT THIS FILE ASSERTS, AND HOW IT KNOWS ───────────────────────────────
 * Nothing here is hand-typed. The tab inventory comes from the bucket
 * definitions themselves (`POSTED_STATUS_FILTERS` / `APPLIED_STATUS_FILTERS`,
 * which are `BUCKET_LABEL` + `BUCKET_SHORT_LABEL` in bucket order), the
 * breakpoint and the floor come from the two exported constants, and the type
 * size, the gaps, the slot width and the wiring that turns them on are PARSED
 * out of the components. Change any of them and this file changes with them —
 * which is the point: the row must stay fitted, not stay the same.
 *
 * ── WHAT IT CANNOT CATCH ───────────────────────────────────────────────────
 * jsdom lays nothing out and resolves no font, so label widths come from a
 * stated character model calibrated against five real measurements (see
 * CALIBRATION). It is a floor: the model is deliberately 20% generous, so it
 * fails EARLIER than the browser would, never later. A font swap that makes
 * Montserrat's 600-weight wider than the model, a stylesheet that hides a
 * label some other way, or Dynamic Type still need the browser — that pass is
 * `.claude-scratch/shoot.mjs` at 320/375/414/1440 in both themes, whose
 * numbers are recorded above and in the commit message.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). Every mutation is a state this
// row has actually been in, or one step from it:
//   1. The short words never reach the tabs — the row as it shipped, five long
//      words on a 320 screen. Part 1 must go red at 320 and 375.
//   2. The swap breakpoint moved below every phone, which is the same defect
//      arriving through the constant instead of the wiring.
//   3. The phone row loses `tight`, so the labels go back to 12px and the gaps
//      to 16px. Part 1 must go red at 320.
//   4. The visible title stops stepping aside — the open field goes back to
//      40px of box at 320. Part 2 must go red.
//   5. The held-open magnifier slot doubles. Part 2 must go red: the field is
//      the only thing on the row that can pay for it.
//   6. The tabs are taken away again on an empty list, which is the /jobs
//      screen that rendered one magnifier and nothing else. Part 3 must go red.
//   7. The edge fade is unhooked from the scroller, leaving the hard cut at the
//      card's corner this row shipped with.
//   8. The phone disclosure goes back to opening COLLAPSED on the default
//      filter — the exact line that shipped, and the screen the owner saw on
//      2026-09-20: "My Posts · 🔍 · ⌄" and no tab row at 320/375/414. Part 4
//      must go red. (Parts 1–3 stay green on that mutation, which is the
//      whole reason Part 4 had to exist.)
// Part 4's compiled-CSS leg is covered by mutation 2 (the breakpoint constant
// moves to 290, so the rule the guard looks for at SHORT_LABEL_BELOW_PX is not
// one the compiler emits) — and it has to be, for a reason worth writing down:
// a mutation that edits the CLASS LITERAL cannot make that leg red, because
// the `@mutate` directive below restates the class in a file Tailwind scans,
// which keeps the rule alive on its own. The directives are content too.
// @mutate src/components/job-card/ActivityHeader.tsx | shortLabel: inlineFilters ? undefined : f.shortLabel, | shortLabel: undefined,
// @mutate src/lib/shortLabelBreakpoint.ts | export const SHORT_LABEL_BELOW_PX = 390; | export const SHORT_LABEL_BELOW_PX = 290;
// @mutate src/components/job-card/ActivityHeader.tsx | tight={!inlineFilters} | tight={false}
// @mutate src/components/job-card/ActivityHeader.tsx | narrowTitleStepsAside: true, | narrowTitleStepsAside: false,
// @mutate src/components/job-card/ActivityHeader.tsx | triggerWidth: inlineFilters ? "28px" : "44px", | triggerWidth: inlineFilters ? "28px" : "88px",
// @mutate src/components/job-card/JobListPage.tsx | activeStatusFilters={activeStatusFilters} | activeStatusFilters={[]}
// @mutate src/components/job-card/ActivityHeader.tsx | style={tabFadeStyle} | style={undefined}
// @mutate src/components/job-card/ActivityHeader.tsx | const [tabsOpenPhone, setTabsOpenPhone] = useState(true); | const [tabsOpenPhone, setTabsOpenPhone] = useState(!isDefaultFilter);

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
/** Comments are prose about the old geometry; only declarations count. */
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HEADER = stripComments(read("src/components/job-card/ActivityHeader.tsx"));
const TABS = stripComments(read("src/components/ui/UnderlineTabs.tsx"));
const ROW = stripComments(read("src/components/ui/ScreenHeaderRow.tsx"));
const PAGE = stripComments(read("src/components/job-card/JobListPage.tsx"));
const TAILWIND = stripComments(read("tailwind.config.ts"));

// ── THE PHONE WIDTHS THIS ROW HAS TO SURVIVE ────────────────────────────────
/** 320 = the narrowest phone the app supports; 375 = iPhone SE; 414 = Plus. */
const PHONE_WIDTHS = [320, 375, 414] as const;

/**
 * THE TWO CONTAINERS, AS FUNCTIONS OF THE VIEWPORT — measured, then stated.
 *
 * Both are constant offsets, because everything between the viewport edge and
 * the header row is fixed: the page gutter and PageScaffold's title card with
 * its `px-5`.
 *
 *   ROW_INSET   the header row itself:   320→238, 375→293, 414→332, 500→418
 *   CLIP_INSET  the tab scroller, which BLEEDS 20px each side (`-mx-5 px-5`),
 *               so it is exactly 40px wider:  320→278, 375→333, 414→372
 *
 * Measured in Chromium against the local build of this commit with a real
 * prod session, 2026-09-19. If the page gutter or the card padding changes,
 * these move and the browser pass is what says so.
 */
const ROW_INSET = 82;
const CLIP_INSET = 42;
const rowWidth = (viewport: number) => viewport - ROW_INSET;
const clipWidth = (viewport: number) => viewport - CLIP_INSET;

// ── THE CHARACTER MODEL ─────────────────────────────────────────────────────
/**
 * CALIBRATION. jsdom resolves no font, so this is a stated model of the app's
 * sans (Montserrat) at semibold/bold. `glyphPx` is the same coarse model
 * `jobStepRowCases` uses, calibrated at 11px; against five real measurements
 * of THIS row it came out uniformly narrow by a factor of 1.13–1.15:
 *
 *   row                              model    browser   ratio
 *   posts long  11px/12px gap     290.7      333     1.145
 *   posts short 11px/12px gap     214.3      244     1.139
 *   jobs  long  11px/12px gap     264.0      301     1.140
 *   jobs  short 11px/12px gap     187.6      212     1.130
 *   posts long  12px/16px gap     326.4      372     1.140
 *
 * 1.20 is that factor plus a margin, and the margin points the only safe way:
 * the model over-states every label, so this guard goes red BEFORE the browser
 * cuts a word, never after.
 */
const FONT_FUDGE = 1.2;
const NARROW_GLYPHS = "ijltfrI.,'!|:;()[]";
const WIDE_GLYPHS = "mwMW@";
function glyphPx(ch: string): number {
  if (NARROW_GLYPHS.includes(ch)) return 3.2;
  if (WIDE_GLYPHS.includes(ch)) return 8.8;
  if (ch === " ") return 3.0;
  if (ch >= "A" && ch <= "Z") return 7.0;
  return 6.0;
}
/** Width of a string at `sizePx`, with the calibration applied. */
const textPx = (s: string, sizePx: number) =>
  [...s].reduce((a, ch) => a + glyphPx(ch), 0) * (sizePx / 11) * FONT_FUDGE;

// ── WHAT THE COMPONENTS ACTUALLY SAY (parsed, never assumed) ────────────────
/**
 * Tailwind spacing: `gap-3` is 3 × 4px.
 *
 * `fallback` is the shape the class had BEFORE the width layers existed, so
 * this file still measures a tree that has had them taken out again rather
 * than throwing at import. A guard that crashes says "something changed"; one
 * that measures says WHICH label stopped fitting and by how much.
 */
function gapPx(source: string, pattern: RegExp, which: 1 | 2, fallback?: RegExp): number {
  const m = source.match(pattern) ?? (fallback ? source.match(fallback) : null);
  if (!m) throw new Error(`could not parse ${pattern} — the class shape changed`);
  return Number(m[m.length > which ? which : 1]) * 4;
}
/** `"ds-11": ["11px", …]` in tailwind.config.ts. */
function dsFontPx(token: string): number {
  const m = TAILWIND.match(new RegExp(`"${token}":\\s*\\["(\\d+)px"`));
  if (!m) throw new Error(`tailwind.config.ts has no font size ${token}`);
  return Number(m[1]);
}

/** `tight ? "gap-3" : "gap-4"` on the tab group — or a bare `gap-4` without it. */
const TIGHT_GAP_RE = /tight \? "gap-(\d+)" : "gap-(\d+)"/;
const BARE_GAP_RE = /flex items-baseline gap-(\d+) shrink-0/;
const TAB_GAP = {
  tight: gapPx(TABS, TIGHT_GAP_RE, 1, BARE_GAP_RE),
  loose: gapPx(TABS, TIGHT_GAP_RE, 2, BARE_GAP_RE),
};
/** `tight ? "text-ds-11" : "text-ds-12"` on the label span — or a bare one. */
const TAB_FONT = (() => {
  const m = TABS.match(/tight \? "text-(ds-\d+)" : "text-(ds-\d+)"/);
  if (m) return { tight: dsFontPx(m[1]), loose: dsFontPx(m[2]) };
  const bare = TABS.match(/font-sans text-(ds-\d+) leading-none whitespace-nowrap/);
  if (!bare) throw new Error("could not parse the tab label's font size");
  const px = dsFontPx(bare[1]);
  return { tight: px, loose: px };
})();
/** The count beside a label, and the `gap-1` between the two. */
const COUNT_FONT = dsFontPx(
  (TABS.match(/tabular-nums text-(ds-\d+)/) ?? ["", "ds-9"])[1],
);
const COUNT_GAP = gapPx(TABS, /items-baseline gap-(\d+)/, 1);

/** Is the phone row wired to the tight density, and to the short words? */
const PHONE_IS_TIGHT = /tight=\{!inlineFilters\}/.test(HEADER);
const PHONE_GETS_SHORT_LABELS = /shortLabel:[^,]*\bf\.shortLabel\b/.test(HEADER);

/**
 * THE SHORT-WORD BREAKPOINT'S CLASS NAME, SPELLED WITHOUT EVER WRITING IT.
 *
 * ─── THIS IS NOT SUPERSTITION, IT IS THE BUG THIS FILE SHIPPED ─────────────
 * Tailwind reads every file in `content` as raw TEXT and treats anything
 * class-shaped as a candidate — test files included, because `./src/**` is
 * one of the globs. The first version of this guard asserted the breakpoint
 * by interpolating the constant into the class name:
 *
 *     expect(TABS).toContain(`min-` + `[${SHORT_LABEL_BELOW_PX}px]:hidden`);
 *
 * which put the literal text `min-<dollar>{SHORT_LABEL_BELOW_PX}px]:hidden`
 * into a scanned file. Tailwind extracted that as an arbitrary `min-[…]`
 * variant with an unparseable value, and then emitted NO RULE for the whole
 * `min-[…]` variant family anywhere in the project. Reproduced from a
 * one-line file, 2026-09-20: with it, zero `@media (min-width: 390px)` blocks
 * in the build; without it, the rules come back. Measured blast radius — 40
 * distinct `min-[Npx]:` utilities across the app (NotificationPreferences'
 * whole 360px layer, Footer's 500/620 grid, and these two) compiling to
 * nothing.
 *
 * So the guard asserting the breakpoint is what DELETED the breakpoint, and
 * it stayed green throughout, because the class name really was in the source
 * — which is the entire lesson of this file restated in one line: a name in a
 * file is not a rule in a stylesheet.
 *
 * `String.fromCharCode(91)` is the bracket. Ugly on purpose: the two
 * characters `min-` and `[` must never end up adjacent in this file's text
 * again, and a reader who is about to "tidy" this back into a template
 * literal has the reason right here.
 */
const BR_OPEN = String.fromCharCode(91);
const BR_CLOSE = String.fromCharCode(93);
const shortVariantClass = (util: string) =>
  `min-${BR_OPEN}${SHORT_LABEL_BELOW_PX}px${BR_CLOSE}:${util}`;

// ── THE TAB INVENTORY, FROM THE BUCKET DEFINITIONS ──────────────────────────
/** The row drops the legacy catch-all and shows every real bucket. */
const tabsOf = (filters: typeof POSTED_STATUS_FILTERS) =>
  filters.filter((f) => f.key !== "all");

/**
 * THE COUNT LOAD THIS ROW HAS TO FIT, and the one it does not.
 *
 * A tab with items shows a number beside its word, so the row is at its widest
 * when EVERY bucket carries one — the state an active account is in, and the
 * state nobody measured before this file. The prod account the browser pass
 * ran against carries three (Waiting 3, Done 1, Cancelled 1) and measured
 * 244px at 320; five single-digit counts model at 260px against a 278px clip.
 *
 * FIVE DOUBLE-DIGIT COUNTS DO NOT FIT: they model at 294px at 320, 16px past
 * the clip. That is declared, not overlooked. It is the case the third layer
 * exists for — the scroller's edge fade, which this file asserts is still
 * wired (see "the row still says so when a label IS past the edge"). An
 * account with ten or more jobs in every one of five buckets on a 320px phone
 * gets a row that visibly scrolls; an account with fewer gets all five words
 * whole. Anything that pushes the SINGLE-digit case past the clip is a
 * regression and fails here.
 */
const WORST_CASE_COUNT = 9;

function contentWidth(
  filters: typeof POSTED_STATUS_FILTERS,
  viewport: number,
  opts: { tight: boolean; shortLabels: boolean },
): number {
  const tabs = tabsOf(filters);
  const fontPx = opts.tight ? TAB_FONT.tight : TAB_FONT.loose;
  const gap = opts.tight ? TAB_GAP.tight : TAB_GAP.loose;
  const useShort = opts.shortLabels && viewport < SHORT_LABEL_BELOW_PX;
  let w = 0;
  for (const t of tabs) {
    const word = useShort && t.shortLabel ? t.shortLabel : t.label;
    w += textPx(word, fontPx);
    w += COUNT_GAP + textPx(String(WORST_CASE_COUNT), COUNT_FONT);
  }
  return w + gap * (tabs.length - 1);
}

describe("the Activity status tabs fit a phone", () => {
  it("the inventory is the real bucket list, not a copy of it", () => {
    // VACUITY FLOOR: an empty or hand-typed tab list would make every
    // assertion below true of nothing.
    const posted = tabsOf(POSTED_STATUS_FILTERS);
    expect(posted.length).toBeGreaterThanOrEqual(5);
    expect(posted.map((f) => f.label)).toEqual(
      Object.values(BUCKET_LABEL).filter((l) => posted.some((p) => p.label === l)),
    );
    // Every bucket must offer a short word, or the second layer has holes the
    // widths below cannot see.
    for (const f of posted) {
      expect(f.shortLabel, `${f.key} has no shortLabel`).toBeTruthy();
      expect(f.shortLabel!.length).toBeLessThanOrEqual(f.label.length);
    }
    expect(tabsOf(APPLIED_STATUS_FILTERS).length).toBe(posted.length);
  });

  it("the phone row is wired to both width layers", () => {
    expect(PHONE_IS_TIGHT, "ActivityHeader no longer passes tight={!inlineFilters}").toBe(true);
    expect(
      PHONE_GETS_SHORT_LABELS,
      "ActivityHeader no longer passes f.shortLabel through to the tabs",
    ).toBe(true);
    // The breakpoint constant and the two Tailwind literals must agree, or the
    // swap happens at a width nobody declared. Whether those literals COMPILE
    // to anything is a separate question with its own answer — see "the
    // breakpoint is a rule in the stylesheet" below. This one only says the
    // component and the constant tell the same story.
    expect(TABS).toContain(shortVariantClass("hidden"));
    expect(TABS).toContain(shortVariantClass("inline"));
  });

  it("the row still says so when a label IS past the edge", () => {
    // The third layer, and the reason the double-digit case above is a
    // declared limit rather than a hole: when content really does run past the
    // scroller, the row fades at that edge instead of cutting a word dead at
    // the card's rounded corner. Asserted structurally — jsdom lays nothing
    // out, so the browser pass is what proved it appears at 200/240/260/280
    // and goes away again at 320.
    expect(HEADER, "the tab scroller no longer carries the edge-fade style").toMatch(
      /style=\{tabFadeStyle\}/,
    );
    expect(HEADER, "the fade is no longer driven by a measured edge").toMatch(
      /WebkitMaskImage: gradient/,
    );
    // It must fire on "a label is past the edge", never on the box merely
    // being scrollable: this scroller bleeds the card's own px-5, so
    // scrollWidth counts 20px of trailing padding and a fitted row would fade
    // for nothing.
    expect(
      HEADER,
      "the fade is back to a scrollWidth/clientWidth test, which is true of a row that fits",
    ).not.toMatch(/el\.scrollWidth - el\.clientWidth/);
  });

  for (const viewport of PHONE_WIDTHS) {
    it(`every label is inside the clip at ${viewport}`, () => {
      const clip = clipWidth(viewport);
      for (const [name, filters] of [
        ["posts", POSTED_STATUS_FILTERS],
        ["jobs", APPLIED_STATUS_FILTERS],
      ] as const) {
        const content = contentWidth(filters, viewport, {
          tight: PHONE_IS_TIGHT,
          shortLabels: PHONE_GETS_SHORT_LABELS,
        });
        expect(
          content,
          `${name} @${viewport}: the tab row needs ${content.toFixed(0)}px of content ` +
            `and its scroller clips at ${clip}px. It will still SCROLL, so no overflow ` +
            `guard in this repo can see it — the labels past ${clip}px are simply not on ` +
            `the screen. Take width out of the row (type, gaps, shorter words), do not ` +
            `widen the page.`,
        ).toBeLessThanOrEqual(clip);
      }
    });
  }
});

// ── PART 2: THE OPEN FIELD ──────────────────────────────────────────────────
/**
 * The row's fixed claimants while search is open, parsed from the two files
 * that draw them. The field is what is left, because it is the only flexible
 * item — so this arithmetic IS the field's width.
 */
const ROW_GAP = gapPx(ROW, /flex items-center (gap-(\d+))/, 2);
const CLUSTER_GAP = gapPx(ROW, /flex items-center gap-(\d+) shrink-0/, 1);
/** `triggerWidth: inlineFilters ? "28px" : "44px"` — the phone one. */
const SLOT_PX = (() => {
  const m = HEADER.match(/triggerWidth: inlineFilters \? "(\d+)px" : "(\d+)px"/);
  if (!m) throw new Error("could not parse the header's held-open slot width");
  return Number(m[2]);
})();
/** The status chevron that stays in the cluster while searching: `h-11 w-11`. */
const CHEVRON_PX = (() => {
  const m = HEADER.match(/shrink-0 rounded-ds-md flex items-center justify-center btn-press transition hover:bg-secondary\/60 h-(\d+) w-(\d+)/);
  if (!m) throw new Error("could not parse the search-mode status chevron's box");
  return Number(m[2]) * 4;
})();
/**
 * The visible title's natural width — "My Posts" in the row's 20px display
 * face, measured in the browser at 500 and 520 where it is on screen (82px
 * both times, so it is at its natural width and not against its 40% cap).
 */
const TITLE_PX = 82;
const TITLE_STEPS_ASIDE = /narrowTitleStepsAside: true/.test(HEADER);

const fieldWidth = (viewport: number) => {
  const titleVisible = !(TITLE_STEPS_ASIDE && viewport < NARROW_TITLE_ASIDE_PX);
  return (
    rowWidth(viewport) -
    (titleVisible ? TITLE_PX + ROW_GAP : 0) -
    ROW_GAP -
    (SLOT_PX + CLUSTER_GAP + CHEVRON_PX)
  );
};

describe("the Activity search field stays typable on a phone", () => {
  for (const viewport of [...PHONE_WIDTHS, NARROW_TITLE_ASIDE_PX]) {
    it(`the open field is readable at ${viewport}`, () => {
      const w = fieldWidth(viewport);
      expect(
        w,
        `@${viewport}: the open search field is ${w.toFixed(0)}px wide. The magnifier ` +
          `(pl-9) and the ✕ (pr-10) take 76px of that before a character is drawn, so ` +
          `anything under ${MIN_TYPABLE_FIELD_PX}px cannot show the word being typed — ` +
          `at 76px (the width this row shipped at 320) the ✕ is drawn ON TOP of the ` +
          `magnifier. Every other item on the row is fixed-width, so a new one is always ` +
          `paid for out of the field.`,
      ).toBeGreaterThanOrEqual(MIN_TYPABLE_FIELD_PX);
    });
  }
});

// ── PART 3: THE TABS ARE NAVIGATION, SO THEY SURVIVE AN EMPTY LIST ──────────
describe("an empty Activity list still shows its tabs", () => {
  it("Activity.tsx passes the whole filter list, empty or not", () => {
    const m = PAGE.match(/activeStatusFilters=\{([^}]*)\}/);
    expect(m, "Activity.tsx no longer passes activeStatusFilters at all").not.toBeNull();
    expect(
      m![1].trim(),
      "Activity.tsx is gating the status tabs on whether the list has rows. That is the " +
        "/jobs screen an account with no applications saw on 2026-09-19: a header " +
        "strip holding one magnifier and nothing else, because the title is sr-only on " +
        "the desktop website and the tabs had been removed. The tabs are where you ARE " +
        "in the screen, not an action on its rows.",
    ).toBe("activeStatusFilters");
  });
});

// ── PART 4: THE ROW IS ON THE SCREEN AT ALL, AND ITS BREAKPOINT IS REAL ─────
/**
 * WHAT WIDTH ALONE COULD NOT CATCH, AND WHY THIS FILE NEEDED BOTH.
 *
 * Parts 1–3 measure how much room the five labels need against the room the
 * scroller gives them. All three were GREEN on 2026-09-20 while the owner,
 * signed in on a phone, saw no tab row at all:
 *
 *     375  /posts   chevron aria-expanded="false"   visible tab words: []
 *     414  /posts   chevron aria-expanded="false"   visible tab words: []
 *
 * A width check cannot tell a row that FITS from a row that is NOT RENDERED:
 * in both cases nothing is past the clip edge. Two claims were missing, and
 * they are the two ways a correct measurement can be true of something nobody
 * can see.
 *
 *   (a) THE ROW IS NOT BEHIND A DISCLOSURE AT FIRST PAINT. It used to open
 *       collapsed whenever the live filter was the default one — i.e. on
 *       every arrival. Asserted here on the source, and on a REAL BOX in a
 *       real browser (non-zero `getBoundingClientRect`, both routes, every
 *       bucket, 320/375/414/1440) by
 *       e2e/prod-audit/activity-tabs-visible.spec.ts, which also presses the
 *       chevron afterwards to prove the measurement can still go red.
 *
 *   (b) THE BREAKPOINT IS A RULE IN THE STYLESHEET, not a class name in a
 *       file. `min-[390px]:inline` was in the source, asserted by this very
 *       guard, and compiled to NOTHING — so the owner's five long words were
 *       `display: none` at every width up to 900 and a 414 phone showed
 *       "You / Soon / Cancel". See `shortVariantClass` for the cause: this
 *       file's own assertion string was poisoning Tailwind's extractor.
 *
 * (b) is checked by running the app's REAL Tailwind over the app's REAL
 * content globs and looking for the rule in the output — the same compiler
 * the build uses, not a restatement of what it ought to do.
 */
describe("the status tabs survive first paint, and their breakpoint is a real rule", () => {
  it("the phone disclosure starts OPEN, so arriving on the screen shows the tabs", () => {
    const SEED_RE = /const \[tabsOpenPhone, setTabsOpenPhone\] = useState\(([^)]*)\)/;
    expect(
      HEADER,
      "ActivityHeader no longer seeds the phone disclosure state at all — find the " +
        "useState behind `tabsOpenPhone`.",
    ).toMatch(SEED_RE);
    const seed = HEADER.match(SEED_RE)![1].trim();
    expect(
      seed,
      `ActivityHeader opens the phone status tabs collapsed (useState(${seed})). ` +
        "That is the screen the owner reported on 2026-09-20: plain /posts at 375 and " +
        "414 painted \"My Posts · 🔍 · ⌄\" and no tab row, because the seed was " +
        "`!isDefaultFilter` and the default filter is what every arrival lands on. Note " +
        "the obvious wrong guess, ruled out by measurement that day: it was never about " +
        "the bucket being EMPTY — /jobs' default bucket had rows and hid its tabs too. " +
        "The tabs are navigation; they open with the screen.",
    ).toBe("true");
  });

  /* AND THE OTHER HALF OF (b) IS NOT HERE ON PURPOSE.
     Whether these two classes are RULES rather than names is asserted by
     src/test/arbitraryWidthVariantsCompile.test.ts, which runs the app's real
     Tailwind over the app's real content globs against the WHOLE inventory of
     `min-[Npx]:` / `max-[Npx]:` classes the app writes — these two included,
     since UnderlineTabs is under src/components.
     It lives there rather than here for two reasons. The defect was never
     Activity-specific: one poisoned candidate took 40 classes across ten files
     down at once, and a guard scoped to this row would have reported one
     fortieth of it. And a Tailwind compile is the most expensive thing in the
     vitest suite; doing it twice put this file over its timeout under the full
     parallel run on an 8 GB machine, which is its own kind of false red. */
});
