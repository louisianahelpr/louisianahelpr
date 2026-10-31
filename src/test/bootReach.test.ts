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
 * @mutate vite.config.ts | const { deep: signedInDeep, declutterOnly, homeOff } = signedInSplit(process.cwd()); | const signedInDeep = new Set<string>(); const declutterOnly = new Set<string>(); const homeOff = new Set<string>();
 * @mutate vite.config.ts | name: "declutter-first-screen", | name: "signed-in-shared",
 * @mutate scripts/perf/bootReach.mjs | const declutterOnly = new Set([...firstScreen].filter((f) => !others.has(f))); | const declutterOnly = new Set();
 * @mutate src/pages/auth/signup/useCityZipMismatch.ts | void import("@/lib/cityZipMismatch").then( | void Promise.resolve(staticHint).then(
 * @mutate scripts/perf/bootReach.mjs |   return new Set([...reach].filter((f) => f.startsWith(src) && !others.has(f) && f !== browse)); |   return new Set([...reach].filter((f) => f.startsWith(src) && f !== browse));
 * @mutate scripts/perf/bootReach.mjs |   return new Set([...reach].filter((f) => f.startsWith(src) && !others.has(f) && f !== browse)); |   return new Set([...reach].filter((f) => SHARED_DIR_RE.test(f) && !others.has(f) && f !== browse));
 * @mutate vite.config.ts | name: "browse-first-screen", | name: "browse-first-screen-off",
 * @mutate vite.config.ts | const { browseOnly, homeShared: browseHomeShared } = guestBrowseSplit(process.cwd()); | const { homeShared: browseOnly, browseOnly: browseHomeShared } = guestBrowseSplit(process.cwd());
 * @mutate vite.config.ts | name: "browse-home-shared", | name: "browse-home-shared-off",
 * @mutate scripts/perf/bootReach.mjs |     browseOnly: new Set([...all].filter((f) => !home.has(f))), |     browseOnly: all,
 * @mutate vite.config.ts | test: /[\\/]src[\\/](lib[\\/]parishCentroids\|hooks[\\/]useUserLocation)\.ts$/, | test: /[\\/]src[\\/](lib[\\/]parishCentroids\|hooks[\\/](useDashboardFilters\|useUserLocation))\.ts$/,
 *
 * LEAD-POSTS-BOOT-SHRINK (10-31): code only guest /browse reaches (guestBrowseOnlyModules) has its own
 * `browse-first-screen` chunk; the built-bundle half is check-deferred-vendors.mjs ("only guest /browse reaches").
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { firstScreenRoots, guestBrowseOnlyModules, guestBrowseSplit, homeFirstScreenRoots, publicRoots, signedInOnlyModules, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
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
    // 2026-10-19: /home opens the Home dashboard and /jobs the Jobs section (which embeds Dashboard).
    for (const rel of ["src/pages/posts/PostsPage.tsx", "src/pages/home/HomeDashboard.tsx", "src/pages/jobs/JobsSection.tsx", "src/pages/messages/Messages.tsx", "src/pages/profile/Profile.tsx", "src/components/ProtectedRoute.tsx", "src/components/MobileNav.tsx"]) {
      expect(roots, rel).toContain(abs(rel));
    }
  });

  it("partitions signedInOnly exactly, and both halves are real", () => {
    expect(firstScreen.size + deep.size).toBe(signedInOnly.size);
    for (const f of deep) expect(firstScreen.has(f), f).toBe(false);
    expect(firstScreen.size).toBeGreaterThan(80); // 130 on 2026-10-17
    expect(deep.size).toBeGreaterThan(40); // 73 on 2026-10-17
  });

  it("code only Declutter's first screen reaches is split off, and nothing another first screen reads", () => {
    const { declutterOnly } = signedInSplit(ROOT);
    expect(declutterOnly.size).toBeGreaterThan(20); // about 60 on 2026-10-30
    for (const rel of ["src/lib/declutter/sellerDelivery.ts", "src/lib/declutter/wanted.ts"]) {
      expect(declutterOnly.has(abs(rel)), rel).toBe(true);
    }
    for (const f of declutterOnly) expect(firstScreen.has(f), f).toBe(true);
    for (const rel of ["src/hooks/useActivityData.ts", "src/lib/lifecycleErrors.ts"]) {
      expect(declutterOnly.has(abs(rel)), rel).toBe(false);
    }
  });

  it("/signup's first download does not carry the parish tables", () => {
    const reach = staticReach(ROOT, [abs("src/pages/auth/Signup.tsx")]);
    expect(reach.size).toBeGreaterThan(20);
    expect(reach.has(abs("src/lib/parishes.ts"))).toBe(false);
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
    expect(cfg).toMatch(/\{\s*deep:\s*signedInDeep,\s*declutterOnly,\s*homeOff\s*\}\s*=\s*signedInSplit\(process\.cwd\(\)\)/);
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

describe("guest /browse-only code is split off every other route's boot (LEAD-POSTS-BOOT-SHRINK)", () => {
  const browseOnly = guestBrowseOnlyModules(ROOT);
  const cfg = blankComments(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));

  it("holds the map, browse and job-card code, and none of it is reached by another first screen or the boot", () => {
    expect(browseOnly.size).toBeGreaterThan(40); // 84 on 2026-10-31
    for (const rel of ["src/hooks/useMapKitJs.ts", "src/lib/savedSearches.ts", "src/hooks/useDashboardJobsCount.ts", "src/lib/jobDisplayPay.ts", "src/components/dashboard/JobPrice.tsx"]) {
      expect(browseOnly.has(abs(rel)), rel).toBe(true);
    }
    const others = staticReach(ROOT, [
      ...publicRoots(ROOT).filter((r) => !r.endsWith("src/pages/home/DashboardGuest.tsx")),
      abs("src/App.tsx"),
    ]);
    expect(others.size).toBeGreaterThan(100);
    for (const f of browseOnly) expect(others.has(f), f).toBe(false);
    expect(browseOnly.has(abs("src/pages/home/DashboardGuest.tsx"))).toBe(false);
  });

  it("vite.config.ts gives them their own group above app-shared, without dragging their deps", () => {
    const g = cfg.match(/name:\s*"browse-first-screen"[\s\S]*?\n\s*\},/)?.[0] ?? "";
    expect(g).not.toBe("");
    expect(cfg).toMatch(/const \{ browseOnly, homeShared: browseHomeShared \} = guestBrowseSplit\(process\.cwd\(\)\)/);
    expect(g).toMatch(/browseOnly\.has\(/);
    expect(g).toMatch(/includeDependenciesRecursively:\s*false/);
    const appShared = Number(cfg.match(/name:\s*"app-shared"[\s\S]*?priority:\s*(\d+)/)?.[1]);
    expect(Number(g.match(/priority:\s*(\d+)/)?.[1])).toBeGreaterThan(appShared);
  });
});

describe("signed-in Home never downloads guest /browse's own chunk (10-31: /home 466 KB gz vs 441)", () => {
  const { browseOnly, homeShared } = guestBrowseSplit(ROOT);
  const cfg = blankComments(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));

  it("splits the guest /browse code by Home's reach, exactly", () => {
    const all = guestBrowseOnlyModules(ROOT);
    const home = staticReach(ROOT, homeFirstScreenRoots(ROOT));
    expect(browseOnly.size).toBeGreaterThan(30);
    expect(homeShared.size).toBeGreaterThan(10);
    expect(browseOnly.size + homeShared.size).toBe(all.size);
    for (const f of browseOnly) expect(home.has(f), f).toBe(false);
    for (const f of homeShared) expect(home.has(f), f).toBe(true);
    expect(homeShared.has(abs("src/components/dashboard/JobPrice.tsx"))).toBe(true);
    expect(browseOnly.has(abs("src/hooks/useDashboardFilters.ts"))).toBe(true);
  });

  it("vite.config.ts gives Home's part its own group, and no fixed group puts a /browse-only module beside Home's code", () => {
    const g = cfg.match(/name:\s*"browse-home-shared"[\s\S]*?\n\s*\},/)?.[0] ?? "";
    expect(g).toMatch(/browseHomeShared\.has\(/);
    expect(g).toMatch(/includeDependenciesRecursively:\s*false/);
    // parish-data rides with Home (its location); the job-list filter hook in it pulled browse-first-screen onto /home.
    const parish = cfg.match(/name:\s*"parish-data"[\s\S]*?test:\s*(\/[^\n]*\/),/)?.[1] ?? "";
    expect(parish).not.toBe("");
    const re = new RegExp(parish.slice(1, parish.lastIndexOf("/")));
    expect(re.test(abs("src/hooks/useUserLocation.ts"))).toBe(true);
    for (const f of browseOnly) expect(re.test(f), `${f} rides in parish-data, which /home fetches`).toBe(false);
  });
});

