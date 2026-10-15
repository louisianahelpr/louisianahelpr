/// <reference types="node" />
/**
 * Vite plugin (registered in vitest.config.ts): drops an edge-harness load's
 * generated modules from the Vite module graph once that load is over.
 *
 * Why (main's Coverage floor job, 2026-10-15, runs 38659872759 and
 * 38666593004): `loadEdgeFunction` (./harness.ts) writes every load of a
 * function as NEW `.gen.ts` files (a fresh runId each time, plus a `?t=`
 * cache-bust) so each test gets a freshly evaluated module. The Vite server
 * lives in Vitest's MAIN process and caches every transformed module, code and
 * source map, for the rest of the run, and nothing ever evicted these: one
 * unique entry per load, never requested again. Measured locally on
 * src/test/edge/create-payment.test.ts alone: 596 gen modules, 490 MB of
 * cached transform output, main heap 1.2 GB. The six sharded Vitest jobs each
 * hold a sixth of that; the unsharded coverage job held all of it and died at
 * V8's ~4 GB heap limit ("Reached heap limit", exit 134) once #3123 added more
 * create-payment / charge-recurring-visits loads.
 *
 * A gen module is safe to drop once its FILE is gone: the harness deletes a
 * load's files only after the whole graph has been imported (its `finally`),
 * and no later request can name that runId again. So on every new gen
 * transform, each earlier gen module whose file no longer exists is removed
 * from the graph (and from its neighbours' importer sets, which would
 * otherwise keep it alive). Nothing outside GEN_DIR is touched, so coverage of
 * src/lib and src/hooks is unaffected.
 */
import { existsSync } from "node:fs";
import type { Plugin } from "vite";

/** The git-ignored dir the harness writes its `.gen.ts` files into (repo root). */
export const EDGE_GEN_DIR_NAME = ".lh-edge-gen";

type GraphNode = {
  id: string | null;
  url: string;
  file: string | null;
  transformResult?: { etag?: string } | null;
  importers: Set<GraphNode>;
  importedModules: Set<GraphNode>;
};
type Graph = {
  idToModuleMap: Map<string, GraphNode>;
  urlToModuleMap: Map<string, GraphNode>;
  etagToModuleMap: Map<string, GraphNode>;
  fileToModulesMap: Map<string, Set<GraphNode>>;
  getModuleById(id: string): GraphNode | undefined;
};

function isEdgeGenId(id: string): boolean {
  return id.includes(`/${EDGE_GEN_DIR_NAME}/`);
}

/** Remove one module from the graph and unlink it from its neighbours. */
function dropFromGraph(graph: Graph, mod: GraphNode): void {
  const etag = mod.transformResult?.etag;
  if (etag) graph.etagToModuleMap.delete(etag);
  mod.transformResult = null;
  for (const dep of mod.importedModules) dep.importers.delete(mod);
  for (const importer of mod.importers) importer.importedModules.delete(mod);
  mod.importedModules.clear();
  mod.importers.clear();
  if (mod.id && graph.idToModuleMap.get(mod.id) === mod) graph.idToModuleMap.delete(mod.id);
  if (graph.urlToModuleMap.get(mod.url) === mod) graph.urlToModuleMap.delete(mod.url);
  if (mod.file) {
    const set = graph.fileToModulesMap.get(mod.file);
    set?.delete(mod);
    if (set && set.size === 0) graph.fileToModulesMap.delete(mod.file);
  }
}

export type EvictStats = { dropped: number; pending: number; peakHeapMB: number };

/**
 * `fileExists` is injectable for the unit test; production uses existsSync.
 * `onReport` receives the end-of-run numbers (dropped modules, main-process
 * heap peak sampled at each sweep) so CI logs show the effect.
 */
export function evictEdgeGenModules(
  opts: { fileExists?: (path: string) => boolean; onReport?: (s: EvictStats) => void } = {},
): Plugin {
  const fileExists = opts.fileExists ?? existsSync;
  // Per environment graph: ids of gen modules still holding a transform result.
  const pending = new Map<Graph, Set<string>>();
  let dropped = 0;
  let peakHeapMB = 0;

  const sweep = (graph: Graph) => {
    const ids = pending.get(graph);
    if (!ids) return;
    for (const id of ids) {
      const mod = graph.getModuleById(id);
      if (!mod) {
        ids.delete(id);
        continue;
      }
      const file = mod.file ?? id.split("?")[0];
      if (fileExists(file)) continue;
      dropFromGraph(graph, mod);
      ids.delete(id);
      dropped++;
    }
    const heap = Math.round(process.memoryUsage().heapUsed / 1e6);
    if (heap > peakHeapMB) peakHeapMB = heap;
  };

  return {
    name: "lh-evict-edge-gen-modules",
    enforce: "post",
    transform(_code, id) {
      if (!isEdgeGenId(id)) return null;
      const graph = (this as unknown as { environment?: { moduleGraph?: Graph } }).environment?.moduleGraph;
      if (!graph) return null;
      sweep(graph);
      let ids = pending.get(graph);
      if (!ids) pending.set(graph, (ids = new Set()));
      ids.add(id);
      return null;
    },
    buildEnd() {
      let left = 0;
      for (const ids of pending.values()) left += ids.size;
      opts.onReport?.({ dropped, pending: left, peakHeapMB });
    },
  };
}
