/* eslint-disable react-hooks/rules-of-hooks */
// Playwright's `test.extend` fixtures take a callback whose second arg is a
// `use(value)` function. The react-hooks lint plugin pattern-matches the
// literal name `use(...)` and assumes it's React's `use()` hook. There's no
// React in this file — it's a Playwright fixture module — so we disable the
// rule for the whole file rather than renaming the API away from Playwright's
// documented signature.
import {
  test as baseTest,
  expect,
  type Page,
  type Route,
  type BrowserContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SEED_TABLES, SEED_JOBS } from "./seedData";

// Happy-path smoke fixtures. These tests run against `npm run build && npx
// vite preview` (the Vite preview server, no live backend) and stub every
// Supabase HTTP call with deterministic responses via `page.route()`. The
// goal is to verify the critical UI flow contracts — landing→signup,
// post-job, browse-and-apply, see-applications — fail loudly if the React
// surface breaks, WITHOUT depending on the real Supabase project.
//
// Why we pre-seed an authed session instead of driving the multi-step
// Signup form: the live signup form is a 3-step flow that requires an
// avatar upload + government-ID upload + bio + phone duplicate-check
// before it lets the user through. A full form-driving smoke would be
// brittle (file inputs over Playwright + 20+ fields per spec) and would
// double the wall-clock cost of the suite. The contract this suite cares
// about is the POST-AUTH behavior — once a user is "signed in," what do
// they see — so we forge a session at the storage layer and assert on
// the surfaces from there. A bare "/signup renders without crashing"
// assertion is kept in `smoke.spec.ts` and covers the signup-page-loads
// half of the contract independently.

const SUPABASE_PROJECT_ID = "fncmgoasalhdgfwzhsqa";
const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;
const SUPABASE_AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_ID}-auth-token`;

// Mobile viewport — matches the existing Mobile viewport spot-check
// suite (iPhone-SE 2nd/3rd-gen profile, 375x667). Most Helpr users hit
// the app from a phone, so smoke tests assert the mobile layout, not
// the desktop one.
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;

// --- Session helpers ----------------------------------------------------

export interface FakeUser {
  id: string;
  email: string;
  fullName: string;
  role: "customer" | "helper";
}

export const FAKE_CUSTOMER: FakeUser = {
  id: "00000000-0000-4000-8000-00000000c1ce",
  email: "customer.smoke@helpr.test",
  fullName: "Smoke Customer",
  role: "customer",
};

export const FAKE_HELPER: FakeUser = {
  id: "00000000-0000-4000-8000-00000000he1p",
  email: "helper.smoke@helpr.test",
  fullName: "Smoke Helper",
  role: "helper",
};

// Supabase-js stores its session under `sb-<project>-auth-token` as a
// JSON-encoded object that includes a `currentSession` (older
// localStorage encoding) or the session shape directly. We write the
// flatter session shape that newer @supabase/supabase-js (>=2.x) reads
// from `getSession()` — verified against
// `src/integrations/supabase/keychainStorageAdapter.test.ts`.
function buildFakeSession(user: FakeUser) {
  const nowSec = Math.floor(Date.now() / 1000);
  // 1h validity — plenty for the smoke run, short enough that a leaked
  // token would expire by the time someone read this comment.
  const expiresAt = nowSec + 60 * 60;
  return {
    access_token: `fake-access-token-${user.id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: `fake-refresh-token-${user.id}`,
    provider_token: null,
    provider_refresh_token: null,
    user: buildFakeAuthUser(user),
  };
}

