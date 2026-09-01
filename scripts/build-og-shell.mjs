#!/usr/bin/env node
/**
 * Snapshot the built SPA shell for the link-preview function.
 *
 * WHY THIS EXISTS
 * ---------------
 * `api/share.ts` serves `/jobs/:id`, `/signup` and `/user/:id` so those routes
 * can carry accurate Open Graph tags for crawlers (which never execute the
 * SPA's JavaScript, so `usePageMeta` is invisible to them).
 *
 * The function must return THE SAME DOCUMENT the static host would have
 * returned — identical to the byte, apart from the handful of meta values it
 * rewrites. Anything else is cloaking. So it needs the real, post-Vite
 * `dist/index.html`, hashed asset URLs and all.
 *
 * Rather than read that file at runtime (which would mean `includeFiles`
 * config, `process.cwd()` guesswork, or a self-fetch that preview-deployment
 * protection can block), we inline it into a JS module at build time and let
 * the function `import` it. Vercel documents exactly this pattern — "Access
 * build-time data in a Vercel Function" — and it is the only option with no
 * runtime failure mode: the shell is part of the function bundle.
 *
 * The output lives OUTSIDE `api/` on purpose. Every recognised source file in
 * `api/` is turned into an HTTP route by Vercel's zero-config builder, and a
 * module that exports a string but no handler is not a valid function. Import
 * tracing pulls it into the bundle from here just the same.
 *
 * Wired into `npm run build` (see package.json). Run standalone after any
 * `vite build` if you want to regenerate it by hand.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/**
 * `--index <path>` overrides the source HTML. Used by the verification
 * harness to snapshot the CURRENTLY DEPLOYED shell (fetched from production)
 * rather than a local build, so the function can be exercised against the
 * exact bytes production serves.
 */
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const indexHtmlPath = path.resolve(arg("--index", path.join(repoRoot, "dist", "index.html")));
const outPath = path.resolve(
  arg("--out", path.join(repoRoot, "scripts", "generated", "og-shell.js")),
);

/**
 * Anchors `api/share.ts` rewrites. If a future edit to index.html renames,
 * reorders or reformats any of these, the replacement would silently no-op and
 * we would ship the generic marketing card again without a single error — the
 * exact failure this whole lane exists to fix. So assert them at build time and
 * fail the build loudly instead.
 *
 * Note what is deliberately NOT in this list: og:image, og:image:type,
 * og:image:width/height/alt and twitter:image. index.html's comments record why
 * their ORDER is load-bearing (every major consumer takes the first og:image,
 * and the structured sub-properties bind to the preceding parent by position,
 * not by name). The function never touches them, so the ordering cannot break.
 */
const REQUIRED_ANCHORS = [
  { label: "<title>", re: /<title>[\s\S]*?<\/title>/ },
  { label: 'link rel="canonical"', re: /<link rel="canonical" href="[^"]*">/ },
  { label: 'meta name="description"', re: /<meta name="description" content="[^"]*">/ },
  { label: "og:url", re: /<meta property="og:url" content="[^"]*" \/>/ },
  { label: "og:title", re: /<meta property="og:title" content="[^"]*" \/>/ },
  { label: "og:description", re: /<meta property="og:description" content="[^"]*" \/>/ },
  { label: "twitter:url", re: /<meta name="twitter:url" content="[^"]*" \/>/ },
  { label: "twitter:title", re: /<meta name="twitter:title" content="[^"]*" \/>/ },
  { label: "twitter:description", re: /<meta name="twitter:description" content="[^"]*" \/>/ },
];

/** The image block must survive untouched — assert it is still intact. */
const IMAGE_ORDER_GUARD =
  /<meta property="og:image" content="[^"]*og-image\.png[^"]*" \/>\s*<meta property="og:image:type"[^>]*\/>\s*<meta property="og:image:width" content="1200" \/>\s*<meta property="og:image:height" content="630" \/>\s*<meta property="og:image:alt"[^>]*\/>\s*<meta property="og:image" content="[^"]*og-image-square\.png"/;

async function main() {
  let html;
  try {
    html = await readFile(indexHtmlPath, "utf8");
  } catch {
    console.error(
      `✗ ${path.relative(repoRoot, indexHtmlPath)} not found — run \`vite build\` first.`,
    );
    process.exit(1);
  }

  const missing = REQUIRED_ANCHORS.filter((a) => !a.re.test(html)).map((a) => a.label);
  if (missing.length) {
    console.error(
      "✗ index.html no longer matches the tags api/share.ts rewrites.\n" +
        `  Missing / reformatted: ${missing.join(", ")}\n` +
        "  Update REQUIRED_ANCHORS here and the matching patterns in api/share.ts,\n" +
        "  or per-route link previews will silently fall back to the generic card.",
    );
    process.exit(1);
  }

  if (!IMAGE_ORDER_GUARD.test(html)) {
    console.error(
      "✗ The og:image block in index.html is no longer in the expected order.\n" +
        "  Banner (1200x630) must come FIRST with its width/height/alt immediately\n" +
        "  after it, then the 1024x1024 square. See the comment above those tags.",
    );
    process.exit(1);
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  const body =
    "/* eslint-disable */\n" +
    "// GENERATED FILE — do not edit, do not commit.\n" +
    "// Written by scripts/build-og-shell.mjs from dist/index.html during `npm run build`.\n" +
    `// Source bytes: ${Buffer.byteLength(html)}\n` +
    `export const SHELL_HTML = ${JSON.stringify(html)};\n`;
  await writeFile(outPath, body, "utf8");

  console.log(
    `✓ og shell snapshot → ${path.relative(repoRoot, outPath)} (${Buffer.byteLength(html).toLocaleString()} bytes of HTML)`,
  );
}

main().catch((err) => {
  console.error("✗ build-og-shell failed:", err);
  process.exit(1);
});
