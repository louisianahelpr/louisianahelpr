/**
 * zz-runtime-probe — three never-exercised runtime behaviours.
 *
 * 1. Realtime channel scoping (CLAUDE.md house rule: every `postgres_changes`
 *    binding needs a server-side `filter` scoped to the user, and a unique
 *    channel name via `channelNonce()`). Checked BOTH statically (parse every
 *    `.channel(...).on("postgres_changes", …)` site in src/) and at RUNTIME
 *    (record the real `phx_join` frames the app pushes over the realtime
 *    websocket while walking the authed routes).
 *
 * 2. Error boundaries — forced, not assumed: a route-level render crash, a
 *    lazy-chunk 404 (the real post-deploy scenario), a section-level crash
 *    inside a page, and offline.
 *
 * 3. Deep links / universal links — the AASA file's claimed paths, the
 *    `deepLinkRoute.ts` normalizer, and what the native-only short paths
 *    actually do in a browser.
 *
 * ── How the realtime capture works ────────────────────────────────────────
 * `page.route()` cannot see a ws:// upgrade, so fixtures.ts installs an
 * "InertSocket" that swallows every send. That is the right default for the
 * rest of the suite (it silences the console error) but it also throws away
 * exactly the frames this spec needs. So this spec installs its OWN websocket
 * stub FIRST and sets the `__helprRealtimeStubbed` flag the fixture checks, so
 * `installSupabaseMocks()` leaves ours in place. Ours speaks enough of the
 * Phoenix v2 wire protocol (`[join_ref, ref, topic, event, payload]`, see
 * @supabase/realtime-js/dist/module/lib/serializer.js) to answer `phx_join`
 * with a matching `phx_reply`, so channels reach SUBSCRIBED and never
 * re-join — which means a repeated channel name in the capture is a REAL
 * duplicate, not a rejoin retry.
 *
 * Run it on its own port so it can't kill another lane's preview server:
 *   HAPPY_PATH_PORT=4177 npx playwright test --project=happy-path zz-runtime-probe
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

import {
  test,
  expect,
  FAKE_CUSTOMER,
  installSupabaseMocks,
  seedAuthedSession,
} from "./fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

// ───────────────────────────────────────────────────────────────────────────
// 1a. STATIC: enumerate every postgres_changes subscription in src/
// ───────────────────────────────────────────────────────────────────────────

interface Binding {
  file: string;
  line: number;
  table: string;
  event: string;
  filter: string | null;
}

interface ChannelSite {
  file: string;
  line: number;
  /** The raw channel-name expression, e.g. "`unread-nav-${user.id}-${channelNonce()}`" */
  name: string;
  hasNonce: boolean;
  bindings: Binding[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Extract the balanced `{ … }` object literal starting at/after `from`. */
function objectLiteralAt(text: string, from: number): { body: string; end: number } | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function enumerateChannelSites(): ChannelSite[] {
  const sites: ChannelSite[] = [];
  for (const file of walk(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(REPO_ROOT, file);
    // `.channel(` occurrences that are real calls (not prose inside a comment).
    //
    // TWO SHAPES, and missing the second is what made this probe blind.
    // Originally every site inlined its own name:
    //     .channel(`notif-${userId}-${channelNonce()}`)
    // The realtime-recovery refactor hoisted naming into a factory:
    //     subscribeWithRecovery((name) => supabase.channel(name).on(...), ...)
    // so the argument is now an IDENTIFIER. A literal-only regex silently
    // stopped matching 12 of the 17 live sites — and because `hasNonce` is a
    // substring test on the matched argument, the few it still found would
    // have reported `nonced: false` for channels that ARE nonced. The
    // `>= 12` sanity assertion below is the only reason this surfaced as a
    // failure instead of a guard quietly passing while checking nothing.
    const callRe = /\.channel\(\s*(`[^`]*`|"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text))) {
      const idx = m.index;
      const lineStart = text.lastIndexOf("\n", idx) + 1;
      const linePrefix = text.slice(lineStart, idx);
      // Skip doc-comment prose (` * Two subscribers that open `.channel("x")` …`)
      if (/^\s*(\*|\/\/|\/\*)/.test(linePrefix) || linePrefix.includes("//")) continue;

      const subIdx = text.indexOf(".subscribe(", idx);
      const segment = text.slice(idx, subIdx === -1 ? Math.min(text.length, idx + 6000) : subIdx);

      const name = m[1];
      const bindings: Binding[] = [];
      const onRe = /\.on\(\s*['"`]postgres_changes['"`]\s*,/g;
      let b: RegExpExecArray | null;
      while ((b = onRe.exec(segment))) {
        const obj = objectLiteralAt(segment, b.index + b[0].length);
        if (!obj) continue;
        const table = /\btable\s*:\s*['"`]([^'"`]+)/.exec(obj.body)?.[1] ?? "?";
        const event = /\bevent\s*:\s*['"`]([^'"`]+)/.exec(obj.body)?.[1] ?? "?";
        const filterMatch = /(?:^|[\s,{])filter\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/.exec(obj.body);
        bindings.push({
          file: rel,
          line: lineOf(text, idx + b.index),
          table,
          event,
          filter: filterMatch ? filterMatch[1] : null,
        });
      }

      // Is this the factory form? The callback must be the ARGUMENT of a
      // `subscribeWithRecovery(` — so the arrow has to sit immediately before
      // this channel call, with nothing but whitespace and comments between.
      //
      // THIS REGEX USED TO CARRY A SECOND ALTERNATION, `subscribeWithRecovery\s*\(`
      // with no anchor, and that one branch made the whole check decorative: it
      // matched the string ANYWHERE in the preceding 800 characters, so a
      // hard-coded channel name was graded "nonced" because of an unrelated
      // call up the file. Proven in both directions —
      //
      //   supabase.channel("probe-leak-static") alone in a new file  -> FAILS
      //   the same channel in a file that also contains one ordinary
      //   subscribeWithRecovery(...) call above it                    -> PASSES
      //
      // — and the file most likely to gain a new raw channel is a file that
      // already does realtime, which is precisely where the hole was. That is
      // the exact defect `channelNonce()` exists to prevent: Supabase dedupes
      // by name, so the second subscription is silently dropped.
      //
      // The `>= 12` sanity assertion added in 4603ed5e9 does not cover this,
      // because the site IS counted — it is just mis-graded. A count guards
      // against the enumerator finding nothing; it cannot guard against the
      // enumerator finding everything and scoring it wrong.
      //
      // Kept deliberately strict. A legitimate factory-form site that this
      // does not match should be FIXED or named in an explicit allowlist, not
      // absorbed by loosening the pattern — an inferred exception is not
      // auditable, and loosening is how the first version got here.
      // `idx` is the index of `.channel(`, so `back` ends with the RECEIVER of
      // that call — `(name) => supabase` — not with the arrow. The anchor has
      // to allow that receiver expression and nothing else, which is what makes
      // it mean "this channel call is the arrow's body" rather than "the words
      // appear near each other".
      const back = text.slice(Math.max(0, idx - 800), idx);
      const viaRecovery =
        /subscribeWithRecovery\s*\(\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*$/.test(back);

      // `subscribeWithRecovery` appends a fresh `channelNonce()` per attempt
      // (src/lib/realtimeRecovery.ts) UNLESS the caller opts out with
      // `stableName: true` — which `useChatPresence` legitimately does,
      // because presence only works when both participants join one topic.
      // So the opt-out, not the call site, is what has to be inspected.
      const fwd = text.slice(idx, Math.min(text.length, idx + 4000));
      const optsOutOfNonce = /\bstableName\s*:\s*true\b/.test(fwd);

      sites.push({
        file: rel,
        line: lineOf(text, idx),
        name,
        hasNonce:
          name.includes("channelNonce()") || (viaRecovery && !optsOutOfNonce),
        bindings,
      });
    }
  }
  return sites;
}

/**
 * Bindings that ship WITHOUT a server-side filter, each with an explicit
 * in-code rationale. Anything not on this list is a house-rule violation.
 * Key = `<file>::<table>::<event>`.
 */
const DOCUMENTED_UNFILTERED = new Set([
  // Admin dashboard — deliberately platform-wide (src/pages/Admin.tsx:369-372).
  "src/pages/Admin.tsx::jobs::*",
  "src/pages/Admin.tsx::profiles::*",
  "src/pages/Admin.tsx::reports::*",
  // Admin notification-log viewer — deliberately platform-wide
  // (src/components/admin/AdminNotificationLogs.tsx:155-161).
  "src/components/admin/AdminNotificationLogs.tsx::notification_logs::INSERT",
  // messages DELETE — a DELETE payload carries only the PK under REPLICA
  // IDENTITY DEFAULT, so a receiver_id filter can never match
  // (src/pages/messages/useMessagesRealtime.ts:177-181). See the report:
  // this is the one USER-FACING unfiltered stream in the app.
  "src/pages/messages/useMessagesRealtime.ts::messages::DELETE",
]);

test("1a · static: every postgres_changes binding is nonced and user-filtered", async () => {
  const sites = enumerateChannelSites();
  const allBindings = sites.flatMap((s) => s.bindings);

  const table = sites.map((s) => ({
    site: `${s.file}:${s.line}`,
    name: s.name,
    nonced: s.hasNonce,
    bindings: s.bindings.map((b) => ({
      at: `${b.file}:${b.line}`,
      table: b.table,
      event: b.event,
      filter: b.filter,
    })),
  }));
  writeArtifact("realtime-static-enumeration.json", table);
  console.log("[realtime/static]\n" + JSON.stringify(table, null, 2));

  // Sanity: the parser actually found the sites we know exist.
  expect(sites.length, "expected to find the known .channel() call sites").toBeGreaterThanOrEqual(12);
  expect(allBindings.length, "expected to find the known postgres_changes bindings")
    .toBeGreaterThanOrEqual(25);

  // (b) unique name via channelNonce(). Scoped to channels that carry a
  //     postgres_changes binding — that is what the CLAUDE.md rule covers.
  //     `useChatPresence` deliberately SHARES `presence-<thread>` across both
  //     participants: a presence/broadcast channel only works when everyone
  //     joins the same topic, so a nonce there would break typing indicators.
  const pgSites = sites.filter((s) => s.bindings.length > 0);
  const presenceOnly = sites.filter((s) => s.bindings.length === 0).map((s) => `${s.file}:${s.line} → ${s.name}`);
  console.log("[realtime/static] presence/broadcast-only channels (nonce rule N/A): " + JSON.stringify(presenceOnly));
  const missingNonce = pgSites.filter((s) => !s.hasNonce).map((s) => `${s.file}:${s.line} → ${s.name}`);
  expect(missingNonce, "postgres_changes channel names missing channelNonce()").toEqual([]);

  // (b-ii) The nonce guarantee is now CENTRAL, so guard the centre. Most sites
  //        are trusted above purely because they route through
  //        `subscribeWithRecovery`. If that helper ever stopped appending a
  //        nonce, every one of those trust decisions would silently become
  //        wrong and this probe would keep reporting green. Assert the source.
  const recoverySrc = readFileSync(join(REPO_ROOT, "src/lib/realtimeRecovery.ts"), "utf8");
  expect(
    /channelNonce\(\)/.test(recoverySrc),
    "subscribeWithRecovery must mint a channelNonce() — the per-site nonce checks above trust it",
  ).toBe(true);
  expect(
    /stableName\s*\?\s*opts\.name\s*:\s*`\$\{opts\.name\}-\$\{channelNonce\(\)\}`/.test(recoverySrc),
    "subscribeWithRecovery must append the nonce to the channel name on every attempt unless stableName is set",
  ).toBe(true);

  // (a) server-side filter, except the documented platform-wide exceptions
  const unfiltered = allBindings
    .filter((b) => !b.filter)
    .map((b) => ({ key: `${b.file}::${b.table}::${b.event}`, at: `${b.file}:${b.line}` }));
  const undocumented = unfiltered.filter((u) => !DOCUMENTED_UNFILTERED.has(u.key));
  expect(
    undocumented.map((u) => `${u.at} (${u.key})`),
    "postgres_changes bindings with NO server-side filter and no documented rationale",
  ).toEqual([]);

  // Every FILTERED binding must scope by a single column to an id, not a
  // constant — `table=eq.<something>` shape.
  const badShape = allBindings
    .filter((b) => b.filter)
    .filter((b) => !/^`?[a-z_]+=eq\./.test(b.filter!.replace(/^[`'"]/, "")))
    .map((b) => `${b.file}:${b.line} → ${b.filter}`);
  expect(badShape, "filters that are not `<column>=eq.<value>`").toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// 1b. RUNTIME: record every channel actually subscribed across authed routes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Replaces window.WebSocket with a recorder that speaks just enough Phoenix v2
 * to keep supabase-realtime happy. MUST be added to the page BEFORE
 * installSupabaseMocks() so the `__helprRealtimeStubbed` flag suppresses the
 * fixture's InertSocket (which would swallow the frames we want).
 */
function installRecordingRealtimeSocket() {
  const w = window as unknown as Record<string, unknown>;
  if (w.__helprRealtimeStubbed) return;
  w.__helprRealtimeStubbed = true;
  w.__lhJoins = [];
  w.__lhSocketUrls = [];
  const Native = window.WebSocket;

  class RecordingSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    CONNECTING = 0;
    OPEN = 1;
    CLOSING = 2;
    CLOSED = 3;
    url: string;
    readyState = 0;
    bufferedAmount = 0;
    extensions = "";
    protocol = "";
    binaryType = "arraybuffer";
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      (w.__lhSocketUrls as string[]).push(url);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({ type: "open" });
      }, 0);
    }
    addEventListener() { /* phoenix uses the on* properties */ }
    removeEventListener() { /* noop */ }
    dispatchEvent() { return true; }

    send(raw: unknown) {
      let msg: unknown;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!Array.isArray(msg)) return;
      const [joinRef, ref, topic, event, payload] = msg as [
        string | null, string | null, string, string, Record<string, unknown> | undefined,
      ];
      if (event === "phx_join") {
        const cfg = (payload?.config ?? {}) as Record<string, unknown>;
        const pg = (cfg.postgres_changes ?? []) as Record<string, unknown>[];
        (w.__lhJoins as unknown[]).push({
          topic,
          postgresChanges: pg,
          hasPresence: !!cfg.presence,
          at: Date.now(),
        });
        // Echo the requested bindings back with server ids, or realtime-js
        // errors the channel out ("mismatch between server and client bindings").
        const response = { postgres_changes: pg.map((f, i) => ({ id: 900000 + i, ...f })) };
        this.reply([joinRef, ref, topic, "phx_reply", { status: "ok", response }]);
        return;
      }
      if (ref) {
        this.reply([joinRef ?? null, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      }
    }

    reply(arr: unknown[]) {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(arr) }), 0);
    }

    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000, reason: "", wasClean: true });
    }
  }

  window.WebSocket = new Proxy(Native, {
    construct(target, args: unknown[]) {
      const url = String(args[0] ?? "");
      if (url.includes("/realtime/v1/websocket")) {
        return new RecordingSocket(url) as unknown as WebSocket;
      }
      return Reflect.construct(target, args as never) as WebSocket;
    },
  }) as typeof WebSocket;
}

