/**
 * THE ACTIVITY TAB ROW IS ON THE SCREEN — the claim a width cannot make.
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * `src/test/activityTabLabelsFitAPhone.test.ts` measures how much WIDTH the
 * five status labels need against the width their scroller gives them, and it
 * was green on 2026-09-20 while the owner, signed in on a phone, saw this:
 *
 *     375  /posts   header: "My Posts · 🔍 · ⌄"      tab words: []
 *     414  /posts   header: "My Posts · 🔍 · ⌄"      tab words: []
 *
 * Zero tabs. The row was not narrow, it was NOT RENDERED — collapsed behind a
 * chevron at `aria-expanded="false"` — and a guard that measures a row's
 * content width against its clip width cannot tell the difference between a
 * row that fits and a row that does not exist. Both are "no label past the
 * edge". That is the whole defect class: a measurement that is true about an
 * element nobody can see.
 *
 * So this file asserts the two things width alone cannot:
 *
 *   1. VISIBLE WITHOUT INTERACTION. On first paint, with no click, tap or
 *      keypress, the tab group has a real box (`getBoundingClientRect()` with
 *      non-zero width AND height) and no disclosure control is sitting at
 *      `aria-expanded="false"` in front of it. Asserted at 320 / 375 / 414 /
 *      1440, on BOTH /posts and /jobs, and for every one of the five
 *      buckets — the EMPTY ones included, because the two states the owner
 *      hit were an empty bucket on /posts and a POPULATED one on /jobs.
 *      (That pair is also what settled the root cause: emptiness was never
 *      it. The row was hidden whenever the live filter was the DEFAULT one,
 *      full bucket or not.)
 *
 *   2. THE WORD ACTUALLY PAINTED at each width is the one the breakpoint
 *      promises. `SHORT_LABEL_BELOW_PX` says the owner's five long words are
 *      what a 414 phone shows and the short stand-ins belong below 390 — and
 *      on 2026-09-20 the rendered DOM at 414, 500 and 600 all painted "You /
 *      Soon / Cancel". The long labels were `display: none` at EVERY width,
 *      because `min-[390px]:inline` was compiling to no CSS rule at all (see
 *      the note in src/test/activityTabLabelsFitAPhone.test.ts — a template
 *      literal in that very guard was poisoning Tailwind's extractor). The
 *      source said one thing, the browser did another, and only the browser
 *      can referee that.
 *
 * ─── THE VACUITY PROOF, ON THE SAME PAGE AND THE SAME RUN ──────────────────
 * A test that finds a box and calls it visible proves nothing unless it can
 * be shown to find nothing. So on every phone width the spec presses the
 * disclosure chevron ONCE after measuring, which reproduces the exact state
 * the owner reported, and FAILS if the tab group still has a box. The "after"
 * measurement is therefore printed beside a live "before" every time it runs.
 *
 * ─── AND MESSAGES, 2026-09-20 ──────────────────────────────────────────────
 * The inbox had the same shape of defect from the other direction. Its
 * Active/All strip and its magnifier were gated on `conversations.length > 0`
 * — so an EMPTY inbox painted "Messages · ☰" and nothing else, the same
 * "looks broken" screen the owner had just had fixed on /posts. That gate
 * was itself the fix for an earlier report (the thread area jumping when an
 * empty result landed), so the owner ruled on the third option on 2026-09-20:
 * keep the row's height reserved and render the tabs in BOTH outcomes.
 *
 * That ruling makes two claims, and this file proves both with numbers:
 *
 *   (a) the strip and the search trigger are on the screen, without a press,
 *       on a GENUINELY EMPTY inbox — driven with the `admin` seed account,
 *       which owns zero rows in `messages` (checked on prod, 2026-09-20).
 *       The spec asserts that emptiness at run time from the rendered page,
 *       so the day someone messages that account this goes red instead of
 *       passing while testing nothing.
 *
 *   (b) the thread area's first row starts at the SAME y on the empty inbox
 *       as on the populated one. Measured before the fix: 83 against 127 at
 *       375, a 44px step. Asserted as an exact equality, not a tolerance.
 *
 * Read-only against prod: it navigates and (for the vacuity legs only) presses
 * one local disclosure toggle and removes one node from its own page's DOM.
 * It writes no row and changes no account state.
 *
 * Run:
 *   PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit \
 *     activity-tabs-visible
 * Shots land in LH_TABS_SHOTS when set; LH_TABS_SCHEME picks the theme. Per
 * CLAUDE.md they are not evidence until someone has LOOKED:
 * `npm run review:record -- <png> <screen> <checked> <ok|defect>`.
 */
