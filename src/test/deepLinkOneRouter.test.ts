/**
 * NB-017 class guard: every native URL is routed by ONE function, exactly once,
 * and every helpr:// address the app mints opens a real route.
 *
 * What went wrong, as measured from the code (the device half of NB-017 is
 * still unverified — see the finding):
 *   - On iOS `App.getLaunchUrl()` returns ApplicationDelegateProxy.lastURL, and
 *     the cold-start `appUrlOpen` is retained until a listener attaches. Both
 *     entry points ran the whole handler, so a cold start from a link routed
 *     it twice (two Browser.close(), two navigate()).
 *   - The listener sat at the end of the push-setup try block, so any push
 *     throw left the process with no deep links at all.
 *
 * Three checks:
 *   1. SOURCE: `appUrlOpen` is subscribed once and `getLaunchUrl()` is read
 *      once in all of src/, both in deepLinkRouter.ts, and both hand the URL to
 *      `routeIncomingUrl` — the one function that navigates.
 *   2. BEHAVIOUR: the launch read and its appUrlOpen twin route once in either
 *      order; two real taps route twice.
 *   3. ROUTES: every `buildRedirectUrl(...)` in the edge functions (the
 *      native=1 Stripe returns that nativeReturnBounce.ts turns into
 *      `helpr:///<path>`) normalizes to a path App.tsx serves.
 *
 * RED proofs are the @mutate lines below; each was run against this file.
 */
// @mutate src/lib/deepLinkRouter.ts | if (isLaunchTwin(rawUrl, source, Date.now())) return; | void isLaunchTwin;
// @mutate src/lib/deepLinkRouter.ts | if (launch?.url) await routeIncomingUrl(launch.url, "launch", navigate); | if (launch?.url) navigate(launch.url);
// @mutate src/App.tsx | <Route path="/payment-success" | <Route path="/payment-successx"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { normalizeDeepLinkUrl, NATIVE_RETURN_SCHEME } from "@/lib/deepLinkRoute";

type UrlListener = (event: { url: string }) => void;
let urlListener: UrlListener | null = null;
let launchUrl: string | undefined;
const closeMock = vi.fn();
const reportMock = vi.fn();

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (name: string, fn: UrlListener) => {
      await new Promise((r) => setTimeout(r, 0));
      if (name === "appUrlOpen") urlListener = fn;
      return { remove: vi.fn() };
    },
    getLaunchUrl: async () => {
      await new Promise((r) => setTimeout(r, 0));
      return launchUrl ? { url: launchUrl } : {};
    },
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: () => closeMock() } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { AppOpenedFromDeepLink: "app_opened_from_deep_link" } }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

const REPO = resolve(__dirname, "../..");
const ROUTER = "src/lib/deepLinkRouter.ts";

function srcFiles(): string[] {
  return walkSource([join(REPO, "src")])
    .map((abs) => relative(REPO, abs))
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith("src/test/"));
}