interface CapturedJoin {
  topic: string;
  postgresChanges: { event?: string; schema?: string; table?: string; filter?: string }[];
  hasPresence: boolean;
}

const AUTHED_ROUTES = ["/dashboard", "/my-posts", "/my-jobs", "/messages", "/profile"];

test("1b · runtime: no duplicate channel names, every binding filtered to the user", async ({
  page,
  context,
  baseURL,
}) => {
  test.slow();
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await page.addInitScript(installRecordingRealtimeSocket);
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });

  // `page.goto` is a full document load, so the in-page capture array resets
  // each time — snapshot it per route and accumulate here. Per-route is also
  // the honest scope for the "duplicate name" rule: Supabase dedupes by name
  // on a LIVE socket, so a collision only matters within one page session.
  const perRoute: { route: string; joins: CapturedJoin[] }[] = [];
  const socketUrls: string[] = [];
  for (const route of [...AUTHED_ROUTES, "/dashboard"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000); // let the subscribing effects mount + join
    const j = (await page.evaluate(
      () => (window as never as { __lhJoins: CapturedJoin[] }).__lhJoins,
    )) as CapturedJoin[];
    const u = (await page.evaluate(
      () => (window as never as { __lhSocketUrls: string[] }).__lhSocketUrls,
    )) as string[];
    perRoute.push({ route, joins: j });
    socketUrls.push(...u);
  }
  const joins = perRoute.flatMap((r) => r.joins);

  const perRouteSummary = perRoute.map((r) => ({
    route: r.route,
    channelCount: r.joins.length,
    // How many channels share a purpose (same name minus the nonce)? Each one
    // is a separate server-side subscription for identical data.
    byPurpose: Object.entries(
      r.joins.reduce<Record<string, number>>((acc, j) => {
        const purpose = j.topic
          .replace(/realtime:/, "")
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
        acc[purpose] = (acc[purpose] ?? 0) + 1;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]),
  }));
  console.log("[realtime/runtime] per-route channel counts:\n" + JSON.stringify(perRouteSummary, null, 2));

  writeArtifact("realtime-runtime-joins.json", { socketUrls, perRoute, perRouteSummary });
  console.log(
    "[realtime/runtime] channels subscribed:\n" +
      joins.map((j) => `  ${j.topic}\n` + j.postgresChanges.map((p) => `      ${p.event} ${p.schema}.${p.table} filter=${p.filter ?? "(NONE)"}`).join("\n")).join("\n"),
  );

  expect(joins.length, "no realtime channels were subscribed — capture is broken").toBeGreaterThan(0);
  expect(socketUrls.every((u) => u.includes("/realtime/v1/websocket"))).toBe(true);

  // (1) No duplicate channel names. Our stub answers every join, so channels
  //     reach SUBSCRIBED and never re-join — a repeat here is a real collision
  //     and means Supabase silently dropped the second subscription.
  const dupes: string[] = [];
  for (const r of perRoute) {
    const t = r.joins.map((j) => j.topic);
    dupes.push(...t.filter((x, i) => t.indexOf(x) !== i).map((x) => `${r.route} → ${x}`));
  }
  expect([...new Set(dupes)], "duplicate realtime channel names (second subscription is dropped)")
    .toEqual([]);
  const topics = joins.map((j) => j.topic);

  // (2) Every name carries a nonce (a UUID from channelNonce()).
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const unnonced = topics.filter((t) => !UUID.test(t));
  expect(unnonced, "channel names subscribed at runtime without a channelNonce() UUID").toEqual([]);

  // (3) Every postgres_changes binding sent over the wire carries a
  //     server-side filter. On the non-admin routes we walk, there should be
  //     exactly one unfiltered binding: the documented messages DELETE.
  const wireBindings = joins.flatMap((j) =>
    j.postgresChanges.map((p) => ({ topic: j.topic, ...p })),
  );
  const unfiltered = wireBindings.filter((b) => !b.filter);
  expect(
    unfiltered.map((b) => `${b.topic} → ${b.event} ${b.schema}.${b.table}`),
    "unfiltered postgres_changes bindings sent from a NON-ADMIN session",
  ).toEqual(
    unfiltered
      .filter((b) => b.table === "messages" && b.event === "DELETE")
      .map((b) => `${b.topic} → ${b.event} ${b.schema}.${b.table}`),
  );

  // (4) Every FILTERED binding is scoped to this user's id, or to a resource
  //     id (job/thread) rather than to a constant. A filter that names some
  //     other user's id would be the serious finding.
  const foreign = wireBindings
    .filter((b) => b.filter)
    .filter((b) => {
      const value = b.filter!.split("=eq.")[1] ?? "";
      const isSelf = value === FAKE_CUSTOMER.id;
      const isUuid = UUID.test(value); // job_id / thread id — resource-scoped
      return !isSelf && !isUuid;
    })
    .map((b) => `${b.topic} → ${b.filter}`);
  expect(foreign, "postgres_changes filters not scoped to this user or a resource id").toEqual([]);

  // What did the user-scoped ones actually resolve to?
  const selfScoped = wireBindings.filter((b) => b.filter?.endsWith(`=eq.${FAKE_CUSTOMER.id}`));
  expect(selfScoped.length, "expected at least one user-scoped filter on the wire").toBeGreaterThan(0);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Error boundaries — forced, with a screenshot of what the user sees
// ───────────────────────────────────────────────────────────────────────────

const THROWING_ROUTE_CHUNK =
  `export default function ProbeCrash(){ throw new Error("PROBE: forced route render crash"); }\n`;
const THROWING_SECTION_CHUNK =
  `export function LegalTab(){ throw new Error("PROBE: forced section render crash"); }\n` +
  `export default LegalTab;\n`;

async function shot(page: import("@playwright/test").Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  test.info().annotations.push({ type: "screenshot", description: path });
  console.log(`[boundary] screenshot → ${path}`);
  return path;
}

test("2a · route-level render crash is caught by RouteErrorBoundary", async ({ page }) => {
  // Replace the /legal page chunk with a module whose default export throws
  // during render. Rollup emits `export { … as default }` for a page chunk, so
  // a hand-written `export default` slots straight in.
  await page.route("**/assets/Legal-*.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: THROWING_ROUTE_CHUNK }),
  );

  await page.goto("/legal", { waitUntil: "domcontentloaded" });

  const heading = page.getByText("This page hit a problem.", { exact: false });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("We've logged it. Try again or head back home.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Try Again/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Go Home/i })).toBeVisible();
  // Not a white screen: the boundary's card is real, painted content.
  const bodyText = (await page.locator("body").innerText()).trim();
  expect(bodyText.length).toBeGreaterThan(20);
  await shot(page, "2a-route-render-crash");

  // "Go Home" must escape the crashed route (componentDidUpdate clears on
  // pathname change) — otherwise the user is trapped.
  await page.getByRole("button", { name: /Go Home/i }).click();
  await expect(page).not.toHaveURL(/\/legal/, { timeout: 10_000 });
});

/**
 * Records the raw `vite:preloadError` payload AND whether some later listener
 * called preventDefault() on it. Registered from an init script so it runs
 * before main.tsx's own handler (listeners fire in registration order).
 */
function installPreloadErrorProbe() {
  const w = window as unknown as Record<string, unknown>;
  w.__lhPreloadErrors = [];
  window.addEventListener("vite:preloadError", (e: Event) => {
    const payload = (e as Event & { payload?: unknown }).payload;
    const rec: Record<string, unknown> = {
      message: payload instanceof Error ? payload.message : String(payload),
      name: payload instanceof Error ? payload.name : typeof payload,
      preventedByAnotherListener: null,
    };
    (w.__lhPreloadErrors as unknown[]).push(rec);
    // Every other listener has run by the time this microtask drains.
    queueMicrotask(() => { rec.preventedByAnotherListener = e.defaultPrevented; });
  });
}

async function driveChunk404(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  opts: { armReloadGuard?: boolean } = {},
) {
  await context.addInitScript(installPreloadErrorProbe);
  if (opts.armReloadGuard) {
    // Arm the one-shot 10s reload guard so recoverFromChunkError() declines to
    // reload — the deterministic "second failure" state a user reaches when the
    // auto-reload didn't fix it.
    await context.addInitScript(() => {
      try { sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now())); } catch { /* private mode */ }
    });
  }
  await page.route("**/assets/Jobs-*.js", (route) => route.abort("failed"));
  // Mock Supabase so auth resolves quickly; the Jobs chunk is still aborted
  // because same-origin routes pass through the catch-all via route.continue()
  // to the abort handler registered above (Playwright checks routes LIFO).
  await installSupabaseMocks(page, {});
  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const preloadErrors = await page
    .evaluate(() => (window as never as { __lhPreloadErrors?: unknown[] }).__lhPreloadErrors ?? [])
    .catch(() => []);
  return { body, preloadErrors };
}

