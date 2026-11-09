/**
 * Q2705 (Builder 4, 11-09): index.html preloads main.tsx's static closure, so the boot graph downloads in the
 * entry's round, not one round trip (562 ms on Slow 4G) after the entry has arrived and run.
 * Lab, local dists, cwv-lab Slow 4G + 4x, 375, median of 3: app drawn / 3339 -> 3247, /login 3350 -> 3117,
 * /home 3781 -> 3502, /jobs 4860 -> 4291 ms (~/.lh-shots/speed-shell/ab1-*.log).
 *
 * The class: the boot graph falling back to a second round (the html list loses main's closure), or the html list
 * growing into lazy pages' code (the 2026-09-03 regression: 77 links, FCP 0.70 -> 3.22 s).
 *   (a) entryBootPreloads lists index.html's own deps, then main and everything it reaches statically, once each;
 *   (b) it never lists a dynamic import's chunk (a page) nor the entry itself;
 *   (c) vite.config.ts hands index.html's list (hostType "html") to entryBootPreloads.
 *
 * @mutate scripts/perf/entryRouteDeps.mjs |   walk(mainFile);\n  return out; |   return out;
 * @mutate scripts/perf/entryRouteDeps.mjs |     for (const i of bundle[f].imports ?? []) walk(i); |     void f;
 * @mutate scripts/perf/entryRouteDeps.mjs |     out.push(f);\n    for (const i of bundle[f].imports ?? []) walk(i); |     out.push(f);\n    for (const i of [...(bundle[f].imports ?? []), ...(bundle[f].dynamicImports ?? [])]) walk(i);
 * @mutate vite.config.ts |         hostType === "html" ? entryBootPreloads(builtBundle, filename, deps) :\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entryBootPreloads, type EntryRouteBundle } from "../../scripts/perf/entryRouteDeps.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");

const bundle: EntryRouteBundle = {
  "assets/index-AAAAAAAA.js": { type: "chunk", isEntry: true, imports: ["assets/preload-helper-B.js"], dynamicImports: ["assets/main-CCCCCCCC.js", "assets/Page-DDDDDDDD.js"] },
  "assets/preload-helper-B.js": { type: "chunk", imports: [] },
  "assets/main-CCCCCCCC.js": { type: "chunk", imports: ["assets/react-vendor-E.js", "assets/app-shared-F.js", "assets/preload-helper-B.js"], dynamicImports: ["assets/Lazy-J.js"] },
  "assets/app-shared-F.js": { type: "chunk", imports: ["assets/tanstack-G.js", "assets/react-vendor-E.js"] },
  "assets/react-vendor-E.js": { type: "chunk", imports: [] },
  "assets/tanstack-G.js": { type: "chunk", imports: [] },
  "assets/Page-DDDDDDDD.js": { type: "chunk", imports: ["assets/react-vendor-E.js", "assets/page-only-H.js"] },
  "assets/page-only-H.js": { type: "chunk", imports: [] },
  "assets/Lazy-J.js": { type: "chunk", imports: [] },
};

describe("index.html preloads the boot graph (main.tsx's static closure)", () => {
  it("(a) lists index.html's own deps, then main's whole static closure, once each", () => {
    const list = entryBootPreloads(bundle, "assets/index-AAAAAAAA.js", ["assets/preload-helper-B.js"]);
    expect(list).toEqual([
      "assets/preload-helper-B.js",
      "assets/main-CCCCCCCC.js",
      "assets/react-vendor-E.js",
      "assets/app-shared-F.js",
      "assets/tanstack-G.js",
    ]);
  });

  it("(b) never a page or other lazy chunk, never the entry; unreadable input leaves the list whole", () => {
    const list = entryBootPreloads(bundle, "assets/index-AAAAAAAA.js", ["assets/preload-helper-B.js"]);
    for (const lazy of ["assets/Page-DDDDDDDD.js", "assets/page-only-H.js", "assets/Lazy-J.js", "assets/index-AAAAAAAA.js"]) expect(list).not.toContain(lazy);
    expect(entryBootPreloads(null, "assets/index-AAAAAAAA.js", ["x.js"])).toEqual(["x.js"]);
    expect(entryBootPreloads(bundle, "assets/main-CCCCCCCC.js", ["x.js"])).toEqual(["x.js"]);
  });

  it("(c) vite.config.ts hands index.html's preload list to entryBootPreloads", () => {
    const cfg = blankComments(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));
    expect(cfg).toContain('hostType === "html" ? entryBootPreloads(builtBundle, filename, deps) :');
    expect(cfg).toMatch(/import \{ entryBootPreloads, [^}]*\} from "\.\/scripts\/perf\/entryRouteDeps\.mjs"/);
  });
});
