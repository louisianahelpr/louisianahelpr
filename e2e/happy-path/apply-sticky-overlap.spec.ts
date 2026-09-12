import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

// THE SUBMIT ROW MUST NOT SIT ON TOP OF THE THING ABOVE IT.
//
// The apply step's submit row carries `.sheet-sticky-actions` — `position:
// sticky; bottom: 0` plus a negative bottom margin that cancels the scroll
// container's own bottom padding. That treatment is built for a sheet that
// OVERFLOWS, and it is actively wrong on one that fits:
//
//   the negative margin makes the container compute its content ~20px shorter
//   than the row actually renders. On a scrolling sheet that is harmless (20px
//   less scrollable content). On a sheet that FITS, the container's height
//   comes from that short measurement — so the row no longer fits inside it,
//   and `bottom: 0` does what it is told and drags the row UP, over whatever
//   is above it.
//
// Measured on the merged job sheet at 1440x994 before the fix: the payout-gate
// notice ("You can apply — but you can't be hired yet") ended at y=703.5 and
// the submit row began at y=697.5. A 6px overlap, which squared off the
// notice's bottom corners — on the one screen that exists to explain why a
// helper cannot be hired yet (owner, 2026-09-11: "the you can apply button is
// cut off by apply"). The same mismatch left dead space under the button,
// which was the second half of the same report.
//
// The comment on `.sheet-sticky-actions` in index.css asserted this "costs
// nothing when the sheet fits". It cost 6px. The claim had never been
// measured — which is the whole reason this spec exists: a vertical overlap
// is invisible to the horizontal-fit spec next door (apply-dialog-fit),
// invisible to a screenshot diff of the dialog BOX, and invisible to jsdom,
// which does no layout at all.
//
// The fixture's helper profile has no `stripe_account_id`, so
// useAwardBlockReason returns "helper_payout_setup_incomplete" and the notice
// renders — i.e. this is the default state of the harness, not a contrived one.

const BASE_JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  // Must not be FAKE_HELPER.id or the feed filters the card out as "your own job".
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving",
  budget: 100,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00",
  location: "New Orleans, LA",
  status: "open",
  payment_status: "escrow",
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_urgent: false,
  urgent_fee: 0,
  is_flexible_schedule: false,
  is_recurring: false,
  is_group_job: false,
  helpers_needed: 1,
  estimated_hours: 1,
  special_requirements: null,
  photos: [],
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  boosted_at: null,
  boost_expires_at: null,
  recurrence_interval: null,
  recurrence_end_date: null,
  parent_job_id: null,
  helper_id: null,
};

const POSTER_PROFILE = {
  user_id: BASE_JOB.customer_id,
  full_name: "Jane Poster",
  avatar_url: null,
  subscription_tier: "free",
  subscription_expires_at: null,
};

/**
 * Walks the apply body's own children and reports any pair of CONSECUTIVE
 * siblings whose boxes overlap vertically.
 *
 * Scoped to consecutive siblings on purpose: a dialog legitimately contains
 * overlapping boxes (the absolutely-positioned close button over the header,
 * the category stripe bleeding into the padding gutter). Two siblings in a
 * flex column overlapping each other is never legitimate — that is a layout
 * failure by definition.
 */
