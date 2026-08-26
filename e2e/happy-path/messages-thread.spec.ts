import {
  test,
  expect,
  FAKE_CUSTOMER,
  installSupabaseMocks,
  mockTable,
  seedAuthedSession,
  checkA11y,
} from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { SEED_JOBS, SEED_MESSAGES, CUSTOMER_ID, HELPER_ID } from "./seedData";

/**
 * Messages: the bottom nav must never disappear over the INBOX, and the
 * composer must fit the screen.
 *
 * THE BUG THIS EXISTS FOR (owner, on device): "Where is the bottom nav? I'm
 * stuck here" — on the Messages LIST, with no thread open. `MobileNav` hides
 * the entire bottom dock while `/messages` carries `?chat=1`, and that flag
 * was set from component state by `openConvo` and removed by nothing. The two
 * desynced on every remount that kept the URL:
 *
 *   - open a thread → ⋮ → View profile → back;
 *   - and worst of all a native resume: RouteMemory records `pathname +
 *     search`, so a WKWebView jetsam-reload restores `/messages?chat=1` into a
 *     fresh app process with no thread open at all.
 *
 * Either way the user lands on the inbox with no bottom nav, no back button,
 * and no way out of Messages. `replace: true` on the open made it worse — it
 * overwrote the `/messages` history entry, so the back gesture left Messages
 * entirely rather than closing the thread.
 *
 * The contract is now: `?chat=1` is present ⟺ a thread is really open, both
 * directions, enforced in src/pages/Messages.tsx. Each case below is one of
 * the paths that broke it.
 */

const NAV = 'nav[aria-label="Bottom navigation"]';
/** The seeded thread: SEED_MESSAGES all hang off SEED_JOBS[1]. */
const THREAD_JOB_ID = SEED_JOBS[1].id;

async function setup(page: Page, context: BrowserContext, baseURL: string | undefined) {
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
}

async function gotoMessages(page: Page, url = "/messages") {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/**
 * Opens the seeded conversation and waits for the thread to be on screen.
 *
 * The thread's own back button only exists on the phone layout — the desktop
 * website (>=1024px) renders the list and the thread side by side, so there is
 * nothing to go "back" from. The composer dock is the surface both layouts
 * share, so that is what we wait on.
 */
async function openFirstThread(page: Page) {
  // The row wrapper contains buttons, so it can't be one itself — the inner
  // name/preview button is what opens the thread (see ConversationRow).
  const row = page
    .locator("button")
    .filter({ hasText: SEED_JOBS[1].title.slice(0, 40) })
    .first();
  await row.waitFor();
  await row.click();
  await expect(page.locator(".glass-dock")).toBeVisible();
}

test.describe("Messages — the bottom nav can never strand the user", () => {
  test("(e) reached from the bottom nav: the list shows its nav immediately", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await gotoMessages(page);
    await expect(page.locator(NAV)).toBeVisible();
    expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
  });

  test("(a)+(b) open a thread → nav hidden; back out → nav visible and the flag is gone", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await gotoMessages(page);
    await expect(page.locator(NAV)).toBeVisible();

    await openFirstThread(page);
    // (a) An open conversation owns the whole screen — no bottom dock.
    await expect(page.locator(NAV)).toBeHidden();
    expect(new URL(page.url()).searchParams.get("chat")).toBe("1");

    // (b) The header back button.
    await page.getByRole("button", { name: "Back to conversations" }).click();
    await expect(page.locator(NAV)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/messages");
    expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
  });

  test("(c) hardware/gesture back from a thread lands on the LIST with its nav — not out of Messages", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await gotoMessages(page, "/dashboard");
    await gotoMessages(page);
    await openFirstThread(page);
    expect(new URL(page.url()).searchParams.get("chat")).toBe("1");

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Still in Messages, on the list, with a way out.
    expect(new URL(page.url()).pathname).toBe("/messages");
    expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
    await expect(page.locator(NAV)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to conversations" }),
    ).toBeHidden();
  });

  test("(d) deep-linked straight into a thread, then back → list with nav", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await gotoMessages(
      page,
      `/messages?jobId=${THREAD_JOB_ID}&userId=${HELPER_ID}`,
    );
    await expect(
      page.getByRole("button", { name: "Back to conversations" }),
    ).toBeVisible();
    await expect(page.locator(NAV)).toBeHidden();

    await page.getByRole("button", { name: "Back to conversations" }).click();
    await expect(page.locator(NAV)).toBeVisible();
    expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
  });

  test("a stale ?chat=1 with no thread behind it heals itself — the native-resume repro", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    // Exactly what NativeLaunchRouter restores from RouteMemory after iOS
    // jetsams the WebView: the flagged URL, a brand-new app process, no
    // thread open. This is the state the owner was stranded in.
    await gotoMessages(page, "/messages?chat=1");

    await expect(page.locator(NAV)).toBeVisible();
    expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
    // And it's the LIST, not a half-open thread.
    await expect(
      page.getByRole("button", { name: "Back to conversations" }),
    ).toBeHidden();
  });
});

