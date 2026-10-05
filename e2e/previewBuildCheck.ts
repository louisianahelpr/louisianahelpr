/**
 * A local run must not drive a `vite preview` of some OTHER commit (Q845).
 *
 * playwright.config.ts starts `vite preview` with `reuseExistingServer: !CI`,
 * so locally a run reuses whatever already holds the port. On 2026-09-28 the
 * shared checkout's preview was a 2026-09-24 build (d00b1c348), and prod
 * storage kept receiving `max-age=3600` avatar uploads from the test accounts
 * after the Q655 fix (`31536000`) had deployed: journeys were exercising old
 * code against prod and reporting it as today's.
 *
 * Every build stamps `<meta name="build-commit" content="<sha>">` into
 * index.html (vite.config.ts). Before a local run starts, the served page's
 * commit is compared with this checkout's HEAD; a different one stops the run
 * with the command that frees the port. CI is exempt: it builds fresh.
 */
import { execSync } from "node:child_process";

/** The commit a served index.html says it was built from, or null. */
export function servedBuildCommit(html: string): string | null {
  return /<meta\s+name="build-commit"\s+content="([0-9a-f]{7,40})"/i.exec(html)?.[1] ?? null;
}

/**
 * Why the served build must not be reused, or null when it may be.
 * A page with no stamp is refused too: it is not a build of this repo's config.
 */
export function previewMismatch(html: string, head: string, base: string): string | null {
  const served = servedBuildCommit(html);
  if (served && head.startsWith(served.slice(0, 7)) && (served.length < 40 || served === head)) return null;
  const port = (() => {
    try {
      return new URL(base).port || "80";
    } catch {
      // An unparseable base only costs the hint its port number; the refusal still stands.
      return "?";
    }
  })();
  return (
    `The preview at ${base} serves ${served ? `commit ${served.slice(0, 9)}` : "a page with no build-commit stamp"}, ` +
    `but this checkout is at ${head.slice(0, 9)}. A local run would test the old build against prod (Q845). ` +
    `Free the port and let Playwright build this checkout: kill $(lsof -ti:${port})`
  );
}

/** Throw when a reused local preview is not this checkout's build. CI and fresh starts pass. */
export async function assertPreviewIsThisCheckout(base: string): Promise<void> {
  if (process.env.CI || !process.env.PLAYWRIGHT_WEB_SERVER) return;
  let html: string;
  try {
    const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return; // nothing usable is serving: Playwright starts a fresh build
    html = await res.text();
  } catch {
    return; // no server on the port yet: Playwright builds this checkout
  }
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const why = previewMismatch(html, head, base);
  if (why) throw new Error(why);
}