const MEASURE_OVERLAP = `(() => {
  const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
  const dlg = dialogs[dialogs.length - 1];
  if (!dlg) return { error: "dialog not open" };

  const row = dlg.querySelector(".sheet-sticky-actions")
    || [...dlg.querySelectorAll("div")].find((d) =>
         [...d.children].some((c) => c.tagName === "BUTTON" && /apply now|book now/i.test(c.textContent || "")));
  if (!row) return { error: "submit row not found" };

  const parent = row.parentElement;
  const kids = [...parent.children].filter((c) => {
    const cr = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    // Ignore zero-boxes and anything absolutely positioned / display:contents —
    // neither participates in the column's vertical flow.
    return cr.height > 0 && cs.position !== "absolute" && cs.position !== "fixed";
  });

  // A sticky element's rect is its flow position PLUS the lift \`bottom: 0\`
  // applies, and that lift is the whole point of a sticky footer: content
  // passes under it as you scroll. Measuring the lifted rect here would call
  // every sticky footer in existence an overlap. So a sticky box is measured
  // at its STATIC position — which is exactly what the desktop bug was about:
  // there the row was lifted inside a container that had been measured too
  // short, i.e. its FLOW was wrong. What the lift OCCLUDES is asserted
  // separately, below.
  //
  // The static position is read by neutralising \`position\` for one synchronous
  // layout and putting it straight back — \`offsetTop\` is NOT an alternative,
  // it reports the used (lifted) position for a sticky box, which is how this
  // helper was wrong on its first draft.
  const boxOf = (el) => {
    if (getComputedStyle(el).position !== "sticky") {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }
    const prev = el.style.position;
    el.style.position = "static";
    const r = el.getBoundingClientRect();
    el.style.position = prev;
    return { top: r.top, bottom: r.bottom };
  };

  const overlaps = [];
  for (let i = 1; i < kids.length; i++) {
    const prev = boxOf(kids[i - 1]);
    const cur = boxOf(kids[i]);
    // Positive = the current box starts ABOVE where the previous one ended.
    const overlap = prev.bottom - cur.top;
    if (overlap > 0.5) {
      overlaps.push({
        overlapPx: +overlap.toFixed(1),
        prevText: (kids[i - 1].textContent || "").trim().slice(0, 60),
        prevBottom: +prev.bottom.toFixed(1),
        curText: (kids[i].textContent || "").trim().slice(0, 60),
        curTop: +cur.top.toFixed(1),
        curCls: (typeof kids[i].className === "string" ? kids[i].className : "").slice(0, 120),
      });
    }
  }

  const scroller = (() => {
    let el = row.parentElement;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return el;
      el = el.parentElement;
    }
    return null;
  })();

  const rowRect = row.getBoundingClientRect();
  const btn = row.querySelector("button");
  const btnRect = btn ? btn.getBoundingClientRect() : null;

  return {
    overlaps,
    sheetScrolls: scroller ? scroller.scrollHeight - scroller.clientHeight > 1 : false,
    rowIsSticky: getComputedStyle(row).position === "sticky",
    // Space between the button's bottom edge and the sheet's inner bottom edge.
    // This is the "extra space under Apply Now" half of the same report.
    gapUnderButton: scroller && btnRect
      ? +(scroller.getBoundingClientRect().bottom - btnRect.bottom).toFixed(1)
      : null,
    noticePresent: !!dlg.querySelector('[role="status"]'),
  };
})()`;

/**
 * THE OWNER'S ACTUAL DEFECT, measured directly: is the payout-gate notice —
 * the sentence saying why this helper cannot be hired, and the "Set Up
 * Payouts" link that fixes it — fully readable, or is the submit row sitting
 * on it?
 *
 * Takes a scroll position as `SCROLL_FRACTION` and reports, at that position,
 * how much of the notice is hidden: clipped by the scrollport, or covered by
 * the Apply Now button. Both must be zero at EVERY scroll position, which is
 * only true if the notice and the button are one sticky unit — the fix.
 */
const MEASURE_NOTICE = `(() => {
  const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
  const dlg = dialogs[dialogs.length - 1];
  if (!dlg) return { error: "dialog not open" };
  const notice = [...dlg.querySelectorAll('[role="status"]')]
    .find((n) => /can't be hired yet/i.test(n.textContent || ""));
  if (!notice) return { error: "payout-gate notice not found" };
  const btn = [...dlg.querySelectorAll("button")]
    .find((b) => /^(apply now|book now)$/i.test((b.textContent || "").trim()));
  if (!btn) return { error: "submit button not found" };

  let scroller = notice.parentElement;
  while (scroller) {
    const oy = getComputedStyle(scroller).overflowY;
    if (oy === "auto" || oy === "scroll") break;
    scroller = scroller.parentElement;
  }
  if (!scroller) return { error: "scroller not found" };

  const n = notice.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  const link = notice.querySelector("a");
  const l = link ? link.getBoundingClientRect() : null;

  return {
    scrollTop: +scroller.scrollTop.toFixed(1),
    // Hidden above/below the scrollport's own edges.
    clippedPx: +(Math.max(0, s.top - n.top) + Math.max(0, n.bottom - s.bottom)).toFixed(1),
    // Covered by the submit button (they are laid out in one column, so any
    // vertical intersection is the button sitting on the notice).
    coveredPx: +Math.max(0, Math.min(n.bottom, b.bottom) - Math.max(n.top, b.top)).toFixed(1),
    // The one control that resolves the block must itself be on screen.
    linkVisible: !!l && l.top >= s.top - 0.5 && l.bottom <= s.bottom + 0.5
      && !(Math.min(l.bottom, b.bottom) - Math.max(l.top, b.top) > 0.5),
  };
})()`;

type NoticeMeasurement = {
  error?: string;
  scrollTop: number;
  clippedPx: number;
  coveredPx: number;
  linkVisible: boolean;
};

type OverlapMeasurement = {
  error?: string;
  overlaps: {
    overlapPx: number;
    prevText: string;
    prevBottom: number;
    curText: string;
    curTop: number;
    curCls: string;
  }[];
  sheetScrolls: boolean;
  rowIsSticky: boolean;
  gapUnderButton: number | null;
  noticePresent: boolean;
};

