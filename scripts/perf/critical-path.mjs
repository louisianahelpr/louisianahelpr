#!/usr/bin/env node
/**
 * critical-path — what a cold load of each entry route must download, and in
 * how many dependent network rounds, read from the BUILT bundle (Q178).
 *
 * The browser discovers a module's static imports only after it has fetched
 * that module, so the number of dependent rounds is the depth of the static
 * import graph — unless a chunk is announced earlier by a
 * `<link rel="modulepreload">` in index.html (round 1) or by a preload list
 * that a dynamic import carries (`__vite__mapDeps`, fetched in parallel with
 * the route chunk itself).
 *
 *   node scripts/perf/critical-path.mjs            # table
 *   node scripts/perf/critical-path.mjs --json     # machine-readable
 *   node scripts/perf/critical-path.mjs --check    # CI budget (critical-path-budget.json)
 *   node scripts/perf/critical-path.mjs --boot-list  # files before the shell runs
 *
 * For each route it reports:
 *   rounds    dependent request rounds until the route's own chunk AND its
 *             static closure are all in hand (index.html = round 0)
 *   routeRound  the round in which the route's own page chunk is requested
 *   jsKB      gzip KB of every JS chunk on that path
 *   chunks    number of JS files on that path
 *
 * Fails loudly (throws; exit 2 from the CLI) if it cannot find the entry or a route chunk: a check
 * that silently reads nothing is the false green this repo keeps finding.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const DIST = process.env.CRITICAL_PATH_DIST || "dist";

/** Entry routes and the page chunk (file-name prefix) each one renders. */
export const ROUTES = [
  { path: "/", chunk: "Index" },
  { path: "/browse", chunk: "DashboardGuest" },
  { path: "/login", chunk: "Login" },
  { path: "/signup", chunk: "Signup" },
  // Signed-in representative (PD-020): useProfile + the job-list page's shared graph.
  { path: "/posts", chunk: "PostsPage" },
];

function die(msg) {
  throw new Error(`critical-path: ${msg}`);
}

export function analyse(dist = DIST) {
  const assets = join(dist, "assets");
  if (!existsSync(join(dist, "index.html"))) die(`${dist}/index.html not found — run \`npx vite build\` first`);
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
  const src = new Map(files.map((f) => [f, readFileSync(join(assets, f), "utf8")]));
  const gz = new Map(files.map((f) => [f, gzipSync(src.get(f)).length]));

  const entryMatch = html.match(/<script[^>]*type="module"[^>]*src="\/assets\/([^"]+\.js)"/);
  if (!entryMatch) die("no module entry <script> in index.html");
  const entry = entryMatch[1];
  const htmlPreloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);

  const staticDeps = (f) => {
    const code = src.get(f);
    if (code == null) return [];
    const out = new Set();
    // import{a}from"./x.js" / import"./x.js" / export{a}from"./x.js" — never import("./x.js").
    for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)) out.add(m[1]);
    return [...out];
  };
  // The preload list Vite attaches to each dynamic import in `host`:
  //   const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/a.js",...])))=>i.map(i=>d[i]);
  //   ...import(`./X.js`),__vite__mapDeps([3,1,2])...   (any quote style)
  // Returns target file -> [its preloaded deps].
  const dynamicImports = (host) => {
    const code = src.get(host) || "";
    const table = code.match(/m\.f\s*=\s*\[([^\]]*)\]/);
    const f = table ? [...table[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1].replace(/^.*\//, "")) : [];
    const out = new Map();
    for (const m of code.matchAll(/import\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)([^;]{0,40}?__vite__mapDeps\(\[([\d,\s]*)\]\))?/g)) {
      const deps = m[3] ? m[3].split(",").filter(Boolean).map((i) => f[Number(i)]).filter((d) => d && d.endsWith(".js")) : [];
      out.set(m[1], [...new Set([...(out.get(m[1]) || []), ...deps])]);
    }
    return out;
  };

  /** BFS the static graph from `roots` fetched at `round`; returns file -> round. */
  const walk = (roots, round, known) => {
    const at = new Map(known);
    let frontier = roots.filter((f) => !at.has(f));
    for (const f of frontier) at.set(f, round);
    while (frontier.length) {
      round++;
      const next = [];
      for (const f of frontier)
        for (const d of staticDeps(f))
          if (!at.has(d)) {
            at.set(d, round);
            next.push(d);
          }
      frontier = next;
    }
    return at;
  };

  // Round 1: the entry plus every modulepreload in index.html.
  let boot = walk([entry, ...htmlPreloads], 1, new Map());
  const entryRound = Math.max(...boot.values());
  // The app itself: src/entry.ts imports src/main.tsx dynamically. When the
  // entry has no such import (the pre-Q178 shape, main.tsx IS the entry),
  // the whole app is already in `boot`.
  const entryDyn = dynamicImports(entry);
  const mainChunk = files.find((f) => /^main-[\w-]{6,}\.js$/.test(f) && entryDyn.has(f));
  if (mainChunk) boot = walk([mainChunk, ...entryDyn.get(mainChunk)], entryRound + 1, boot);
  const bootRounds = Math.max(...boot.values());

  const routes = ROUTES.map((r) => {
    const re = new RegExp(`^${r.chunk}-[\\w-]{6,}\\.js$`);
    const chunk = files.find((f) => re.test(f));
    if (!chunk) die(`no built chunk for ${r.path} (expected ${r.chunk}-<hash>.js)`);
    let at;
    let routeRound;
    if (boot.has(chunk)) {
      at = boot;
      routeRound = boot.get(chunk);
    } else if (entryDyn.has(chunk)) {
      // Started by the entry itself (src/boot/routePreload.ts), beside main.
      routeRound = entryRound + 1;
      at = walk([chunk, ...entryDyn.get(chunk)], routeRound, boot);
    } else {
      // Otherwise the route's lazy import fires once the app graph has run.
      routeRound = bootRounds + 1;
      const host = [...boot.keys()].find((h) => dynamicImports(h).has(chunk));
      const deps = host ? dynamicImports(host).get(chunk) : [];
      at = walk([chunk, ...deps], routeRound, boot);
    }
    const onPath = [...at.keys()];
    return {
      path: r.path,
      chunk,
      routeRound,
      rounds: Math.max(...at.values()),
      chunks: onPath.length,
      jsKB: Math.round(onPath.reduce((a, f) => a + (gz.get(f) || 0), 0) / 1024),
    };
  });
  return {
    entry,
    entryKB: Math.round((gz.get(entry) || 0) / 102.4) / 10,
    entryStaticChunks: [...walk([entry], 1, new Map()).keys()].length,
    htmlPreloads,
    bootRounds,
    bootChunks: boot.size,
    bootKB: Math.round([...boot.keys()].reduce((a, f) => a + (gz.get(f) || 0), 0) / 1024),
    bootFiles: [...boot.entries()].sort((a, b) => a[1] - b[1]).map(([f, r]) => `${r} ${f} ${(gz.get(f) / 1024).toFixed(1)}KB`),
    routes,
  };
}

