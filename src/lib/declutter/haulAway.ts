/**
 * Declutter haul-away (docs/specs/declutter-haul-away.md; migration
 * 20261016053639): when a listing hasn't sold, the seller books a Helpr to take
 * it to a donation center or the dump. It is an ordinary Helpr job: Post a Job
 * opens pre-filled from the listing(s) (`/post-job?haulAway=<id>,<id>`), the
 * seller checks it and pays through the normal job checkout. Nothing here
 * moves money.
 *
 * Every RPC refuses server-side without the 'declutter' AND
 * 'declutter_haul_away' switches; this file is never the protection.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { MAX_JOB_BUDGET_DOLLARS, MIN_JOB_BUDGET_DOLLARS } from "@/lib/moneyLimits";
import type { DeliverySize } from "@/lib/declutter/api";
import { isNetworkFailure } from "@/lib/networkFailure";
import { removeJobPhotos } from "@/lib/storageCleanup";
import { report } from "@/lib/errorLogger";

/** Job photos Post a Job accepts (useJobMediaUpload's cap). */
const JOB_PHOTO_MAX = 5;

/** public.jobs CHECKs: title <= 32, description <= 1000 code points. */
const TITLE_MAX = 32;
const DESCRIPTION_MAX = 1000;

import { isPostable, type HaulAwayRow } from "./haulAwayParam";
// The pure helpers live in ./haulAwayParam (tiny, shared by the screens);
// re-exported so one import serves callers that load this module anyway.
export {
  daysUntil,
  haulAwayPostJobPath,
  haulJobToDelete,
  isPostable,
  oneTripGroup,
  parseHaulAwayParam,
  type HaulAwayRow,
  type HaulAwayState,
} from "./haulAwayParam";

/**
 * Suggested pay per item, by the listing's delivery size (default chosen by
 * the lane, owner to confirm: docs/specs/declutter-haul-away.md H4). The
 * seller can change it on the form like any job's pay.
 */
const HAUL_AWAY_PAY_DOLLARS: Record<DeliverySize, number> = { small: 15, large: 35, xl: 60 };
/** One trip is worth at least this much (H4). */
const HAUL_AWAY_MIN_PAY_DOLLARS = 40;

export function haulAwayPayDollars(sizes: DeliverySize[]): number {
  const sum = sizes.reduce((n, s) => n + (HAUL_AWAY_PAY_DOLLARS[s] ?? HAUL_AWAY_PAY_DOLLARS.large), 0);
  return Math.min(MAX_JOB_BUDGET_DOLLARS, Math.max(HAUL_AWAY_MIN_PAY_DOLLARS, MIN_JOB_BUDGET_DOLLARS, sum));
}

const SIZE_WORDS: Record<DeliverySize, string> = {
  small: "small, one person can carry it",
  large: "large",
  xl: "extra large, needs two people",
};

const fit = (s: string, n: number) => Array.from(s).slice(0, n).join("").trim();

