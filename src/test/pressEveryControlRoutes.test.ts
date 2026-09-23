import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

type ParsedRoute = { path: string; redirect: boolean; protected: boolean; admin: boolean };
type DerivedRow = { url: string; base: string; personas: string[]; redirect: boolean };
const deriveRouteSet = harness.deriveRouteSet as (o: { seedJobId: string; jobIds?: string[]; helperId: string; customerId: string; adminViews: string[] }) => DerivedRow[];
const parseAdminViews = harness.parseAdminViews as () => string[];
const parseAppRoutes = harness.parseAppRoutes as (appSrc?: string) => ParsedRoute[];
const parseProfileTabs = harness.parseProfileTabs as () => string[];
const DOCUMENTED_SKIPS = harness.DOCUMENTED_SKIPS as Set<string>;

/**
 * The press-every-control harness derives its route set from src/App.tsx so a
 * new route is walked the commit it is added. This guard makes sure the
 * derivation cannot silently lose routes: every `<Route path>` in the router
 * must map to at least one derived row, and the derivation must not be
 * checking itself against its own output (it is diffed against an independent
 * regex over App.tsx here — "registries checked against themselves" is a
 * pattern this repo has been bitten by three times).
 */
const repoRoot = resolve(__dirname, "../..");
const appSrc = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");

const independentPaths = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

const derived = deriveRouteSet({
  seedJobId: "10000000-0000-4000-8000-000000000001",
  helperId: "H",
  customerId: "C",
  adminViews: ["analytics"],
});

// @mutate scripts/audit/press-every-control.mjs | for (const v of adminViews) push(`${url}?view=${v}`, r, ["admin"]); |
describe("press-every-control route derivation", () => {
  it("maps every <Route path> in App.tsx to at least one derived row", () => {
    const bases = new Set(derived.map((r) => r.base));
    const missing = independentPaths.filter((p) => !bases.has(p));
    expect(missing).toEqual([]);
  });

  it("marks pure redirect routes so their targets are not pressed twice", () => {
    const parsed = parseAppRoutes();
    const byPath = Object.fromEntries(parsed.map((r) => [r.path, r]));
    // App.tsx has no redirect route left since Q194, so the positive case is a
    // synthetic route table.
    const synthetic = parseAppRoutes(`<Route path="/old" element={<Navigate to="/profile" replace />} />`);
    expect(synthetic).toEqual([expect.objectContaining({ path: "/old", redirect: true })]);
    expect(byPath["/dashboard"].redirect).toBe(false);
    // A wrapper that contains a page (MarketingRedirect around <Index />) is a
    // page, not a redirect.
    expect(byPath["/"].redirect).toBe(false);
  });

  it("walks every Profile tab and every admin view as its own row", () => {
    const tabs = parseProfileTabs().filter((t) => t !== "landing");
    for (const t of tabs) {
      expect(derived.some((r) => r.url === `/profile?tab=${t}`)).toBe(true);
    }
    expect(derived.some((r) => r.url === "/admin?view=analytics" && r.personas.includes("admin"))).toBe(true);
  });

  it("walks every real job id it was given as its own /jobs/:id row", () => {
    const rows = deriveRouteSet({ seedJobId: "J1", jobIds: ["J1", "J2", "J3"], helperId: "H", customerId: "C", adminViews: [] });
    expect(rows.filter((r) => r.base === "/jobs/:id").map((r) => r.url)).toEqual(["/jobs/J1", "/jobs/J2", "/jobs/J3"]);
  });

  it("derives the admin views from src/pages/Admin.tsx, not a hand-kept list", () => {
    const views = parseAdminViews();
    const src = readFileSync(resolve(repoRoot, "src/pages/Admin.tsx"), "utf8");
    const independent = [...(/type View\s*=\s*([^;]+);/.exec(src)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((v) => v !== "home");
    expect(views).toEqual(independent);
    expect(views).toContain("people");
  });

  it("visits protected routes as customer, helper and the incomplete-profile account; public routes anonymously", () => {
    const dash = derived.find((r) => r.url === "/dashboard");
    expect(dash?.personas).toEqual(expect.arrayContaining(["anon", "customer", "helper", "incomplete"]));
    const help = derived.find((r) => r.url === "/help");
    expect(help?.personas).toEqual(expect.arrayContaining(["anon", "customer"]));
  });

  it("has a closed list of documented skip reasons", () => {
    // Anything not in this set counts against coverage in the report. Adding
    // a reason is a deliberate edit to the script, never a runtime string.
    expect(DOCUMENTED_SKIPS.size).toBeGreaterThan(5);
    for (const reason of DOCUMENTED_SKIPS) expect(typeof reason).toBe("string");
  });
});

describe("press-every-control: Vercel-only scripts on a local preview", () => {
  // Runs 34744828202 and 34865377511 failed "Go Back" on 404 GET
  // /_vercel/speed-insights/script.js — a file only Vercel's edge serves.
  const ignore = harness.ignoreHostOnlyAsset as ((url: string, base: string) => boolean) | undefined;
  it("ignores /_vercel/(speed-)insights 404s against a local preview", () => {
    expect(typeof ignore, "harness has no host-only asset filter").toBe("function");
    expect(ignore!("http://127.0.0.1:4173/_vercel/speed-insights/script.js", "http://127.0.0.1:4173")).toBe(true);
    expect(ignore!("http://127.0.0.1:4173/_vercel/insights/script.js", "http://127.0.0.1:4173")).toBe(true);
  });
  it("still counts them against a real Vercel host, and never hides app requests", () => {
    expect(ignore!("https://www.louisianahelpr.com/_vercel/insights/script.js", "https://www.louisianahelpr.com")).toBe(false);
    expect(ignore!("http://127.0.0.1:4173/assets/index.js", "http://127.0.0.1:4173")).toBe(false);
    expect(ignore!("https://fncmgoasalhdgfwzhsqa.supabase.co/rest/v1/jobs", "http://127.0.0.1:4173")).toBe(false);
  });
});
