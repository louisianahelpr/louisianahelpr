/**
 * Declutter "Add a Helpr": a job whose link to its paid order failed at posting time (Q1942).
 *
 * Posting links the new job to the order (declutter_link_setup_job) and then redirects to Stripe at once, so a toast
 * telling the buyer the link failed was on screen for about a second. Now a failed CALL is tried once more on the
 * spot, and a link still missing is remembered here (durable: the `helpr_` prefix is mirrored by safeStorage, so it
 * survives the trip through Stripe on iPhone). PaymentSuccess takes it for its own job, tries the link again, and
 * tells the buyer only if it still fails, on a screen that stays put.
 *
 * Small and free of Supabase on purpose: PaymentSuccess imports it statically, and the link itself is passed in.
 */
import { safeStorage } from "@/lib/safeStorage";

export const SETUP_LINK_PENDING_KEY = "helpr_declutter_setup_link_pending";

export interface PendingSetupLink {
  orderId: string;
  jobId: string;
}

export type SetupLinkResult = { ok: true } | { ok: false; err: unknown; why?: string };

/**
 * Run the link, and once more when the CALL failed (a throw with no server words: network, timeout, a chunk that
 * did not load). A server answer of no (false, or a refusal carrying `userMessage`) is final: asking again would get
 * the same answer.
 */
export async function linkSetupJobOnceMore(link: () => Promise<boolean>): Promise<SetupLinkResult> {
  let last: SetupLinkResult = { ok: false, err: new Error("declutter setup job not linked") };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await link()) return { ok: true };
      return { ok: false, err: new Error("declutter setup job not linked") };
    } catch (err) {
      // Not swallowed: the error is returned to the caller, which reports it and tells the buyer.
      const why = (err as { userMessage?: string } | null)?.userMessage;
      last = { ok: false, err, why };
      if (why) return last;
    }
  }
  return last;
}

export function rememberPendingSetupLink(p: PendingSetupLink): void {
  safeStorage.setItem(SETUP_LINK_PENDING_KEY, JSON.stringify(p));
}

export function clearPendingSetupLink(): void {
  safeStorage.removeItem(SETUP_LINK_PENDING_KEY);
}

/**
 * The pending link for THIS job, removed from storage whichever job it named: one for another job is from an
 * earlier post that never reached this screen, and the order card is where that buyer looks.
 */
export function takePendingSetupLink(jobId: string | null): PendingSetupLink | null {
  const raw = safeStorage.getItem(SETUP_LINK_PENDING_KEY);
  if (raw === null) return null;
  clearPendingSetupLink();
  let p: Partial<PendingSetupLink> | null;
  try {
    p = JSON.parse(raw) as Partial<PendingSetupLink>;
  } catch {
    // A value this module did not write (hand-edited or truncated): nothing to retry.
    return null;
  }
  if (!p || typeof p.orderId !== "string" || typeof p.jobId !== "string" || !jobId || p.jobId !== jobId) return null;
  return { orderId: p.orderId, jobId: p.jobId };
}
