/**
 * A local stand-in for a Vercel production deploy, for the Q199 stale-chunk
 * spec (e2e/happy-path/deploy-stale-chunk.spec.ts).
 *
 * Build A is this checkout's `dist/`. Build B is a copy of it in which EVERY
 * /assets/*.js file has a new name, with every reference to it rewritten: a
 * self-consistent build whose chunk names share nothing with A, which is what a
 * real deploy looks like to a tab holding A's names (no second `npm run build`
 * needed, and the two cannot differ in anything but the names).
 *
 * The server mirrors vercel.json where it matters here: a path with no file
 * falls through the `/((?!api/|_vercel/).*)` rewrite to index.html, so a
 * deleted chunk answers 200 text/html (a MIME error in the browser), not 404.
 *
 * `deploy()` swaps A for B. `htmlLag` models the propagation window Q199 was
 * seen in: for that many document requests after the swap, the HTML still
 * comes from A while A's chunks are already gone.
 */
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

/** Copy `dist` to a temp dir with every /assets/*.js renamed (…-<hash>.js → …-<hash>b.js). */
export async function makeBuildB(distDir: string): Promise<{ dir: string; renamed: Map<string, string> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-q199-buildB-"));
  await fs.cp(distDir, dir, { recursive: true });
  const assets = path.join(dir, "assets");
  const renamed = new Map<string, string>();
  for (const f of await fs.readdir(assets)) {
    if (f.endsWith(".js")) renamed.set(f, f.replace(/\.js$/, "b.js"));
  }
  const rewrite = (text: string) => text.replace(/[\w.-]+\.js\b/g, (m) => renamed.get(m) ?? m);
  const walk = async (d: string): Promise<string[]> => {
    const out: string[] = [];
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else out.push(p);
    }
    return out;
  };
  for (const file of await walk(dir)) {
    if (!/\.(js|html|css|json|webmanifest)$/.test(file)) continue;
    const text = await fs.readFile(file, "utf8");
    const next = rewrite(text);
    if (next !== text) await fs.writeFile(file, next);
  }
  for (const [from, to] of renamed) {
    await fs.rename(path.join(assets, from), path.join(assets, to));
    await fs.rm(path.join(assets, `${from}.map`), { force: true });
  }
  return { dir, renamed };
}

export interface DeployServer {
  url: string;
  /** Switch production from A to B. `htmlLag` document requests still get A's HTML. */
  deploy(opts?: { htmlLag?: number }): void;
  /** Break B for good: its entry chunk answers the SPA fallback (a genuinely broken build). */
  breakEntry(): void;
  /** Pathnames of /assets/*.js requests that got no file (the SPA fallback). */
  missing: string[];
  close(): Promise<void>;
}

export async function startDeployServer(dirA: string, dirB: string): Promise<DeployServer> {
  let live = dirA;
  let htmlLag = 0;
  let entryBroken = false;
  const missing: string[] = [];
  const indexB = await fs.readFile(path.join(dirB, "index.html"), "utf8");
  const entryB = /<script[^>]+src="\/assets\/(index-[\w-]+\.js)"/.exec(indexB)?.[1] ?? "";

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    let p = decodeURIComponent(u.pathname);
    let root = live;
    const isDoc = !path.extname(p) || p.endsWith(".html");
    if (isDoc && live === dirB && htmlLag > 0) {
      htmlLag -= 1;
      root = dirA;
    }
    if (entryBroken && p === `/assets/${entryB}`) p = "/__gone__.js";
    let file = path.join(root, p);
    let stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) {
      file = path.join(file, "index.html");
      stat = await fs.stat(file).catch(() => null);
    }
    if (!stat) {
      if (/^\/assets\/.+\.js$/.test(p)) missing.push(p);
      // vercel.json's catch-all rewrite: no file → index.html, 200.
      file = path.join(root, "index.html");
    }
    const body = await fs.readFile(file);
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": p.startsWith("/assets/") && stat ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    deploy(opts) {
      live = dirB;
      htmlLag = opts?.htmlLag ?? 0;
    },
    breakEntry() {
      entryBroken = true;
    },
    missing,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
