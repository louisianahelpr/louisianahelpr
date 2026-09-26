import { test, expect } from "../prodTest";
import { clearConsentGate, newUserContext, sessionFor, writeFirewall } from "./harness";
import { spacingScreens } from "./shellSpacing";
import { sampleRetention, spaNavigate, type RetentionSample } from "../memory/retention";

/**
 * Q440 (PD-009 follow-up): route changes keep no old page alive — SIGNED IN.
 *
 * The guest walk (e2e/memory/route-retention.spec.ts) covers the public routes
 * on every PR. The signed-in surface adds what a guest never mounts: realtime
 * channels, React Query caches for jobs/messages/notifications, the bottom
 * nav's shared-layout pills and the Profile tabs' (LegalTab, SubscriptionTab).
 * This walks every signed-in route in the app's own inventory
 * (`spacingScreens()`, the audit catalog that src/test/auditCatalogRoutes
 * proves is every route in src/App.tsx) as the poster account, lap after lap,
 * and applies the same measure (e2e/memory/retention.ts).
 *
 * Read-only: the context is behind `writeFirewall` (reads, token refresh and
 * the tester's own terms acceptance pass; every other write is refused), so a
 * walk over prod changes nothing.
 *
 * Runs in prod-audit.yml (nightly, and on demand: dispatch with grep "Q440").
 *
 * Shown able to fail: with SharedLayoutPill's release removed the retained
 * pages come back (see the numbers recorded beside the budgets).
 * @mutate src/components/ui/SharedLayoutPill.tsx | stacks.delete(layoutId); | void stacks;
 */

const ROUTES = spacingScreens()
  .filter((s) => s.auth === "poster")
  .map((s) => s.url);
const LAPS = 3;
/** Detached nodes still retained after GC. A whole retained page is hundreds. */
const DETACHED_NODE_BUDGET = 300;
/** Renderer node growth from the first measured lap to the last. */
const NODE_GROWTH_BUDGET = 100;
/** JSEventListeners growth from the first measured lap to the last. */
const LISTENER_GROWTH_BUDGET = 20;

test.describe("Q440 route retention, signed in", () => {
  test("Q440: signed-in route round-trips do not retain old pages, nodes or listeners", async ({ browser, request }) => {
    test.setTimeout(8 * 60_000);
    // Inventory floor: the catalog really gave us the signed-in surface.
    expect(ROUTES.length, "signed-in routes from spacingScreens()").toBeGreaterThan(20);

    const poster = await sessionFor(request, "poster");
    const ctx = await newUserContext(browser, poster);
    const blocked = await writeFirewall(ctx);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");

    await page.goto(ROUTES[0], { waitUntil: "domcontentloaded" });
    await clearConsentGate(page);
    await expect.poll(() => page.evaluate(() => location.pathname), { timeout: 20_000 }).not.toMatch(/^\/(login|signup)/);
    // First interaction loads analytics (src/main.tsx); its listeners are app-lifetime.
    await page.keyboard.press("Shift");
    // Warm lap: first-load chunks, fonts, analytics and caches are not retention.
    for (const r of ROUTES) await spaNavigate(page, r);

    const samples: RetentionSample[] = [];
    const landed: string[] = [];
    for (let lap = 1; lap <= LAPS; lap++) {
      for (const r of ROUTES) {
        await spaNavigate(page, r);
        if (lap === 1) landed.push(await page.evaluate(() => location.pathname));
      }
      samples.push(await sampleRetention(page, cdp, lap));
    }
    console.log(`[Q440] routes=${ROUTES.length} ${JSON.stringify(samples)}`);
    await test.info().attach("route-retention-signed-in.json", {
      body: JSON.stringify({ routes: ROUTES, landed, samples, blockedWrites: blocked }, null, 2),
      contentType: "application/json",
    });

    // Still signed in at the end: a walk that fell back to /login measured the guest app.
    expect(landed.filter((p) => /^\/(login|signup)/.test(p)), "routes that bounced to sign-in").toEqual([]);
    expect(samples.length, "one sample per lap").toBeGreaterThan(LAPS - 1);
    const first = samples[0];
    const last = samples[samples.length - 1];
    expect(last.live, "live DOM of the last route").toBeGreaterThan(100);

    expect(last.detachedNodes, `detached DOM still retained after ${(LAPS + 1) * ROUTES.length} signed-in navigations`).toBeLessThanOrEqual(DETACHED_NODE_BUDGET);
    expect(last.nodes - first.nodes, "renderer node growth across laps").toBeLessThanOrEqual(NODE_GROWTH_BUDGET);
    expect(last.listeners - first.listeners, "event-listener growth across laps").toBeLessThanOrEqual(LISTENER_GROWTH_BUDGET);
    await ctx.close();
  });
});
