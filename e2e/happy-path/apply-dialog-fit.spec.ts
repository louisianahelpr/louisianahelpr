import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

// ApplyConfirmDialog must FIT THE SCREEN.
//
// This dialog shipped cut off horizontally for months: AlertDialogContent is a
// CSS grid, its body was a grid item with the default `min-width: auto`, and
// the "Tap a suggested opener" chip row (an `overflow-x-auto` flex row of
// `whitespace-nowrap` chips) pushed the single implicit column to its 674px
// max-content width inside a 341px box. Every row — the job title, the earnings
// figures, the character counter, and both action buttons — stretched to 674px
// and ran ~356px off the right edge of a 375px screen. Measured before the fix
// at 375x812: the "Apply now" button's right edge sat at x=687.
//
// The regression is invisible to a screenshot diff of the dialog box (the BOX
// is correctly sized — only its contents overflow) and invisible to a
// document-level `scrollWidth <= clientWidth` check (the dialog is
// `position: fixed`, so its overflow never widens the document). It needs an
// element-level measurement, which is what this spec is.
//
// Guarded here rather than in the vitest suite because jsdom does no layout —
// every width it reports is 0.

const BASE_JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  // Must not be FAKE_HELPER.id or the feed filters the card out as "your own job".
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving",
  budget: 100,
  // jobs.date_needed is a Postgres DATE — PostgREST emits "YYYY-MM-DD".
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00",
  location: "New Orleans, LA",
  status: "open",
  payment_status: "paid",
  // Older than the 20-minute free-tier "early access" delay, or the feed hides it.
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
 * Walks every element inside the open alert dialog and reports the ones whose
 * box escapes the dialog's content box. Elements inside a horizontal scroll
 * container are excluded, because a scrollport clips its overflow rather than
 * painting it. The suggested-opener chips USED to rely on that exclusion; they
 * wrap now, so they are walked like everything else and must fit.
 */
const MEASURE = `(() => {
  const dlg = document.querySelector('[role="alertdialog"]');
  if (!dlg) return { error: "dialog not open" };
  const cs = getComputedStyle(dlg);
  const r = dlg.getBoundingClientRect();
  const contentLeft = r.left + parseFloat(cs.paddingLeft);
  const contentRight = r.right - parseFloat(cs.paddingRight);
  const offenders = [];
  const walk = (el) => {
    for (const child of el.children) {
      const cr = child.getBoundingClientRect();
      let clipped = false;
      for (let p = child.parentElement; p && p !== dlg; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") { clipped = true; break; }
      }
      // 4px of slack for sub-pixel rounding on bled/negative-margin rows.
      if (!clipped && cr.width > 0 && (cr.right - contentRight > 4 || contentLeft - cr.left > 4)) {
        offenders.push({
          tag: child.tagName.toLowerCase(),
          cls: (typeof child.className === "string" ? child.className : "").slice(0, 120),
          text: (child.textContent || "").trim().slice(0, 40),
          right: +cr.right.toFixed(1),
          overRight: +(cr.right - contentRight).toFixed(1),
        });
      }
      walk(child);
    }
  };
  walk(dlg);
  // Match on the ACCESSIBLE NAME, not on textContent. The dismiss action is an
  // icon button now (an "x" with aria-label="Cancel"), so its textContent is
  // empty — matching text alone would silently drop it from the actions list
  // and the "both actions are on screen and tappable" assertions would pass
  // vacuously. aria-label first, visible text otherwise.
  const accName = (b) => ((b.getAttribute("aria-label") || b.textContent || "").trim());
  const actions = [...dlg.querySelectorAll("button")]
    .filter((b) => /apply now|submit bid|book now|^cancel$|try again/i.test(accName(b)))
    .map((b) => {
      const br = b.getBoundingClientRect();
      return {
        text: accName(b),
        left: +br.left.toFixed(1),
        right: +br.right.toFixed(1),
        height: +br.height.toFixed(1),
        // A label squeezed to "Apply no…" would scroll inside its own button.
        labelTruncated: b.scrollWidth > b.clientWidth + 0.5,
        inViewport:
          br.top >= 0 && br.bottom <= window.innerHeight &&
          br.left >= 0 && br.right <= window.innerWidth,
      };
    });
  return {
    dialog: {
      scrollWidth: dlg.scrollWidth,
      clientWidth: dlg.clientWidth,
      contentLeft: +contentLeft.toFixed(1),
      contentRight: +contentRight.toFixed(1),
      top: +r.top.toFixed(1),
      bottom: +r.bottom.toFixed(1),
    },
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    actions,
    offenders,
  };
})()`;

