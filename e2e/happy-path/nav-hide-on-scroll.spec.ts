/**
 * The bottom dock's hide-on-scroll, measured on the four routes that carry the
 * app's longest lists.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The behaviour was reported dead on every fixed-shell route on the theory
 * that `window.scrollY` is pinned at 0 there. It is not: those pages scroll a
 * nested container, and MobileNav's capture-phase listener reads the real
 * scroll target, so all four already hide and reveal correctly. What made it
 * LOOK dead is that none of these lists overflow a 375x812 viewport under the
 * default seed — with nothing to scroll there is nothing to hide. So this spec
 * seeds enough rows to actually scroll, and asserts the transform rather than
 * "looks about right".
 *
 * The real defect it pins is the opposite one: a dock that hides and then
 * cannot come back. Everything in MobileNav is driven by `scroll` events, so a
 * scroll surface that stops existing (Home's list -> map toggle sets
 * `display:none` on the list container) left the dock parked 130px below the
 * viewport with no gesture able to reveal it — tabs AND the Post FAB gone
 * until the user navigated away.
 *
 * Assertions are on the nav's own translateY, taken from the computed
 * transform matrix: 0 = docked, ~130 = slid off the bottom. Reading the class
 * list or `aria-hidden` would pass on a bar that never actually moved.
 */
import { test, expect, FAKE_CUSTOMER, installSupabaseMocks, seedAuthedSession, type MockRule } from "./fixtures";
import type { Page } from "@playwright/test";

/** Someone else's account — Home's feed hides jobs you posted yourself. */
const OTHER_POSTER = "33333333-3333-4333-8333-333333333333";

/** Tall enough to overflow 375x812 several times over on every route. */
const ROW_COUNT = 30;

function manyJobs(customerId: string) {
  const now = Date.now();
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `10000000-0000-4000-8000-0000000${String(i + 100).padStart(5, "0")}`,
    title: `Seeded job number ${i + 1} — a title long enough to wrap on a phone`,
    description: "A description that runs a couple of lines so the card has real height.",
    category: "cleaning",
    status: "open",
    budget: 100 + i,
    location: "New Orleans, LA",
    parish: "orleans",
    date_needed: new Date(now + 86_400_000).toISOString().slice(0, 10),
    start_time: "09:00:00",
    created_at: new Date(now - i * 3_600_000).toISOString(),
    updated_at: new Date(now - i * 3_600_000).toISOString(),
    customer_id: customerId,
    helper_id: null,
    is_urgent: false,
    urgent_fee: 0,
    is_recurring: false,
    is_group_job: false,
    helpers_needed: 1,
    estimated_hours: 2,
    special_requirements: null,
    photos: [],
    boost_expires_at: null,
    expires_at: new Date(now + 7 * 86_400_000).toISOString(),
    recurrence_interval: null,
    pricing_mode: "fixed",
  }));
}

function manyMessages() {
  const now = Date.now();
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `30000000-0000-4000-8000-0000000${String(i + 100).padStart(5, "0")}`,
    job_id: `10000000-0000-4000-8000-0000000${String(i + 100).padStart(5, "0")}`,
    sender_id: i % 2 === 0 ? FAKE_CUSTOMER.id : OTHER_POSTER,
    recipient_id: i % 2 === 0 ? OTHER_POSTER : FAKE_CUSTOMER.id,
    content: `Thread ${i + 1} — latest message text goes here.`,
    read: i % 4 === 0,
    created_at: new Date(now - i * 60_000).toISOString(),
    archived_by: [],
  }));
}

/**
 * Home reads the RLS-public `open_jobs_browse` view, the Activity tabs read
 * `jobs`. Both are mocked so one fixture covers all four routes; Home's rows
 * belong to someone else (it filters your own posts out of the feed) and the
 * Activity rows belong to the signed-in account.
 */
/**
 * Home's feed is infinite-scrolling: it re-requests the SAME URL with a new
 * `Range` header for each page. A mock that answers every call with the same
 * 30 rows therefore never ends, and "scroll to the true end of the list" never
 * terminates. Range is a header, not a query param, so the rule can't read the
 * page number — but the URL repeating IS the page-2 signal, so the first call
 * for a given URL serves rows and every repeat reports the end of the feed.
 */
const pageOneOnly = (() => {
  const served = new Set<string>();
  return (url: URL, body: unknown[]) => {
    const key = url.toString();
    if (served.has(key)) return { status: 200, body: [] };
    served.add(key);
    return { status: 200, body };
  };
})();

const listRules: MockRule[] = [
  {
    match: (url, method) => method === "GET" && url.pathname === "/rest/v1/open_jobs_browse",
    handle: (url) => pageOneOnly(url, manyJobs(OTHER_POSTER)),
  },
  {
    match: (url, method) => method === "GET" && url.pathname === "/rest/v1/jobs",
    handle: () => ({ status: 200, body: manyJobs(FAKE_CUSTOMER.id) }),
  },
  {
    match: (url, method) => method === "GET" && url.pathname === "/rest/v1/messages",
    handle: () => ({ status: 200, body: manyMessages() }),
  },
];

async function boot(page: Page, url: string) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "helpr_onboarding",
        JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }),
      );
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
}

/** The dock's vertical offset in px. 0 = docked, ~130 = slid off-screen. */
function navOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Bottom navigation"]');
    if (!nav) return Number.NaN;
    return Math.round(new DOMMatrixReadOnly(getComputedStyle(nav).transform).f);
  });
}