test("2b · lazy-chunk fetch failure never white-screens; records what the user sees", async ({
  page,
  context,
}) => {
  test.slow();
  // The real post-deploy scenario: the HTML references chunk hashes that no
  // longer exist on the CDN.
  const { body, preloadErrors } = await driveChunk404(page, context, { armReloadGuard: true });
  await shot(page, "2b-chunk-fetch-failure");

  const state = body.includes("Update ready.")
    ? "Update ready. (chunk-aware copy)"
    : body.includes("This page hit a problem.")
      ? "This page hit a problem. (GENERIC route-crash copy — see 2b-defect)"
      : body.slice(0, 120);
  console.log(`[boundary] chunk-404 user-visible state: ${state}`);
  console.log("[boundary] vite:preloadError payloads: " + JSON.stringify(preloadErrors, null, 2));
  writeArtifact("chunk-404-state.json", { state, body: body.slice(0, 400), preloadErrors });
  test.info().annotations.push({ type: "chunk-404 copy", description: state });

  // The floor this test defends: something honest is painted, not a blank page.
  expect(body.length).toBeGreaterThan(20);
  await expect(page.getByRole("button", { name: /Try Again|Reload/i })).toBeVisible();
});

test("a chunk 404 shows the chunk-aware 'Update ready.' copy", async ({
  page,
  context,
}) => {
  // KNOWN DEFECT (src/main.tsx:44-47). Vite's preload helper wraps BOTH the dep
  // preload and the real `import()` in one catch; `event.preventDefault()` in
  // main.tsx makes that catch SWALLOW the error and resolve the import with
  // `undefined`. React.lazy then reads `.default` off undefined, so the error
  // that reaches RouteErrorBoundary is a plain TypeError, NOT the
  // "Failed to fetch dynamically imported module" string `isChunkLoadError()`
  // matches (src/lib/chunkReload.ts:15-32). Consequences whenever
  // recoverFromChunkError() declines to reload (the 10s guard, or offline):
  //   • the user gets "This page hit a problem." for a routine stale deploy
  //   • "Try Again" re-renders the same dead module reference and re-throws
  //   • report() fires, so every stale deploy becomes Sentry route-error noise
  // Was test.fail() while src/main.tsx swallowed the chunk error via an
  // unconditional preventDefault(). Fixed in cea0055f, so this is now a
  // real regression guard: a stale deploy must show the chunk-aware copy,
  // not the generic "This page hit a problem" card.
  test.slow();
  const { body } = await driveChunk404(page, context, { armReloadGuard: true });
  expect(body).toContain("Update ready.");
});

