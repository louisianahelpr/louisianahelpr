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
 * ON THE REAL BACKEND (Q1035; moved from the mocked e2e/happy-path/nav-hide-on-scroll.spec.ts).
 * The bodies are the same. The lists are the real test accounts' own prod rows instead of 30 seeded ones: the
 * poster's inbox and its Posted list (All), and the Helpr's Working list (All). Jobs > Browse is NOT measured here:
 * prod's open feed held 0 rows (open_jobs_browse, read-only, 2026-11-05 ~04:25Z), so it has nothing to scroll.
 * That left the map-view case ("a hidden dock comes back when its scroll surface goes away") with no surface on
 * prod; its invariant and @mutate moved to src/components/mobileNav/useDockScrollState.test.ts, which drives the
 * real hook's ResizeObserver path.
 *
 * READ-ONLY BY CONSTRUCTION: every context goes through abortProdWrites (the a11y-prod allow-list) plus an abort
 * of the telemetry hosts, and any user write fails the test.
 *
 * Assertions are on the nav's own translateY, taken from the computed
 * transform matrix: 0 = docked, ~130 = slid off the bottom. Reading the class
 * list or `aria-hidden` would pass on a bar that never actually moved.
 */
import type { APIRequestContext, Browser, BrowserContext, Page, Request } from "@playwright/test";
import { test, expect, SUPABASE_URL, getSession, isUserWrite, newUserContext, sessionsAvailable, type Role } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { abortProdWrites } from "../a11y-prod/abortProdWrites";
import { defaultInboxTab } from "../../src/lib/inboxDefault";

/** Telemetry the app sends off-Supabase: never let a test run reach Sentry, PostHog or Vercel. */
const TELEMETRY_HOSTS = /(^|\.)(sentry\.io|sentry-cdn\.com|posthog\.com|vercel-insights\.com)$/;

// newUserContext already blocks them; this covers any context the project builds (Q1164).
test.use({ serviceWorkers: "block" });

/** One SCENARIO pin runs this file and messages-thread together ("thread-dock"). */
const rotation: Rotation = { ...rotationFor(23), network: "fast" };
const scrollName = (slug: string, role: Role) =>
  scenarioTitle({
    journey: `thread-dock-scroll-${slug}`,
    persona: role === "helper" ? "helper-only" : "poster-only",
    state: "approved",
    rotation,
    outcome: "smooth",
  });

type Opened = { page: Page; context: BrowserContext; writes: string[] };

