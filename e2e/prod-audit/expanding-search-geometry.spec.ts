/**
 * EVERY EXPANDING SEARCH, MEASURED — the half of the class that only a browser
 * can settle.
 *
 * OWNER, 2026-09-19, two reports that turned out to be one rule:
 *   (1) "search bars should also never open and cover anything anywhere. the
 *        search bar on home opens on the left right on top of the number of
 *        jobs. that's wrong. it needs to open where it was clicked, open
 *        slightly to the left of the icon so it doesn't cover anything"
 *   (2) "on post, the x on search needed to be clicked 3 times to close the
 *        search bar"
 *
 * src/test/searchDismissAndOverlay.test.tsx pins the MECHANISM in jsdom — the
 * dismiss contract, nothing leaving the flow, the screen keeping its name.
 * jsdom has no layout: `getBoundingClientRect()` returns zeros there, so the
 * three assertions below are structurally invisible to it and are owed here:
 *
 *   a. the open field's rect intersects NO sibling's rect in its row;
 *   b. `documentElement.scrollWidth <= clientWidth` with search OPEN — an
 *      expanding field is a width change;
 *   c. the ✕'s rect and the magnifier's POST-CLOSE rect do not overlap. This
 *      is report (2): the state machine was always innocent (one press already
 *      closes and clears), and the whole defect was that the magnifier came
 *      back UNDER the finger that had just dismissed it. Close, re-open,
 *      close — three taps for one intent.
 *
 * THE VACUITY GUARD IS THE POINT OF (c), not decoration. A test that measures
 * two boxes and finds them apart proves nothing unless it can be shown to find
 * them together. So every surface is measured TWICE: once as shipped, and once
 * with the magnifier's held-open landing slot (`[data-search-trigger-slot]`,
 * see SearchTriggerSlot in ScreenHeaderRow) deleted from the live DOM. The
 * second pass reproduces the pre-fix geometry exactly — same page, same
 * styles, one element removed — and the spec FAILS if the overlap does not
 * come back. That number is the "before" beside the "after", on the same run.
 *
 * MEASURED 2026-09-19, Chromium, prod Supabase + this checkout's local build
 * (✕ vs the magnifier's landing box, shipped → with the slot deleted):
 *
 *   my-posts       320  0px ← 26px      my-jobs   320  0px ← 26px
 *                  375  0px ← 26px                375  0px ← 26px
 *                 1440  0px ←  6px               1440  0px ←  6px
 *   messages       320  0px ← 28px      legal      320  0px ← 44px
 *                  375  0px ← 26px                 375  0px ← 44px
 *                 1440  0px ← 26px                1440  0px ← 44px
 *   saved-helprs   320/375/1440  0px ← 28px
 *   browse-strip  1440  0px ← 28px
 *
 * Read-only against prod: navigates, presses search, presses the dismiss.
 * Writes no row and toggles no account state.
 *
 * Run:
 *   PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit \
 *     expanding-search-geometry
 * Shots land in LH_SEARCH_SHOTS when set, LH_SEARCH_SCHEME picks the theme.
 * Per CLAUDE.md they are not evidence until someone has LOOKED:
 * `npm run review:record -- <png> <screen> <checked> <ok|defect>`.
 */
// Shown able to fail on clause (a) and (b) together: the open field must take
// FREE space, never a sibling's, and must not push the page. `min-w-0` on the
// search wrapper is what lets it shrink inside its flex row; demanding 900px
// instead makes it both steal from its siblings and hang off the right edge.
// @mutate src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx | relative flex-1 min-w-0 lg:max-w-md | relative flex-1 min-w-[900px] lg:max-w-md
// Q143: the Messages field below 360 must open on its own line with the row at
// rest. Un-holding the chevron's box below 360 moves the hamburger on open
// (measured 187 -> 235, the first run of this clause).
// @mutate src/components/messages/ConversationList.tsx | <div aria-hidden className="shrink-0 pointer-events-none w-11 self-stretch" /> | <div aria-hidden className="shrink-0 pointer-events-none w-11 self-stretch max-[359px]:hidden" />

