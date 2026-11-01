/**
 * B83, 11-01: `app-shared`, the chunk main.tsx imports statically (so every page's boot), holds only the shared code
 * boot runs plus what Home's first screen runs. With the directory test alone every shared src/lib, src/hooks...
 * module two chunks import rode there: 57 modules main.tsx never reaches. Production build, bundle-size.yml env,
 * same session: boot 215 -> 209 KB gz, /home 295 -> 290, /posts 215 -> 209. The rest is one `shared-late` chunk.
 *
 * @mutate vite.config.ts | test: (id: string) => SHARED_DIR_RE.test(id) && bootOrHome(norm(id)), | test: (id: string) => SHARED_DIR_RE.test(id),
 * @mutate vite.config.ts | const bootOrHome = (f: string) => bootSet.has(f) \|\| homeSet.has(f); | const bootOrHome = (f: string) => !!f;
 * @mutate scripts/perf/bootReach.mjs |   return staticReach(root, [main]); |   return staticReach(root, [main, ...publicRoots(root)]);
 * @mutate scripts/perf/bootReach.mjs |   return homeFirstScreenRoots(root).filter((r) => !EVERY_PAGE_ROOTS.some((e) => toPosix(r).endsWith(e))); |   return homeFirstScreenRoots(root);
 * @mutate vite.config.ts | const homeSet = staticReach(process.cwd(), homePageRoots(process.cwd())); | const homeSet = staticReach(process.cwd(), [...homePageRoots(process.cwd()), "src/pages/info/Legal.tsx"]);
 *
 * B88, 11-01: "Home's first screen" is Home's PAGE (main.tsx, HomeDashboard, ProtectedRoute: homePageRoots), not
 * the every-page roots App mounts lazily after it (Legal, the dock, the ID sheet). With them, Legal's public page
 * table (publicPageMeta.mjs) rode app-shared onto every page's boot. Build: boot 204 -> 202 KB gz, /home 285 -> 282.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootModules, homePageRoots, SHARED_DIR_RE, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
const groupOf = (name: string) => config.match(new RegExp(`name:\\s*"${name}",[\\s\\S]*?\\}`))?.[0] ?? "";

describe("app-shared carries only boot's (and Home's) shared code (B83)", () => {
  it("bootModules is main.tsx's static closure, not every page's", () => {
    const boot = bootModules(ROOT);
    const has = (f: string) => boot.has(resolve(ROOT, f).split("\\").join("/"));
    // Floor: boot really is walked (App, the Supabase client, errorLogger...).
    expect(boot.size).toBeGreaterThan(80);
    expect(has("src/App.tsx")).toBe(true);
    expect(has("src/lib/errorLogger.ts")).toBe(true);
    // Shared modules only some pages run, not boot.
    expect(has("src/lib/messageScanner.ts")).toBe(false);
    expect(has("src/lib/turnstile.ts")).toBe(false);
    expect([...boot].filter((f) => SHARED_DIR_RE.test(f)).length).toBeGreaterThan(40);
  });

  it("the app-shared group admits a shared module only when boot or Home's first screen runs it", () => {
    const app = groupOf("app-shared");
    expect(app).toMatch(/test:\s*\(id: string\) => SHARED_DIR_RE\.test\(id\) && bootOrHome\(norm\(id\)\)/);
    expect(config).toMatch(/const bootOrHome = \(f: string\) => bootSet\.has\(f\) \|\| homeSet\.has\(f\);/);
    expect(config).toMatch(/const bootSet = bootModules\(process\.cwd\(\)\);/);
    expect(config).toMatch(/const homeSet = staticReach\(process\.cwd\(\), homePageRoots\(process\.cwd\(\)\)\);/);
    // The rest goes to ONE chunk (many small ones pushed the entry's preload list past its budget).
    const late = groupOf("shared-late");
    expect(late).toMatch(/test:\s*lateShared,/);
    expect(late).toMatch(/includeDependenciesRecursively:\s*false/);
  });

  it("Home's reach is its page, not the every-page roots that load after it (B88)", () => {
    const roots = homePageRoots(ROOT).map((r) => r.split("\\").join("/"));
    expect(roots.length).toBeGreaterThan(2);
    expect(roots.some((r) => r.endsWith("src/pages/home/HomeDashboard.tsx"))).toBe(true);
    expect(roots.some((r) => r.endsWith("src/pages/info/Legal.tsx") || r.endsWith("src/components/MobileNav.tsx"))).toBe(false);
    const home = staticReach(ROOT, homePageRoots(ROOT));
    const has = (f: string) => home.has(resolve(ROOT, f).split("\\").join("/"));
    expect(home.size).toBeGreaterThan(100);
    expect(has("src/hooks/useCurrentUser.ts")).toBe(true);
    // Only Legal (an every-page root) and public pages read it: not Home's first round, so not app-shared.
    expect(has("src/lib/publicPageMeta.mjs")).toBe(false);
    expect(config).toMatch(/const lateShared = \(id: string\) => [^\n]*!bootOrHome\(norm\(id\)\);/);
  });
});