/**
 * Compare a result against the budget file. Returns a list of failures.
 *
 * TWO-WAY, as every budget in this repo must be (CLAUDE.md, "every number we
 * track stays current"): rounds are structural and must match EXACTLY — one
 * more is the waterfall coming back, one fewer means the budget is stale and
 * must be lowered in the same commit. Bytes move with every shared-code edit,
 * so they get a band instead of an exact number: more than +5% over the
 * budget fails as a regression, more than 10% under fails as a stale budget.
 */
export function checkAgainstBudget(res, budget) {
  const fails = [];
  const exact = (label, got, want) => {
    if (got !== want)
      fails.push(`${label}: measured ${got}, budget ${want} — ${got > want ? "REGRESSION (the waterfall is back)" : "better than budget: lower the budget in scripts/perf/critical-path-budget.json in this commit"}`);
  };
  const band = (label, got, want) => {
    if (got > want * 1.05) fails.push(`${label}: ${got} KB gzip, budget ${want} KB (+5% allowed) — REGRESSION`);
    else if (got < want * 0.9) fails.push(`${label}: ${got} KB gzip, budget ${want} KB — more than 10% under: lower the budget in this commit`);
  };
  exact("entry static chunks (index.html -> entry's static graph)", res.entryStaticChunks, budget.entry.staticChunks);
  band("entry chunk", res.entryKB, budget.entry.kb);
  for (const [path, want] of Object.entries(budget.routes)) {
    const got = res.routes.find((r) => r.path === path);
    if (!got) {
      fails.push(`${path}: in the budget but not measured — ROUTES and the budget disagree`);
      continue;
    }
    exact(`${path} round its page chunk is requested in`, got.routeRound, want.routeRound);
    exact(`${path} rounds until the page chunk and its closure are in hand`, got.rounds, want.rounds);
    band(`${path} JS on the critical path`, got.jsKB, want.jsKB);
  }
  for (const r of res.routes) if (!budget.routes[r.path]) fails.push(`${r.path}: measured but has no budget`);
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let res;
  try {
    res = analyse();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
  if (process.argv.includes("--check")) {
    const budgetPath = new URL("./critical-path-budget.json", import.meta.url);
    const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
    const fails = checkAgainstBudget(res, budget);
    for (const r of res.routes)
      console.log(`${r.path.padEnd(8)} page chunk in round ${r.routeRound}; ready after ${r.rounds} rounds; ${r.jsKB} KB gz`);
    if (fails.length) {
      console.error(`\n✗ critical-path budget (Q178): ${fails.length} failure(s)`);
      for (const f of fails) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log("\n✓ critical path within budget (scripts/perf/critical-path-budget.json)");
  } else if (process.argv.includes("--boot-list")) {
    // Every JS file a cold load fetches before the app shell can run: the
    // entry's static graph plus main.tsx's (bundle-size.yml weighs these).
    for (const l of res.bootFiles) console.log(`assets/${l.split(" ")[1]}`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`entry ${res.entry} (${res.entryKB} KB gz, ${res.entryStaticChunks} static chunks); ${res.htmlPreloads.length} html modulepreloads; boot graph ${res.bootChunks} chunks, ${res.bootKB} KB gz, ${res.bootRounds} rounds`);
    if (process.argv.includes("--files")) for (const l of res.bootFiles) console.log("  " + l);
    for (const r of res.routes)
      console.log(`${r.path.padEnd(8)} ${r.chunk.padEnd(32)} route chunk in round ${r.routeRound}; ready after ${r.rounds} rounds; ${r.chunks} chunks, ${r.jsKB} KB gz`);
  }
}
