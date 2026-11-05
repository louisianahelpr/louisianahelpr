/**
 * runtime-probe — the three signed-in checks of e2e/happy-path/zz-runtime-probe.spec.ts,
 * ON THE REAL BACKEND (Q1035; moved from that mocked file, which keeps its
 * mock-free parts: the static channel parse, the guest boundary cases and the
 * AASA / deep-link checks).
 *
 *   1b  realtime: every channel the app joins while a real member walks the
 *       signed-in routes has a unique, nonced name, and every postgres_changes
 *       binding on the wire is filtered to that member or to a resource id.
 *   2c  a section-level render crash (the Profile legal tab's own chunk is
 *       replaced by one that throws) is contained by SectionBoundary.
 *   2d  offline: the OfflineBanner appears, the page degrades honestly and the
 *       banner goes away on reconnect.
 *
 * What changed from the mocked file is who the app talks to: the shared test
 * poster, signed in for real, so every screen draws its own prod rows and the
 * realtime socket is prod's own (the frames are read off the wire with
 * page.on("websocket"), not answered by a stub). The only things faked are the
 * crash (one of the app's own /assets/*.js answered on the client) and the
 * network loss (context.setOffline), neither of which touches prod.
 *
 * READ-ONLY BY CONSTRUCTION: every context goes through abortProdWrites (the
 * a11y-prod allow-list: reads, the token refresh and STABLE RPCs only) plus an
 * abort of the telemetry hosts, so the crash report 2c MEANS to cause never
 * leaves the browser and never reaches the owner. Any user write is recorded
 * and fails the test.
 */
import type { Browser, APIRequestContext, BrowserContext, Page, Request, WebSocket } from "@playwright/test";

import { test, expect, SUPABASE_URL, getSession, isUserWrite, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { abortProdWrites } from "../a11y-prod/abortProdWrites";

// newUserContext already blocks them; this covers any context the project builds (Q1164).
test.use({ serviceWorkers: "block" });

/** Telemetry the app sends off-Supabase: never let a deliberate failure reach Sentry, PostHog or Vercel. */
const TELEMETRY_HOSTS = /(^|\.)(sentry\.io|sentry-cdn\.com|posthog\.com|vercel-insights\.com)$/;

const rotation: Rotation = { ...rotationFor(22), network: "fast" };
/** Every SCENARIO pin that names this journey runs all of it ("runtime-probe"). */
function titleFor(slug: string) {
  return scenarioTitle({ journey: `runtime-probe-${slug}`, persona: "poster-only", state: "approved", rotation, outcome: "smooth" });
}

type Opened = { page: Page; context: BrowserContext; writes: string[]; selfId: string };

/** The shared test poster, signed in for real; prod writes and telemetry aborted, user writes recorded. */
async function open(browser: Browser, request: APIRequestContext, title: string): Promise<Opened> {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const session = await getSession(request, "poster");
  const context = await newUserContext(browser, session);
  const writes: string[] = [];
  context.on("request", (req: Request) => {
    if (isUserWrite(req.method(), req.url())) writes.push(`${req.method()} ${req.url().slice(0, 140)}`);
  });
  await abortProdWrites(context, SUPABASE_URL, test.info().outputPath());
  await context.route(
    (u) => TELEMETRY_HOSTS.test(u.hostname),
    (route) => route.abort("blockedbyclient"),
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 375, height: 812 });
  return { page, context, writes, selfId: session.user.id };
}

async function done(o: Opened) {
  await o.context.close().catch(() => {});
  expect(o.writes, "the runtime-probe journey is read-only: no user writes").toEqual([]);
}

async function shot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  test.info().annotations.push({ type: "screenshot", description: path });
}

// ───────────────────────────────────────────────────────────────────────────
// 1b. realtime, read off prod's own socket
// ───────────────────────────────────────────────────────────────────────────

interface Binding { event?: string; schema?: string; table?: string; filter?: string }
interface Join { topic: string; joinRef: string | null; ref: string | null; bindings: Binding[] }

/**
 * Records the Phoenix v2 frames (`[join_ref, ref, topic, event, payload]`) on
 * every realtime socket the page opens. A real server can refuse a join and the
 * client then re-joins the same topic, so a topic counts as a DUPLICATE only
 * when it is joined again while an earlier join of it was answered "ok" and was
 * never left or closed since: that is the collision Supabase dedupes silently.
 */
