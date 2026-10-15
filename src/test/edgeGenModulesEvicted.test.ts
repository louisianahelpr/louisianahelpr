/**
 * The edge harness's generated modules do not pile up in Vitest's MAIN process.
 *
 * Main's Coverage floor job died at V8's ~4 GB heap limit on 2026-10-15 (runs
 * 38659872759, 38666593004: "Reached heap limit", exit 134). Root cause: every
 * `loadEdgeFunction` call writes its function as NEW `.gen.ts` modules, and the
 * Vite server (in the main process) cached each one's transform output for the
 * rest of the run. Measured on src/test/edge/create-payment.test.ts alone:
 * 596 gen modules, 490 MB of cached output, main heap 1.2 GB; with the plugin,
 * 2 left and 112 MB. The unsharded coverage job ran every edge suite in one
 * process, so it grew past the limit; the sharded jobs held a sixth each.
 *
 * The class this guards: anything that makes Vite keep finished harness loads
 * (the plugin unregistered, the harness writing elsewhere, a Vite upgrade that
 * changes the graph shape). It drives a REAL Vite server through two harness
 * loads and asserts the first load's modules are gone from the graph once its
 * files are deleted, the way the harness deletes them.
 *
 * @mutate src/test/edge/evictGenModules.ts |       if (fileExists(file)) continue; |       continue;
 * @mutate src/test/edge/evictGenModules.ts |   for (const dep of mod.importedModules) dep.importers.delete(mod); |   void 0;
 * @mutate vitest.config.ts |     evictEdgeGenModules({ |     void ({
 * @mutate src/test/edge/harness.ts | const GEN_DIR = join(REPO_ROOT, EDGE_GEN_DIR_NAME); | const GEN_DIR = join(REPO_ROOT, ".edge-gen");
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { evictEdgeGenModules, EDGE_GEN_DIR_NAME, type EvictStats } from "./edge/evictGenModules";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("edge-harness modules are evicted from the main process's module graph", () => {
  // realpath: macOS tmpdir is a symlink, and Vite keys modules by the real path.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lh-evict-")));
  const gen = join(dir, EDGE_GEN_DIR_NAME);
  mkdirSync(gen, { recursive: true });
  let server: ViteDevServer | undefined;
  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("drops a finished load's modules, and unlinks them from the modules they import", async () => {
    const reports: EvictStats[] = [];
    server = await createServer({
      root: dir,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, watch: null, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [evictEdgeGenModules({ onReport: (s) => reports.push(s) })],
    });
    const env = server.environments.ssr;
    // A shared module outside GEN_DIR, like the harness's ./mocks/*.ts.
    writeFileSync(join(dir, "shared.ts"), "export const shared = 1;\n");

    // Load 1: entry + sibling, both importing the shared module.
    const load = (run: string) => {
      writeFileSync(join(gen, `fn.${run}.1_dep.gen.ts`), `import { shared } from "../shared.ts";\nexport const dep = shared + 1;\n`);
      writeFileSync(
        join(gen, `fn.${run}.0_index.gen.ts`),
        `import { dep } from "./fn.${run}.1_dep.gen.ts";\nimport { shared } from "../shared.ts";\nexport default dep + shared;\n`,
      );
      return [`/${EDGE_GEN_DIR_NAME}/fn.${run}.0_index.gen.ts`, `/${EDGE_GEN_DIR_NAME}/fn.${run}.1_dep.gen.ts`];
    };
    const ids = (run: string) => [join(gen, `fn.${run}.0_index.gen.ts`), join(gen, `fn.${run}.1_dep.gen.ts`)];

    const [entryA, depA] = load("aaaa");
    await env.transformRequest(entryA);
    await env.transformRequest(depA);
    const graph = env.moduleGraph;
    for (const id of ids("aaaa")) expect(graph.getModuleById(id)?.transformResult).toBeTruthy();
    const sharedMod = graph.getModuleById(join(dir, "shared.ts"));
    expect(sharedMod?.importers.size ?? 0).toBeGreaterThan(0);

    // The harness's `finally`: the load is over, its files are deleted.
    for (const id of ids("aaaa")) rmSync(id);

    // Load 2 arrives; its first transform sweeps load 1 away.
    const [entryB, depB] = load("bbbb");
    await env.transformRequest(entryB);
    await env.transformRequest(depB);

    for (const id of ids("aaaa")) expect(graph.getModuleById(id), `${id} still cached`).toBeUndefined();
    for (const id of ids("bbbb")) expect(graph.getModuleById(id)?.transformResult).toBeTruthy();
    const importers = [...(graph.getModuleById(join(dir, "shared.ts"))?.importers ?? [])].map((m) => m.id ?? "");
    expect(importers.some((id) => id.includes("aaaa")), `shared.ts still lists load 1 as an importer: ${importers.join(", ")}`).toBe(false);
    expect(importers.some((id) => id.includes("bbbb"))).toBe(true);

    await server.close();
    server = undefined;
    expect(reports[reports.length - 1]?.dropped).toBe(2);
  });

  it("is registered in vitest.config.ts, and the harness writes into the directory it watches", () => {
    const config = read("vitest.config.ts");
    const calls = config.match(/\bevictEdgeGenModules\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(config).toMatch(/plugins:\s*\[[\s\S]*\bevictEdgeGenModules\(/);
    const harness = read("src/test/edge/harness.ts");
    expect(harness).toMatch(/const GEN_DIR = join\(REPO_ROOT, EDGE_GEN_DIR_NAME\);/);
    // Inventory floor: the harness is what fills the graph; every edge suite uses it.
    const loads = (readFileSync(join(ROOT, "src/test/edge/create-payment.test.ts"), "utf8").match(/loadEdgeFunction\(/g) ?? []).length;
    expect(loads).toBeGreaterThan(0);
  });
});