test("an offline lazy-route navigation shows chunk/offline copy", async ({
  page,
  context,
}) => {
  // KNOWN DEFECT, same root cause. chunkReload.ts:89-95 deliberately returns
  // false when offline so "the caller falls through to its normal error UI" —
  // but main.tsx already swallowed the error, so the caller never sees a chunk
  // error and shows the generic route-crash card instead.
  // Was test.fail() while src/main.tsx swallowed the chunk error via an
  // unconditional preventDefault(). Fixed in cea0055f, so this is now a
  // real regression guard: a stale deploy must show the chunk-aware copy,
  // not the generic "This page hit a problem" card.
  test.slow();
  await context.addInitScript(installPreloadErrorProbe);
  // Load the SPA first, THEN go offline, THEN client-side-navigate to a route
  // whose chunk was never fetched. (A cold `goto` while offline fails at the
  // document request and shows Chromium's own error page — not this code path.)
  await page.goto("/", { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.route("**/assets/Jobs-*.js", (route) => route.abort("internetdisconnected"));
  await page.evaluate(() => {
    window.history.pushState({}, "", "/jobs");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(4000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  console.log(`[boundary] offline lazy-route body: ${body.slice(0, 300)}`);
  await shot(page, "2b-offline-lazy-route");
  // The OfflineBanner DOES appear (good). But the route card underneath still
  // blames the page — "This page hit a problem. We've logged it." — for what is
  // just a missing network, and in production `report()` really does fire.
  expect(body).toContain("You're offline");
  expect(body, "offline must not be reported to the user as a page defect")
    .not.toContain("This page hit a problem.");
});

test("2c · section-level crash is contained by SectionBoundary", async ({
  page,
  context,
  baseURL,
}) => {
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  // The Profile "legal" tab panel is its own lazy chunk consumed as a NAMED
  // export (`m.LegalTab`), so Rollup keeps the public name — a replacement
  // module exporting a throwing `LegalTab` drops straight in.
  await page.route("**/assets/LegalTab-*.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: THROWING_SECTION_CHUNK }),
  );

  await page.goto("/profile?tab=legal", { waitUntil: "domcontentloaded" });

  const inline = page.getByText("Couldn't load the legal section.", { exact: false });
  await expect(inline).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText("The rest of the page is still fine.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Try Again/i })).toBeVisible();
  await shot(page, "2c-section-crash");

  // Containment: the route did NOT fall through to the route-level boundary.
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("This page hit a problem.");
  expect(body).not.toContain("Something went sideways.");
});

test("2d · offline: OfflineBanner appears and the app degrades honestly", async ({
  page,
  context,
  baseURL,
}) => {
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });

  // Load fully FIRST — OfflineBanner is itself a lazy chunk, so going offline
  // before it loads would only prove the chunk can't be fetched.
  await page.goto("/dashboard", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await expect(page.getByText("You're offline", { exact: false })).toHaveCount(0);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  const banner = page.getByRole("status").filter({ hasText: "You're offline" });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("You're offline. Showing the last data we have."),
  ).toBeVisible();
  await shot(page, "2d-offline-banner");

  // Degrades honestly: content is still on screen, no white screen, and the
  // banner does not promise a retry queue the app doesn't have.
  const body = await page.locator("body").innerText();
  expect(body.trim().length).toBeGreaterThan(50);
  expect(body).not.toMatch(/will retry automatically|reconnecting…?/i);

  // …and it goes away again.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("You're offline. Showing the last data we have.")).toHaveCount(0, {
    timeout: 10_000,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Deep links / universal links
// ───────────────────────────────────────────────────────────────────────────

const AASA_URL = "https://www.louisianahelpr.com/.well-known/apple-app-site-association";

/**
 * The claims and exclusions that must NOT quietly disappear.
 *
 * This is deliberately a SUBSET, not the whole list. It used to be a
 * hand-maintained copy of the file's entire `paths` array, asserted with
 * `toEqual` — and 08ed41e5 grew that array from 16 entries to 33 (`/dashboard`,
 * `/my-posts`, `/browse`, `NOT /reset-password`, …) without touching the copy.
 * The served file and the committed file agreed with each other perfectly; only
 * this duplicate disagreed, and it failed every CI run for two days while
 * describing the deployment as broken. A copy of data is not an assertion about
 * it — the exact-shape check now compares the SERVED file against the COMMITTED
 * one (below), which is the property actually worth pinning, and this list
 * covers the individual entries whose loss would be a real defect:
 *
 *   - the deep-link surfaces the app routes on (`normalizeDeepLinkUrl` in
 *     src/lib/deepLinkRoute.ts maps exactly these prefixes), and
 *   - the exclusions that exist for a security or auth reason — admin must
 *     open in the browser, and the Supabase OAuth callback must stay there or
 *     the PKCE verifier is unreachable.
 *
 * `NOT /reset-password` and `NOT /account-pending` are deliberately absent. The
 * AASA file's own comments describe both as exclusions held open pending work
 * on fragment-carried auth sessions — i.e. entries that are EXPECTED to flip to
 * claims one day. Pinning them here would make the fix that removes them look
 * like a regression.
 */
const REQUIRED_CLAIMS = [
  "/jobs", "/jobs/*", "/j/*", "/user/*", "/u/*",
  "/messages", "/messages/*", "/m/*",
  "/legal", "/legal/*", "/post-job", "/post-job/*",
];
const REQUIRED_EXCLUSIONS = [
  "NOT /admin", "NOT /admin/*", "NOT /api/*", "NOT /.well-known/*", "NOT /auth/*",
];

test("3a · AASA is served over HTTPS with the claimed paths", async () => {
  test.slow();
  let res: Response;
  try {
    res = await fetch(AASA_URL, { redirect: "manual" });
  } catch (e) {
    test.skip(true, `AASA fetch failed (no network?): ${String(e)}`);
    return;
  }
  const contentType = res.headers.get("content-type") ?? "(none)";
  const body = await res.text();
  console.log(`[aasa] www  → ${res.status} content-type=${contentType} bytes=${body.length}`);
  test.info().annotations.push({
    type: "AASA www",
    description: `HTTP ${res.status}, content-type: ${contentType}`,
  });

  if (res.status === 403) {
    test.skip(true, "AASA fetch blocked by environment proxy (HTTP 403) — not a product issue");
    return;
  }
  expect(res.status, "AASA must be served 200 with no redirect").toBe(200);
  const json = JSON.parse(body);
  const detail = json.applinks.details[0];
  expect(detail.appID).toBe("P85MCK558V.com.Helpr");
  for (const p of [...REQUIRED_CLAIMS, ...REQUIRED_EXCLUSIONS]) {
    expect(detail.paths, `AASA no longer claims ${p}`).toContain(p);
  }
  // Apple stops at the FIRST matching entry, so an exclusion is only an
  // exclusion while it precedes the broader claims. `NOT /admin/*` listed after
  // `/dashboard`-style claims would still be honoured (nothing claims /admin),
  // but the moment a wildcard claim is added above it the exclusion is dead —
  // which is exactly the failure mode the file's own `NOT /admin` comment
  // describes. Pin the ordering, not just the membership.
  const firstClaim = detail.paths.findIndex((p: string) => !p.startsWith("NOT "));
  const lastExclusion = detail.paths.reduce(
    (acc: number, p: string, i: number) => (p.startsWith("NOT ") ? i : acc),
    -1,
  );
  expect(lastExclusion, "every NOT rule must precede every claim").toBeLessThan(firstClaim);
  expect(json.webcredentials.apps).toContain("P85MCK558V.com.Helpr");

  // The committed file and the served file must agree — on everything APPLE
  // READS. THIS is the exact-shape assertion: it compares the deployment
  // against the source of truth in the repo, so a stale deploy or a hand-edit
  // on the CDN fails here rather than against a third copy of the path list
  // that has to be maintained by hand.
  //
  // `comment` is stripped from both sides first. It is not part of the AASA
  // format — Apple ignores unknown keys in a `components` entry — and this file
  // uses it as long-form documentation of WHY each exclusion exists. Comparing
  // prose meant that editing a comment turned this test red and made it accuse
  // the DEPLOYMENT of being wrong, when nothing about the association had
  // changed and there was nothing to deploy. Caught exactly that way while
  // fixing this spec: a concurrent lane rewrote the /reset-password and
  // /account-pending notes, and the first thing to complain was a universal-link
  // probe. Compare the contract, not the commentary.
  const stripComments = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stripComments)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([k]) => k !== "comment")
              .map(([k, val]) => [k, stripComments(val)]),
          )
        : v;
  const committed = readFileSync(
    join(REPO_ROOT, "public/.well-known/apple-app-site-association"),
    "utf8",
  );
  expect(stripComments(JSON.parse(committed))).toEqual(stripComments(json));

  writeArtifact("aasa-www.json", { status: res.status, contentType, body: json });
});

test("AASA is served as application/json", async () => {
  // Was a documented defect: Vercel served the extension-less file as
  // application/octet-stream because vercel.json declared no Content-Type for
  // /.well-known/*, and the global X-Content-Type-Options: nosniff meant the
  // client could not recover by sniffing — so the universal-link association
  // failed SILENTLY and taps opened Safari instead of the app.
  //
  // Fixed in vercel.json (d3ffb269). This is now a real regression guard: if
  // someone drops that header rule, universal links break with no other
  // symptom, so this test is the only thing that would notice.
  test.slow();
  let res: Response;
  try {
    res = await fetch(AASA_URL, { redirect: "manual" });
  } catch (e) {
    test.skip(true, `AASA fetch failed (no network?): ${String(e)}`);
    return;
  }
  if (res.status === 403) {
    test.skip(true, "AASA fetch blocked by environment proxy (HTTP 403) — not a product issue");
    return;
  }
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
});

/**
 * Every domain the app CLAIMS must actually serve AASA, with no redirect.
 *
 * This replaces a hardcoded apex assertion whose premise had gone stale. That
 * test asserted `louisianahelpr.com` must serve AASA, and justified itself with
 * "App.entitlements declares BOTH applinks:louisianahelpr.com and
 * applinks:www.louisianahelpr.com". It does not, and did not by the time this
 * was written — both entitlement files declare www ONLY. The apex claim had
 * already been removed, so the test was demanding a fix for a domain nothing
 * claims, and its `test.fail()` annotation quietly hid that the reasoning
 * underneath had stopped being true.
 *
 * That is the failure mode this whole file exists to catch, so the fix is not
 * to correct the prose — prose rots the same way twice. The requirement is
 * DERIVED from the entitlements instead:
 *
 *   for each `applinks:<domain>` the app claims
 *     → https://<domain>/.well-known/apple-app-site-association
 *       must answer 200 with content-type application/json, NO redirect.
 *
 * Apple's CDN does not follow redirects when fetching AASA, so a claimed
 * domain that 307s cannot associate and its universal links open Safari.
 *
 * WHERE THE APEX RULE LIVES, and why the explanation is here and not there.
 * `vercel.json` carries a redirect that sends apex -> www for every path EXCEPT
 * `/.well-known/apple-app-site-association`, so Apple can read the association
 * at the apex while www stays canonical for humans and SEO. That rule is INERT
 * until the apex's project-domain redirect is cleared in the Vercel dashboard
 * (Project > Settings > Domains > louisianahelpr.com): the redirect is stored on
 * the domain record as `redirect` + `redirectStatusCode: 307` and applied at the
 * edge BEFORE config routing, so nothing in `vercel.json` is reached while it
 * exists. It uses 307 rather than 308 deliberately, matching the status the
 * domain redirect already returns so the move is a no-op for every client and
 * nobody gets a permanent redirect pinned in cache.
 *
 * That paragraph was originally `//`-prefixed keys inside the redirect entry
 * itself. Vercel's schema sets `additionalProperties: false` on redirect
 * entries, so it broke the config and blocked production deploys — the same
 * failure d3ffb269 had already fixed once. `vercel.json` is schema-validated and
 * cannot hold prose; this file can, and is where the requirement is enforced.
 *
 * Today the apex is not claimed, so it is not checked — and the apex 307 is
 * therefore NOT what breaks apex links; the missing entitlement is. The moment
 * anyone adds `applinks:louisianahelpr.com` back, this test starts requiring
 * the apex to serve AASA directly, which is a Vercel DOMAIN setting (the apex
 * currently 307s to www) and not something vercel.json can override. It will
 * fail until that is changed, which is exactly the coupling that was missing.
 */
function claimedApplinkDomains(): string[] {
  const files = ["ios/App.entitlements", "ios/App/App/App.entitlements"];
  const domains = new Set<string>();
  for (const rel of files) {
    const text = readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const m of text.matchAll(/applinks:([A-Za-z0-9.-]+)/g)) domains.add(m[1]);
  }
  return [...domains].sort();
}

test("3a · every applinks: domain serves AASA directly, with no redirect", async () => {
  test.slow();
  const domains = claimedApplinkDomains();
  // If this is ever empty the app claims nothing and universal links are dead
  // app-wide — a silent pass here would be the worst possible outcome.
  expect(domains.length, "App.entitlements declares no applinks: domain").toBeGreaterThan(0);
  console.log("[aasa] claimed applinks domains: " + JSON.stringify(domains));

  const failures: string[] = [];
  for (const domain of domains) {
    const url = `https://${domain}/.well-known/apple-app-site-association`;
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual" });
    } catch (e) {
      test.skip(true, `AASA fetch failed for ${domain} (no network?): ${String(e)}`);
      return;
    }
    if (res.status === 403) {
      test.skip(true, `AASA fetch blocked by environment proxy for ${domain} (HTTP 403) — not a product issue`);
      return;
    }
    const location = res.headers.get("location");
    const contentType = res.headers.get("content-type") ?? "";
    console.log(`[aasa] ${domain} → ${res.status} type=${contentType} location=${location ?? "(none)"}`);
    if (res.status !== 200) {
      failures.push(
        `${domain}: expected 200, got ${res.status}` +
          (location ? ` → ${location} (Apple does not follow redirects when fetching AASA)` : ""),
      );
      continue;
    }
    if (!contentType.includes("application/json")) {
      failures.push(`${domain}: expected application/json, got "${contentType}"`);
    }
  }
  expect(failures, "claimed applinks domains that cannot serve AASA to Apple").toEqual([]);
});

/** Transpile src/lib/deepLinkRoute.ts and expose it on window as __deepLink. */
function buildDeepLinkRouteIife(): string {
  const source = readFileSync(join(SRC_ROOT, "lib/deepLinkRoute.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return `(function(){var exports={};var module={exports:exports};\n${js}\n;window.__deepLink=exports;})();`;
}

test("3b · deepLinkRoute normalizer mapping + host allowlist", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: buildDeepLinkRouteIife() });

  const cases: [string, string | null][] = [
    // canonical pass-through
    ["https://www.louisianahelpr.com/jobs", "/jobs"],
    ["https://www.louisianahelpr.com/jobs/abc123", "/jobs/abc123"],
    ["https://louisianahelpr.com/user/u-1", "/user/u-1"],
    ["https://louisianahelpr.com/messages", "/messages"],
    ["https://louisianahelpr.com/legal", "/legal"],
    // short links
    ["https://louisianahelpr.com/u/u-1", "/user/u-1"],
    ["https://louisianahelpr.com/j/j-1", "/jobs/j-1"],
    ["https://louisianahelpr.com/m/j-1", "/messages?jobId=j-1"],
    ["https://louisianahelpr.com/m/j-1?userId=u-9", "/messages?userId=u-9&jobId=j-1"],
    // legal tabs
    ["https://louisianahelpr.com/legal/terms", "/legal?tab=terms"],
    ["https://louisianahelpr.com/legal/privacy", "/legal?tab=privacy"],
    ["https://louisianahelpr.com/legal/community", "/legal?tab=community"],
    // post-job sub-paths collapse
    ["https://louisianahelpr.com/post-job", "/post-job"],
    ["https://louisianahelpr.com/post-job/draft/7", "/post-job"],
    ["https://louisianahelpr.com/post-job/draft/7?resume=1", "/post-job?resume=1"],
    // trailing slash
    ["https://louisianahelpr.com/jobs/", "/jobs"],
    // ignored
    ["https://louisianahelpr.com/", null],
    ["https://louisianahelpr.com", null],
    ["https://louisianahelpr.com/auth/v1/callback", null],
    ["https://louisianahelpr.com/auth/callback?code=x", null],
    ["https://louisianahelpr.com/admin", null],
    ["https://louisianahelpr.com/admin/users", null],
    // HOST ALLOWLIST — a normalizer that accepts any host is an open redirect.
    ["https://evil.example.com/jobs/abc", null],
    ["https://louisianahelpr.com.evil.example.com/jobs/abc", null],
    ["https://notlouisianahelpr.com/jobs/abc", null],
    ["https://www.louisianahelpr.com.attacker.io/u/1", null],
    ["http://louisianahelpr.com.evil.io/admin", null],
    ["not-a-url", null],
    ["javascript:alert(1)", null],
    // the app's own return scheme is host-less and still allowed
    ["helpr:///payment-success?session_id=cs_1", "/payment-success?session_id=cs_1"],
  ];

  const results = await page.evaluate((inputs: string[]) => {
    const fn = (window as never as { __deepLink: { normalizeDeepLinkUrl: (u: string) => string | null } })
      .__deepLink.normalizeDeepLinkUrl;
    return inputs.map((i) => {
      try { return fn(i); } catch (e) { return `THREW: ${String(e)}`; }
    });
  }, cases.map((c) => c[0]));

  const table = cases.map((c, i) => ({ input: c[0], expected: c[1], actual: results[i] }));
  writeArtifact("deeplink-normalizer.json", table);
  const mismatches = table.filter((r) => r.actual !== r.expected);
  console.log("[deeplink] mismatches: " + JSON.stringify(mismatches, null, 2));
  expect(mismatches).toEqual([]);
});