// Shown able to fail on the owner's own report: a status tab that paints no
// word. The labels are the whole subject — the phone row swaps three of five to
// a shortLabel below 390px to fit five tabs, a title and a search button into
// 320-414px, and "it fits" is worthless if the words are gone. Blanking them
// reds "a tab button painted no word at all".
// @mutate src/components/job-card/ActivityHeader.tsx |         label: f.label, |         label: "",
import { test, expect, type Browser, type Page, type TestInfo } from "../prodTest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, sessionFor, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
/* The inbox's own strip, as data — same rule as BUCKET_ORDER below: the words
   this spec expects are the app's, never a copy kept here. */
import { INBOX_TAB_LABEL, INBOX_TAB_ORDER } from "../../src/lib/inboxDefault";
import { SHORT_LABEL_BELOW_PX } from "../../src/lib/shortLabelBreakpoint";
/* The bucket inventory comes from the app's own leaf module — the same list
   ActivityHeader builds its tabs from, never a copy. activityFilters.ts
   re-exports these three; this spec imports the leaf directly because that one
   has no React/runtime dependencies for the e2e tsconfig to pull in. */
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_SHORT_LABEL,
} from "../../src/lib/activityBuckets";

const SHOTS = process.env.LH_TABS_SHOTS;
const SCHEME: "light" | "dark" = process.env.LH_TABS_SCHEME === "dark" ? "dark" : "light";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** The tab group's own accessible name, and the id the phone scroller wears. */
const GROUP = '[role="group"][aria-label="Filter by status"]';

/** The inbox's strip wears its own name. Same shape of control, same claim. */
const INBOX_GROUP = '[role="group"][aria-label="Filter conversations"]';

/** The words the inbox's two tabs paint, in order, at every width. */
const INBOX_WORDS = INBOX_TAB_ORDER.map((k) => INBOX_TAB_LABEL[k]);

/**
 * The two Activity screens, and their buckets — taken from the filter
 * definitions, never restated. A sixth bucket appears here the day it is
 * added, which is the point.
 */
const ROUTES = [
  { name: "posts", url: "/posts" },
  { name: "jobs", url: "/jobs" },
] as const;

/** Both Activity screens offer the same five buckets, in BUCKET_ORDER. */
const BUCKETS = BUCKET_ORDER;

type TabShot = {
  /** The group's box. `null` when the row is not rendered at all. */
  group: { w: number; h: number } | null;
  /** One entry per tab button: the word actually PAINTED and its box. */
  tabs: { word: string; w: number; h: number; selected: boolean }[];
  /** Any status disclosure left closed in front of the row. */
  collapsedBy: string | null;
  /** The count beside the LIVE tab. 0 when the bucket is empty — UnderlineTabs
   *  omits the number entirely at zero rather than printing "0". */
  liveCount: number;
};

/**
 * Read the row as a USER sees it: only boxes that exist, only words that are
 * painted. `display: none` resolves to a zero box and drops the node out of
 * the a11y tree, so "the painted word" is exactly "the accessible name" — the
 * same fact read two ways, which is what keeps WCAG 2.5.3 true at every width
 * without an aria-label.
 */
