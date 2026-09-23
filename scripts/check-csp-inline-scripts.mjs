#!/usr/bin/env node
/**
 * POST-BUILD CSP CHECK (Q13). Runs at the end of `npm run build` and
 * `npm run build:ios`, so Vercel and CI both refuse a bundle that would break
 * under, or weaken, the Content-Security-Policy.
 *
 * For every dist/**.html it asserts, against the vercel.json header policy AND
 * against the page's own <meta http-equiv> policy if it carries one (the
 * Capacitor bundle does; the web build strips it):
 *   - script-src has no 'unsafe-inline' / 'unsafe-eval' / 'unsafe-hashes' /
 *     'strict-dynamic';
 *   - every inline EXECUTABLE <script> (not application/ld+json) has its exact
 *     sha256 listed — otherwise the browser blocks it and, e.g., the boot
 *     watchdog or the pre-paint theme silently stop running;
 *   - no inline event handler (onload="…") and no javascript: URL.
 *
 * On failure it prints the hash to add. Editing any inline script in
 * index.html / public/*.html therefore means updating the hash in vercel.json
 * AND index.html's meta CSP (and public/_headers); src/test/cspScriptSrc.test.ts
 * catches the same drift from source, without a build.
 *
 * Usage: node scripts/check-csp-inline-scripts.mjs [distDir]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { checkHtmlAgainstPolicy, inlineExecutableScripts, metaCsp, vercelCsp } from "./csp/inline-scripts.mjs";

const dist = process.argv[2] ?? "dist";
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const headerPolicy = vercelCsp(vercel);

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

const problems = [];
if (!headerPolicy) problems.push('vercel.json: no Content-Security-Policy header on source "/(.*)"');

const pages = walk(dist).filter((f) => f.endsWith(".html") && !f.endsWith("stats.html"));
if (!pages.some((f) => relative(dist, f) === "index.html")) problems.push(`${dist}/index.html not found — run the build first`);

let scripts = 0;
for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const label = relative(".", file);
  scripts += inlineExecutableScripts(html).length;
  if (headerPolicy) problems.push(...checkHtmlAgainstPolicy(html, headerPolicy, `${label} vs vercel.json`));
  const meta = metaCsp(html);
  if (meta) problems.push(...checkHtmlAgainstPolicy(html, meta, `${label} vs its <meta> CSP`));
}

if (problems.length) {
  console.error(`✗ CSP inline-script check: ${problems.length} problem(s)\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log(`✓ CSP inline-script check: ${pages.length} HTML page(s), ${scripts} inline script(s), all hashed; no unsafe-inline, handlers or javascript: URLs`);
