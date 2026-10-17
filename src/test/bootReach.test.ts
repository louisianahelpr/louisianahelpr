/**
 * Q654: shared code no signed-out cold load reaches stays out of the boot chunk.
 *
 * vite.config.ts's `app-shared` group sits on the boot path of every page, and
 * ~160 modules only the signed-in pages use rode in it (useActivityData,
 * subscriptionTiers, nativePush, ...). scripts/perf/bootReach.mjs computes, from
 * source on every build, which shared modules a public cold load cannot reach;
 * vite.config.ts gives them the `signed-in-shared` chunk. The built-bundle half
 * is scripts/check-deferred-vendors.mjs ("signed-in-only shared module is on the
 * boot path"), which reads the real chunks' sourcemaps; this is the source half.
 *
 * @mutate scripts/perf/bootReach.mjs | const reach = staticReach(root, publicRoots(root)); | const reach = new Set();
 * @mutate vite.config.ts | name: "signed-in-shared", | name: "signed-in-shared-off",
 * @mutate vite.config.ts | includeDependenciesRecursively: false, | includeDependenciesRecursively: true,
 * @mutate scripts/perf/bootReach.mjs | const deep = new Set([...signedInOnly].filter((f) => !reach.has(f))); | const deep = new Set();
 * @mutate vite.config.ts | name: "signed-in-deep", | name: "signed-in-deep-off",
 * @mutate vite.config.ts | const { deep: signedInDeep } = signedInSplit(process.cwd()); | const signedInDeep = new Set<string>();
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { firstScreenRoots, publicRoots, signedInOnlyModules, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const abs = (rel: string) => join(ROOT, rel).split("\\").join("/");

describe("bootReach: what a signed-out cold load can reach", () => {
  const { signedInOnly, reachable, sharedModules } = signedInOnlyModules(ROOT);

  it("starts from main.tsx and every guest first screen in ENTRY_ROUTE_CHUNKS", () => {
    const roots = publicRoots(ROOT).map((r) => r.split("\\").join("/"));
    expect(roots).toContain(abs("src/main.tsx"));
    for (const page of ["info/Index", "auth/Login", "auth/Signup", "home/DashboardGuest"]) {
      expect(roots).toContain(abs(`src/pages/${page}.tsx`));
    }
  });

  it("inventory: the walk sees the real tree", () => {
    expect(sharedModules).toBeGreaterThan(200); // 289 on 2026-10-04
    expect(reachable.size).toBeGreaterThan(150);
    expect(signedInOnly.size).toBeGreaterThan(100); // 161 on 2026-10-04
  });

  it("signed-in-only code is outside the public reach, boot code is inside it", () => {
    for (const rel of ["src/hooks/useActivityData.ts", "src/lib/awardGate.ts"]) {
      expect(signedInOnly.has(abs(rel)), rel).toBe(true);
    }
    for (const rel of ["src/lib/errorLogger.ts", "src/hooks/useCurrentUser.ts", "src/lib/queryKeys.ts"]) {
      expect(signedInOnly.has(abs(rel)), rel).toBe(false);
      expect(reachable.has(abs(rel)), rel).toBe(true);
    }
  });

  it("a dynamic import() is not an edge (that is the point of lazy code)", () => {
    // sentry.ts is loaded with import() from main.tsx; its module must not count as reached.
    expect(staticReach(ROOT, [abs("src/main.tsx")]).has(abs("src/lib/sentry.ts"))).toBe(false);
  });
});

describe("signedInSplit: signed-in code no first screen reaches (signed-in-deep, 2026-10-17)", () => {
  const { signedInOnly, firstScreen, deep } = signedInSplit(ROOT);

  it("starts from every page in ENTRY_ROUTE_CHUNKS, ProtectedRoute and the every-page components", () => {
    const roots = firstScreenRoots(ROOT).map((r) => r.split("\\").join("/"));
    for (const rel of ["src/pages/posts/PostsPage.tsx", "src/pages/home/Dashboard.tsx", "src/pages/messages/Messages.tsx", "src/pages/profile/Profile.tsx", "src/components/ProtectedRoute.tsx", "src/components/MobileNav.tsx"]) {
      expect(roots, rel).toContain(abs(rel));
    }
  });

  it("partitions signedInOnly exactly, and both halves are real", () => {
    expect(firstScreen.size + deep.size).toBe(signedInOnly.size);
    for (const f of deep) expect(firstScreen.has(f), f).toBe(false);
    expect(firstScreen.size).toBeGreaterThan(80); // 130 on 2026-10-17
    expect(deep.size).toBeGreaterThan(40); // 73 on 2026-10-17
  });

  it("first-screen code stays in signed-in-shared, lazy-only code goes deep", () => {
    for (const rel of ["src/hooks/useActivityData.ts", "src/lib/lifecycleErrors.ts", "src/lib/awardGate.ts"]) {
      expect(firstScreen.has(abs(rel)), rel).toBe(true);
    }
    for (const rel of ["src/lib/crewLifecycle.ts", "src/lib/enRouteLocation.ts", "src/lib/adminBanStatus.ts"]) {
      expect(deep.has(abs(rel)), rel).toBe(true);
    }
  });
});

describe("vite.config.ts wires the group", () => {
  const cfg = blankComments(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));
  const group = cfg.match(/name:\s*"signed-in-shared"[\s\S]*?\n\s*\},/)?.[0] ?? "";

  it("has a signed-in-shared group fed by signedInOnlyModules, above app-shared's priority", () => {
    expect(group).not.toBe("");
    expect(cfg).toMatch(/signedInOnlyModules\(process\.cwd\(\)\)/);
    expect(group).toMatch(/signedInOnly\.has\(/);
    const prio = Number(group.match(/priority:\s*(\d+)/)?.[1]);
    const appShared = Number(cfg.match(/name:\s*"app-shared"[\s\S]*?priority:\s*(\d+)/)?.[1]);
    expect(prio).toBeGreaterThan(appShared);
  });

  it("has a signed-in-deep group fed by signedInSplit, above signed-in-shared's priority", () => {
    const deepGroup = cfg.match(/name:\s*"signed-in-deep"[\s\S]*?\n\s*\},/)?.[0] ?? "";
    expect(deepGroup).not.toBe("");
    expect(cfg).toMatch(/\{\s*deep:\s*signedInDeep\s*\}\s*=\s*signedInSplit\(process\.cwd\(\)\)/);
    expect(deepGroup).toMatch(/signedInDeep\.has\(/);
    expect(deepGroup).toMatch(/includeDependenciesRecursively:\s*false/);
    expect(Number(deepGroup.match(/priority:\s*(\d+)/)?.[1])).toBeGreaterThan(Number(group.match(/priority:\s*(\d+)/)?.[1]));
  });

  it("does not drag the boot modules these import into the chunk", () => {
    // With the default (true) rolldown pulls utils, the Supabase client and react-router into it,
    // boot then imports it, and the whole move is a no-op (measured 2026-10-04: boot 280 KB, not 253).
    expect(group).toMatch(/includeDependenciesRecursively:\s*false/);
  });
});