async function readTabs(page: Page, groupSelector: string = GROUP): Promise<TabShot> {
  return page.evaluate((groupSel) => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const group = document.querySelector<HTMLElement>(groupSel);
    const tabs: { word: string; w: number; h: number; selected: boolean }[] = [];
    if (group) {
      for (const b of Array.from(group.querySelectorAll("button"))) {
        // The label span holds either one bare word or the short/long pair.
        // Whichever variant has a box is the one on the screen.
        const variants = Array.from(b.querySelectorAll<HTMLElement>("span span"));
        let word = "";
        let r: DOMRect | null = null;
        if (variants.length) {
          for (const v of variants) {
            if (getComputedStyle(v).display !== "none") {
              word = (v.textContent || "").trim();
              r = v.getBoundingClientRect();
            }
          }
        } else {
          const only = b.querySelector<HTMLElement>("span");
          word = (only?.textContent || "").trim();
          r = only?.getBoundingClientRect() ?? null;
        }
        tabs.push({
          word,
          w: Math.round(r?.width ?? 0),
          h: Math.round(r?.height ?? 0),
          selected: b.getAttribute("aria-pressed") === "true",
        });
      }
    }
    // A disclosure left CLOSED in front of the row. Named by its own label so
    // a failure says which control is hiding the navigation.
    const closed = Array.from(document.querySelectorAll<HTMLElement>("button[aria-expanded]")).find(
      (b) =>
        b.getAttribute("aria-expanded") === "false" &&
        /status|filter/i.test(b.getAttribute("aria-label") || ""),
    );
    const live = group?.querySelector('button[aria-pressed="true"]');
    const num = live?.querySelector(".tabular-nums");
    return {
      group: box(group),
      tabs,
      collapsedBy: closed ? closed.getAttribute("aria-label") : null,
      liveCount: num ? Number((num.textContent || "0").trim()) || 0 : 0,
    };
  }, groupSelector);
}

function note(info: TestInfo, line: string) {
  info.annotations.push({ type: "tabs-visible", description: line });

  console.log(`[activity-tabs] ${line}`);
}

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

async function authedContext(
  browser: Browser,
  vw: number,
  baseURL: string | undefined,
  /* Whose inbox / activity. Defaults to the populated fixture; the empty-inbox
     legs pass the seed account that owns zero rows in `messages`. */
  session: Session = poster,
) {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: vw, height: vw >= 900 ? 900 : 812 },
    hasTouch: vw < 900,
    colorScheme: SCHEME,
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
        /* signed out: the assertions below fail visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(session) },
  );
  return ctx;
}

async function openActivity(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The header row is what this spec is about, so wait for the row's OWN
  // control rather than the list: an empty bucket never paints a card, and
  // waiting for one would time out on exactly the state under test.
  await page.waitForSelector("[data-search-trigger]", { state: "visible", timeout: 45_000 });
  await page.waitForTimeout(1500);
}

/**
 * THE CLAIM, at one width on one screen: the row is there, with no
 * interaction, and every one of its labels has been painted.
 */
function assertVisible(shot: TabShot, tag: string, expectedTabs: number) {
  expect(
    shot.collapsedBy,
    `${tag}: the status tabs are behind a closed disclosure ("${shot.collapsedBy}"). ` +
      `The tab row is this screen's navigation — which slice of your jobs you are ` +
      `looking at — and on 2026-09-20 a phone opened /posts to "My Posts · 🔍 · ⌄" ` +
      `and nothing else. Navigation is not a thing the user has to discover a chevron ` +
      `to see.`,
  ).toBeNull();
  expect(shot.group, `${tag}: no status tab row in the DOM at all`).not.toBeNull();
  expect(
    shot.group!.w * shot.group!.h,
    `${tag}: the tab row is in the DOM with a ZERO box (${shot.group!.w}×${shot.group!.h}) — ` +
      `rendered, and invisible.`,
  ).toBeGreaterThan(0);
  expect(shot.tabs.length, `${tag}: expected ${expectedTabs} status tabs`).toBe(expectedTabs);
  for (const t of shot.tabs) {
    expect(t.word, `${tag}: a tab button painted no word at all`).not.toBe("");
    expect(
      t.w * t.h,
      `${tag}: the tab "${t.word}" has a zero box — its label is in the DOM but not on ` +
        `the screen.`,
    ).toBeGreaterThan(0);
  }
}