import { test, expect, type Page, type Browser, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
/* The floor is the app's own constant, not a number restated here — see
   MIN_TYPABLE_FIELD_PX for what it is and the widths it was derived from. */
import { MIN_TYPABLE_FIELD_PX } from "../../src/lib/searchFieldFloor";

const SHOTS = process.env.LH_SEARCH_SHOTS;
/**
 * Light or dark. Geometry is theme-independent, but LOOKING at it is not
 * (CLAUDE.md: verify every visual change by an actual screenshot, both
 * themes), and a wash that only reads in one of them is exactly the kind of
 * defect a measurement cannot see. Run the suite twice, once per scheme.
 */
const SCHEME: "light" | "dark" = process.env.LH_SEARCH_SCHEME === "dark" ? "dark" : "light";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

type Rect = { x: number; y: number; w: number; h: number; label: string };

/**
 * A surface whose field opens on its OWN LINE below a width (Messages below
 * 360, Q143): `lineSel` is that line, `clusterSel` a control in the header
 * row's trailing cluster that must not move while the field is open.
 */
type OwnLine = { lineSel: string; clusterSel: string };

/** Overlap of two rects in px, 0 when they do not intersect. */
function overlap(a: Rect, b: Rect): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
    y: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)),
  };
}

/**
 * Record a measurement on the test AND print it.
 *
 * Annotations alone are only visible in the HTML report, and the numbers here
 * are the whole point of the run — "a fix is not done until its own number
 * moves" needs the number in the run's own output, beside the old one.
 */
function note(info: TestInfo, a: { type: string; description: string }) {
  info.annotations.push(a);
   
  console.log(`[search-geometry] ${a.type}  ${a.description}`);
}

/**
 * Read a control's box in the page. Returns null when it is not there, which
 * every caller treats as a hard failure rather than a skip — a surface whose
 * trigger cannot be found has not been measured, and saying so is the
 * difference between a green run and a covered one.
 */
async function rectOf(page: Page, selector: string, label: string): Promise<Rect | null> {
  return page.evaluate(
    ({ sel, lbl }) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height, label: lbl };
    },
    { sel: selector, lbl: label },
  );
}

/**
 * The open field's row siblings.
 *
 * `rowSel` names the header ROW explicitly, because walking up from the input
 * to "the first flex ancestor" is wrong on two of the six surfaces: both
 * BrowseSearchBar and the Saved-Helprs field wrap the input in their own inner
 * flex box, so the walk stopped one level too early and reported ZERO siblings
 * — an empty set that (a) then passed over. An empty set is exactly the shape
 * a vacuous check takes, so the caller must declare it deliberately
 * (`soloRow`) rather than receive it by accident.
 */
async function fieldAndSiblings(page: Page, fieldSelector: string, rowSel?: string) {
  return page.evaluate(
    ({ sel, row: rowSelector }) => {
      const field = document.querySelector<HTMLElement>(sel);
      if (!field) return null;
      const row = rowSelector
        ? document.querySelector<HTMLElement>(rowSelector)
        : (() => {
            let n: HTMLElement = field;
            while (n.parentElement && !getComputedStyle(n.parentElement).display.includes("flex")) {
              n = n.parentElement;
              if (n === document.body) return null;
            }
            return n.parentElement;
          })();
      if (!row || !row.contains(field)) return null;
      // The row CHILD that contains the field — that is the flex item the
      // siblings are measured against, whatever depth the input sits at.
      const item = Array.from(row.children).find((c) => c.contains(field)) as HTMLElement | undefined;
      if (!item) return null;
      const box = (el: Element, label: string) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, label };
      };
      const siblings = Array.from(row.children)
        .filter((c) => c !== item)
        .map((c, i) => {
          const isSlot = (c as HTMLElement).hasAttribute("data-search-trigger-slot");
          const text = (c.textContent || "").trim().slice(0, 24);
          return box(c, `${c.tagName.toLowerCase()}#${i}:${isSlot ? "SLOT" : text || "icon"}`);
        })
        .filter((r) => r.w > 0 && r.h > 0);
      return { item: box(item, "field"), siblings };
    },
    { sel: fieldSelector, row: rowSel },
  );
}

