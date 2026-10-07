/**
 * Q652 (owner, 2026-10-07: "BUILD the landing prerender now"; the hero is LOCKED).
 *
 * WHY. `/` painted nothing until ~380 KB of JavaScript had loaded and run:
 * LCP = FCP = the hero H1 at 3.3 s on real phones (Vercel Speed Insights P75,
 * 2026-10-03) and 3.6-4.4 s in the 375 lab (scripts/perf/cwv-lab.mjs). The
 * page is static for a signed-out visitor, so it can be HTML.
 *
 * WHAT (run by `npm run build`, after vite build and build-og-shell):
 *   1. vite SSR-builds src/prerender/landingStatic.tsx (the REAL Index page,
 *      rendered as a signed-out web visitor sees it) into node_modules/.cache;
 *   2. renders it to HTML and checks it: the locked H1 is there, and every
 *      /assets/ URL it references exists in dist/ (same content hash as the
 *      client build, or the static paint would show broken images);
 *   3. writes dist/app.html = the plain SPA shell (every route but `/`, see
 *      vercel.json), and dist/index.html = the shell with the markup in
 *      `#landing-prerender`, a sibling before `#root`.
 * The Capacitor build (`build:ios`) does not run this: the app never shows
 * the marketing page (Index's NativeRedirect).
 *
 * How the static copy leaves: src/lib/landingPrerender.ts.
 *
 *   node scripts/prerender-landing.mjs [--dist dist]
 *
 * Guard: src/test/landingPrerender.test.ts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PRERENDER_ID = "landing-prerender";
/** The locked hero headline (CLAUDE.md), as the markup spells it. */
export const HERO_TEXT = /Louisiana[’']s Local Job(?:<!-- -->)?\s*<em[^>]*>Partner\.<\/em>/;
const ROOT_OPEN = /<div id="root"[^>]*>/;

/** Every root-relative /assets/ URL in src/srcSet/href attributes. */
export function assetUrls(markup) {
  const out = new Set();
  for (const m of markup.matchAll(/\s(?:src|href|srcSet|srcset)="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith("/assets/")) out.add(url);
    }
  }
  return [...out].sort();
}

/**
 * The landing shell: the static markup in its own container right before
 * #root, and the app stylesheet RENDER-BLOCKING. The SPA shell loads it async
 * (vite.config.ts html-async-entry-css: nothing on its first paint needs it);
 * the landing's first paint IS styled markup, so painting before the sheet
 * would flash an unstyled hero. The async swap script stays and finds nothing.
 */
export function injectPrerender(shellHtml, markup) {
  const m = ROOT_OPEN.exec(shellHtml);
  if (!m) throw new Error("prerender-landing: no <div id=\"root\"> in the shell");
  if (shellHtml.includes(`id="${PRERENDER_ID}"`)) throw new Error("prerender-landing: the shell already carries a prerender (run on a fresh build)");
  const withMarkup = `${shellHtml.slice(0, m.index)}<div id="${PRERENDER_ID}">${markup}</div>\n    ${shellHtml.slice(m.index)}`;
  return withMarkup.replace(/<link rel="stylesheet" href="(\/assets\/[^"]+\.css)" media="print" data-async-css>/g, '<link rel="stylesheet" href="$1">');
}

export function checkMarkup(markup, distDir) {
  const problems = [];
  if (!HERO_TEXT.test(markup)) problems.push("the locked hero H1 (\"Louisiana's Local Job Partner.\") is not in the rendered markup");
  if (markup.length < 5_000) problems.push(`the rendered markup is only ${markup.length} bytes`);
  const urls = assetUrls(markup);
  for (const u of urls) if (!existsSync(path.join(distDir, u))) problems.push(`${u} is referenced but not in ${distDir} (SSR and client asset hashes disagree)`);
  return { problems, urls };
}

async function renderMarkup() {
  const { build } = await import("vite");
  const react = (await import("@vitejs/plugin-react-swc")).default;
  const outDir = path.join(ROOT, "node_modules", ".cache", "prerender-landing");
  mkdirSync(outDir, { recursive: true });
  const env = (k, d) => process.env[k] || d;
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    plugins: [react()],
    resolve: { alias: { "@": path.join(ROOT, "src") } },
    define: {
      __APP_COMMIT__: JSON.stringify("prerender"),
      __APP_COMMIT_FULL__: JSON.stringify("prerender"),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env("VITE_SUPABASE_URL", "https://fncmgoasalhdgfwzhsqa.supabase.co")),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP")),
    },
    build: {
      ssr: path.join(ROOT, "src", "prerender", "landingStatic.tsx"),
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { output: { format: "esm", entryFileNames: "landing.mjs" } },
    },
    ssr: { noExternal: true },
  });
  const mod = await import(/* @vite-ignore */ `${pathToFileURL(path.join(outDir, "landing.mjs")).href}?t=${Date.now()}`);
  return mod.renderLanding();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--dist");
  const dist = path.resolve(i > -1 ? process.argv[i + 1] : path.join(ROOT, "dist"));
  const indexPath = path.join(dist, "index.html");
  const shell = readFileSync(indexPath, "utf8");
  const markup = await renderMarkup();
  const { problems, urls } = checkMarkup(markup, dist);
  if (problems.length) {
    for (const p of problems) console.error(`✗ prerender-landing: ${p}`);
    process.exit(1);
  }
  writeFileSync(path.join(dist, "app.html"), shell);
  writeFileSync(indexPath, injectPrerender(shell, markup));
  console.log(`✓ prerender-landing: ${markup.length.toLocaleString()} bytes of landing markup in dist/index.html (${urls.length} asset URL(s) checked); dist/app.html is the plain shell`);
}