/** Cut to n characters without ending on half a word. */
function fitWords(s: string, n: number): string {
  const chars = Array.from(s.trim());
  if (chars.length <= n) return chars.join("");
  const cut = chars.slice(0, n).join("");
  if (chars[n] === " ") return cut.trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface HaulAwayPrefill {
  itemIds: string[];
  title: string;
  description: string;
  budget: string;
  /** Storage paths of the listing photos to copy onto the job (the first photo of each item first). */
  photoPaths: string[];
}

/** The job a haul-away pre-fills, from the seller's own rows. Pure. Null when none can be posted. */
export function buildHaulAwayPrefill(rows: HaulAwayRow[]): HaulAwayPrefill | null {
  const ok = rows.filter(isPostable);
  if (ok.length === 0) return null;
  const title = ok.length === 1 ? fitWords(`Haul away: ${ok[0].title}`, TITLE_MAX) : `Haul away ${ok.length} items`;
  const list = ok.map((r) => `- ${fitWords(r.title, 80)} (${SIZE_WORDS[r.delivery_size] ?? "large"})`).join("\n");
  const description = fit(
    [
      `Pick up ${ok.length === 1 ? "this item" : "these items"} from my place and take ${ok.length === 1 ? "it" : "them"} to a donation center. If donation won't take ${ok.length === 1 ? "it" : "something"}, take it to the dump.`,
      list,
      "Please take a photo when you drop off, so I can see where it went. Any drop-off or dump fee is part of the pay.",
    ].join("\n\n"),
    DESCRIPTION_MAX,
  );
  const firsts = ok.map((r) => r.photo_paths[0]).filter((p): p is string => !!p);
  const rest = ok.flatMap((r) => r.photo_paths.slice(1));
  return {
    itemIds: ok.map((r) => r.item_id),
    title,
    description,
    budget: String(haulAwayPayDollars(ok.map((r) => r.delivery_size))),
    photoPaths: [...firsts, ...rest].slice(0, JOB_PHOTO_MAX),
  };
}

/** The RPC's data, or a throw carrying the plain words for its refusal on `userMessage` (as src/lib/declutter/api.ts). */
function withWords<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

/** The seller's live and off-sale items (or just `itemIds`), with their haul-away state. */
export async function fetchHaulAwayState(itemIds?: string[]): Promise<HaulAwayRow[]> {
  const rows = withWords(
    await supabase.rpc("declutter_haul_away_state", itemIds ? { p_item_ids: itemIds } : {}),
    (e) => rpcErrorMessage("declutter_haul_away_state", e),
  );
  return (rows ?? []) as HaulAwayRow[];
}

/** Point the items at the job just posted and take them off sale. Throws the refusal. */
export async function linkHaulAway(itemIds: string[], jobId: string): Promise<number> {
  return withWords(
    await supabase.rpc("declutter_link_haul_away", { p_item_ids: itemIds, p_job_id: jobId }),
    (e) => rpcErrorMessage("declutter_link_haul_away", e),
  ) as number;
}

/**
 * Undo a haul-away whose job is gone or cancelled: the item goes back on sale
 * if it was for sale. `jobId`: Post a Job undoing its own failed booking (only
 * the link to that job, or one whose job is already gone). Returns its status.
 */
export async function cancelHaulAway(itemId: string, jobId?: string): Promise<string> {
  return withWords(
    await supabase.rpc("declutter_cancel_haul_away", jobId ? { p_item_id: itemId, p_job_id: jobId } : { p_item_id: itemId }),
    (e) => rpcErrorMessage("declutter_cancel_haul_away", e),
  ) as string;
}

/**
 * Link the items to the job, once more if the answer was lost on the wire
 * (linking the same items to the same job again is a no-op on the server, so
 * a lost success is not mistaken for a refusal). Throws the refusal.
 */
export async function linkHaulAwayForJob(itemIds: string[], jobId: string): Promise<number> {
  try {
    return await linkHaulAway(itemIds, jobId);
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    return await linkHaulAway(itemIds, jobId);
  }
}

/**
 * Post a Job's booking failed after its job was deleted: put the items back
 * how they were. Best effort, never throws (each failure reported); answers
 * how many items it could not restore.
 */
export async function undoHaulAwayForJob(itemIds: string[], jobId: string): Promise<number> {
  let failed = 0;
  for (const id of itemIds) {
    try {
      await cancelHaulAway(id, jobId);
    } catch (err) {
      // haul_away_not_found: the link never landed; nothing to put back.
      if ((err as { message?: string })?.message?.includes("haul_away_not_found")) continue;
      failed++;
      report(err, { severity: "warning", tags: { source: "declutter.undoHaulAwayForJob" }, context: { job_id: jobId } });
    }
  }
  return failed;
}

/**
 * Delete a never-paid haul-away job the seller is giving up on (My listings:
 * "Book it again" / "Put back on sale"), so its checkout can never be opened
 * again. The poster's own DELETE policy allows exactly an open job that never
 * started a checkout (or one known dead); a live checkout is refused, and this
 * answers false. Photos first: their DELETE policy needs the job row.
 */
export async function deleteNeverPaidHaulJob(jobId: string): Promise<boolean> {
  await removeJobPhotos(jobId, "declutter.deleteNeverPaidHaulJob");
  const { data, error } = await supabase.from("jobs").delete().eq("id", jobId).eq("status", "open").select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
