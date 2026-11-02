/**
 * AUD31-60/66 (part): Home's first screen no longer downloads the code only
 * the OTHER signed-in first screens run.
 *
 * Every signed-in visitor lands on /home, and its first screen fetched all of
 * `signed-in-shared`: the shared code of every signed-in first screen (the job
 * lists, Messages, You, Post a job). Measured on the production build
 * (bundle-size.yml env, 2026-10-31): /home 458 KB gz before, 441 after;
 * scripts/perf/critical-path.mjs now budgets /home, and CI's bundle-size.yml
 * checks the built graph.
 *
 * This file reads the same source walk vite.config.ts splits chunks by
 * (scripts/perf/bootReach.mjs): signedInSplit's `homeOff` (first-screen code
 * Home never runs) is real, disjoint from Home's static reach, and gets its own
 * `signed-in-pages` chunk, ranked above signed-in-shared so it wins those modules.
 *
 * @mutate vite.config.ts |               test: (id: string) => homeOff.has(id.split("?")[0].replace(/\\/g, "/")), |               test: (id: string) => signedInDeep.has(id.split("?")[0].replace(/\\/g, "/")),
 * @mutate vite.config.ts |               priority: 15.5, |               priority: 14,
 * @mutate scripts/perf/bootReach.mjs |   const homeOff = new Set([...firstScreen].filter((f) => !declutterOnly.has(f) && !home.has(f))); |   const homeOff = new Set();
 * @mutate scripts/perf/bootReach.mjs |   const homeOff = new Set([...firstScreen].filter((f) => !declutterOnly.has(f) && !home.has(f))); |   const homeOff = new Set([...firstScreen].filter((f) => !declutterOnly.has(f)));
 * @mutate vite.config.ts |               test: (id: string) => homeLate.has(id.split("?")[0].replace(/\\/g, "/")), |               test: (id: string) => homeOff.has(id.split("?")[0].replace(/\\/g, "/")),
 * @mutate vite.config.ts |               priority: 15.2, |               priority: 14.9,
 * @mutate scripts/perf/bootReach.mjs |   const homeLate = new Set([...firstScreen].filter((f) => !declutterOnly.has(f) && !homeOff.has(f) && !page.has(f))); |   const homeLate = new Set([...firstScreen].filter((f) => !declutterOnly.has(f) && !homeOff.has(f)));
 *
 * @mutate vite.config.ts |               priority: 91, |               priority: 89,
 * @mutate scripts/perf/bootReach.mjs |   return new Set([...iconsOf(staticReach(root, page))].filter((i) => !boot.has(i))); |   return new Set();
 * @mutate vite.config.ts | includeDependenciesRecursively: false // lucide's runtime stays put | // lucide's runtime stays put
 *
 * @mutate vite.config.ts |                 return bootIcons.has(file.replace(/^.*\//, "").replace(/\.mjs$/, "")); |                 return false;
 * @mutate vite.config.ts |                 if (!/\/icons\//.test(file)) return !/lucide-react\.mjs$/.test(file); |                 if (!/\/icons\//.test(file)) return false;
 * @mutate vite.config.ts |               priority: 92, |               priority: 88,
 * @mutate scripts/perf/bootReach.mjs |   return lucideIconScan(root).iconsOf(staticReach(root, [path.join(root, "src/main.tsx")])); |   return new Set();
 *
 * AUD31-66 (B129, 11-01): main.tsx's graph draws two icons (the offline banner's wifi-off and refresh-cw) and imported
 * them out of the two big merged icon chunks, so EVERY boot downloaded both (16.7 KB gz) for two icons; lucide's runtime
 * sat in one of them too. Both now ride a small icons-0 chunk. Production build, bundle-size.yml env: boot 207 -> 192
 * KB gz, /home 289 -> 274, /posts 207 -> 192, /login 250 -> 244.
 *
 * B79 (11-01): Home's icons (bootReach.mjs homeIconFiles, ~34) sat in one 166-icon chunk (~16 KB gz) that Home's first
 * round downloaded whole; they get their own icons-home chunk. Same build: /home 308 -> 295 KB gz; boot unchanged;
 * /, /browse, /login, /signup +0.5 KB gz each (they draw a few of Home's icons, now from this chunk).
 *
 * B79 (11-01): the same for the code only the every-page roots run (MobileNav, Legal, ...), which App mounts
 * lazily beside Home and which load after Home's first paint: signedInSplit's `homeLate` gets its own
 * `signed-in-late` chunk. Production build, bundle-size.yml env: /home 317 -> 308 KB gz.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVERY_PAGE_ROOTS, bootIconFiles, homeFirstScreenRoots, homeIconFiles, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
const homeReach = new Set([...staticReach(ROOT, homeFirstScreenRoots(ROOT))].map(rel));

describe("Home's first screen carries only Home's code (AUD31-60/66)", () => {
  it("walks a real first screen (floor: the dock, Home and its summary are all reached)", () => {
    expect(homeReach.size).toBeGreaterThan(60);
    for (const f of ["src/components/MobileNav.tsx", "src/pages/home/HomeDashboard.tsx", "src/pages/home/homeDashboard/useHomeSummary.ts", "src/components/ProtectedRoute.tsx"]) {
      expect(homeReach.has(f), f).toBe(true);
    }
  });

  it("splits the first-screen code Home never runs into its own chunk", () => {
    const { homeOff, firstScreen } = signedInSplit(ROOT);
    const off = [...homeOff].map(rel);
    expect(off.length).toBeGreaterThan(50);
    expect(off.filter((f) => homeReach.has(f))).toEqual([]);
    expect([...homeOff].every((f) => firstScreen.has(f))).toBe(true);
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    const group = config.match(/name:\s*"signed-in-pages",[\s\S]*?\}/)?.[0] ?? "";
    expect(group).toMatch(/test:\s*\(id: string\)\s*=>\s*homeOff\.has\(/);
    // Above signed-in-shared (15), below signed-in-deep (16) and declutter-first-screen (17).
    expect(group).toMatch(/priority:\s*15\.5,/);
  });

  it("splits the code only the every-page roots run, not Home's page, into signed-in-late (B79)", () => {
    const { homeLate, homeOff, firstScreen } = signedInSplit(ROOT);
    const late = [...homeLate].map(rel);
    // Floor: MobileNav's unread counts and message previews, Legal's data export, ... (26 at the time of writing).
    expect(late.length).toBeGreaterThan(15);
    for (const f of ["src/lib/archivedConversations.ts", "src/hooks/useDataExport.ts"]) expect(late, f).toContain(f);
    const pageReach = new Set([...staticReach(ROOT, homeFirstScreenRoots(ROOT).filter((r) => !EVERY_PAGE_ROOTS.some((e) => r.endsWith(e))))].map(rel));
    expect(late.filter((f) => pageReach.has(f))).toEqual([]);
    expect([...homeLate].every((f) => firstScreen.has(f) && !homeOff.has(f))).toBe(true);
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    const group = config.match(/name:\s*"signed-in-late",[\s\S]*?\}/)?.[0] ?? "";
    expect(group).toMatch(/test:\s*\(id: string\)\s*=>\s*homeLate\.has\(/);
    // Above signed-in-shared (15), below signed-in-pages (15.5).
    expect(group).toMatch(/priority:\s*15\.2,/);
  });

  it("gives the icons Home's page draws their own chunk, above the merged icon groups (B79)", () => {
    const icons = homeIconFiles(ROOT);
    // Floor: the title bar's bell and help, the dock's house and compass, the first-job card's checks (34 when written).
    expect(icons.size).toBeGreaterThan(20);
    for (const i of ["bell", "life-buoy", "circle-check"]) expect([...icons], i).toContain(i);
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    const group = config.match(/name:\s*"icons-home",[\s\S]*?\n\s*\},/)?.[0] ?? "";
    expect(group).toMatch(/homeIcons\.has\(/);
    // Without this the group also takes lucide's runtime, every icon chunk then imports it, and it joins the boot path.
    expect(group).toMatch(/includeDependenciesRecursively:\s*false/);
    const icon = config.match(/name:\s*"icons",[\s\S]*?priority:\s*(\d+)/)?.[1];
    expect(Number(group.match(/priority:\s*(\d+)/)?.[1])).toBeGreaterThan(Number(icon));
  });

  it("gives main.tsx's own icons and lucide's runtime a small chunk of their own, above every icon group (AUD31-66)", () => {
    const boot = bootIconFiles(ROOT);
    // Floor: the offline banner's two icons (2 when written).
    expect(boot.size).toBeGreaterThan(1);
    for (const i of ["wifi-off", "refresh-cw"]) expect([...boot], i).toContain(i);
    expect([...homeIconFiles(ROOT)].filter((i) => boot.has(i))).toEqual([]);
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    const group = config.match(/name:\s*"icons-0",[\s\S]*?(?=name:\s*"icons-home")/)?.[0] ?? "";
    expect(group).toMatch(/bootIcons\.has\(/);
    // The runtime (Icon, createLucideIcon, ...) rides here too: every file under lucide's dist/esm that is not an icon,
    // except the barrel.
    expect(group).toMatch(/if \(!\/\\\/icons\\\/\/\.test\(file\)\) return !\/lucide-react\\\.mjs\$\/\.test\(file\);/);
    expect(group).toMatch(/includeDependenciesRecursively:\s*false/);
    const home = config.match(/name:\s*"icons-home",[\s\S]*?priority:\s*(\d+)/)?.[1];
    expect(Number(group.match(/priority:\s*(\d+)/)?.[1])).toBeGreaterThan(Number(home));
  });
});