async function overflowOf(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    /**
     * `scrollWidth` alone cannot see clause (b), and the reason is our own CSS.
     * `src/index.css` sets `body { overflow-x: hidden }` to absorb the 1-2px the
     * .full-bleed -50vw trick spills, which also stops documentElement.scrollWidth
     * growing. Measured 2026-09-21 in mobile-viewports: a deliberately 1400px-wide
     * element left the identical comparison reading equal at every width.
     *
     * That matters most HERE, because "an expanding field is a width change" is
     * the entire reason this file exists — the one clause it could not have
     * detected. A bounding rect ignores an ancestor's clip, which is the second
     * half of CLAUDE.md's proof-of-fit rule and what `measureLayout` in
     * auditRoutes.ts has always used as `overflowOffenders`.
     */
    pastRightEdge: (() => {
      const vw = window.innerWidth;
      const out: string[] = [];
      // An ancestor that legitimately clips or SCROLLS on the x-axis makes a
      // child past the right edge correct, not a defect — a side-scrolling tab
      // strip is the common case. Same walk `measureLayout` in auditRoutes.ts
      // uses for `clippedWideElements`, and omitting it produced a false
      // positive on /my-posts@320 (the Cancelled tab of an overflow-x-auto
      // strip, right=326 of a 320px viewport) before this was added.
      const clipped = (e: Element): boolean => {
        let p = e.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
          p = p.parentElement;
        }
        return false;
      };
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>("button, a, input, h1, h2, h3, p, li, label"),
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.display === "none") continue;
        if (clipped(el)) continue;
        if (r.right > vw + 2 && r.left < vw) {
          out.push(`<${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}> right=${Math.round(r.right)} > ${vw}`);
          if (out.length >= 5) break;
        }
      }
      return out;
    })(),
  }));
}

/**
 * One surface, one viewport, the whole contract.
 *
 * `triggerSel` must resolve to the MAGNIFIER in its resting place and
 * `closeSel` to the ✕ inside the open field.
 */