// ── 1. THE OWNER'S OWN REPRO: the plain route, no query string, no press ────
for (const vw of [320, 375, 414, 1440] as const) {
  for (const route of ROUTES) {
    test(`${route.name}: the status tabs are on the screen without a press @${vw}`, async ({
      browser,
    }, info) => {
      const ctx = await authedContext(browser, vw, info.project.use.baseURL);
      const page = await ctx.newPage();
      try {
        await openActivity(page, route.url);
        const shot = await readTabs(page);
        note(
          info,
          `${route.name}@${vw} words=${JSON.stringify(shot.tabs.map((t) => t.word))} ` +
            `box=${shot.group ? `${shot.group.w}×${shot.group.h}` : "none"} ` +
            `collapsedBy=${shot.collapsedBy ?? "—"}`,
        );
        if (SHOTS) {
          await page.screenshot({
            path: join(SHOTS, `${route.name}-${vw}-${SCHEME}-default.png`),
          });
        }
        assertVisible(shot, `${route.name}@${vw}`, BUCKETS.length);

        // ── THE WORD THE BREAKPOINT PROMISES, read off the screen ──────────
        // Below SHORT_LABEL_BELOW_PX the stand-ins; at it and above, the
        // owner's own five words. Asserted per tab against the filter
        // definitions, so neither vocabulary can drift from the other.
        const expectWords = BUCKETS.map((key) =>
          vw < SHORT_LABEL_BELOW_PX ? BUCKET_SHORT_LABEL[key] : BUCKET_LABEL[key],
        );
        expect(
          shot.tabs.map((t) => t.word),
          `${route.name}@${vw}: the words PAINTED are not the ones the breakpoint ` +
            `promises. SHORT_LABEL_BELOW_PX is ${SHORT_LABEL_BELOW_PX}, so ${vw} should ` +
            `show ${vw < SHORT_LABEL_BELOW_PX ? "the short stand-ins" : "the owner's five long words"}. ` +
            `A class name in the source is not a rule in the stylesheet: on 2026-09-20 ` +
            `min-[390px]:inline compiled to nothing and the long words were display:none ` +
            `at every width up to 900.`,
        ).toEqual(expectWords);

        // ── VACUITY: collapse it, and the same measurement must go red ─────
        // This is the state the owner reported, reproduced on the same page in
        // the same run — the "before" beside the "after".
        if (vw < 900) {
          await page.click('button[aria-expanded][aria-label="Hide status filters"]');
          await page.waitForTimeout(250);
          const after = await readTabs(page);
          note(
            info,
            `${route.name}@${vw} VACUITY after one press on the chevron: ` +
              `box=${after.group ? `${after.group.w}×${after.group.h}` : "none"} ` +
              `collapsedBy=${after.collapsedBy ?? "—"}`,
          );
          expect(
            after.group === null || after.collapsedBy !== null,
            `${route.name}@${vw}: pressing the disclosure did NOT take the tab row away, ` +
              `so the visibility assertion above cannot fail and proves nothing.`,
          ).toBe(true);
        }
      } finally {
        await ctx.close();
      }
    });
  }
}

// ── 2. EVERY BUCKET, EMPTY ONES INCLUDED ────────────────────────────────────
/**
 * The root cause was never emptiness — it was the live filter being the
 * DEFAULT one — but "every bucket including the empty ones" is the claim the
 * owner made, and a bucket with no rows is the one state where a screen is
 * most tempted to drop its own navigation. So every bucket is driven, and the
 * run asserts it saw at least one EMPTY one and at least one POPULATED one:
 * a sweep that happened to land only on full buckets would be green for the
 * wrong reason.
 */
test("every bucket on both Activity screens keeps its tabs, empty or full @375", async ({
  browser,
}, info) => {
  const ctx = await authedContext(browser, 375, info.project.use.baseURL);
  const page = await ctx.newPage();
  try {
    let sawEmpty = 0;
    let sawFull = 0;
    for (const route of ROUTES) {
      for (const key of BUCKETS) {
        await openActivity(page, `${route.url}?filter=${key}`);
        const shot = await readTabs(page);
        // "Populated" is read off the row itself, in the SAME DOM snapshot as
        // the boxes above (a second evaluate later races the count query and
        // read numbers that did not match the row on screen). UnderlineTabs
        // omits the count entirely at zero, so a live tab with no number
        // beside it is an empty bucket. Counted ACROSS both screens, because
        // which of the two has rows is a property of the test account on the
        // day, not of the claim: on 2026-09-20 the poster's /posts had
        // rows and its /jobs had none, which is the pair this needs.
        const count = shot.liveCount;
        if (count > 0) sawFull++;
        else sawEmpty++;
        note(
          info,
          `${route.name}?filter=${key} @375 count=${count} ` +
            `box=${shot.group ? `${shot.group.w}×${shot.group.h}` : "none"}`,
        );
        assertVisible(shot, `${route.name}?filter=${key}@375`, BUCKETS.length);
      }
    }
    expect(sawEmpty, "no EMPTY bucket was exercised — the claim is untested").toBeGreaterThan(0);
    expect(sawFull, "no POPULATED bucket was exercised — the claim is untested").toBeGreaterThan(0);
  } finally {
    await ctx.close();
  }
});

