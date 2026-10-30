/**
 * One listing photo on a weak connection (owner 2026-10-30: "it took so long to load that some pictures timed out and
 * didn't upload"). A lost answer means we can't tell whether the step landed, so neither step may repeat its work:
 *   - the file goes to one fixed name, so a second try finds it there instead of storing a copy;
 *   - before attaching again, it asks whether the first try attached it (declutter_add_item_photo would add a second
 *     row: a duplicate photo on the listing).
 * Dependency-free apart from the retry, so its tests hold no fake database.
 */
import { isNetworkFailure } from "@/lib/networkFailure";
import { withRetries, worthTryingAgain, type RetryOptions } from "@/lib/declutter/steadyRetry";

/** The waits before a photo's further tries. */
export const UPLOAD_RETRY_DELAYS_MS = [2_000, 6_000, 15_000] as const;

/** A refusal from the server: another try gets the same answer. */
export class PhotoUploadRefused extends Error {}

export interface SteadySteps {
  /** Store the file at its one name. `again` says an earlier try may already have put it there. */
  store: (again: boolean) => Promise<void>;
  attach: () => Promise<string>;
  /** The photo's id if an earlier try attached it after all. */
  findAttached: () => Promise<string | null>;
}

export type UploadHooks = Pick<RetryOptions, "onRetry" | "pause" | "whenBack" | "awayCount">;

const worthIt = (error: unknown) => !(error instanceof PhotoUploadRefused) && worthTryingAgain(error);

export async function uploadSteadily(steps: SteadySteps, hooks: UploadHooks = {}): Promise<string> {
  const retry = { delays: UPLOAD_RETRY_DELAYS_MS, worthIt, ...hooks };
  let stored = 0;
  await withRetries(() => steps.store(stored++ > 0), retry);
  let attached = 0;
  return withRetries(async () => {
    if (attached++ > 0) {
      const found = await steps.findAttached();
      if (found) return found;
    }
    return steps.attach();
  }, { ...retry, worthIt: (error) => worthIt(error) && isNetworkFailure(error) });
}