function buildFakeAuthUser(user: FakeUser) {
  const nowIso = new Date().toISOString();
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: nowIso, // skip the verify-email gate
    phone: "",
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: user.fullName },
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function buildFakeProfile(user: FakeUser) {
  // The "Big 7" verification gate in `ProtectedRoute.tsx` requires every
  // one of these fields be set, otherwise the user is bounced to
  // /complete-profile and nothing else renders. is_legacy_user=true
  // bypasses the gate as a belt-and-braces fallback for any field the
  // gate later adds.
  const nowIso = new Date().toISOString();
  return {
    id: `${user.id}-profile`,
    user_id: user.id,
    full_name: user.fullName,
    // data: URI, not a real URL — "https://example.com/avatar.png" was
    // actually fetched by the browser and 404'd, which showed up as a
    // console error on every screen that renders an avatar and read as an
    // app bug in the sweep report.
    avatar_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    bio: "Smoke-test profile bio with at least twenty characters.",
    date_of_birth: "1990-01-01",
    phone: "5045550100",
    location: "New Orleans, LA",
    id_document_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    approval_status: "approved",
    ban_status: "active",
    is_legacy_user: true,
    subscription_tier: "free",
    subscription_expires_at: null,
    referral_code: "SMOKE",
    is_verified: true,
    role: user.role,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

// --- Network mocking ----------------------------------------------------

/**
 * Map of (matcher fn) -> response builder. First match wins. Tests register
 * specific overrides via `mockSupabase()`; everything else falls through to
 * the catch-all empty-array response so unanticipated reads don't 404 and
 * crash the page.
 */
export type SupabaseRouteHandler = (
  url: URL,
  request: Route["request"] extends () => infer R ? R : never,
) => SupabaseResponse | null | Promise<SupabaseResponse | null>;

export interface SupabaseResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockRule {
  match: (url: URL, method: string) => boolean;
  handle: (url: URL, method: string) => SupabaseResponse | null;
}

export interface MockSupabaseOptions {
  user?: FakeUser;
  rules?: MockRule[];
  /**
   * Answer table SELECTs from `SEED_TABLES` (see ./seedData) instead of the
   * default empty array.
   *
   * OFF by default, deliberately. The happy-path specs drive their own flows
   * and assert against a known-empty starting state; handing them pre-existing
   * jobs would break them. The audit sweep opts IN, because a screenshot of an
   * empty list proves only that the empty state renders — populated layouts are
   * where truncation, overflow and status-pill bugs actually live.
   */
  seed?: boolean;
}

/**
 * Register a route handler for every Supabase HTTP call. Default
 * responses keep the page from white-screening; per-test overrides take
 * precedence by being checked first.
 *
 * Safe to call multiple times on the same page — each call removes the
 * previous handler before installing a fresh one, so per-test mock
 * additions never stack on top of the fixture-installed defaults (which
 * would otherwise leave the older handler matching first and ignoring
 * the new rules).
 */
export async function installSupabaseMocks(
  page: Page,
  options: MockSupabaseOptions = {},
): Promise<void> {
  const user = options.user;
  const rules = options.rules ?? [];
  const seed = options.seed ?? false;

  // Clear any handler the fixture (or a prior call) registered for the
  // same URL pattern. Playwright stacks handlers most-recent-first, so
  // without this the old catch-all would resolve every request before
  // the new override rules ever ran.
  await page.unroute(`${SUPABASE_URL}/**`).catch(() => {
    /* no-op when nothing was registered yet */
  });
  // Realtime: hand the app an inert socket instead of letting it dial out.
  //
  // `page.route` covers HTTP only — Playwright does not intercept the ws://
  // upgrade — so every `.channel(...).subscribe()` in the app tried to reach
  // the REAL Supabase realtime host and the browser logged
  //   "WebSocket connection to 'wss://…/realtime/v1/websocket?…' failed"
  // as a console ERROR. The empty-state sweep asserts zero console errors, so
  // one unmocked socket failed 135 screens at once with a finding that says
  // nothing about any of them. (This block used to be a comment claiming the
  // failure "logs a warning" and was "fine" — it is an error, and it was only
  // invisible while the authed screens weren't mounting the subscribing hooks.)
  //
  // The stub stays in CONNECTING forever and never fires error/close, so
  // supabase-js quietly retries on its own timer and nothing reaches the
  // console. Non-Supabase sockets are untouched.
  await page.addInitScript(() => {
    const w = window as unknown as { __helprRealtimeStubbed?: boolean };
    if (w.__helprRealtimeStubbed) return;
    w.__helprRealtimeStubbed = true;
    const NativeWebSocket = window.WebSocket;
    class InertSocket extends EventTarget {
      static readonly CONNECTING = 0;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState = 0;
      bufferedAmount = 0;
      extensions = "";
      protocol = "";
      binaryType: BinaryType = "blob";
      onopen: unknown = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      onclose: unknown = null;
      constructor(readonly url: string) { super(); }
      send() { /* swallowed — nothing is listening */ }
      close() { this.readyState = 3; }
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args: unknown[]) {
        const url = String(args[0] ?? "");
        if (url.includes("/realtime/v1/websocket")) {
          return new InertSocket(url) as unknown as WebSocket;
        }
        return Reflect.construct(target, args) as WebSocket;
      },
    }) as typeof WebSocket;
  });

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    // 1. Per-test overrides — first matching rule wins.
    for (const rule of rules) {
      if (rule.match(url, method)) {
        const resp = rule.handle(url, method);
        if (resp) {
          return route.fulfill(buildFulfill(resp));
        }
      }
    }

    // 2. Auth endpoints
    if (url.pathname.startsWith("/auth/v1/")) {
      return route.fulfill(buildFulfill(handleAuth(url, method, user)));
    }

    // 3. PostgREST (table/RPC reads + writes)
    if (url.pathname.startsWith("/rest/v1/")) {
      return route.fulfill(buildFulfill(handleRest(url, method, user, seed)));
    }

    // 4. Edge functions (e.g. complete-signup) — always 200 with an empty
    //    success body. The post-signup code paths in src/pages/Signup.tsx
    //    treat a missing `result.error` as success.
    if (url.pathname.startsWith("/functions/v1/")) {
      return route.fulfill(buildFulfill({ status: 200, body: { success: true } }));
    }

    // 5. Realtime websockets are handled by the InertSocket init script
    //    above, not here — `route` never sees a ws:// upgrade.

    // 6. Storage uploads etc — 200 empty.
    return route.fulfill(buildFulfill({ status: 200, body: {} }));
  });

  // Also intercept any other backend hosts we don't depend on for smoke.
  // PostHog, Sentry, Vercel analytics, etc. shouldn't
  // make tests fail when they 4xx — let them through if they're harmless
  // but block any cross-origin write attempts that might add latency.
  await page.route("**/*.posthog.com/**", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.route("**/sentry.io/**", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.route("**/*.ingest.sentry.io/**", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.route("**/vitals.vercel-insights.com/**", (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("**/vercel.live/**", (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("**/_vercel/**", (r) => r.fulfill({ status: 204, body: "" }));

  // Catch-all for any OTHER third-party host. The named stubs above cover the
  // services we know about, but anything else — a map SDK, a font CDN, an
  // avatar host — still hits the real network, fails offline/in CI, and lands
  // in the sweep's console report as "Failed to load resource: 404". That
  // reads as an app defect when it is really an unmocked dependency.
  //
  // Scoped to CROSS-ORIGIN only: same-origin requests must still be served by
  // the preview server, otherwise the app's own chunks and assets would be
  // stubbed out and nothing would render.
  await page.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    // Before the first navigation page.url() is "about:blank", which has no
    // host to compare against — fall back to the preview origin. That fallback
    // must track HAPPY_PATH_BASE_URL (playwright.config.ts reads the same var):
    // hardcoding :4173 made every request 204 when the suite ran against any
    // other port, so the very first goto died with ERR_ABORTED.
    // HAPPY_PATH_PORT is the same knob playwright.config.ts uses to give a
    // session its own preview server; honour it here too, otherwise a run on a
    // non-default port falls back to :4173 for the pre-navigation origin and
    // 204s its own first request.
    const previewOrigin =
      process.env.HAPPY_PATH_BASE_URL ||
      `http://127.0.0.1:${process.env.HAPPY_PATH_PORT || "4173"}`;
    const base = new URL(page.url() === "about:blank" ? previewOrigin : page.url());

    // Same-origin: the preview server owns it (app chunks, assets).
    if (target.host === base.host) return route.fallback();

    // Hosts that ALREADY have a specific handler registered above. Playwright
    // runs handlers most-recent-first, so this catch-all is reached FIRST and
    // must hand them back — otherwise it answered every Supabase call with an
    // empty 204, the app got no data, and screens silently rendered their
    // loading/empty variant. That showed up as h1 counts changing on 9 screens:
    // a mock intercepting more than it meant to, not an app change.
    const DELEGATED = [
      SUPABASE_URL,
      "posthog.com",
      "sentry.io",
      "vercel-insights.com",
      "vercel.live",
    ];
    if (DELEGATED.some((h) => target.host.includes(h.replace(/^https?:\/\//, "")))) {
      return route.fallback();
    }

    return route.fulfill({ status: 204, body: "" });
  });
}

function buildFulfill(resp: SupabaseResponse) {
  return {
    status: resp.status ?? 200,
    contentType: resp.headers?.["content-type"] ?? "application/json",
    body: typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body ?? null),
    headers: resp.headers ?? {},
  };
}

function handleAuth(url: URL, method: string, user: FakeUser | undefined): SupabaseResponse {
  const path = url.pathname.replace("/auth/v1/", "");

  // signup → return an auth user (email_confirmed so the app proceeds)
  if (path === "signup" && method === "POST") {
    if (!user) return { status: 200, body: { user: null, session: null } };
    return { status: 200, body: { user: buildFakeAuthUser(user), session: buildFakeSession(user) } };
  }

  // signInWithPassword → POST /auth/v1/token?grant_type=password
  if (path === "token" && method === "POST") {
    if (!user) return { status: 400, body: { error: "invalid_grant" } };
    return { status: 200, body: buildFakeSession(user) };
  }

  // getUser → GET /auth/v1/user
  if (path === "user" && method === "GET") {
    if (!user) return { status: 401, body: { error: "no user" } };
    return { status: 200, body: buildFakeAuthUser(user) };
  }

  // logout → POST /auth/v1/logout
  if (path === "logout") {
    return { status: 204, body: "" };
  }

  // Default — let any other auth endpoint return an empty 200 to avoid
  // crashing the supabase-js client.
  return { status: 200, body: {} };
}

/**
 * Apply the PostgREST query params the seeded reads actually depend on:
 * `order` and `limit`.
 *
 * Without this the mock returns rows in array order no matter what the client
 * asked for, so a list built as "newest first" renders oldest-first. That looks
 * exactly like an app bug in a screenshot — the message list previewed the FIRST
 * message instead of the latest — when it is really the fixture ignoring
 * `?order=created_at.desc`. A mock that silently disagrees with the query is
 * worse than no mock, because it manufactures findings.
 *
 * Deliberately NOT a full PostgREST implementation: filters (`eq`, `in`, …) are
 * still ignored, so a screen may show rows it would not see in production. That
 * is acceptable for a LAYOUT audit — more rows is a harder layout test — but it
 * means this harness cannot be used to verify data-scoping or RLS.
 */
function applyPostgrestQuery(rows: unknown[], url: URL): unknown[] {
  let out = [...rows];

  // Column filters. PostgREST encodes them as `?col=op.value`, so any search
  // param whose value carries a known operator prefix is a filter. Previously
  // ALL of these were ignored, which meant a screen showed rows it could never
  // see in production — e.g. every job regardless of customer_id. That makes a
  // layout audit lie in the generous direction (more rows than reality) and
  // makes the harness useless for anything data-shaped.
  const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "like", "ilike"];
  const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
  for (const [key, raw] of url.searchParams.entries()) {
    if (RESERVED.has(key)) continue;
    const dot = raw.indexOf(".");
    if (dot < 0) continue;
    const op = raw.slice(0, dot);
    if (!OPS.includes(op)) continue;
    const val = raw.slice(dot + 1);
    out = out.filter((r) => {
      const cell = (r as Record<string, unknown>)[key];
      switch (op) {
        case "eq":
          return String(cell) === val;
        case "neq":
          return String(cell) !== val;
        case "is":
          return val === "null" ? cell == null : String(cell) === val;
        case "in": {
          // in.(a,b,c) — quotes are optional per value.
          const set = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
          return set.includes(String(cell));
        }
        case "gt":
          return String(cell) > val;
        case "gte":
          return String(cell) >= val;
        case "lt":
          return String(cell) < val;
        case "lte":
          return String(cell) <= val;
        case "like":
        case "ilike": {
          const rx = new RegExp("^" + val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", op === "ilike" ? "i" : "");
          return rx.test(String(cell));
        }
        default:
          return true;
      }
    });
  }

  // `or=(a.eq.x,b.eq.y)` is deliberately NOT implemented — the message list
  // uses it to match either side of a conversation. Applying only half of an
  // OR would silently hide rows, which is worse than ignoring it, so an
  // unhandled `or` leaves the set untouched.

  const order = url.searchParams.get("order");
  if (order) {
    // "created_at.desc" / "created_at.desc.nullslast" / "name.asc"
    const [col, dir] = order.split(".");
    const desc = dir === "desc";
    out.sort((a, b) => {
      const av = (a as Record<string, unknown>)[col];
      const bv = (b as Record<string, unknown>)[col];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av > bv ? 1 : -1;
      return desc ? -cmp : cmp;
    });
  }

  const limit = url.searchParams.get("limit");
  if (limit && Number.isFinite(Number(limit))) out = out.slice(0, Number(limit));

  return out;
}

function handleRest(
  url: URL,
  method: string,
  user: FakeUser | undefined,
  seed = false,
): SupabaseResponse {
  // /rest/v1/<table>?... or /rest/v1/rpc/<name>
  const parts = url.pathname.replace("/rest/v1/", "").split("/");
  const table = parts[0] ?? "";

  // RPC calls — return null which most RPCs in the codebase tolerate as
  // "no rows" via `data ?? []` or `?? null` patterns.
  if (table === "rpc") {
    const rpcName = parts[1] ?? "";
    // get_jobs_for_my_applications is called by fetchAppliedActivity to build
    // the job map that populates `app.job` on each AppliedJobCard. Without it
    // every card gets job:null and renders as the non-expandable minimal card.
    if (seed && rpcName === "get_jobs_for_my_applications") {
      return { status: 200, body: SEED_JOBS };
    }
    return { status: 200, body: null };
  }

  // profiles SELECT by user_id → return the fake profile so the "Big 7"
  // gate in ProtectedRoute passes.
  if (table === "profiles" && method === "GET" && user) {
    // The authed user's own profile must always be present — the "Big 7" gate
    // in ProtectedRoute bounces to /complete-profile without it. When seeding,
    // append the counterparty profiles too, otherwise this branch short-circuits
    // before the SEED_TABLES lookup below and every other person in the seeded
    // data renders as the fallback "User".
    const own = buildFakeProfile(user);
    if (!seed) return { status: 200, body: [own] };

    // Honour `?user_id=eq.<uuid>` (and `id=eq.`). Returning ALL profiles here
    // breaks the app's own profile read, which uses .single() and errors on
    // multiple rows — the screen renders "We couldn't load your account".
    // So resolve the filter to exactly the row asked for.
    const rawWanted = url.searchParams.get("user_id") ?? url.searchParams.get("id") ?? "";
    // `in.(a,b,c)` — the batch name-hydration shape (team members, applicant
    // lists). Before this branch existed it fell through the `eq.` strip
    // unchanged, matched nothing, and every hydrated name rendered as the
    // fallback: a team roster of blank rows that looks like a name-resolution
    // bug but is really the fixture ignoring the filter it was handed.
    if (rawWanted.startsWith("in.")) {
      const set = new Set(
        rawWanted
          .slice(3)
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.replace(/^"|"$/g, "")),
      );
      const seededPool = (SEED_TABLES.profiles ?? []) as Record<string, unknown>[];
      const all = [
        own,
        ...seededPool.filter((r) => r.user_id !== (own as Record<string, unknown>).user_id),
      ] as Record<string, unknown>[];
      return { status: 200, body: all.filter((r) => set.has(String(r.user_id)) || set.has(String(r.id))) };
    }
    const wanted = rawWanted.replace(/^eq\./, "");
    // Dedupe by user_id, own profile winning. SEED_PROFILES contains a row for
    // the helper, and when the sweep runs AS the helper that row and `own` are
    // the same person — so an `.eq("user_id", me)` lookup matched BOTH and every
    // .maybeSingle() caller got PGRST116 "Results contain 2 rows". That showed up
    // as "[StrikeBanner] failed to load ban status" on all 29 helper screens and
    // looked like an app bug.
    const seeded = (SEED_TABLES.profiles ?? []) as Record<string, unknown>[];
    const pool = [
      own,
      ...seeded.filter((r) => r.user_id !== (own as Record<string, unknown>).user_id),
    ] as Record<string, unknown>[];
    if (wanted) {
      const hit = pool.filter(
        (r) => r.user_id === wanted || r.id === wanted,
      );
      return { status: 200, body: hit };
    }
    // An UNFILTERED profiles read is essentially always "my own profile", and
    // several callers use .single(). Returning the whole pool made those fail
    // with PGRST116 "Results contain 2 rows" — which surfaced as a real-looking
    // "[StrikeBanner] failed to load ban status" error on 29 screens.
    return { status: 200, body: [own] };
  }

  // user_roles SELECT — fake user is NOT admin, return an empty array.
  if (table === "user_roles" && method === "GET") {
    return { status: 200, body: [] };
  }

  // INSERT / UPDATE / DELETE — return an empty array so .insert().select()
  // patterns get back data. supabase-js doesn't care about the row shape
  // here; the dashboard mutations all refresh via React Query, and the
  // mocked SELECTs will reflect the new state.
  if (["POST", "PATCH", "DELETE", "PUT"].includes(method)) {
    return { status: 201, body: [] };
  }

  // Seeded rows for the audit sweep (opt-in via `seed: true`). Checked last,
  // so per-test `rules` and the profiles/user_roles special cases above still
  // win — this only replaces the blanket empty-array fallback.
  if (seed && method === "GET" && SEED_TABLES[table]) {
    return { status: 200, body: applyPostgrestQuery(SEED_TABLES[table], url) };
  }

  // Default empty array for any other SELECT.
  return { status: 200, body: [] };
}

// --- Helpers exposed to specs -------------------------------------------

/**
 * Convenience: build a mock-rule that matches a `/rest/v1/<table>` URL
 * regardless of query string, and returns the given body.
 */
export function mockTable(
  table: string,
  body: unknown,
  options: { method?: string; status?: number } = {},
): MockRule {
  const wantMethod = options.method ?? "GET";
  return {
    match: (url, method) =>
      method === wantMethod && url.pathname === `/rest/v1/${table}`,
    handle: () => ({ status: options.status ?? 200, body }),
  };
}

/**
 * Convenience: build a mock-rule that matches `/rest/v1/rpc/<name>`.
 */
export function mockRpc(
  name: string,
  body: unknown,
  options: { status?: number } = {},
): MockRule {
  return {
    match: (url, method) =>
      method === "POST" && url.pathname === `/rest/v1/rpc/${name}`,
    handle: () => ({ status: options.status ?? 200, body }),
  };
}

/**
 * Pre-seed an authed Supabase session into localStorage before the app's
 * JS boots. Must be called BEFORE the first `page.goto()` so it lands
 * before `getSession()` runs during app bootstrap.
 */
export async function seedAuthedSession(context: BrowserContext, user: FakeUser, baseURL: string): Promise<void> {
  const session = buildFakeSession(user);
  // addInitScript runs in every new page, before any of the page's JS.
  await context.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* SSR/no-storage guard — irrelevant on Vite preview */
      }
    },
    { key: SUPABASE_AUTH_STORAGE_KEY, value: JSON.stringify(session) },
  );
  // Dismiss the first-run welcome modal for smoke tests — the modal
  // intercepts pointer events and breaks click-based test flows.
  await context.addInitScript(() => {
    try { window.localStorage.setItem('helpr_welcomed', '1'); } catch { /* SSR guard */ }
  });
  // …and the first-run OnboardingTour, for the same reason.
  //
  // OnboardingTour (src/components/OnboardingTour.tsx) opens on a
  // `setTimeout(…, 1500)` on /dashboard for any account that has not completed
  // it — which every freshly-seeded test session is. It is a MODAL Radix
  // dialog: it holds focus, blurs the page behind it, and eats the first tap
  // and the first Escape. A spec that lands on /dashboard without suppressing
  // it is driving the tour, not the app, and the failures it produces are
  // artifacts of the harness (focus "not moved into the overlay", Escape "did
  // not close it", a tap that opened nothing, axe scanning a mid-fade
  // composite at 1.01:1).
  //
  // Suppressed HERE, once, at the only shared entry point every authed spec
  // goes through — rather than in ~13 separate copies of the same init script
  // that had to be remembered each time a spec was written. `completed: true`
  // short-circuits the auto-show effect before any other branch; the
  // dismissed_at key stops the "Resume tour" pill too. The full shape
  // (`currentStep`/`completedSteps`) is written, not the older `{seen,
  // completed}` shorthand, so it matches what the component actually persists.
  //
  // A spec that wants to audit the tour itself must clear the key in its own
  // addInitScript after seeding — none does today.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "helpr_onboarding",
        JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
      );
      window.localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
    } catch { /* SSR guard */ }
  });
  // Some browsers gate localStorage on origin — touch the origin once so
  // the addInitScript above lands on the right localStorage partition.
  // (This is a no-op on file:// or about:blank for the same reason.)
  void baseURL;
}