// ── 3. MESSAGES: THE ROW IS RESERVED, AND IT IS THERE EITHER WAY ────────────
/**
 * The owner's 2026-09-20 ruling, as two numbers per width.
 *
 * /messages is in this file rather than its own because the claim is the same
 * claim: a tab row that is this screen's navigation must be on the screen
 * without a press. What is different is WHY it could be missing — Activity's
 * row was collapsed behind a disclosure, the inbox's was gated on having
 * threads — and that difference is exactly why the second half of this block
 * exists: emptiness was never the cause on Activity, and it was the whole
 * cause here.
 *
 * The empty inbox is the `admin` seed account (zero rows in `messages` on
 * prod, checked 2026-09-20); the populated one is the shared `poster` fixture
 * (129 rows the same day). Both are first-class accounts here —
 * `PLAYWRIGHT_ADMIN_EMAIL`/`_PASSWORD` are CI secrets and admin-views.spec.ts
 * already drives that account — so neither leg skips.
 */
const INBOX_WIDTHS = [320, 375, 414, 1440] as const;

/** Where the thread area starts, whether it IS empty, and the search trigger. */
async function readInbox(page: Page) {
  return page.evaluate(() => {
    const area = document.querySelector("[data-thread-area]");
    const box = area?.getBoundingClientRect();
    const search = document.querySelector("[data-search-trigger]");
    const sb = search?.getBoundingClientRect();
    return {
      threadAreaTop: box ? Math.round(box.top) : null,
      // The default inbox's empty state paints this and no rows. Read off the
      // page, never assumed from which account is signed in.
      empty: /No messages yet/i.test(document.body.innerText || ""),
      // One per painted thread — ConversationRow's own name element, which
      // exists on every row and nowhere else. Counting rows this way means
      // "is this inbox empty" is read off the SCREEN, not inferred from which
      // account was signed in.
      rows: document.querySelectorAll('[data-testid="row-name"]').length,
      search: sb ? { w: Math.round(sb.width), h: Math.round(sb.height) } : null,
    };
  });
}

async function openInbox(page: Page) {
  await page.goto("/messages", { waitUntil: "domcontentloaded" });
  // Wait for the thread AREA, not a row: on the empty inbox there is no row,
  // and waiting for one would time out on the state under test.
  await page.waitForSelector("[data-thread-area]", { state: "attached", timeout: 45_000 });
  await page.waitForTimeout(2500);
}

let emptyInbox: Session;
test.beforeAll(async ({ request }) => {
  emptyInbox = await sessionFor(request, "admin");
});

