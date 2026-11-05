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
 * @mutate scripts/perf/bootReach.mjs |     itemShared: new Set([...itemPages].filter((f) => restReach.has(f))), |     itemShared: new Set(),
 * @mutate vite.config.ts |               name: "item-shared", |               name: "declutter-item-pages",
 * @mutate vite.config.ts |               priority: 15.75, |               priority: 15.6,
 * @mutate scripts/perf/bootReach.mjs | const reach = staticReach(root, [...publicRoots(root), ...GUEST_CHROME_ROOTS.map((r) => toPosix(path.join(root, r)))]); | const reach = new Set();
 * @mutate scripts/perf/bootReach.mjs | const reach = staticReach(root, [...publicRoots(root), ...GUEST_CHROME_ROOTS.map((r) => toPosix(path.join(root, r)))]); | const reach = staticReach(root, publicRoots(root));
 * @mutate scripts/perf/bootReach.mjs |   "src/components/PermissionRationaleMount.tsx", |   // PermissionRationaleMount dropped
 * @mutate vite.config.ts | name: "signed-in-shared", | name: "signed-in-shared-off",
 * @mutate vite.config.ts | includeDependenciesRecursively: false, | includeDependenciesRecursively: true,
 * @mutate scripts/perf/bootReach.mjs | const deep = new Set([...signedInOnly].filter((f) => !reach.has(f))); | const deep = new Set();
 * @mutate vite.config.ts | name: "signed-in-deep", | name: "signed-in-deep-off",
 * @mutate scripts/perf/bootReach.mjs | toPosix(path.join(root, POST_JOB_ROOT)), | 
 * @mutate src/boot/routePreload.ts |     signedIn: [postJobRoute, protectedRoute], |     signedIn: [protectedRoute],
 * @mutate src/boot/postJobRoute.ts | import("@/pages/post-job/PostJob").catch | Promise.resolve().catch
 * @mutate vite.config.ts | const { deep: signedInDeep, declutterOnly, homeOff, homeLate } = signedInSplit(process.cwd()); | const signedInDeep = new Set<string>(); const declutterOnly = new Set<string>(); const homeOff = new Set<string>(); const homeLate = new Set<string>();
 * @mutate vite.config.ts | name: "declutter-first-screen", | name: "signed-in-shared",
 * @mutate scripts/perf/bootReach.mjs | const declutterOnly = new Set([...firstScreen].filter((f) => !others.has(f))); | const declutterOnly = new Set();
 * @mutate src/pages/auth/signup/useCityZipMismatch.ts | const loadCityZipMismatch = () => loadModule(() => import("@/lib/cityZipMismatch")); | import * as cityZipNow from "@/lib/cityZipMismatch";\nconst loadCityZipMismatch = async () => cityZipNow;
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
import { GUEST_CHROME_ROOTS, ITEM_PAGES_PINNED_RE, declutterItemSplit, firstScreenRoots, guestBrowseOnlyModules, guestBrowseSplit, homeFirstScreenRoots, publicRoots, signedInOnlyModules, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
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

/**
 * Q654 (B40, 11-03): App.tsx's lazy chrome that a GUEST mounts at once (outside SignedInChrome / SignedInOnly) is
 * fetched on every public cold load, ~70 ms after main.tsx. Measured on a build of origin/main dca60fb752 (Chromium,
 * cold `/`, no backend): ScrollToTop and PermissionRationaleMount pulled signed-in-shared (14.6 KB gz, 85% unused),
 * signed-in-dock and browse-home-shared onto that boot, because their helpers counted as signed-in-only.
 */
describe("bootReach: the lazy chrome a guest mounts at once is public reach", () => {
  const app = blankComments(readFileSync(join(ROOT, "src/App.tsx"), "utf8"));
  const lazySpec = new Map([...app.matchAll(/const (\w+) = lazy\(\s*\(\)\s*=>\s*(?:\([^)]*\)\s*,\s*)?import\(\s*["']([^"']+)["']/g)].map((m) => [m[1], m[2]]));
  const toFile = (spec: string) => {
    const rel = spec.startsWith("@/") ? `src/${spec.slice(2)}` : `src/${spec.replace(/^\.\//, "")}`;
    return [".tsx", ".ts"].map((ext) => rel + ext).find((f) => { try { readFileSync(join(ROOT, f)); return true; } catch { return false; } }) ?? rel;
  };
  // Spans of the signed-in wrappers: a lazy mount inside one never renders for a guest.
  const spans = [...app.matchAll(/<(SignedInChrome|SignedInOnly)>[\s\S]*?<\/\1>/g)].map((m) => [m.index!, m.index! + m[0].length]);
  const mounts = [...app.matchAll(/<Suspense fallback=\{null\}>\s*<(\w+)\s*\/>\s*<\/Suspense>/g)]
    .filter((m) => lazySpec.has(m[1]))
    .map((m) => ({ name: m[1], guest: !spans.some(([a, b]) => m.index! > a && m.index! < b) }));

  it("inventory: App.tsx's lazy chrome mounts and its signed-in wrappers are read", () => {
    expect(lazySpec.size).toBeGreaterThan(10);
    expect(mounts.length).toBeGreaterThan(8); // 11 on 2026-11-03
    expect(spans.length).toBeGreaterThan(1);
  });

  it("GUEST_CHROME_ROOTS is exactly the lazy chrome a guest mounts", () => {
    const guest = [...new Set(mounts.filter((m) => m.guest).map((m) => toFile(lazySpec.get(m.name)!)))].sort();
    expect(guest).toEqual([...GUEST_CHROME_ROOTS].sort());
  });

  it("no module that chrome reaches statically counts as signed-in-only", () => {
    const { signedInOnly } = signedInOnlyModules(ROOT);
    const reach = staticReach(ROOT, GUEST_CHROME_ROOTS.map(abs));
    expect(reach.size).toBeGreaterThan(10);
    expect([...reach].filter((f) => signedInOnly.has(f)).map((f) => f.slice(ROOT.length + 1))).toEqual([]);
    for (const rel of ["src/lib/hideUnopenedInApp.ts", "src/lib/lazyModule.ts"]) expect(signedInOnly.has(abs(rel)), rel).toBe(false);
  });
});

describe("signedInSplit: signed-in code no first screen reaches (signed-in-deep, 2026-10-17)", () => {
  const { signedInOnly, firstScreen, deep } = signedInSplit(ROOT);

  it("starts from every page in ENTRY_ROUTE_CHUNKS, ProtectedRoute and the every-page components", () => {
    const roots = firstScreenRoots(ROOT).map((r) => r.split("\\").join("/"));
    // 2026-10-19: /home opens the Home dashboard and /jobs the Jobs section (which embeds Dashboard).
    for (const rel of ["src/pages/posts/PostsPage.tsx", "src/pages/home/HomeDashboard.tsx", "src/pages/jobs/JobsSection.tsx", "src/pages/messages/Messages.tsx", "src/pages/profile/Profile.tsx", "src/pages/post-job/PostJob.tsx", "src/components/ProtectedRoute.tsx", "src/components/MobileNav.tsx"]) {
      expect(roots, rel).toContain(abs(rel));
    }
  });

  it("/post-job starts its page through src/boot/postJobRoute.ts, which starts PostJob (its list stays out of the entry, 11-04)", () => {
    const table = blankComments(readFileSync(join(ROOT, "src/boot/routePreload.ts"), "utf8"));
    expect(table).toMatch(/const postJobRoute = \(\) => import\("@\/boot\/postJobRoute"\)/);
    expect(table).toMatch(/"\/post-job": \{\s*guest: \[protectedRoute\],\s*signedIn: \[postJobRoute, protectedRoute\]/);
    expect(table).not.toMatch(/import\("@\/pages\/post-job\/PostJob"\)/);
    const boot = blankComments(readFileSync(join(ROOT, "src/boot/postJobRoute.ts"), "utf8"));
    expect(boot).toMatch(/import\("@\/pages\/post-job\/PostJob"\)/);
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
    expect(cfg).toMatch(/\{\s*deep:\s*signedInDeep,\s*declutterOnly,\s*homeOff,\s*homeLate\s*\}\s*=\s*signedInSplit\(process\.cwd\(\)\)/);
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

describe("declutterItemSplit itemShared: the job lists do not download Declutter's item-page code (Q654/Q1158, B41)", () => {
  // Measured 2026-11-03 (cwv-lab, signed in, 375): /jobs' first round fetched the whole declutter-item-pages chunk
  // (30 KB gz, Declutter's api and seller tools) for the error copy, offer clock and upload helpers it shares with the
  // item page. Static closure of /jobs, built: 465.7 -> 453.8 KB gz with the split.
  const { itemPages, itemShared } = declutterItemSplit(ROOT);
  // B52 (11-03): the Posted / Working lists are JobsSection's lazy chunk, a first screen of their own on a list link.
  const jobs = staticReach(ROOT, [abs("src/pages/jobs/JobsSection.tsx"), abs("src/components/job-card/JobListPage.tsx")]);

  it("inventory: both sets are real and itemShared is part of itemPages", () => {
    expect(itemPages.size).toBeGreaterThan(15);
    expect(itemShared.size).toBeGreaterThan(5);
    for (const f of itemShared) expect(itemPages.has(f), f).toBe(true);
  });

  it("every item-page module the /jobs first screen runs is in itemShared", () => {
    const used = [...itemPages].filter((f) => jobs.has(f));
    // 4 since B48 (11-03): the refusal words (lifecycleErrorCopy.ts) and what only they read left the /jobs boot.
    expect(used.length).toBeGreaterThan(3);
    for (const f of used) expect(itemShared.has(f), `${f}: /jobs would fetch declutter-item-pages for it`).toBe(true);
    // offerDeadline.ts left the item page with the refusal words (B48): only lifecycleErrors.ts is pinned here now.
    for (const rel of ["src/lib/lifecycleErrors.ts"]) expect(itemShared.has(abs(rel)), rel).toBe(true);
  });

  it("Declutter's own item-page code stays out of itemShared", () => {
    for (const rel of ["src/lib/declutter/api.ts", "src/lib/declutter/managerMode.ts"]) {
      expect(itemPages.has(abs(rel)), `${rel} is item-page code`).toBe(true);
      expect(itemShared.has(abs(rel)), rel).toBe(false);
    }
    for (const f of itemShared) expect(ITEM_PAGES_PINNED_RE.test(f), f).toBe(false);
  });

  it("vite.config.ts gives itemShared its own group between declutter-item-pages and leaves", () => {
    const cfg = blankComments(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));
    const group = cfg.match(/name:\s*"item-shared"[\s\S]*?\n\s*\},/)?.[0] ?? "";
    expect(group).toMatch(/declutterItemShared\.has\(/);
    expect(cfg).toMatch(/itemShared:\s*declutterItemShared\s*\}\s*=\s*declutterItemSplit\(/);
    const prio = Number(group.match(/priority:\s*([\d.]+)/)?.[1]);
    const prioOf = (name: string) => Number(cfg.match(new RegExp(`name:\\s*"${name}"[\\s\\S]*?priority:\\s*([\\d.]+)`))?.[1]);
    expect(prio).toBeGreaterThan(prioOf("declutter-item-pages"));
    expect(prio).toBeLessThan(prioOf("leaves"));
  });
});