/** The tallest genuinely-scrollable region on the route. */
function scrollState(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const oy = getComputedStyle(el).overflowY;
      return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 2;
    });
    const el = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return el
      ? { found: true, top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
      : { found: false, top: 0, max: 0 };
  });
}

async function wheel(page: Page, dy: number, steps: number) {
  await page.mouse.move(187, 500);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(70);
  }
  // Longer than the 0.28s slide so the transform has settled before we read it.
  await page.waitForTimeout(500);
}

// Seeded jobs are open with no applicants → bucket "waiting". The default
// Activity tab is "needs_you", so /my-jobs and /my-posts land on an empty
// list without the filter param — nothing to scroll, nothing to hide for.
const ROUTES = ["/dashboard", "/messages", "/my-jobs?filter=waiting", "/my-posts?filter=waiting"] as const;

for (const route of ROUTES) {
  test(`dock hides on scroll-down and returns on scroll-up @ ${route}`, async ({
    context,
    page,
    baseURL,
  }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: listRules });
    await boot(page, route);

    // The premise of the whole spec: there IS something to scroll. Without
    // this guard a route that quietly stopped rendering rows would report a
    // dock that "correctly stays visible".
    const initial = await scrollState(page);
    expect(initial.found, `${route} has no scrollable region — nothing to hide for`).toBe(true);
    expect(initial.max, `${route} scroll range`).toBeGreaterThan(400);

    expect(await navOffset(page), `${route} docked at rest`).toBe(0);

    await wheel(page, 120, 8);
    expect(await navOffset(page), `${route} after scrolling down`).toBeGreaterThan(100);

    await wheel(page, -120, 3);
    expect(await navOffset(page), `${route} after scrolling up`).toBe(0);

    // Near the top the dock always reveals, whatever the gesture direction.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>("*")]
        .filter((e) => {
          const oy = getComputedStyle(e).overflowY;
          return (oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 2;
        })
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (el) el.scrollTop = 0;
    });
    await page.waitForTimeout(500);
    expect(await navOffset(page), `${route} back at the top`).toBe(0);

    // The true end of the list. The dock hides on the way down; one upward
    // nudge — the gesture a user makes to reach for the nav — must bring it
    // back, so nothing is ever stranded under a bar that will not return.
    //
    // Driven to CONVERGENCE rather than to `scrollHeight - clientHeight` in
    // one jump. Home's feed is virtualized (`VirtualizedJobList`), and a
    // dynamically-measured virtualizer re-estimates its total every time the
    // window moves — so a single jump lands at the end of the currently
    // measured window and the reported total then grows again. Looping until
    // the offset stops moving is what "as far down as this list goes" means on
    // a virtualized surface; on the three plain lists it settles on the first
    // pass at the real end.
    let atEnd = await scrollState(page);
    for (let i = 0; i < 15; i++) {
      const before = atEnd.top;
      await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>("*")]
          .filter((e) => {
            const oy = getComputedStyle(e).overflowY;
            return (oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 2;
          })
          .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(350);
      atEnd = await scrollState(page);
      if (atEnd.top > atEnd.max - 4 || atEnd.top - before < 4) break;
    }
    expect(atEnd.top, `${route} scrolled deep into the list`).toBeGreaterThan(1_000);

    await wheel(page, -120, 2);
    expect(await navOffset(page), `${route} recovers at the end of the list`).toBe(0);
  });
}

test("a hidden dock is taken out of the tab order, not just out of the a11y tree", async ({
  context,
  page,
  baseURL,
}) => {
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: listRules });
  await boot(page, "/my-posts");

  await wheel(page, 120, 8);
  expect(await navOffset(page), "dock hidden").toBeGreaterThan(100);

  // `aria-hidden` on a bar of buttons that are still tabbable is an
  // aria-hidden-focus violation and a real trap for keyboard/switch users.
  const state = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Bottom navigation"]');
    return {
      ariaHidden: nav?.getAttribute("aria-hidden") ?? null,
      inert: nav?.hasAttribute("inert") ?? false,
    };
  });
  expect(state.ariaHidden).toBe("true");
  expect(state.inert, "off-screen dock must be inert").toBe(true);

  // Proof rather than attribute-faith: focus cannot land inside an inert tree.
  const focused = await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>(
      'nav[aria-label="Bottom navigation"] button',
    );
    btn?.focus();
    return document.activeElement?.closest('nav[aria-label="Bottom navigation"]') !== null;
  });
  expect(focused, "a hidden dock button must not be focusable").toBe(false);
});

test("switching Home to map view cannot strand the dock off-screen", async ({
  context,
  page,
  baseURL,
}) => {
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules: listRules });
  await boot(page, "/dashboard");

  await wheel(page, 120, 8);
  expect(await navOffset(page), "dock hidden by scrolling the feed").toBeGreaterThan(100);

  // Map view sets `display:none` on the list's scroll container and renders a
  // map that never scrolls, so no further scroll event can ever fire on this
  // route. Before the fix the dock stayed 130px down — no tabs, no Post FAB.
  // Map view is no longer a top-level toolbar button — the owner moved it (and
  // saved searches) INTO the filter sheet, so reaching it is two steps now:
  // open Filters, then pick Map from the "Feed view" group. The assertion below
  // is unchanged; only the route to the control moved.
  await page.getByRole("button", { name: /^Filters/ }).first().click();
  await page
    .getByRole("group", { name: "Feed view" })
    .getByRole("button", { name: "Map", exact: true })
    .click();
  await page.waitForTimeout(1_200);

  expect(await navOffset(page), "dock must return when the scroll surface goes away").toBe(0);
});
