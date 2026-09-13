/**
 * Shared step guard for the interruption journeys (owner, 2026-09-12: audits
 * must act like real users — and real users hit back, refresh, lose signal and
 * tap twice). After EVERY step a spec calls `assertHealthy`: an error screen,
 * the retired "Update ready" screen, a blank page or a loader that never
 * settles fails the step, with a screenshot attached under the step's name.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";
import { detectStuckOrBlank, findErrorScreen } from "../../errorScreens";

export async function assertHealthy(
  page: Page,
  testInfo: TestInfo,
  step: string,
  opts: { allow?: string[]; settleMs?: number } = {},
): Promise<void> {
  // A loader is only "stuck" if it is still there after a real user's patience.
  const deadline = Date.now() + (opts.settleMs ?? 12_000);
  let stuck: string | null = null;
  for (;;) {
    stuck = await page.evaluate(detectStuckOrBlank).catch(() => "page not evaluable");
    if (!stuck || Date.now() > deadline) break;
    await page.waitForTimeout(400);
  }
  const text = await page.locator("body").innerText().catch(() => "");
  const err = findErrorScreen(text, opts.allow ?? []);
  // Written to disk (not just attached) so a human can open and LOOK at it.
  const path = testInfo.outputPath(`${step}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(`${step}.png`, { path, contentType: "image/png" });
  expect(err, `[${step}] error screen at ${page.url()}: ${err?.name} — "${err?.excerpt}"`).toBeNull();
  expect(stuck, `[${step}] stuck/blank at ${page.url()}`).toBeNull();
}

/** Count requests matching a predicate from now on. */
export function countRequests(page: Page, pred: (url: URL, method: string) => boolean): () => number {
  let n = 0;
  page.on("request", (r) => {
    try {
      if (pred(new URL(r.url()), r.method())) n++;
    } catch {
      /* non-URL request (data:) is not ours to count */
    }
  });
  return () => n;
}