describe("1. one router for both native URL entry points", () => {
  const hits = { appUrlOpen: [] as string[], getLaunchUrl: [] as string[] };
  for (const f of srcFiles()) {
    const text = readSource(join(REPO, f));
    if (text === null) continue;
    const code = blankComments(text);
    for (const m of code.matchAll(/addListener\(\s*["'`]appUrlOpen["'`]/g)) if (m) hits.appUrlOpen.push(f);
    for (const m of code.matchAll(/\bgetLaunchUrl\s*\(/g)) if (m) hits.getLaunchUrl.push(f);
  }

  it("the source inventory is real (floor)", () => {
    expect(srcFiles().length).toBeGreaterThan(500);
  });

  it("appUrlOpen is subscribed exactly once, in deepLinkRouter.ts", () => {
    expect(hits.appUrlOpen).toEqual([ROUTER]);
  });

  it("App.getLaunchUrl() is read exactly once, in deepLinkRouter.ts", () => {
    expect(hits.getLaunchUrl).toEqual([ROUTER]);
  });

  it("both entry points hand the URL to routeIncomingUrl, and nothing else there navigates", () => {
    const code = blankComments(readFileSync(join(REPO, ROUTER), "utf8"));
    expect(code).toMatch(/addListener\(\s*"appUrlOpen"[\s\S]{0,400}?routeIncomingUrl\(\s*event\.url,\s*"appUrlOpen"/);
    expect(code).toMatch(/getLaunchUrl\(\)[\s\S]{0,200}?routeIncomingUrl\(\s*launch\.url,\s*"launch"/);
    // The single navigate() call lives inside routeIncomingUrl's body.
    const body = code.slice(code.indexOf("async function routeIncomingUrl("), code.indexOf("export async function startDeepLinkRouting"));
    const everywhere = [...code.matchAll(/\bnavigate\(\s*[a-z]/gi)].length;
    const inRouter = [...body.matchAll(/\bnavigate\(\s*[a-z]/gi)].length;
    expect(inRouter).toBe(1);
    expect(everywhere).toBe(inRouter);
  });
});

describe("2. the launch URL and its appUrlOpen twin route once", () => {
  const LINK = `${NATIVE_RETURN_SCHEME}:///payment-success?job_id=abc`;
  let navigate: ReturnType<typeof vi.fn<(to: string) => void>>;

  async function boot() {
    const mod = await import("@/lib/deepLinkRouter");
    mod.resetDeepLinkRouterForTests();
    navigate = vi.fn<(to: string) => void>();
    return mod;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    urlListener = null;
    launchUrl = undefined;
  });
  afterEach(() => vi.restoreAllMocks());

  const settle = () => new Promise((r) => setTimeout(r, 5));

  it("cold start: retained appUrlOpen first, then getLaunchUrl → one navigation", async () => {
    const mod = await boot();
    launchUrl = LINK;
    const started = mod.startDeepLinkRouting(navigate);
    // The retained event is replayed as soon as the listener attaches.
    while (!urlListener) await new Promise((r) => setTimeout(r, 0));
    urlListener({ url: LINK });
    await started;
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/payment-success?job_id=abc");
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("cold start: getLaunchUrl first, then the appUrlOpen twin → one navigation", async () => {
    const mod = await boot();
    launchUrl = LINK;
    await mod.startDeepLinkRouting(navigate);
    urlListener!({ url: LINK });
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("plain launch (no URL), then a link → routed", async () => {
    const mod = await boot();
    await mod.startDeepLinkRouting(navigate);
    urlListener!({ url: "https://www.louisianahelpr.com/legal?tab=privacy" });
    await settle();
    expect(navigate).toHaveBeenCalledWith("/legal?tab=privacy");
  });

  it("the same link tapped twice while running → routed twice", async () => {
    const mod = await boot();
    await mod.startDeepLinkRouting(navigate);
    urlListener!({ url: LINK });
    await settle();
    urlListener!({ url: LINK });
    await settle();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("the launch link re-tapped after the twin window → routed again", async () => {
    const mod = await boot();
    launchUrl = LINK;
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    await mod.startDeepLinkRouting(navigate);
    now.mockReturnValue(t0 + mod.LAUNCH_TWIN_WINDOW_MS + 1);
    urlListener!({ url: LINK });
    await settle();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("starts once per process", async () => {
    const mod = await boot();
    launchUrl = LINK;
    await mod.startDeepLinkRouting(navigate);
    await mod.startDeepLinkRouting(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("3. every helpr:// address the app mints is a real route", () => {
  const appCode = blankComments(readFileSync(join(REPO, "src/App.tsx"), "utf8"));
  const patterns = [...appCode.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== "*")
    .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\/\*$/, "(?:/.*)?").replace(/:[A-Za-z0-9_]+/g, "[^/]+")}$`));
  const served = (pathname: string) => patterns.some((re) => re.test(pathname));

  // buildRedirectUrl(<first arg>, ...) in every edge function (tests excluded).
  const calls: { where: string; arg: string }[] = [];
  const fnFiles = walkSource([join(REPO, "supabase/functions")])
    .map((abs) => relative(REPO, abs))
    .filter((f) => !/\.(test|spec)\.ts$/.test(f) && !f.includes("/tests/") && !f.endsWith("_shared/appUrl.ts"));
  for (const f of fnFiles) {
    const text = readSource(join(REPO, f));
    if (text === null) continue;
    for (const m of blankComments(text).matchAll(/buildRedirectUrl\(\s*([^,)]+)/g)) calls.push({ where: f, arg: m[1].trim() });
  }

  it("the inventories are real (floors)", () => {
    expect(patterns.length).toBeGreaterThan(20);
    expect(calls.length).toBeGreaterThan(15);
    expect(served("/payment-success")).toBe(true);
    expect(served("/no-such-page")).toBe(false);
  });

  it("every buildRedirectUrl target is a literal path (provable), not a variable", () => {
    const opaque = calls.filter((c) => !/^["'`]\//.test(c.arg)).map((c) => `${c.where} :: ${c.arg}`);
    expect(opaque).toEqual([]);
  });

  it("each one, bounced through helpr://, normalizes to a route App.tsx serves", () => {
    const bad: string[] = [];
    for (const { where, arg } of calls) {
      // `/home?boosted=${job_id}` → a concrete sample; only the path decides the route.
      const sample = arg.slice(1, -1).replace(/\$\{[^}]*\}/g, "sample-id");
      // Exactly what nativeReturnBounce.ts builds: `${scheme}://${pathname}${search}`.
      const internal = normalizeDeepLinkUrl(`${NATIVE_RETURN_SCHEME}://${sample}`);
      const pathname = internal ? new URL(internal, "https://x.invalid").pathname : null;
      if (!pathname || !served(pathname)) bad.push(`${where} :: ${arg} -> ${internal}`);
    }
    expect(bad).toEqual([]);
  });
});