/** A real test account signed in, prod writes and telemetry aborted, user writes recorded. */
async function open(browser: Browser, request: APIRequestContext, role: Role, title: string): Promise<Opened> {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const context = await newUserContext(browser, await getSession(request, role));
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

/** A test body run as `role`; the context closes and the write check runs whatever happens. */
function as(role: Role, slug: string, body: (page: Page) => Promise<void>) {
  return async ({ browser, request }: { browser: Browser; request: APIRequestContext }) => {
    const o = await open(browser, request, role, scrollName(slug, role));
    try {
      await body(o.page);
    } finally {
      await o.context.close().catch(() => {});
      expect(o.writes, "the dock check is read-only: no user writes").toEqual([]);
    }
  };
}

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

/**
 * Wait for the dock to FINISH moving to where it belongs, then assert it.
 *
 * The dock slides on a 0.28s CSS transition, and `getComputedStyle().transform`
 * reads the transition's CURRENT value — which only advances when the engine
 * runs a rendering update. nightly-webkit 34924529210 (Linux WebKit, two
 * workers on a CI runner) proved a single read after a fixed 500ms wait is not
 * enough there: the trace's DOM snapshot shows the app HAD hidden the dock
 * after the second scroll step (`aria-hidden="true"`, `inert`, inline
 * `translateY(calc(var(--safe-area-bottom, 0px) + 130px))`), yet the read
 * returned 0, and the screencast had painted no frame for 1.6s around it. So
 * this polls the painted position instead of trusting one sample: a dock that
 * never hides (or never returns) still fails, after the timeout.
 */
async function expectDock(page: Page, where: "hidden" | "docked", message: string) {
  const offset = expect.poll(() => navOffset(page), { message, timeout: 5_000 });
  if (where === "hidden") await offset.toBeGreaterThan(100);
  else await offset.toBe(0);
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

/**
 * Scroll the route by `dy`, `steps` times.
 *
 * Mobile WebKit has no wheel: Playwright throws "Mouse wheel is not supported
 * in mobile WebKit", which is what took the whole nightly-webkit run red
 * (2026-09-14) — six of its seventeen failures were this one line, in a
 * project whose whole point is WKWebView parity. Scrolling the container
 * directly is not a weaker substitute here: the dock listens for `scroll` in
 * the capture phase (MobileNav.tsx's `checkScroll`) and never for `wheel`, so
 * both paths deliver the app exactly the same event.
 */
/** 120px wheel steps that go well past the 64px hide threshold but stop >=150px short of the list's end. */
function downSteps(travel: number): number {
  return Math.max(2, Math.min(8, Math.floor((travel - 150) / 120)));
}

async function wheel(page: Page, dy: number, steps: number) {
  await page.mouse.move(187, 500).catch(() => undefined);
  for (let i = 0; i < steps; i++) {
    try {
      await page.mouse.wheel(0, dy);
    } catch {
      await page.evaluate((d) => {
        // The same "tallest genuinely-scrollable region" scrollState() reads,
        // so the scroll lands where the assertions are looking.
        const els = [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
          const oy = getComputedStyle(el).overflowY;
          return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 2;
        });
        const el = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (el) el.scrollBy(0, d);
        else window.scrollBy(0, d);
      }, dy);
    }
    await page.waitForTimeout(70);
  }
  // Longer than the 0.28s slide so the transform has settled before we read it.
  await page.waitForTimeout(500);
}

// The real accounts' own lists, each long enough to scroll at 375x812 (measured read-only 2026-11-05 ~04:25Z:
// the poster has 30 threads and 672 posted jobs, 133 completed; the Helpr is hired on 121, 111 completed). "All" so no bucket default can leave a
// list empty. Jobs > Browse is not here: prod's open feed has nothing to scroll (see the file header).
const ROUTES: { route: string; role: Role; slug: string }[] = [
  { route: "/messages", role: "poster", slug: "inbox" },
  { route: "/jobs?tab=posted&filter=all", role: "poster", slug: "posted" },
  { route: "/jobs?tab=working&filter=all", role: "helper", slug: "working" },
];

for (const { route, role, slug } of ROUTES) {
  test(`${scrollName(slug, role)} · dock hides on scroll-down and returns on scroll-up @ ${route}`, as(role, slug, async (page) => {
    await boot(page, route);

    // This spec is about the dock hiding on scroll, not about which inbox tab
    // is default — so it asks the rule rather than restating it. The seeded
    // customer has read everything, so defaultInboxTab lands on All and the
    // rows are already there; if the rule ever changes to open somewhere with
    // no rows, this switches to a tab that has some instead of failing on a
    // premise it only assumed.
    if (route === "/messages" && defaultInboxTab(0) !== "all") {
      // On a phone Active/All live in the search row's "more" menu (Q2231);
      // on the desktop website the strip is inline.
      const more = page.getByRole("button", { name: "More conversation options" });
      if (await more.count()) {
        await more.first().click();
        await page.getByRole("menuitemradio", { name: /^Any status/ }).first().click();
      } else {
        await page.getByRole("tab", { name: /^Any status/ }).or(
          page.getByRole("button", { name: /^Any status/ }),
        ).first().click();
      }
      await page.waitForTimeout(600);
    }

    // The premise of the whole spec: there IS something to scroll. Without
    // this guard a route that quietly stopped rendering rows would report a
    // dock that "correctly stays visible".
    const initial = await scrollState(page);
    expect(initial.found, `${route} has no scrollable region — nothing to hide for`).toBe(true);
    expect(initial.max, `${route} scroll range`).toBeGreaterThan(400);

    await expectDock(page, "docked", `${route} docked at rest`);

    // Down, but short of the end: at the end the dock comes back on its own (dockRevealsAtEnd, DA-9), so a list
    // shorter than 8 x 120px would read as "never hid". The real Working list measured ~400-960px of travel
    // (run 41972344165, 2026-11-05: it hit the end and the dock was rightly back).
    await wheel(page, 120, downSteps(initial.max));
    await expectDock(page, "hidden", `${route} after scrolling down`);

    await wheel(page, -120, 3);
    await expectDock(page, "docked", `${route} after scrolling up`);

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
    await expectDock(page, "docked", `${route} back at the top`);

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
    // At the real end (the prod lists are the accounts' own rows, some under 1,000px of travel).
    expect(atEnd.top, `${route} scrolled to the end of the list`).toBeGreaterThan(Math.max(400, atEnd.max - 4));

    await wheel(page, -120, 2);
    await expectDock(page, "docked", `${route} recovers at the end of the list`);
  }));
}

test(`${scrollName("tab-order", "poster")} · a hidden dock is taken out of the tab order, not just out of the a11y tree`, as("poster", "tab-order", async (page) => {
  // DEEP-LINK TO A BUCKET THAT HAS ROWS. This spec is about the dock leaving
  // the tab order when it hides, not about which bucket My Posts opens on —
  // and it needs a scrollable list to hide the dock at all. The seeded jobs are
  // open with no applications, so they sit under Waiting; My Posts opens on
  // "Needs you", which for this fixture is legitimately empty.
  //
  // It used to land on them anyway, because Activity.tsx silently moved the
  // selection to the first non-empty bucket on first load. That effect is gone
  // (it contradicted defaultStatusFilterFor's "deliberately NO automatic
  // fallback", and the empty state now offers the jump as a button instead), so
  // this asks for the populated bucket by name — the same accommodation the
  // inbox case above already makes for the same reason.
  await boot(page, "/jobs?tab=posted&filter=all");

  await wheel(page, 120, 8);
  await expectDock(page, "hidden", "dock hidden");

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
}));

// The map-view case ("switching Jobs > Browse to map view cannot strand the dock off-screen") and its
// useDockScrollState @mutate moved to src/components/mobileNav/useDockScrollState.test.ts: prod's open feed has no
// rows to scroll, so the case has no surface here (see the file header).

/**
 * THE DOCK LABELS, MEASURED (owner, 2026-10-19: a one-word label under each
 * icon, one line, never cut, at 320 with all six tabs). The source half is
 * src/test/dockLabelsOneLine.test.ts; this is the pixel half: each label is
 * one line, shows every letter, stays inside the dock and the viewport, and
 * no two labels touch.
 */
for (const width of [320, 375]) {
  test(`${scrollName(`labels-${width}`, "poster")} · dock labels: one line, uncut, none touching @ ${width}`, as("poster", `labels-${width}`, async (page) => {
    await boot(page, "/home");
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Bottom navigation"]');
      const navBox = nav?.getBoundingClientRect();
      const labels = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Bottom navigation"] [data-dock-label]')]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(el).lineHeight) || 13;
          return { text: (el.textContent ?? "").trim(), left: r.left, right: r.right, h: r.height, lh, cut: el.scrollWidth > el.clientWidth + 0.5 };
        })
        .sort((a, b) => a.left - b.left);
      return { labels, navLeft: navBox?.left ?? 0, navRight: navBox?.right ?? 0, vw: innerWidth };
    });
    // Floor: Home + Messages always, plus the member's sections.
    expect(m.labels.length, `labels=${JSON.stringify(m.labels.map((l) => l.text))}`).toBeGreaterThanOrEqual(4);
    for (const l of m.labels) {
      expect(l.text.length, "a dock label is empty").toBeGreaterThan(1);
      expect(l.h, `"${l.text}" wraps to a second line`).toBeLessThanOrEqual(l.lh * 1.5);
      expect(l.cut, `"${l.text}" is cut`).toBe(false);
      expect(l.left, `"${l.text}" leaves the dock on the left`).toBeGreaterThanOrEqual(Math.max(0, m.navLeft) - 0.5);
      expect(l.right, `"${l.text}" leaves the dock on the right`).toBeLessThanOrEqual(Math.min(m.vw, m.navRight) + 0.5);
    }
    for (let i = 1; i < m.labels.length; i++) {
      const a = m.labels[i - 1], b = m.labels[i];
      expect(b.left - a.right, `"${a.text}" and "${b.text}" touch at ${width}`).toBeGreaterThanOrEqual(1);
    }
  }));
}