/**
 * Run an Axe accessibility scan at the current page state. Asserts no
 * critical or serious violations. Use `tags` to limit the rule set
 * (default = WCAG 2.0 A/AA + best-practice, which is what most CI gates
 * use).
 */
export async function checkA11y(
  page: Page,
  options: { context?: string; tags?: string[]; disableRules?: string[] } = {},
): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(
    options.tags ?? ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  );
  if (options.context) builder.include(options.context);
  if (options.disableRules?.length) builder.disableRules(options.disableRules);
  // Some legacy color-contrast tickets are not yet fixed app-wide.
  // We do NOT silently mute them; the suite asserts no
  // critical/serious violations, and color-contrast typically lands as
  // "serious," so a regression here will still fail loudly. If the
  // bootstrap suite is too noisy we'll narrow with .disableRules() per
  // page.
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (blocking.length > 0) {
    const formatted = blocking
      .map(
        (v) =>
          `[${v.impact}] ${v.id} — ${v.help}\n    nodes: ${v.nodes.length}\n    help: ${v.helpUrl}`,
      )
      .join("\n");
    throw new Error(`Axe a11y violations:\n${formatted}`);
  }
}

// --- Custom test with fixtures ------------------------------------------

interface HappyPathFixtures {
  customerPage: Page;
  helperPage: Page;
}

export const test = baseTest.extend<HappyPathFixtures>({
  // Always start on mobile viewport — matches the live mobile-viewport
  // spot-check workflow and is what 80%+ of Helpr users hit.
  page: async ({ page }, use) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await use(page);
  },

  customerPage: async ({ context, page, baseURL }, use) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await page.setViewportSize(MOBILE_VIEWPORT);
    await use(page);
  },

  helperPage: async ({ context, page, baseURL }, use) => {
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER });
    await page.setViewportSize(MOBILE_VIEWPORT);
    await use(page);
  },
});

export { expect };