async function assertSurface(
  page: Page,
  info: TestInfo,
  opts: {
    name: string;
    vw: number;
    triggerSel: string;
    fieldSel: string;
    closeSel: string;
    rowSel?: string;
    soloRow?: string;
    minFieldPx?: number;
    ownLine?: OwnLine;
  },
) {
  const { name, vw, triggerSel, fieldSel, closeSel, soloRow, minFieldPx, ownLine } = opts;
  // On an own-line width the field's row IS its line, and it is alone there
  // by design (see OwnLine).
  const rowSel = ownLine ? ownLine.lineSel : opts.rowSel;
  const tag = `${name}@${vw}${ownLine ? "(own line)" : ""}`;
  const restCluster = ownLine ? await rectOf(page, ownLine.clusterSel, "cluster(rest)") : null;
  if (ownLine) expect(restCluster, `${tag}: no ${ownLine.clusterSel} in the header row at rest`).not.toBeNull();

  // ── the magnifier at rest. This is the rect (c) is measured against. ──
  const closedTrigger = await rectOf(page, triggerSel, "trigger(closed)");
  expect(closedTrigger, `${tag}: no search trigger found — this surface was NOT measured`).not.toBeNull();

  const beforeOverflow = await overflowOf(page);
  expect(
    beforeOverflow.scrollWidth,
    `${tag}: the page already overflows horizontally BEFORE search opens`,
  ).toBeLessThanOrEqual(beforeOverflow.clientWidth);
  expect(
    beforeOverflow.pastRightEdge,
    `${tag}: content already past the right edge BEFORE search opens (see overflowOf)`,
  ).toEqual([]);

  await page.click(triggerSel);
  await page.waitForSelector(fieldSel, { state: "visible", timeout: 10_000 });
  // The open animation is a width transition; measure it settled.
  await page.waitForTimeout(450);

  // ── (b) an expanding field is a width change ──
  const openOverflow = await overflowOf(page);
  expect(
    openOverflow.scrollWidth,
    `${tag}: documentElement.scrollWidth ${openOverflow.scrollWidth} > clientWidth ${openOverflow.clientWidth} with search OPEN`,
  ).toBeLessThanOrEqual(openOverflow.clientWidth);
  expect(
    openOverflow.pastRightEdge,
    `${tag}: content past the right edge with search OPEN. body{overflow-x:hidden} hides ` +
      `this from scrollWidth, so it is measured per element — see overflowOf.`,
  ).toEqual([]);

  // ── (a) the field takes free space, never a sibling's ──
  const geom = await fieldAndSiblings(page, fieldSel, rowSel);
  expect(geom, `${tag}: could not resolve the field's row`).not.toBeNull();
  // VACUITY FLOOR. A row with no siblings cannot demonstrate "covers nothing",
  // so an empty set has to be DECLARED (`soloRow`, with the reason), never
  // received by accident from a mis-resolved row.
  expect(
    geom!.siblings.length > 0 || !!soloRow || !!ownLine,
    `${tag}: the open field has no measurable siblings and this surface did not declare soloRow — (a) would pass over an empty set. Fix rowSel.`,
  ).toBe(true);
  const intersecting = geom!.siblings.filter((s) => {
    const o = overlap(geom!.item as Rect, s as Rect);
    return o.x > 0.5 && o.y > 0.5;
  });
  note(info, {
    type: tag,
    description: `field ${Math.round(geom!.item.x)}…${Math.round(geom!.item.x + geom!.item.w)}; ${geom!.siblings.length} sibling(s): ${geom!.siblings
      .map((s) => `${s.label} ${Math.round(s.x)}…${Math.round(s.x + s.w)}`)
      .join(" | ")}`,
  });
  expect(
    intersecting.map((s) => s.label),
    `${tag}: the open field is drawn over ${intersecting.length} sibling(s) in its row`,
  ).toEqual([]);

  // ── (c) the ✕ and the magnifier's post-close rect ──
  const closeRect = await rectOf(page, closeSel, "close");
  expect(closeRect, `${tag}: the open field has no dismiss ✕ — it cannot be left`).not.toBeNull();

  const shipped = overlap(closeRect!, closedTrigger!);
  const shippedOverlapPx = Math.min(shipped.x, shipped.y) > 0 ? shipped.x : 0;

  // THE VACUITY PROOF, on the same page: delete the held-open landing slot and
  // the pre-fix geometry comes straight back. If it does not, this assertion
  // is measuring something that cannot move and must not be believed.
  const withoutSlot = await page.evaluate(
    ({ closeSelector }) => {
      const slots = Array.from(document.querySelectorAll<HTMLElement>("[data-search-trigger-slot]"));
      if (slots.length === 0) return { slotCount: 0, rect: null };
      const restore = slots.map((s) => ({ el: s, next: s.nextSibling, parent: s.parentElement }));
      slots.forEach((s) => s.remove());
      // Force layout, read, then put every slot back exactly where it was.
      const el = document.querySelector<HTMLElement>(closeSelector);
      const r = el ? el.getBoundingClientRect() : null;
      const rect = r ? { x: r.x, y: r.y, w: r.width, h: r.height, label: "close(no slot)" } : null;
      restore.forEach(({ el: s, next, parent }) => parent?.insertBefore(s, next));
      return { slotCount: slots.length, rect };
    },
    { closeSelector: closeSel },
  );

  note(info, {
    type: `${tag} (c)`,
    description:
      `✕ ${Math.round(closeRect!.x)}…${Math.round(closeRect!.x + closeRect!.w)} vs trigger ` +
      `${Math.round(closedTrigger!.x)}…${Math.round(closedTrigger!.x + closedTrigger!.w)} ` +
      `→ ${Math.round(shippedOverlapPx)}px` +
      (withoutSlot.rect
        ? `; with the landing slot removed → ${Math.round(
            overlap(withoutSlot.rect as Rect, closedTrigger!).x,
          )}px`
        : "; NO landing slot on this surface"),
  });

  expect(
    Math.round(shippedOverlapPx),
    `${tag}: the ✕ overlaps the box the magnifier comes back to by ${Math.round(
      shippedOverlapPx,
    )}px — one press to dismiss lands the next press on re-open`,
  ).toBe(0);

  expect(
    withoutSlot.slotCount,
    `${tag}: no [data-search-trigger-slot] in the open row. Either this surface never got the fix, or the marker moved — either way (c) above is unfalsifiable here.`,
  ).toBeGreaterThan(0);
  if (ownLine) {
    // OWN-LINE WIDTHS. The ✕ is on the line UNDER the magnifier's row, so (c)
    // holds by construction and the slot's job here is different: it keeps
    // the row at rest, so the hamburger/chevron do not slide while the field
    // is open and the magnifier returns where it was pressed. Proved three
    // ways, each able to fail:
    //   1. the field is BELOW the magnifier's row, not in it;
    //   2. the cluster sits exactly where it sat at rest;
    //   3. deleting the slot moves the cluster (so 2 measures the slot).
    const field = geom!.item;
    note(info, {
      type: `${tag} (own line)`,
      description: `field top ${Math.round(field.y)} vs magnifier bottom ${Math.round(closedTrigger!.y + closedTrigger!.h)}`,
    });
    expect(
      Math.round(field.y),
      `${tag}: the field is not on its own line — its top (${Math.round(field.y)}) is above the magnifier row's bottom`,
    ).toBeGreaterThanOrEqual(Math.round(closedTrigger!.y + closedTrigger!.h) - 1);
    const openCluster = await rectOf(page, ownLine.clusterSel, "cluster(open)");
    expect(
      [Math.round(openCluster!.x), Math.round(openCluster!.y)],
      `${tag}: the header cluster moved when search opened on its own line`,
    ).toEqual([Math.round(restCluster!.x), Math.round(restCluster!.y)]);
    // The held slot IS the magnifier's box: it starts exactly where the
    // magnifier did, and deleting it moves the cluster's leading edge (so the
    // equality is a measurement of the slot, not of a row that cannot move).
    // Measured 2026-09-23 when the chevron's box was not held below 360: the
    // hamburger jumped 187 -> 235 on open, which the check above caught.
    const slotEdge = await page.evaluate(() => {
      const slot = document.querySelector<HTMLElement>("[data-search-trigger-slot]");
      const cluster = slot?.parentElement;
      if (!slot || !cluster) return null;
      const withSlot = slot.getBoundingClientRect().x;
      const next = slot.nextSibling;
      slot.remove();
      const clusterNoSlot = cluster.getBoundingClientRect().x;
      cluster.insertBefore(slot, next);
      return { withSlot, clusterNoSlot };
    });
    expect(slotEdge, `${tag}: no held slot in the header row`).not.toBeNull();
    expect(
      Math.round(slotEdge!.withSlot),
      `${tag}: the held slot does not sit where the magnifier was — it comes back somewhere else`,
    ).toBe(Math.round(closedTrigger!.x));
    expect(
      Math.abs(Math.round(slotEdge!.clusterNoSlot - slotEdge!.withSlot)),
      `${tag}: deleting the held slot did not move the cluster's leading edge, so the check above proves nothing about the slot`,
    ).toBeGreaterThan(0);
  } else {
    const regressed = overlap(withoutSlot.rect as Rect, closedTrigger!);
    expect(
      Math.round(regressed.x),
      `${tag}: removing the landing slot did NOT bring the overlap back, so the 0px above proves nothing about the slot. Re-derive the geometry before believing this check.`,
    ).toBeGreaterThan(0);
  }

  // ── (d) THE FIELD IS WIDE ENOUGH TO READ WHAT YOU TYPED ───────────────────
  //
  // (a) proves the field covers nothing and (c) proves the ✕ clears the
  // magnifier — and BOTH were true, on every surface, of a field 42px wide.
  // Measured on 2026-09-19 at 320: my-posts 76px, my-jobs 76px, messages 42px,
  // with the magnifier (pl-9) and the ✕ (pr-10) claiming 76px before a
  // character is drawn. "oak tree" typed into the 375 field rendered as "ree".
  //
  // The field is the ONLY flexible item on these rows — the title, the
  // held-open slot, the icon cluster and the gaps are all fixed — so it is
  // where every new claimant's width comes from, silently. That is the class
  // this assertion exists for, and neither (a) nor (c) can see it.
  const fieldFloor = minFieldPx ?? MIN_TYPABLE_FIELD_PX;
  note(info, { type: `${tag} (d)`, description: `field ${Math.round(geom!.item.w)}px vs floor ${fieldFloor}px` });
  expect(
    Math.round(geom!.item.w),
    `${tag}: the open search field is ${Math.round(geom!.item.w)}px wide, under the ${fieldFloor}px ` +
      `floor. 76px of it is the magnifier and the ✕, so what is left cannot show the word being ` +
      `typed. Take the width out of a FIXED item on the row — the visible title is the one that ` +
      `yields on a phone (ScreenHeaderRow's narrowTitleStepsAside) — never out of the field.`,
  ).toBeGreaterThanOrEqual(fieldFloor);

  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, `${name}-${vw}-${SCHEME}-open.png`), fullPage: false });
  }

  // ── ONE press out, and the magnifier comes back where it was ──
  await page.click(closeSel);
  await page.waitForTimeout(400);
  expect(
    await page.locator(fieldSel).count(),
    `${tag}: ONE press of the ✕ must close the field`,
  ).toBe(0);

  const reopened = await rectOf(page, triggerSel, "trigger(reopened)");
  expect(reopened, `${tag}: the magnifier did not come back after the dismiss`).not.toBeNull();
  expect(
    [Math.round(reopened!.x), Math.round(reopened!.w)],
    `${tag}: the magnifier came back somewhere else — the row moved under the user`,
  ).toEqual([Math.round(closedTrigger!.x), Math.round(closedTrigger!.w)]);

  // Focus returns to the control that opened it, on every surface.
  const focused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? "",
    isBody: document.activeElement === document.body,
    label: document.activeElement?.getAttribute("aria-label") ?? "",
  }));
  expect(
    focused.isBody,
    `${tag}: the dismiss dropped focus on <body> — the caret must return to the magnifier (got ${focused.tag} "${focused.label}")`,
  ).toBe(false);

  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, `${name}-${vw}-${SCHEME}-closed.png`), fullPage: false });
  }
}

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