// Two viewports, chosen because they put the sheet on OPPOSITE sides of the
// only variable that matters here — whether it overflows.
//   1440x994: the desktop web dialog. The sheet FITS, which is the broken case.
//    375x812: the phone. The same content overflows, so the sticky treatment
//             genuinely applies and must keep working (this is the case the
//             `.sheet-sticky-actions` box-shadow was built for — it must not
//             regress into the stray-content-under-the-CTA bug it fixed).
for (const { width, height, label } of [
  { width: 1440, height: 994, label: "desktop (sheet fits)" },
  { width: 375, height: 812, label: "phone (sheet scrolls)" },
]) {
  test(`apply submit row never overlaps the row above it — ${label}`, async ({ helperPage: page }) => {
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        mockRpc("get_safe_profiles", [POSTER_PROFILE]),
        mockTable("open_jobs_browse", [BASE_JOB]),
        mockTable("helper_availability", []),
        mockTable("applications", []),
        mockTable("user_blocks", []),
        mockTable("saved_jobs", []),
        mockTable("saved_searches", []),
        mockTable("reviews", []),
      ],
    });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
      } catch { /* no-storage guard */ }
    });
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard");

    const card = page.getByText(BASE_JOB.title);
    await card.waitFor({ timeout: 20_000 });
    await card.click();

    const detail = page.locator('[role="dialog"]').last();
    await detail.getByRole("button", { name: /^(apply now|book now)$/i }).waitFor({ timeout: 10_000 });
    // The open animation AND the ResizeObserver that decides whether the host
    // sheet scrolls both need a frame to settle before this measures.
    await page.waitForTimeout(600);

    const m = (await page.evaluate(MEASURE_OVERLAP)) as OverlapMeasurement;
    expect(m.error, `measure failed: ${m.error}`).toBeUndefined();

    // The payout-gate notice is the element the submit row was landing on, so
    // a run where it never rendered would pass this spec vacuously.
    expect(m.noticePresent, "payout-gate notice did not render — spec would pass vacuously").toBe(true);

    // THE ASSERTION. No consecutive siblings overlap, at either viewport.
    expect(
      m.overlaps,
      `submit row overlaps the element above it: ${JSON.stringify(m.overlaps, null, 2)}`,
    ).toEqual([]);

    // The sticky treatment is engaged EXACTLY when the sheet scrolls, and not
    // otherwise — that equivalence is the fix, so it is pinned directly rather
    // than only through its symptom.
    expect(
      m.rowIsSticky,
      `sticky=${m.rowIsSticky} but sheetScrolls=${m.sheetScrolls} — the treatment must track the overflow`,
    ).toBe(m.sheetScrolls);

    // THE OWNER'S REPORT, ASSERTED DIRECTLY, at the top, middle and bottom of
    // the sheet's scroll range. The reason a helper cannot be hired and the
    // link that fixes it have to be readable wherever the sheet happens to be
    // scrolled — not only once the user has scrolled to its very end.
    //
    // Before the notice was moved inside the sticky block, this failed at
    // scroll-top on the phone by 21.1px: the lifted row covered the notice's
    // last line, which is the line carrying "Set Up Payouts".
    for (const fraction of [0, 0.5, 1]) {
      await page.evaluate((f) => {
        const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
        const dlg = dialogs[dialogs.length - 1];
        if (!dlg) return;
        let el = dlg.querySelector('[role="status"]')?.parentElement ?? null;
        while (el) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === "auto" || oy === "scroll") break;
          el = el.parentElement;
        }
        if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
      }, fraction);
      await page.waitForTimeout(120);

      const n = (await page.evaluate(MEASURE_NOTICE)) as NoticeMeasurement;
      expect(n.error, `notice measure failed: ${n.error}`).toBeUndefined();
      expect(
        n.clippedPx,
        `payout notice clipped by the sheet at scroll ${fraction}: ${n.clippedPx}px`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        n.coveredPx,
        `submit button covers the payout notice at scroll ${fraction}: ${n.coveredPx}px`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        n.linkVisible,
        `"Set Up Payouts" — the only control that clears the block — is not readable at scroll ${fraction}`,
      ).toBe(true);
    }

    // And nothing is left stranded under the button on a sheet that fits: the
    // row's own padding is the only thing below it, never a second gutter
    // stacked on top of the sheet's.
    if (!m.sheetScrolls && m.gapUnderButton !== null) {
      expect(
        m.gapUnderButton,
        `dead space under the CTA: ${m.gapUnderButton}px`,
      ).toBeLessThanOrEqual(48);
    }
  });
}
