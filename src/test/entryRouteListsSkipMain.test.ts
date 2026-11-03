/**
 * B48 (11-03): the entry's route preload lists skip what main.tsx's list already names.
 *
 * src/entry.ts imports main.tsx first and the route's page chunks right after it, in the same tick. The preload
 * helper adds one modulepreload link per URL and skips one that already has a link, so main's shared chunks in a
 * route's list never added a link; they were only bytes in the entry, the chunk every page downloads first (its
 * budget is 5.0 KB gz +5%, scripts/perf/critical-path-budget.json). scripts/perf/entryRouteDeps.mjs drops them from
 * the entry's route lists only. Measured on CI's bundle-size env: entry 5344 -> 5303 B gz, every route's rounds and
 * KB unchanged (critical-path --check, ~/.lh-shots/b48-perf/critical-path-compare.log).
 */
// @mutate scripts/perf/entryRouteDeps.mjs |   return deps.filter((d) => !mainClosure.has(d)); |   return deps;
// @mutate scripts/perf/entryRouteDeps.mjs |   if (!bundle \|\| !host?.isEntry \|\| MAIN_CHUNK_RE.test(filename)) return deps; |   if (!bundle) return deps;
// @mutate scripts/perf/entryRouteDeps.mjs |     for (const i of bundle[f]?.imports ?? []) walk(i); |     void f;
// @mutate vite.config.ts |     captureBundle(),\n |
// @mutate src/entry.ts | void import("./main");\n | 
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trimEntryRouteDeps, type EntryRouteBundle } from "../../scripts/perf/entryRouteDeps.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

const bundle: EntryRouteBundle = {
  "assets/index-AAAAAAAA.js": { type: "chunk", isEntry: true, imports: ["assets/preload-helper-B.js"], dynamicImports: ["assets/main-CCCCCCCC.js", "assets/Page-DDDDDDDD.js"] },
  "assets/main-CCCCCCCC.js": { type: "chunk", imports: ["assets/react-vendor-E.js", "assets/app-shared-F.js"] },
  "assets/app-shared-F.js": { type: "chunk", imports: ["assets/supabase-G.js"] },
  "assets/react-vendor-E.js": { type: "chunk", imports: [] },
  "assets/supabase-G.js": { type: "chunk", imports: [] },
  "assets/Page-DDDDDDDD.js": { type: "chunk", imports: ["assets/react-vendor-E.js", "assets/supabase-G.js", "assets/page-only-H.js"] },
  "assets/page-only-H.js": { type: "chunk", imports: [] },
  "assets/Other-IIIIIIII.js": { type: "chunk", imports: ["assets/react-vendor-E.js"], dynamicImports: ["assets/Page-DDDDDDDD.js"] },
};
const pageDeps = ["assets/react-vendor-E.js", "assets/supabase-G.js", "assets/page-only-H.js"];

describe("the entry's route preload lists skip main's closure", () => {
  it("an entry route list keeps only what main.tsx's closure does not reach (transitively)", () => {
    expect(trimEntryRouteDeps(bundle, "assets/index-AAAAAAAA.js", "assets/Page-DDDDDDDD.js", pageDeps)).toEqual(["assets/page-only-H.js"]);
  });

  it("main's own list, a non-entry host's list, and an unreadable bundle stay whole", () => {
    const mainDeps = ["assets/react-vendor-E.js", "assets/app-shared-F.js", "assets/supabase-G.js"];
    expect(trimEntryRouteDeps(bundle, "assets/index-AAAAAAAA.js", "assets/main-CCCCCCCC.js", mainDeps)).toEqual(mainDeps);
    expect(trimEntryRouteDeps(bundle, "assets/Other-IIIIIIII.js", "assets/Page-DDDDDDDD.js", pageDeps)).toEqual(pageDeps);
    expect(trimEntryRouteDeps(null, "assets/index-AAAAAAAA.js", "assets/Page-DDDDDDDD.js", pageDeps)).toEqual(pageDeps);
    const noMain: EntryRouteBundle = { ...bundle, "assets/index-AAAAAAAA.js": { type: "chunk", isEntry: true, dynamicImports: ["assets/Page-DDDDDDDD.js"] } };
    expect(trimEntryRouteDeps(noMain, "assets/index-AAAAAAAA.js", "assets/Page-DDDDDDDD.js", pageDeps)).toEqual(pageDeps);
  });

  it("vite.config.ts captures the bundle before the preload lists are written, and uses it for JS hosts only", () => {
    const cfg = code("vite.config.ts");
    expect(cfg).toMatch(/plugins:\s*\[\s*captureBundle\(\),/);
    expect(cfg).toMatch(/generateBundle:\s*\{\s*order:\s*"pre",/);
    expect(cfg).toMatch(/hostType === "js" \? trimEntryRouteDeps\(builtBundle, hostId, filename, deps\) : deps/);
  });

  it("the entry imports main.tsx before it starts the route's chunks, so main's links are there first", () => {
    const entry = code("src/entry.ts");
    const main = entry.indexOf('void import("./main");');
    expect(main).toBeGreaterThan(-1);
    expect(entry.indexOf("preloadEntryRoute(window.location.pathname)")).toBeGreaterThan(main);
  });
});
