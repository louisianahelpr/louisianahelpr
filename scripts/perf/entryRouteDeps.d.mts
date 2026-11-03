// Types for scripts/perf/entryRouteDeps.mjs (vite.config.ts modulePreload.resolveDependencies).
export type EntryRouteBundle = Record<string, { type: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[] }>;
/** The entry's route preload list without main.tsx's static closure; every other list unchanged. */
export declare function trimEntryRouteDeps(bundle: EntryRouteBundle | null, hostId: string, filename: string, deps: string[]): string[];
