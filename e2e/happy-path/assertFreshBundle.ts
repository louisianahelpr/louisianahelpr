/**
 * Fail loudly when the happy-path suite is about to test a STALE bundle.
 *
 * WHY THIS EXISTS — it cost two long detours in one afternoon, and both times
 * the wrong conclusion was the believable one.
 *
 * The `webServer` block only runs when `PLAYWRIGHT_WEB_SERVER=1`. Run the bare
 * `npx playwright test e2e/happy-path` and Playwright starts nothing, performs
 * no build, and quietly tests whatever is already listening on 4173 — which,
 * on a machine where anyone has ever run `vite preview`, is a bundle built from
 * some older revision. `reuseExistingServer: !CI` does the same thing when the
 * server IS started: it adopts a live server without checking what it serves.
 *
 * The failure mode is not a crash. It is a green suite, or a red one, that
 * describes code you are not running:
 *
 *   · A fix to DialogContent was measured as "not working" three times in a
 *     row. `dist` plainly contained it. The DOM did not. Four cycles went into
 *     the component before a temporary `data-stepped` attribute came back
 *     `null` and proved the element on screen was built from other source.
 *   · Later, two specs "broke" after the segmented controls were unified. The
 *     DOM had no `[role=radio]` anywhere — because the server predated the
 *     component. Both specs were correct and passed the moment the server was
 *     rebuilt.
 *
 * Neither looked like an environment problem. Both looked like a real defect,
 * which is what makes this worth a hard failure rather than a warning.
 *
 * THE CHECK: the built `dist/index.html` names a hashed entry chunk. Ask the
 * server for `/` and compare. Hashes are content-addressed, so a mismatch means
 * the server is serving a different build than the one on disk — exactly the
 * condition, and nothing else. If `dist` is missing entirely the check stays
 * silent: that is CI's own `npm run build &&` path, where the build has not run
 * yet when this is first imported.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { staleBundleMessage } from "../../src/test/staleBundle";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let checked = false;

export async function assertFreshBundle(baseURL: string): Promise<void> {
  if (checked) return;
  checked = true;

  const distIndex = resolve(ROOT, "dist/index.html");
  const diskHtml = existsSync(distIndex) ? readFileSync(distIndex, "utf8") : undefined;

  let servedHtml: string | undefined;
  try {
    servedHtml = await (await fetch(baseURL)).text();
  } catch {
    servedHtml = undefined;
  }

  const message = staleBundleMessage(baseURL, servedHtml, diskHtml);
  if (message) throw new Error(message);
}