async function authedContext(browser: Browser, vw: number, baseURL: string | undefined) {
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
        /* signed out: the trigger assertion below fails visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
  );
  return ctx;
}

/**
 * THE INVENTORY, as routes. It mirrors REVIEWED_EXPANDING_SEARCHES in
 * src/test/searchDismissAndOverlay.test.tsx — that file derives the FILE list
 * from source and fails when it drifts; this one drives the SCREENS those
 * files render. A new expanding search fails there first, which is the prompt
 * to add it here.
 *
 * `minWidth` marks the surfaces that only exist above a breakpoint: the Browse
 * desktop feed strip is gated on useIsWebDesktop (min-width 900px, non-native),
 * so at 320/375 there is no strip and nothing to cover.
 */
const SURFACES: {
  name: string;
  url: string;
  ready: string;
  triggerSel: string;
  fieldSel: string;
  closeSel: string;
  /** The header ROW, when the field's own wrapper is not a direct child of it. */
  rowSel?: string;
  /** Why this field legitimately has no row siblings. Declared, never inferred. */
  soloRow?: string;
  minWidth?: number;
  /**
   * A field floor BELOW MIN_TYPABLE_FIELD_PX, for a surface that has not been
   * fixed yet. Declared with its reason and its open-work line, never a quiet
   * exemption: the number is the measurement this surface is pinned at, so it
   * can get worse and this spec will say so.
   */
  minFieldPx?: number;
  /** Below this width the field opens on its OWN LINE under the header row. */
  ownLine?: OwnLine & { belowPx: number };
}[] = [
  {
    name: "browse-desktop-strip",
    url: "/dashboard",
    /* Scoped to the feed strip itself. Home's LOADING screen renders a
       DashboardTitleBar carrying its own `[data-search-trigger]` at every
       width, so an unscoped wait resolved against the skeleton and measured a
       row no user ever interacts with (seen: trigger at x49 while the real
       strip's sits at x463). */
    ready: "[data-feed-strip] [data-search-trigger]",
    triggerSel: "[data-feed-strip] [data-search-trigger]",
    fieldSel: '[data-feed-strip] input[aria-label="Search jobs"]',
    closeSel: '[data-feed-strip] button[aria-label="Close search"]',
    // BrowseSearchBar wraps its input in an inner flex box, so the strip has
    // to be named or the walk stops inside the field itself.
    rowSel: "[data-feed-strip]",
    minWidth: 900,
  },
  {
    name: "my-posts",
    url: "/my-posts",
    ready: "[data-search-trigger]",
    triggerSel: "[data-search-trigger]",
    fieldSel: 'input[aria-label="Search jobs"]',
    closeSel: 'button[aria-label="Close search"]',
  },
  {
    name: "my-jobs",
    url: "/my-jobs",
    ready: "[data-search-trigger]",
    triggerSel: "[data-search-trigger]",
    fieldSel: 'input[aria-label="Search jobs"]',
    closeSel: 'button[aria-label="Close search"]',
  },
  {
    name: "messages",
    url: "/messages",
    ready: "[data-search-trigger]",
    triggerSel: "[data-search-trigger]",
    fieldSel: 'input[aria-label="Search conversations"]',
    closeSel: 'button[aria-label="Close search"]',
    /* Q143 (owner, 2026-09-23, Q48 option D): below 360 the field opens on its
       own line, where the Active/All strip sits. At 320 in the row it was
       90px against the 120px floor with the slot held, and the ✕ sat 28px
       over the magnifier without it. 375 and up: the row, as before. */
    ownLine: {
      belowPx: 360,
      lineSel: "[data-search-own-line]",
      clusterSel: 'button[aria-label="Conversation list options"]',
    },
  },
  {
    name: "saved-helprs",
    url: "/profile?tab=saved_helpers",
    ready: "[data-search-trigger]",
    triggerSel: "[data-search-trigger]",
    fieldSel: 'input[aria-label="Search saved Helprs"]',
    closeSel: 'button[aria-label="Close search"]',
    soloRow:
      "the Saved-Helprs field is a full-width row of its own under ProfileTabHeader — it has no row neighbours to cover, and its magnifier sits in the header above it. (a) is therefore vacuous here BY DESIGN; (b) and (c) still carry the surface.",
  },
  {
    name: "legal",
    url: "/legal",
    ready: 'button[aria-label="Search all policies"]',
    triggerSel: 'button[aria-label="Search all policies"]',
    fieldSel: 'input[aria-label="Search all policies"]',
    closeSel: 'button[aria-label="Close search"]',
    /* NO LONGER PINNED BELOW THE FLOOR — FIXED 2026-09-20.
       This carried `minFieldPx: 107`, a pin that recorded the defect instead
       of failing on it: at 320 the open field was 107px against the 120px
       floor, and the Terms/Rules/Privacy tab group beside it was 107px for
       ~170px of label, so all three tab names overlapped into one smear. Both
       are `flex-1`, so the shortfall was split and both lost.
       `tabBar` now steps the tab group aside below 500px while the field is
       open — the same behaviour as ActivityHeader, for a stronger reason: a
       live query renders all three policies at once, so the tabs are inert
       exactly then. Measured after, on the production build against prod, in
       both themes: 320 → 107px becomes 222px; 375 → 135px becomes 277px; 1440
       unchanged at 320px, because there the tabs stay and nothing moved.
       The surface therefore takes the SHARED floor now, like every other row
       here: no `minFieldPx` override, so `MIN_TYPABLE_FIELD_PX` applies and a
       regression below 120 fails instead of being recorded. */
  },
];

for (const vw of [320, 375, 1440] as const) {
  for (const surface of SURFACES) {
    const skip = !!surface.minWidth && vw < surface.minWidth;
    test(`${surface.name}: the field covers nothing and the ✕ clears the magnifier @${vw}`, async ({ browser }, info) => {
      test.skip(skip, `${surface.name} does not render at ${vw}`);
      const ctx = await authedContext(browser, vw, info.project.use.baseURL);
      const page = await ctx.newPage();
      try {
        await page.goto(surface.url, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(surface.ready, { state: "visible", timeout: 45_000 });
        await page.waitForTimeout(700);
        await assertSurface(page, info, {
          name: surface.name,
          vw,
          triggerSel: surface.triggerSel,
          fieldSel: surface.fieldSel,
          closeSel: surface.closeSel,
          rowSel: surface.rowSel,
          soloRow: surface.soloRow,
          minFieldPx: surface.minFieldPx,
          ownLine: surface.ownLine && vw < surface.ownLine.belowPx ? surface.ownLine : undefined,
        });
      } finally {
        await ctx.close();
      }
    });
  }
}
