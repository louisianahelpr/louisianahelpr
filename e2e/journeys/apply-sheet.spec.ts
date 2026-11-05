import type { APIRequestContext, Browser, BrowserContext, Page, Request } from "@playwright/test";
import { test, expect, SUPABASE_URL, getSession, isUserWrite, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { abortProdWrites } from "../a11y-prod/abortProdWrites";
import { HELPER_E2E_ID, POSTER_E2E_ID } from "./throwaway";
import { BROWSE_FIXTURE_TITLE, ensureBrowseFixture, fixtureRow } from "../../scripts/e2e/browseFixture.mjs";

/**
 * THE JOB SHEET A HELPR APPLIES FROM, ON THE REAL BACKEND (Q1035).
 *
 * Moved from the mocked e2e/happy-path/apply-dialog-fit.spec.ts and
 * apply-single-sheet.spec.ts. The checks are the same; the job is no longer a
 * planted row. Prod's public feed has no open jobs before launch, so the sheet
 * opened here is the DURABLE TEST-ONLY fixture (scripts/e2e/browseFixture.mjs,
 * public.test_fixture_jobs, Q946): an is_seed Cleaning job of the test poster,
 * funded in the database only, shown only to the registered test accounts, that
 * a trigger refuses to hire, offer or move money on. ensureBrowseFixture() keeps
 * it healthy (the same service-role call 01-browse makes).
 *
 * The real test Helpr (helper-e2e) is signed in. READ-ONLY BY CONSTRUCTION:
 * nothing here submits an application. The note field is typed into and the
 * sheet is closed, never sent. Every context goes through abortProdWrites, and
 * any user write the page makes fails the test.
 *
 * NOT PORTED (stays mocked, see Q1035): apply-sticky-overlap.spec.ts needs the
 * payout-gate notice ("You can apply and accept offers ..."), which renders
 * only for a Helpr whose payouts are not set up AND who is owed a payout
 * setup (payout_setup_hire_allowed: on a funded job, or owed money). helper-e2e's
 * payouts are set up (measured read-only 2026-11-05: stripe_account_id set,
 * stripe_payouts_enabled true), and the fixture refuses the hire that would
 * give any other seed Helpr that state.
 */

// The job sheet — job detail AND the apply form, one surface — must FIT THE
// SCREEN.
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

// APPLYING HAPPENS ON ONE SURFACE, IN ONE STEP.
//
// This spec used to prove that the sheet did not JUMP when it stepped from
// detail to apply — it recorded the top edge, tapped Continue, and asserted
// the edge had not moved. That premise is gone: the owner collapsed the two
// steps into one on 2026-09-09 ("one sheet, one CTA, no step change, one less
// tap to apply"), so there is no Continue, no second step, and nothing left
// that could move.
//
// What it pins now is the shape that replaced it, all of which a screenshot
// diff would miss:
//
//   1. ONE SURFACE. Exactly one dialog, and no Continue/Back anywhere on it.
//   2. ONE STEP. The note field, the save-as-default-pitch checkbox and
//      "Apply now" are on the SAME surface as the job's own title and
//      description — reachable without tapping anything.
//   3. NOTHING STEPS. Tapping around the sheet never swaps its body: the job
//      description is still there after the note field has been typed into.
//   4. THE CLOSE X IS REACHABLE and dismissing abandons the apply — no
//      resurrected standalone apply form on the bare feed.
//   5. NO DEAD BAND under the CTA on a short job: the sheet hugs its content.


// newUserContext already blocks them; this covers any context the project builds (Q1164).
test.use({ serviceWorkers: "block" });

/** One SCENARIO pin runs this whole file ("apply-sheet"). */
const rotation: Rotation = { ...rotationFor(23), network: "fast" };
const titleFor = (slug: string) =>
  scenarioTitle({ journey: `apply-sheet-${slug}`, persona: "helper-only", state: "approved", rotation, outcome: "smooth" });

/** The fixture's description opens with this (fixtureRow); the sheet folds the rest behind Read more (Q949). */
const DESC_START = (fixtureRow(POSTER_E2E_ID).description as string).slice(0, 40);
/** Telemetry the app sends off-Supabase. */
const TELEMETRY_HOSTS = /(^|\.)(sentry\.io|sentry-cdn\.com|posthog\.com|vercel-insights\.com)$/;

/**
 * Walks every element inside the open alert dialog and reports the ones whose
 * box escapes the dialog's content box. Elements inside a horizontal scroll
 * container are excluded, because a scrollport clips its overflow rather than
 * painting it. The suggested-opener chips USED to rely on that exclusion; they
 * wrap now, so they are walked like everything else and must fit.
 */
const MEASURE = `(() => {
  // The apply step renders INSIDE the job-detail sheet now — one surface,
  // two steps — so there is no separate [role="alertdialog"] to measure. The
  // last open dialog is the sheet showing the apply step.
  const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
  const dlg = dialogs[dialogs.length - 1];
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
        if (p.getAttribute("data-frame-chrome") === "true") { clipped = true; break; }
      }
      // Dialog CHROME is exempt: the corner close button is a 44px HIG tap
      // target anchored to the dialog FRAME (right-3, top-3), so its hit box
      // deliberately spans the p-5 padding gutter — that is frame chrome, not
      // content escaping the content box. Content elements are never
      // absolutely positioned buttons, so the exemption stays narrow.
      // data-frame-chrome on an element also exempts it (and its children via
      // the ancestor walk above) — used for the category stripe/badge that
      // intentionally bleeds into the padding gutter to sit flush on the
      // dialog's left edge.
      const isFrameChrome =
        (child.tagName === "BUTTON" && getComputedStyle(child).position === "absolute") ||
        child.getAttribute("data-frame-chrome") === "true";
      // 4px of slack for sub-pixel rounding on bled/negative-margin rows.
      if (!clipped && !isFrameChrome && cr.width > 0 && (cr.right - contentRight > 4 || contentLeft - cr.left > 4)) {
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
  // icon button now (an "x" with aria-label="Close" — the shared
  // AlertDialogContent corner control that replaced the footer Cancel), so its
  // textContent is empty; matching text alone would silently drop it from the
  // actions list and the "both actions are on screen and tappable" assertions
  // would pass vacuously. aria-label first, visible text otherwise.
  const accName = (b) => ((b.getAttribute("aria-label") || b.textContent || "").trim());
  const actions = [...dlg.querySelectorAll("button")]
    .filter((b) => /apply now|submit bid|book now|^close$|try again/i.test(accName(b)))
    .map((b) => {
      const br = b.getBoundingClientRect();
      return {
        text: accName(b),
        left: +br.left.toFixed(1),
        right: +br.right.toFixed(1),
        height: +br.height.toFixed(1),
        // The corner Close is FRAME CHROME: it anchors to the dialog frame
        // (absolute, right-3) and its 44px tap box deliberately spans the
        // padding gutter, so it is exempt from the content-box edge assertions
        // — the primary footer action is not.
        isChrome: getComputedStyle(b).position === "absolute",
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
  actions: { text: string; left: number; right: number; height: number; isChrome: boolean; labelTruncated: boolean; inViewport: boolean }[];
  offenders: { tag: string; cls: string; text: string; right: number; overRight: number }[];
};

type Opened = { page: Page; context: BrowserContext; writes: string[] };

/** The real test Helpr, signed in, the fixture kept healthy, prod writes and telemetry aborted, user writes recorded. */
async function open(browser: Browser, request: APIRequestContext, title: string): Promise<Opened> {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const helper = await getSession(request, "helper");
  expect(helper.user.id, "the helper session is not helper-e2e, whose id the browse fixture is kept for").toBe(HELPER_E2E_ID);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  expect(serviceKey, "the browse fixture needs the service-role key (CI secret SUPABASE_SERVICE_ROLE_KEY)").toBeTruthy();
  await ensureBrowseFixture({ supabaseUrl: SUPABASE_URL, serviceKey: serviceKey!, posterId: POSTER_E2E_ID, helperId: HELPER_E2E_ID });
  const context = await newUserContext(browser, helper);
  const writes: string[] = [];
  context.on("request", (req: Request) => {
    if (isUserWrite(req.method(), req.url())) writes.push(`${req.method()} ${req.url().slice(0, 140)}`);
  });
  await abortProdWrites(context, SUPABASE_URL, test.info().outputPath());
  await context.route(
    (u) => TELEMETRY_HOSTS.test(u.hostname),
    (route) => route.abort("blockedbyclient"),
  );
  return { page: await context.newPage(), context, writes };
}

/** A test body run as the real Helpr; the context closes and the write check runs whatever happens. */
function helpr(slug: string, body: (o: Opened) => Promise<void>) {
  return async ({ browser, request }: { browser: Browser; request: APIRequestContext }) => {
    const o = await open(browser, request, titleFor(slug));
    try {
      await body(o);
    } finally {
      await o.context.close().catch(() => {});
      expect(o.writes, "the apply-sheet check is read-only: no user writes").toEqual([]);
    }
  };
}

/** Jobs > Browse, then the fixture's card: the sheet opens on it. */
async function openFixtureSheet(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/jobs");
  const card = page.getByRole("button", { name: new RegExp(`^View ${BROWSE_FIXTURE_TITLE} — \\$`) }).first();
  await expect(card, "the browse fixture is on the test Helpr's feed").toBeVisible({ timeout: 60_000 });
  await card.click();
}

for (const { name, width } of [
  { name: "Apply now", width: 375 },
  { name: "Apply now", width: 320 },
]) {
  test(`${titleFor(`fit-${width}`)} · apply dialog fits the screen — ${name} @ ${width}`, helpr(`fit-${width}`, async ({ page }) => {
    await openFixtureSheet(page, width, 812);
    const detail = page.locator('[role="dialog"]').last();
    await detail.getByRole("button", { name: /^(apply now|book now)$/i }).waitFor({ timeout: 20_000 });
    // MEASURE THE SHEET AT REST (measured 2026-11-05). On a phone the sheet enters with
    // slide-in-from-bottom: a pure vertical translate, so neither its width nor
    // its scale moves while it slides. Measured locally in WebKit AND Chromium
    // at a cold 320x812 and after a 390x844 -> 320x812 resize (same numbers both
    // ways, so it is not a stale dvh): the box starts at top 812 and lands at
    // top 113.7 / bottom 812 about 290 ms after the tap, reading bottom 817 at
    // 270 ms. The old width + scale settle let WebKit measure that tail
    // (bottom 820 in e2e-journeys 41985120980, 883 in nightly-webkit
    // 41680707961) while the failure screenshot a moment later painted the
    // sheet flush at 812. So: settle, measure, and accept the measurement only
    // if the box is still in the same place 350 ms later. A sheet that really
    // hangs off the screen is at rest there too, and still fails below.
    let m: Measurement | undefined;
    let atRest = false;
    for (let attempt = 0; attempt < 4 && !atRest; attempt++) {
      await page.evaluate(() => { delete (window as unknown as { __lhDlgBox?: number[] }).__lhDlgBox; });
      await page
        .waitForFunction(
          () => {
            const dlg = document.querySelectorAll('[role="dialog"]');
            const el = dlg[dlg.length - 1] as HTMLElement | undefined;
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const box = [r.left, r.top, r.width, r.height];
            const win = window as unknown as { __lhDlgBox?: number[] };
            const prev = win.__lhDlgBox;
            win.__lhDlgBox = box;
            // Two consecutive identical BOXES (left, top, width, height), no
            // residual scale OR TRANSLATION on the box, and its entry animation
            // FINISHED. A 1% scale tolerance let WebKit measure the 44px Apply now
            // at 43.7-43.9px (0.993-0.998 of 44: the zoom-in-95 tail) in
            // nightly-webkit run 38434750617. Width + scale alone missed the phone
            // sheet's VERTICAL slide-in-from-bottom (it changes neither): WebKit
            // measured the sheet mid-slide at bottom 820 (e2e-journeys
            // 41985120980) and 883 (nightly-webkit 41680707961) on an 812 screen
            // whose screenshot, a moment later, painted it flush at 812 (2026-11-05).
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            const still = Math.abs(m.a - 1) < 0.001 && Math.abs(m.d - 1) < 0.001 && Math.abs(m.e) < 0.5 && Math.abs(m.f) < 0.5;
            const running = el.getAnimations({ subtree: true }).some((a) => a.playState === "running");
            return prev !== undefined && box.every((v, i) => Math.abs(v - prev[i]) < 0.5) && still && !running;
          },
          undefined,
          { timeout: 10_000, polling: 100 },
        )
        .catch(() => undefined);
      // A beat after stability for any paint that follows the last layout.
      await page.waitForTimeout(200);
      m = (await page.evaluate(MEASURE)) as Measurement;
      await page.waitForTimeout(350);
      const again = (await page.evaluate(MEASURE)) as Measurement;
      atRest = !(m as { error?: string }).error && !!again.dialog && Math.abs(again.dialog.top - m.dialog.top) < 0.5 && Math.abs(again.dialog.bottom - m.dialog.bottom) < 0.5;
    }
    expect(atRest, `the sheet never came to rest in 4 settles: ${JSON.stringify(m?.dialog)}`).toBe(true);
    m = m!;

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
    //
    // Matched case-INSENSITIVELY. The app-wide Title Case pass (Apple HIG —
    // button labels are Title Case) renamed this control to "Apply now", and an
    // exact-string match reads a rename as a missing button, which is what this
    // assertion was doing rather than measuring fit.
    const labels = m.actions.map((a) => a.text);
    const lower = labels.map((l) => l.toLowerCase());
    expect(lower, `actions: ${JSON.stringify(labels)}`).toContain(name.toLowerCase());
    // The dismiss affordance is the shared corner "Close" now, not a footer
    // "Cancel" — its accessible name is "Close" (see AlertDialogContent, and
    // the ApplyConfirmDialog unit test + home-chrome spec that pin the name).
    expect(lower).toContain("close");
    for (const action of m.actions) {
      expect(action.inViewport, `${action.text} is off screen: ${JSON.stringify(action)}`).toBe(true);
      expect(action.labelTruncated, `${action.text} label is clipped`).toBe(false);
      expect(
        action.height,
        `${action.text} tap target is under 44px: ${JSON.stringify(action)}`,
      ).toBeGreaterThanOrEqual(44);
      // The corner Close is frame chrome and sits in the padding gutter by
      // design (right-3); only the footer action must stay inside the content
      // box. Both must still be on screen and ≥44px, asserted above.
      if (!action.isChrome) {
        expect(action.right).toBeLessThanOrEqual(m.dialog.contentRight + 0.5);
        expect(action.left).toBeGreaterThanOrEqual(m.dialog.contentLeft - 0.5);
      }
    }
  }));
}

test(`${titleFor("one-step")} · one sheet, one step: the apply form is on the job detail surface`, helpr("one-step", async ({ page }) => {
  await openFixtureSheet(page, 375, 812);
  const sheet = page.locator('[role="dialog"]').last();
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);

  // 1. ONE SURFACE, and no step machinery on it.
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(1);
  await expect(sheet.getByRole("button", { name: /^back$/i })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /^continue\b/i })).toHaveCount(0);

  // 2. ONE STEP — the job AND the apply form, together, with no tap in
  //    between. This is the whole change: it used to take a Continue tap to
  //    reach any of the three below.
  await expect(sheet.getByText(DESC_START)).toBeVisible();
  const note = sheet.getByRole("textbox");
  await expect(note).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: /save as my default pitch/i })).toBeVisible();
  const applyNow = sheet.getByRole("button", { name: /^apply now$/i });
  await expect(applyNow).toBeVisible();

  // The CTA wears the real primary surface: SOLID olive since 2026-10-18
  // (owner, option 3B "nearly flat"). Asserting the CLASS passes on a control
  // whose fill was lost (an inline `background` shorthand beats
  // `.btn-grad-primary`), so read the COMPUTED style: no gradient image, and a
  // background-color equal to `hsl(var(--bark))` resolved on this same page.
  const cta = await applyNow.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "hsl(var(--bark))";
    document.body.appendChild(probe);
    const olive = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cs = getComputedStyle(el);
    return { image: cs.backgroundImage, color: cs.backgroundColor, olive };
  });
  expect(cta.image, `Apply now background-image: ${cta.image}`).toBe("none");
  expect(cta.color, `Apply now background-color ${cta.color}, the olive is ${cta.olive}`).toBe(cta.olive);

  // 3. NOTHING STEPS. Typing into the note must not swap the body out — the
  //    job is still on screen, which is the property the two-step version
  //    could not have.
  await note.fill("I have cleaned a lot of kitchens.");
  await page.waitForTimeout(300);
  await expect(sheet.getByText(DESC_START)).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^apply now$/i })).toBeVisible();
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(1);

  // 4. THE CLOSE X IS REACHABLE — on screen and hit-testable, not buried.
  const close = sheet.getByRole("button", { name: /^close$/i });
  await expect(close).toBeVisible();
  // The dialog opens with `zoom-in-95`, so getBoundingClientRect reads the
  // VISUAL rect — a 44px box measured mid-zoom is 44×0.95 = 41.8px. Under CI
  // load WebKit finished this animation late enough that the measurement below
  // caught the tail of it and flagged a 41.8px width (nightly-webkit red,
  // 2026-09-15; passes uncontended locally). Wait for every animation on the
  // dialog subtree to finish so the box is measured at its settled size.
  await sheet.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
  );
  const closeBox = await close.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      ownsItsCentre: !!hit && (hit === el || el.contains(hit)),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
    };
  });
  expect(closeBox.onScreen, JSON.stringify(closeBox)).toBe(true);
  expect(closeBox.ownsItsCentre, JSON.stringify(closeBox)).toBe(true);
  expect(closeBox.w).toBeGreaterThanOrEqual(44);
  expect(closeBox.h).toBeGreaterThanOrEqual(44);
}));

test(`${titleFor("hug")} · a job sheet leaves no dead band under the CTA`, helpr("hug", async ({ page }) => {
  // TALL viewport on purpose (see the mocked original): with 1400px to spare, does the box hug its content? The
  // fixture's long description is folded behind Read more, so its sheet is as short as a one-line job's.
  await openFixtureSheet(page, 375, 1400);
  const sheet = page.locator('[role="dialog"]').last();
  await sheet.getByRole("button", { name: /^apply now$/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const gap = await sheet.evaluate((el) => {
    const dlg = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const btn = [...el.querySelectorAll("button")].find(
      (b) => /^apply now$/i.test((b.textContent || "").trim()),
    );
    if (!btn) return { error: "no Apply now" } as const;
    // Measure to the ACTION ROW's bottom, not the button's. The row carries a
    // deliberate `-mb-4 pb-4` so its opaque surface runs to the sheet's own
    // padding edge and scrolled content passes UNDER it rather than through
    // it — that 16px is paint, not dead space, and measuring the button
    // instead reports it as a phantom gap.
    const row = btn.closest(".sheet-sticky-actions") ?? btn;
    const r = row.getBoundingClientRect();
    return {
      // Anything below the action row that is not the sheet's bottom padding.
      // The reserved-height version measured ~430px here.
      dead: +(dlg.bottom - parseFloat(cs.paddingBottom) - r.bottom).toFixed(1),
      // The sheet must HUG: with 1400px to play with it must not have grown
      // to fill the viewport.
      sheetHeight: +dlg.height.toFixed(1),
      vh: window.innerHeight,
      scrolls: el.scrollHeight > el.clientHeight + 1,
    };
  });
  expect(gap, JSON.stringify(gap)).not.toHaveProperty("error");
  const g = gap as { dead: number; sheetHeight: number; vh: number; scrolls: boolean };
  expect(g.dead, JSON.stringify(gap)).toBeLessThanOrEqual(4);
  // Given room, the sheet sizes to its content instead of stretching to the
  // 86dvh ceiling — and therefore does not scroll at all.
  expect(g.sheetHeight, JSON.stringify(gap)).toBeLessThan(g.vh * 0.86 - 1);
  expect(g.scrolls, JSON.stringify(gap)).toBe(false);
}));

test(`${titleFor("dismiss")} · dismissing the sheet abandons the apply`, helpr("dismiss", async ({ page }) => {
  await openFixtureSheet(page, 375, 812);
  const sheet = page.locator('[role="dialog"]').last();
  await sheet.getByRole("button", { name: /^apply now$/i }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);

  // Type into the note first: abandoning has to survive a half-written pitch,
  // which is the state the stale-id bug was actually reachable from.
  await sheet.getByRole("textbox").fill("half a pitch");
  await sheet.getByRole("button", { name: /^close$/i }).click();
  await page.waitForTimeout(800);

  // Nothing is left on screen — no sheet, and crucially no resurrected
  // standalone apply form.
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(0);
  await expect(page.getByRole("button", { name: /^apply now$/i })).toHaveCount(0);
}));

// `min-w-0` on the apply body is the fix this spec was written for: without it
// the body is a CSS-grid item at the default `min-width: auto`, and the
// overflow-x-auto opener-chip row dragged the implicit column to its 674px
// max-content width inside a 341px box, so every row — title, earnings,
// counter, both buttons — ran off the right edge.
//
// EQUIVALENT MUTANT on its own (Q89, CI vacuity run 35822511272): removing just
// `min-w-0` SURVIVED, because the chip row is gone and nothing ApplyBody renders
// today has a max-content wider than the dialog, so the default `min-width:
// auto` changes no layout. The registration therefore reinstates the ORIGINAL
// DEFECT whole: `min-w-0` dropped AND a non-wrapping opener row put back. That
// is the regression this spec exists to catch.
// @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | <div className="min-w-0 flex flex-col gap-3.5"> | <div className="flex flex-col gap-3.5"><div className="flex gap-2 whitespace-nowrap">Tap a suggested opener: I can be there within the hour · I have a truck and a dolly · I have moved couches before</div>

// "Apply now" is the sheet's one primary, and primaries wear the solid olive
// (CLAUDE.md: primary-surface tests assert the computed style, never the
// class name — which is what the check above does). Handing the Button an
// `outline` variant strips the olive while leaving the class list plausible,
// so a class-name assertion would sail straight past it.
// @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | onClick={handleConfirm} | variant="outline" onClick={handleConfirm}