function recordRealtime(page: Page) {
  const joins: Join[] = [];
  const socketUrls: string[] = [];
  const live = new Map<string, string>(); // topic -> join ref answered ok
  const pendingJoin = new Map<string, string>(); // ref -> topic
  const duplicates: string[] = [];
  const parse = (raw: string | Buffer): unknown[] | null => {
    try {
      const v = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      return Array.isArray(v) ? v : null;
    } catch {
      return null; // binary broadcast frames carry no join
    }
  };
  page.on("websocket", (ws: WebSocket) => {
    if (!ws.url().includes("/realtime/v1/websocket")) return;
    socketUrls.push(ws.url().replace(/([?&](apikey|access_token)=)[^&]+/g, "$1<redacted>"));
    ws.on("framesent", (f) => {
      const m = parse(f.payload);
      if (!m) return;
      const [joinRef, ref, topic, event, payload] = m as [string | null, string | null, string, string, Record<string, unknown>?];
      if (event === "phx_join") {
        const cfg = (payload?.config ?? {}) as { postgres_changes?: Binding[] };
        if (live.has(topic)) duplicates.push(topic);
        joins.push({ topic, joinRef, ref, bindings: cfg.postgres_changes ?? [] });
        if (ref) pendingJoin.set(ref, topic);
      } else if (event === "phx_leave") {
        live.delete(topic);
      }
    });
    ws.on("framereceived", (f) => {
      const m = parse(f.payload);
      if (!m) return;
      const [, ref, topic, event, payload] = m as [string | null, string | null, string, string, { status?: string }?];
      if (event === "phx_reply" && ref && pendingJoin.get(ref) === topic) {
        pendingJoin.delete(ref);
        if (payload?.status === "ok") live.set(topic, ref);
      } else if (event === "phx_close" || event === "phx_error") {
        live.delete(topic);
      }
    });
    ws.on("close", () => live.clear());
  });
  return { joins, socketUrls, duplicates };
}

const AUTHED_ROUTES = ["/home", "/jobs", "/jobs?tab=posted", "/jobs?tab=working", "/messages", "/profile"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * One test per route, each a fresh page session (the scope Supabase dedupes
 * in), so no single test carries the whole walk's requests (the journeys
 * request budget is per test). Every signed-in page mounts the nav badges,
 * which subscribe through the per-user bus (src/lib/userRealtimeBus.ts,
 * `user_id=eq.<me>`), so every route must show at least one join and one
 * member-scoped binding: zero means the capture is broken, not "nothing to see".
 */