type Measurement = {
  dialog: { scrollWidth: number; clientWidth: number; contentLeft: number; contentRight: number; top: number; bottom: number };
  doc: { scrollWidth: number; clientWidth: number };
  viewport: { w: number; h: number };
  actions: { text: string; left: number; right: number; height: number; labelTruncated: boolean; inViewport: boolean }[];
  offenders: { tag: string; cls: string; text: string; right: number; overRight: number }[];
};

for (const { name, width, job } of [
  { name: "Apply now", width: 375, job: {} },
  // Bid mode adds the price field, the poster's-budget line and an extra tip,
  // and carries the longest action label — the tallest, widest variant.
  { name: "Submit bid", width: 320, job: { pricing_mode: "accept_bids" } },
]) {
  test(`apply dialog fits the screen — ${name} @ ${width}`, async ({ helperPage: page }) => {
    const openJob = { ...BASE_JOB, ...job };
    await installSupabaseMocks(page, {
      user: FAKE_HELPER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        mockRpc("get_safe_profiles", [POSTER_PROFILE]),
        mockTable("open_jobs_browse", [openJob]),
        mockTable("helper_availability", []),
        mockTable("applications", []),
        mockTable("user_blocks", []),
        mockTable("saved_jobs", []),
        mockTable("saved_searches", []),
        mockTable("reviews", []),
      ],
    });
    // The onboarding tour renders a modal over the feed and swallows the taps
    // that open the job detail dialog.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
      } catch { /* no-storage guard */ }
    });
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/dashboard");

    const card = page.getByText(openJob.title);
    await card.waitFor({ timeout: 20_000 });
    await card.click();
    const detail = page.locator('[role="dialog"]').last();
    // The detail dialog's CTA is "Apply · earn $N" / "Book now" / a bid-mode
    // variant depending on the job — match any of the openers.
    const applyBtn = detail.getByRole("button", { name: /^(apply|book|bid|submit|place)\b/i }).first();
    await applyBtn.waitFor({ timeout: 10_000 });
    await applyBtn.click();
    await page.locator('[role="alertdialog"]').waitFor({ timeout: 10_000 });
    // Let the zoom-in/fade animation settle before measuring.
    await page.waitForTimeout(500);

    const m = (await page.evaluate(MEASURE)) as Measurement;

    // 1. Nothing inside the dialog escapes its content box.
    expect(m.offenders, `elements past the dialog content box: ${JSON.stringify(m.offenders, null, 2)}`).toEqual([]);

    // 2. The dialog itself has no horizontal overflow to scroll.
    expect(m.dialog.scrollWidth).toBeLessThanOrEqual(m.dialog.clientWidth);

    // 3. The page never gains a horizontal scrollbar while the dialog is open.
    expect(m.doc.scrollWidth).toBeLessThanOrEqual(m.doc.clientWidth);

    // 4. The box fits the viewport vertically — the body scrolls, the box doesn't
    //    hang off the top or bottom of the screen.
    expect(m.dialog.top).toBeGreaterThanOrEqual(0);
    expect(m.dialog.bottom).toBeLessThanOrEqual(m.viewport.h);

    // 5. Both actions are on screen, tappable, and showing their full label.
    const labels = m.actions.map((a) => a.text);
    expect(labels).toContain(name);
    expect(labels).toContain("Cancel");
    for (const action of m.actions) {
      expect(action.inViewport, `${action.text} is off screen: ${JSON.stringify(action)}`).toBe(true);
      expect(action.labelTruncated, `${action.text} label is clipped`).toBe(false);
      expect(action.height).toBeGreaterThanOrEqual(44);
      expect(action.right).toBeLessThanOrEqual(m.dialog.contentRight + 0.5);
      expect(action.left).toBeGreaterThanOrEqual(m.dialog.contentLeft - 0.5);
    }
  });
}
