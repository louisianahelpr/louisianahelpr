/**
 * The entry's route preload lists skip what main.tsx's list already names (B48, 11-03). See the
 * modulePreload.resolveDependencies note in vite.config.ts for why this changes no link, only entry bytes.
 *
 * `bundle` is the built output (fileName -> chunk), `hostId` the chunk the import sits in, `filename` the chunk it
 * imports, `deps` that chunk's static closure as Vite computed it. Only when the host is the entry and the target is
 * not main.tsx's chunk are main's closure (main and every chunk it statically reaches) left out. Anything it cannot
 * read (no bundle, no main import in the entry) leaves the list whole.
 */
const MAIN_CHUNK_RE = /(^|\/)main-[\w-]+\.js$/;

export function trimEntryRouteDeps(bundle, hostId, filename, deps) {
  const host = bundle?.[hostId];
  if (!bundle || !host?.isEntry || MAIN_CHUNK_RE.test(filename)) return deps;
  const mainFile = (host.dynamicImports ?? []).find((f) => MAIN_CHUNK_RE.test(f));
  if (!mainFile) return deps;
  const mainClosure = new Set();
  const walk = (f) => {
    if (mainClosure.has(f)) return;
    mainClosure.add(f);
    for (const i of bundle[f]?.imports ?? []) walk(i);
  };
  walk(mainFile);
  return deps.filter((d) => !mainClosure.has(d));
}

/**
 * index.html's own preload list, plus main.tsx's static closure (Q2705, Builder 4, 2026-11-09).
 *
 * The entry reaches the app only through `import("./main")`, so main and the chunks it statically imports (React,
 * app-shared, tanstack, the rolldown runtime, ...) were requested only once the entry had arrived and run: one whole
 * round trip (562 ms on Slow 4G) after the HTML, with the line idle while the 5 KB entry came down. Listed here they
 * are <link rel="modulepreload"> tags in index.html and download in the entry's own round. This is main's closure
 * only (13 files, the boot graph critical-path.mjs weighs), never a dynamic import's: the 2026-09-03 regression
 * (77 links, FCP 0.70 -> 3.22 s) was every lazy page's code preloaded on every page.
 * Lab, local dists, cwv-lab Slow 4G + 4x, 375, median of 3: app drawn / 3339 -> 3247, /login 3350 -> 3117,
 * /home 3781 -> 3502, /jobs 4860 -> 4291 ms (~/.lh-shots/speed-shell/ab1-*.log).
 * `htmlDeps` is what Vite would list (the entry's static imports); anything it cannot read leaves that list whole.
 */
export function entryBootPreloads(bundle, entryFile, htmlDeps) {
  const entry = bundle?.[entryFile];
  if (!entry?.isEntry) return htmlDeps;
  const mainFile = (entry.dynamicImports ?? []).find((f) => MAIN_CHUNK_RE.test(f));
  if (!mainFile) return htmlDeps;
  const out = [...htmlDeps];
  const seen = new Set([entryFile, ...htmlDeps]);
  const walk = (f) => {
    if (seen.has(f) || !bundle[f]) return;
    seen.add(f);
    out.push(f);
    for (const i of bundle[f].imports ?? []) walk(i);
  };
  walk(mainFile);
  return out;
}