for (const route of AUTHED_ROUTES) {
  const slug = route.replace(/^\//, "").replace(/[?=&]/g, "-");
  const realtimeTitle = titleFor(`realtime-${slug}`);
  test(realtimeTitle, async ({ browser, request }) => {
    const o = await open(browser, request, realtimeTitle);
    try {
      const rec = recordRealtime(o.page);
      await o.page.goto(route, { waitUntil: "domcontentloaded" });
      await o.page.waitForTimeout(5000); // let the subscribing effects mount + join
      const joins = [...rec.joins];
      test.info().annotations.push({
        type: "realtime",
        description: `${route}: ${joins.length} joins on ${rec.socketUrls.length} socket(s): ${joins.map((j) => j.topic).join(", ")}`,
      });

      expect(rec.socketUrls.length, `${route}: no realtime socket opened (capture is broken)`).toBeGreaterThan(0);
      expect(joins.length, `${route}: no realtime channels were joined (capture is broken)`).toBeGreaterThan(0);

      // (1) No live duplicate channel names (the second subscription is dropped).
      expect([...new Set(rec.duplicates)], `${route}: duplicate realtime channel names (second subscription is dropped)`).toEqual([]);

      // (2) Every name carries a nonce (a UUID from channelNonce()).
      const unnonced = [...new Set(joins.map((j) => j.topic).filter((t) => !UUID.test(t)))];
      expect(unnonced, `${route}: channel names joined without a channelNonce() UUID`).toEqual([]);

      // (3) Every postgres_changes binding on the wire carries a server-side
      //     filter, except the one documented messages DELETE.
      const wire = joins.flatMap((j) => j.bindings.map((b) => ({ topic: j.topic, ...b })));
      const unfiltered = wire.filter((b) => !b.filter).map((b) => `${b.topic} → ${b.event} ${b.schema}.${b.table}`);
      expect(
        unfiltered.filter((s) => !/→ DELETE public\.messages$/.test(s)),
        `${route}: unfiltered postgres_changes bindings from a non-admin session`,
      ).toEqual([]);

      // (4) Every filtered binding is scoped to this member or to a resource id.
      const foreign = wire
        .filter((b) => b.filter)
        .filter((b) => {
          const value = b.filter!.split("=eq.")[1] ?? "";
          return value !== o.selfId && !UUID.test(value);
        })
        .map((b) => `${b.topic} → ${b.filter}`);
      expect(foreign, `${route}: postgres_changes filters not scoped to this member or a resource id`).toEqual([]);
      const selfScoped = wire.filter((b) => b.filter?.endsWith(`=eq.${o.selfId}`));
      expect(selfScoped.length, `${route}: expected at least one member-scoped filter on the wire`).toBeGreaterThan(0);
    } finally {
      await done(o);
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 2c. a section-level crash stays inside its section
// ───────────────────────────────────────────────────────────────────────────

const THROWING_SECTION_CHUNK =
  `export function LegalTab(){ throw new Error("PROBE: forced section render crash"); }\n` +
  `export default LegalTab;\n`;

const sectionTitle = titleFor("section-crash");
test(sectionTitle, async ({ browser, request }) => {
  const o = await open(browser, request, sectionTitle);
  try {
    // The Profile "legal" tab panel is its own lazy chunk consumed as a NAMED
    // export (`m.LegalTab`), so Rollup keeps the public name: a replacement
    // module exporting a throwing `LegalTab` drops straight in.
    await o.page.route("**/assets/LegalTab-*.js", (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: THROWING_SECTION_CHUNK }),
    );
    await o.page.goto("/profile?tab=legal", { waitUntil: "domcontentloaded" });

    await expect(o.page.getByText("Couldn't load the legal section.", { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(o.page.getByText("The rest of the page is still fine.", { exact: false })).toBeVisible();
    await expect(o.page.getByRole("button", { name: /Try again/i })).toBeVisible();
    await shot(o.page, "runtime-probe-section-crash");

    // Containment: the route did NOT fall through to the route-level boundary.
    const body = await o.page.locator("body").innerText();
    expect(body).not.toContain("This page hit a problem.");
    expect(body).not.toContain("Something went sideways.");
  } finally {
    await done(o);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 2d. offline degrades honestly
// ───────────────────────────────────────────────────────────────────────────

const offlineTitle = titleFor("offline");
test(offlineTitle, async ({ browser, request }) => {
  const o = await open(browser, request, offlineTitle);
  try {
    // Load fully FIRST: OfflineBanner is itself a lazy chunk, so going offline
    // before it loads would only prove the chunk can't be fetched.
    await o.page.goto("/home", { waitUntil: "load" });
    await o.page.waitForTimeout(1500);
    await expect(o.page.getByText("You're offline", { exact: false })).toHaveCount(0);

    // The app confirms "offline" with a probe to the auth health endpoint
    // (src/lib/connectivity.ts); abort it the way a real lost network fails it.
    const HEALTH = "**/auth/v1/health*";
    await o.page.route(HEALTH, (r) => r.abort("internetdisconnected"));
    await o.context.setOffline(true);
    await o.page.evaluate(() => window.dispatchEvent(new Event("offline")));

    const banner = o.page.getByRole("status").filter({ hasText: "You're offline" });
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(o.page.getByText("You're offline. Reconnect to load anything new.")).toBeVisible();
    await shot(o.page, "runtime-probe-offline");

    // Degrades honestly: content still on screen, and no promise of a retry
    // queue the app doesn't have.
    const body = await o.page.locator("body").innerText();
    expect(body.trim().length).toBeGreaterThan(50);
    expect(body).not.toMatch(/will retry automatically|reconnecting…?/i);

    // …and it goes away again.
    await o.page.unroute(HEALTH);
    await o.context.setOffline(false);
    await o.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(o.page.getByText("You're offline. Reconnect to load anything new.")).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await done(o);
  }
});
