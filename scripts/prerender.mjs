#!/usr/bin/env node
/**
 * Static pre-render for the Helpr landing page.
 *
 * DISABLED BY DEFAULT — wire into package.json's `build` script only after
 * verifying locally:
 *
 *   1. `npm install --save-dev puppeteer`
 *   2. `npm run build`              (produces dist/index.html as the SPA shell)
 *   3. `node scripts/prerender.mjs` (overwrites dist/index.html with the
 *                                    pre-rendered landing-page HTML)
 *   4. `npm run preview` + open localhost:4173 → view-source on `/` should
 *      show hero markup IN the HTML response (not just `<div id="root">`).
 *   5. Real-device smoke test (cellular network, low-end Android). FCP
 *      should drop from ~11s to ~TTFB+JS-hydration (~2-4s).
 *
 * If everything passes, swap `package.json` `scripts.build`:
 *   "build": "vite build && node scripts/prerender.mjs"
 *
 * See docs/PERF_AUDIT_TODO.md for the rationale + risk profile.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const indexHtmlPath = path.join(distDir, "index.html");

async function main() {
  let puppeteer;
  try {
    puppeteer = await import("puppeteer");
  } catch (err) {
    console.error(
      "✗ puppeteer not installed. Run `npm install --save-dev puppeteer` first.",
    );
    console.error("  (see docs/PERF_AUDIT_TODO.md for the full enable procedure)");
    process.exit(2);
  }

  const indexHtml = await readFile(indexHtmlPath, "utf8");

  // Boot a tiny HTTP server over `dist/` so puppeteer can navigate to it
  // with a real `http://` URL (file:// URLs trigger CSP / CORS edge cases
  // that won't reproduce in production).
  const http = await import("node:http");
  const { createReadStream } = await import("node:fs");
  const { stat } = await import("node:fs/promises");
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".json": "application/json",
  };
  const distRoot = path.resolve(distDir);
  const server = http.createServer(async (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      urlPath = "/";
    }
    // Strip null bytes (defense-in-depth) and default the empty path.
    urlPath = urlPath.replace(/\0/g, "");
    if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

    // Resolve the candidate path and verify it stays inside distDir. Even
    // though this server only runs at build time, sanitize input as a
    // matter of hygiene (CodeQL / CodeRabbit-flagged path-traversal).
    const candidate = path.resolve(distRoot, "." + urlPath);
    const isInside = candidate === distRoot || candidate.startsWith(distRoot + path.sep);
    const fallback = path.join(distRoot, "index.html");

    if (!isInside) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      createReadStream(fallback).pipe(res);
      return;
    }
    try {
      await stat(candidate);
      res.writeHead(200, { "content-type": mime[path.extname(candidate)] ?? "application/octet-stream" });
      createReadStream(candidate).pipe(res);
    } catch {
      // SPA fallback to index.html for client-routed paths.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      createReadStream(fallback).pipe(res);
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await puppeteer.default.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log(`→ Rendering http://127.0.0.1:${port}/ ...`);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0", timeout: 30000 });
  // Give React + any post-paint hooks a moment to settle.
  await new Promise((r) => setTimeout(r, 500));

  const renderedHtml = await page.content();

  // Replace the empty <div id="root"> in dist/index.html with the rendered
  // <div id="root">...</div>. Keep all <head>, scripts, meta tags as-is.
  const renderedRootMatch = renderedHtml.match(/<div id="root"[^>]*>([\s\S]*?)<\/div>\s*<script/);
  if (!renderedRootMatch) {
    console.error("✗ Could not find <div id=\"root\"> in rendered HTML — aborting without writing.");
    await browser.close();
    server.close();
    process.exit(1);
  }
  const innerMarkup = renderedRootMatch[1];

  // Preserve the original opening tag (incl. inline style + any future attrs)
  // and only replace inner markup. Avoids cross-route visual side effects.
  const updatedIndexHtml = indexHtml.replace(
    /(<div id="root"[^>]*>)[\s\S]*?(<\/div>)/,
    `$1${innerMarkup}$2`,
  );

  await writeFile(indexHtmlPath, updatedIndexHtml, "utf8");
  console.log(`✓ Wrote pre-rendered landing page to ${path.relative(repoRoot, indexHtmlPath)}`);
  console.log(`  (${innerMarkup.length.toLocaleString()} bytes of inlined markup)`);

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error("✗ prerender failed:", err);
  process.exit(1);
});