for (const vw of INBOX_WIDTHS) {
  test(`messages: the tabs and search are on an EMPTY inbox without a press @${vw}`, async ({
    browser,
  }, info) => {
    const ctx = await authedContext(browser, vw, info.project.use.baseURL, emptyInbox);
    const page = await ctx.newPage();
    try {
      await openInbox(page);
      const inbox = await readInbox(page);
      const shot = await readTabs(page, INBOX_GROUP);
      note(
        info,
        `messages EMPTY @${vw} words=${JSON.stringify(shot.tabs.map((t) => t.word))} ` +
          `box=${shot.group ? `${shot.group.w}×${shot.group.h}` : "none"} ` +
          `search=${inbox.search ? `${inbox.search.w}×${inbox.search.h}` : "none"} ` +
          `threadAreaTop=${inbox.threadAreaTop} empty=${inbox.empty} rows=${inbox.rows}`,
      );
      if (SHOTS) {
        await page.screenshot({ path: join(SHOTS, `messages-empty-${vw}-${SCHEME}.png`) });
      }

      // THE FIXTURE IS THE FIXTURE. Without this the whole test could pass on
      // a populated inbox and prove nothing about the state it is named for.
      expect(
        inbox.rows,
        `@${vw}: the "empty inbox" account is carrying ${inbox.rows} thread rows — ` +
          `this leg is no longer testing an empty inbox. Point it at an account with ` +
          `no rows in \`messages\`, or clear this one.`,
      ).toBe(0);
      expect(
        inbox.empty,
        `@${vw}: the default inbox's empty state ("No messages yet") is not on the page, ` +
          `so this is not the state under test`,
      ).toBe(true);

      assertVisible(shot, `messages EMPTY@${vw}`, INBOX_WORDS.length);
      expect(
        shot.tabs.map((t) => t.word),
        `messages EMPTY@${vw}: the painted words are not the inbox's own tabs`,
      ).toEqual(INBOX_WORDS);

      // The magnifier is the other half of the owner's report: it vanished
      // with the tabs, so an empty inbox offered no way to search either.
      expect(
        inbox.search,
        `messages EMPTY@${vw}: no search trigger on the screen at all`,
      ).not.toBeNull();
      expect(
        inbox.search!.w * inbox.search!.h,
        `messages EMPTY@${vw}: the search trigger has a zero box`,
      ).toBeGreaterThan(0);

      // ── VACUITY, on the same page and the same run ────────────────────
      // /messages has no disclosure to press — the strip is unconditional now,
      // which is the point — so the row is taken away directly and the SAME
      // reader must report its absence. That proves `readTabs` is reading the
      // live row rather than returning a shape that cannot be empty.
      await page.evaluate((sel) => document.querySelector(sel)?.remove(), INBOX_GROUP);
      const after = await readTabs(page, INBOX_GROUP);
      note(
        info,
        `messages EMPTY@${vw} VACUITY after removing the row: ` +
          `box=${after.group ? `${after.group.w}×${after.group.h}` : "none"}`,
      );
      expect(
        after.group,
        `messages EMPTY@${vw}: the reader still found a tab row after the row was removed, ` +
          `so the assertion above cannot fail and proves nothing.`,
      ).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  test(`messages: the thread area starts at the same y empty or populated @${vw}`, async ({
    browser,
  }, info) => {
    const read = async (session: Session, tag: string) => {
      const ctx = await authedContext(browser, vw, info.project.use.baseURL, session);
      const page = await ctx.newPage();
      try {
        await openInbox(page);
        const inbox = await readInbox(page);
        const shot = await readTabs(page, INBOX_GROUP);
        note(
          info,
          `messages ${tag} @${vw} threadAreaTop=${inbox.threadAreaTop} rows=${inbox.rows} ` +
            `tabs=${shot.group ? `${shot.group.w}×${shot.group.h}` : "none"}`,
        );
        if (SHOTS) {
          await page.screenshot({ path: join(SHOTS, `messages-${tag}-${vw}-${SCHEME}.png`) });
        }
        return inbox;
      } finally {
        await ctx.close();
      }
    };

    const empty = await read(emptyInbox, "parity-empty");
    const full = await read(poster, "parity-full");

    // Both sides must be the states they are named for, or the equality below
    // is comparing two copies of the same screen.
    expect(empty.rows, `@${vw}: the empty fixture is carrying thread rows`).toBe(0);
    expect(
      full.rows,
      `@${vw}: the populated fixture painted no thread rows — nothing to compare against`,
    ).toBeGreaterThan(0);
    expect(empty.threadAreaTop, `@${vw}: no thread area on the empty inbox`).not.toBeNull();
    expect(full.threadAreaTop, `@${vw}: no thread area on the populated inbox`).not.toBeNull();

    expect(
      empty.threadAreaTop,
      `@${vw}: the thread area starts at y=${empty.threadAreaTop} on an EMPTY inbox and ` +
        `y=${full.threadAreaTop} on a populated one. Opening Messages and having the list ` +
        `jump by ${Math.abs((empty.threadAreaTop ?? 0) - (full.threadAreaTop ?? 0))}px once ` +
        `the query answers is the original report ("Messages opens different then realized ` +
        `there are no messages and changes the view of the screen"); it measured 44px at 375 ` +
        `before 2026-09-20. The row's height is reserved in both outcomes now, so these two ` +
        `must be the same number — not close, the same.`,
    ).toBe(full.threadAreaTop);
  });
}