test.describe("Messages thread — fit, a11y and tap targets", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const [label, size] of [
      ["375", { width: 375, height: 812 }],
      ["1440", { width: 1440, height: 900 }],
    ] as const) {
      test(`fits with zero overflow at ${label} (${scheme})`, async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(size);
        await gotoMessages(page);
        await openFirstThread(page);

        const fit = await page.evaluate(() => {
          const de = document.documentElement;
          const vw = de.clientWidth;
          const wide: string[] = [];
          document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > vw + 1 && r.height > 0) {
              wide.push(`${el.tagName}.${el.className}`.slice(0, 120));
            }
          });
          return {
            scrollWidth: de.scrollWidth,
            clientWidth: vw,
            h1: document.querySelectorAll("h1").length,
            wide: wide.slice(0, 5),
          };
        });

        expect(fit.wide).toEqual([]);
        expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
        expect(fit.h1).toBe(1);
      });
    }
  }

  test("every tap target in an open thread clears 44px", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await gotoMessages(page);
    await openFirstThread(page);

    const small = await page.evaluate(() => {
      const out: string[] = [];
      document
        .querySelectorAll<HTMLElement>(
          'button:not([role="checkbox"]):not([role="radio"]):not([role="switch"]), a[role="button"]',
        )
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          // Invisible / unrendered controls have no tap target to measure.
          if (r.width === 0 || r.height === 0) return;
          if (r.width < 44 || r.height < 44) {
            out.push(
              `${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        });
      return out;
    });

    expect(small).toEqual([]);
  });

  test("no axe violations on the list or in an open thread", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await gotoMessages(page);
    await checkA11y(page, { context: "#main-content" });
    await openFirstThread(page);
    await checkA11y(page, { context: "#main-content" });
  });
});

test.describe("Messages composer — sits ON the safe area, not past it", () => {
  /**
   * The dock's bottom inset came from `env(safe-area-inset-bottom, 12px)`,
   * which resolves to 0px — not 12px — whenever the inset is zero, and which
   * WebKit additionally reports as 0 inside a fixed descendant of a
   * transformed ancestor (exactly what this dock is). Either way the input
   * row ended up flush on the physical bottom edge with the dock's white
   * material running underneath it: "the bottom doesn't fit the screen".
   *
   * `--safe-area-bottom` is resolved once at `:root` (index.css) so it can be
   * both correct on device and SET here — a browser reports no inset at all,
   * so without the variable a home-indicator layout is simply untestable.
   */
  /**
   * measureDock is a STRING of page-side JS, so page.evaluate cannot infer what
   * comes back and every field read off it was `unknown` — which is why this
   * file was invisible to tsc until e2e joined the build. Naming the shape once
   * restores the checking without changing what runs in the browser.
   */
  type DockMetrics = {
    error?: string;
    paddingBottom: number;
    dockBottom: number;
    dockTop: number;
    viewportBottom: number;
    // null when the composer input is absent — the assertions guard for it.
    inputBottom: number | null;
    gap: number | null;
  };

  const measureDock = `(() => {
    const dock = document.querySelector(".glass-dock");
    if (!dock) return { error: "composer dock not found" };
    const r = dock.getBoundingClientRect();
    const cs = getComputedStyle(dock);
    const input = document.querySelector(".glass-dock input, .glass-dock textarea");
    return {
      paddingBottom: parseFloat(cs.paddingBottom),
      dockBottom: Math.round(r.bottom),
      dockTop: Math.round(r.top),
      viewportBottom: document.documentElement.clientHeight,
      inputBottom: input ? Math.round(input.getBoundingClientRect().bottom) : null,
    };
  })()`;

  test("with no home indicator the dock still keeps a 12px floor and ends at the viewport edge", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoMessages(page);
    await openFirstThread(page);

    const m = await page.evaluate<DockMetrics>(measureDock);
    expect(m.error).toBeUndefined();
    // The old `env(..., 12px)` gave 0 here — the input sat on the edge.
    expect(m.paddingBottom).toBeGreaterThanOrEqual(12);
    // Dock ends exactly at the bottom of the locked viewport: nothing is
    // clipped below it, and nothing is left over above it.
    expect(Math.abs(m.dockBottom - m.viewportBottom)).toBeLessThanOrEqual(1);
    expect(m.dockTop).toBeGreaterThan(0);
  });

  test("with a 34px home indicator the input clears it and nothing is clipped", async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoMessages(page);
    await openFirstThread(page);
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--safe-area-bottom", "34px"),
    );

    const m = await page.evaluate<DockMetrics>(measureDock);
    expect(m.paddingBottom).toBe(34);
    expect(Math.abs(m.dockBottom - m.viewportBottom)).toBeLessThanOrEqual(1);
    // The input row itself stops above the home-indicator strip.
    expect(m.inputBottom).not.toBeNull();
    expect(m.viewportBottom - (m.inputBottom as number)).toBeGreaterThanOrEqual(30);
    // And the dock still fits — its top edge is on screen.
    expect(m.dockTop).toBeGreaterThan(0);
  });
});

test.describe("Messages thread — system events read as ONE kind of thing", () => {
  /**
   * A thread learns about job transitions two ways, and both used to draw
   * themselves differently on the same screen: derived `jobSystemEvents` as a
   * bordered pill, and stored `is_system` rows as loose centred text carrying
   * a literal glyph baked into the DB content by the job-status trigger
   * (`✓ Job awarded`, `▶ Work started`). Emoji-as-iconography is also off-brand
   * beside this app's Lucide strokes.
   *
   * The glyphs live in rows already written to `public.messages`, so they are
   * normalised at RENDER — a trigger-only change would fix new threads and
   * leave every existing one mixed.
   */
  const SYSTEM_ROWS = [
    ...SEED_MESSAGES,
    {
      id: "30000000-0000-4000-8000-0000000000a1",
      job_id: SEED_JOBS[1].id,
      sender_id: CUSTOMER_ID,
      receiver_id: HELPER_ID,
      content: "✓ Job awarded",
      created_at: "2026-08-12T09:00:00.000Z",
      read: true,
      is_system: true,
    },
    {
      id: "30000000-0000-4000-8000-0000000000a2",
      job_id: SEED_JOBS[1].id,
      sender_id: CUSTOMER_ID,
      receiver_id: HELPER_ID,
      content: "▶ Work started",
      created_at: "2026-08-12T09:05:00.000Z",
      read: true,
      is_system: true,
    },
  ];

  test("stored system rows render as the same pill as derived ones, with icons instead of glyphs", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      seed: true,
      rules: [mockTable("messages", SYSTEM_ROWS)],
    });
    await gotoMessages(page);
    await openFirstThread(page);

    const notes = page.locator('[role="note"]');
    await expect(notes.filter({ hasText: "Job awarded" })).toHaveCount(1);
    await expect(notes.filter({ hasText: "Work started" })).toHaveCount(1);

    // One treatment: every system row is the same pill, and each carries a
    // real (Lucide) icon rather than a text glyph.
    const shape = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[role="note"]'));
      return rows.map((r) => ({
        text: (r.textContent ?? "").trim(),
        svgs: r.querySelectorAll("svg").length,
        radius: getComputedStyle(r).borderTopLeftRadius,
      }));
    });
    expect(shape.length).toBeGreaterThanOrEqual(2);
    for (const row of shape) {
      expect(row.svgs).toBeGreaterThanOrEqual(1);
      // No emoji / dingbat survives into the rendered label.
      expect(row.text).not.toMatch(/[✓▶✕⚠]/);
    }
    // All system rows share one radius — i.e. one visual idiom, not two.
    expect(new Set(shape.map((r) => r.radius)).size).toBe(1);
  });
});