/**
 * The AASA claims paths the WEB router may not serve. Every claimed path must
 * either match a route in src/App.tsx or normalize to one — otherwise a shared
 * link opened on a device without the app lands on the in-app 404.
 */
// AASA-claimed short-link paths. These were "native only" — claimed for the
// app, no web route — so a link shared to someone WITHOUT the app installed
// dead-ended on the in-app 404. `ShortLinkRedirect` now serves all of them on
// the web by replaying the same normalizer `deepLinkRoute.ts` uses natively,
// so the two can't drift.
//
// `/legal/terms` is here because it had the identical defect and was NOT
// enumerated when this list was written: `/legal/*` is claimed and normalizes
// to `/legal?tab=`, while `/terms` and `/privacy` worked — so the short form
// was the one that broke.
const AASA_SHORT_LINK_PATHS = [
  "/j/abc123",
  "/u/user-1",
  "/m/job-1",
  "/messages/thread-1",
  "/post-job/draft/7",
  "/legal/terms",
];

test("3c · every AASA-claimed short link resolves on the web, not the in-app 404", async ({ page }) => {
  test.slow();
  const findings: { path: string; httpStatus: number; renders: string; isNotFound: boolean }[] = [];

  for (const path of AASA_SHORT_LINK_PATHS) {
    const resp = await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const heading = (await page.locator("h1, h2").first().innerText().catch(() => "")).trim();
    const body = await page.locator("body").innerText();
    const isNotFound =
      /page not found|doesn't exist|404/i.test(body) || /404/.test(heading);
    findings.push({
      path,
      httpStatus: resp?.status() ?? -1,
      renders: heading.replace(/\s+/g, " ").slice(0, 80),
      isNotFound,
    });
  }

  writeArtifact("deeplink-web-behaviour.json", findings);
  console.log("[deeplink/web]\n" + JSON.stringify(findings, null, 2));

  // The SPA rewrite means these are HTTP 200 with an in-app 404 body — NOT a
  // real HTTP 404. Record it either way; assert only that nothing white-screens.
  for (const f of findings) {
    expect(f.httpStatus, `${f.path} should be served by the SPA shell`).toBe(200);
  }
  const notFound = findings.filter((f) => f.isNotFound).map((f) => f.path);
  test.info().annotations.push({
    type: "AASA-claimed paths still rendering the in-app 404 on the web",
    description: notFound.join(", ") || "(none)",
  });
  // THIS ASSERTION IS INVERTED FROM WHAT IT USED TO SAY, deliberately.
  //
  // It previously asserted that every path in this list DID render the in-app
  // 404 — pinning the defect, with a note that a future fix should flip it.
  // That fix has landed, so the list is now the set that must resolve. Left
  // as a set comparison rather than a bare emptiness check so that a path
  // regressing to NotFound names itself in the failure.
  expect(new Set(notFound), "an AASA-claimed link dead-ends for anyone without the app").toEqual(
    new Set<string>(),
  );
});

// ───────────────────────────────────────────────────────────────────────────

function writeArtifact(name: string, data: unknown) {
  const dir = join(REPO_ROOT, "test-results", "zz-runtime-probe");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  test.info().annotations.push({ type: "artifact", description: path });
  return path;
}
