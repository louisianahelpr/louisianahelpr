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
