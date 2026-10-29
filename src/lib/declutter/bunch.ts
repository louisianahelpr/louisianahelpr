/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once before
 * submission"; owner's pop-up choice: the photo tool groups the photos into
 * items and the seller fixes the grouping).
 *
 *   1. The seller picks many photos at once. They stay on the device.
 *   2. groupPhotos sends smaller copies, GROUP_BATCH at a time, to
 *      declutter-ai-draft's 'group' mode: it sorts them into items and drafts
 *      each. Nothing is stored or saved.
 *   3. The seller fixes the grouping with the pure helpers below (move a
 *      photo, merge two items, split one, drop one) and edits each item.
 *   4. listBunch makes each item's draft with the ordinary calls
 *      (declutter_create_item: every listing rule), uploads its photos
 *      (addPhoto), sets the ways buyers can get it, then lists the ready ones
 *      with publishMany (the four confirmations, the photo check, publish;
 *      the review queue still applies). One item failing never stops the rest.
 *
 * Nothing here is the protection: every write is a declutter_* RPC behind the
 * 'declutter' switch, and the photo tool's mode checks the selling gates.
 */
import { blobToBase64, cleanListingPhoto } from "@/lib/declutter/photos";
import { addPhoto, createDraft, invokeAiBody, setHandovers, type DeliverySize, type SellerHandover } from "@/lib/declutter/api";
import { AI_CHECK_GAP_MS, moveRowProblem, publishMany, type PickupPlace, type PublishOutcome } from "@/lib/declutter/moves";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";

/** Photos per photo-tool call (the server's GROUP_MAX_PHOTOS). */
export const GROUP_BATCH = 8;
/** Photos one "Sell a bunch" takes: 10 calls, under the photo tool's hourly cap of 20. */
export const BUNCH_MAX_PHOTOS = 80;
/** The grouping call sorts up to 8 photos and writes several listings, so it gets longer than one item's minute. */
const GROUP_TIMEOUT_MS = 100_000;

export interface BunchPhoto {
  key: string;
  file: File;
}

/** One item as the seller edits it. `photoKeys` are BunchPhoto keys, in order (the first is the cover). */
export interface BunchItem {
  key: string;
  photoKeys: string[];
  title: string;
  description: string;
  category: string;
  deliverySize: DeliverySize;
  conditionStars: number;
  /** The photo tool thinks it may be a banned item: marked, and cannot be listed from here. */
  flagged: boolean;
  /** Dollars as typed. */
  price: string;
}

/** What the server's 'group' mode answers for one batch (indexes into the photos sent). */
export interface GroupAnswer {
  items: { photos: number[]; title: string; description: string; category: string; deliverySize: DeliverySize; conditionStars: number; flagged: boolean }[];
  leftover: number[];
}

let seq = 0;
const nextKey = (p: string) => `${p}${++seq}`;

/** An item with only photos: the tool did not place them, or its call failed. The seller names it. */
function blankItem(photoKeys: string[]): BunchItem {
  return { key: nextKey("item"), photoKeys, title: "", description: "", category: "other", deliverySize: "large", conditionStars: 3, flagged: false, price: "" };
}

/** One batch's answer as items (each unplaced photo becomes its own item, so none is lost). */
export function itemsFromAnswer(answer: GroupAnswer, batch: BunchPhoto[]): BunchItem[] {
  const keyOf = (i: number) => batch[i]?.key;
  const out: BunchItem[] = [];
  const placed = new Set<number>();
  for (const it of answer.items ?? []) {
    const photoKeys: string[] = [];
    for (const i of it.photos ?? []) {
      const k = keyOf(i);
      if (!k || placed.has(i)) continue;
      placed.add(i);
      photoKeys.push(k);
    }
    if (photoKeys.length === 0) continue;
    out.push({ ...blankItem(photoKeys), title: it.title, description: it.description, category: it.category, deliverySize: it.deliverySize, conditionStars: it.conditionStars, flagged: it.flagged !== false });
  }
  batch.forEach((p, i) => {
    if (!placed.has(i)) out.push(blankItem([p.key]));
  });
  return out;
}

/** Ask the photo tool to sort one batch. Smaller copies, cleaned (no location data), sent once and never kept. */
async function askGroup(files: File[]): Promise<GroupAnswer> {
  const photos: string[] = [];
  for (const f of files) photos.push(await blobToBase64(await cleanListingPhoto(f, 1024, 0.7)));
  const data = (await invokeAiBody({ mode: "group", photos }, GROUP_TIMEOUT_MS)) as GroupAnswer | null;
  // An answer without a list is a fault, never "nothing here".
  if (!data || !Array.isArray(data.items)) throw new Error("ai_unavailable");
  return data;
}

export interface GroupResult {
  items: BunchItem[];
  /** Batches whose call failed: their photos are still there, as items without words, and this says why. */
  failed: { photos: number; error: unknown }[];
}

/**
 * Sort every photo into items, GROUP_BATCH at a time, in the order picked (the
 * same thing's photos are usually taken together). Calls are spaced to stay
 * under the photo tool's per-minute limit. A failed batch keeps its photos.
 */
export async function groupPhotos(
  photos: BunchPhoto[],
  onProgress: (done: number, total: number) => void,
  ask: (files: File[]) => Promise<GroupAnswer> = askGroup,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock: () => number = () => Date.now(),
): Promise<GroupResult> {
  const batches: BunchPhoto[][] = [];
  for (let i = 0; i < photos.length; i += GROUP_BATCH) batches.push(photos.slice(i, i + GROUP_BATCH));
  const items: BunchItem[] = [];
  const failed: GroupResult["failed"] = [];
  let last = -Infinity;
  for (const [i, batch] of batches.entries()) {
    const gap = last + AI_CHECK_GAP_MS - clock();
    if (gap > 0) await wait(gap);
    last = clock();
    try {
      items.push(...itemsFromAnswer(await ask(batch.map((p) => p.file)), batch));
    } catch (error) {
      // Not swallowed: the screen says how many photos were not sorted and why; they stay as items to name.
      failed.push({ photos: batch.length, error });
      for (const p of batch) items.push(blankItem([p.key]));
    }
    onProgress(i + 1, batches.length);
  }
  return { items, failed };
}

/* ---- Fixing the grouping (pure) ----------------------------------------- */

const withoutEmpty = (items: BunchItem[]) => items.filter((it) => it.photoKeys.length > 0);

/** Move one photo to another item (it goes last there). An item left with no photo is removed. */
export function movePhoto(items: BunchItem[], photoKey: string, toItemKey: string): BunchItem[] {
  if (!items.some((it) => it.key === toItemKey)) return items;
  const moved = items.map((it) => {
    const rest = it.photoKeys.filter((k) => k !== photoKey);
    return it.key === toItemKey ? { ...it, photoKeys: [...rest, photoKey] } : { ...it, photoKeys: rest };
  });
  return withoutEmpty(moved);
}

/** Merge `fromKey` into `intoKey`: its photos join the end; the kept item's words stay. Still flagged if either was. */
export function mergeItems(items: BunchItem[], fromKey: string, intoKey: string): BunchItem[] {
  const from = items.find((it) => it.key === fromKey);
  if (!from || fromKey === intoKey || !items.some((it) => it.key === intoKey)) return items;
  return items
    .filter((it) => it.key !== fromKey)
    .map((it) => (it.key === intoKey ? { ...it, photoKeys: [...it.photoKeys, ...from.photoKeys], flagged: it.flagged || from.flagged } : it));
}

/**
 * Split the chosen photos off into a new item, right after this one. The new
 * item starts with no words (it is a different thing); it keeps the flag, so
 * a split never clears a possible banned item.
 */
export function splitItem(items: BunchItem[], itemKey: string, photoKeys: string[]): BunchItem[] {
  const at = items.findIndex((it) => it.key === itemKey);
  if (at < 0) return items;
  const src = items[at];
  const take = src.photoKeys.filter((k) => photoKeys.includes(k));
  const keep = src.photoKeys.filter((k) => !photoKeys.includes(k));
  if (take.length === 0 || keep.length === 0) return items;
  const next = { ...blankItem(take), flagged: src.flagged };
  return [...items.slice(0, at), { ...src, photoKeys: keep }, next, ...items.slice(at + 1)];
}

export function dropItem(items: BunchItem[], itemKey: string): BunchItem[] {
  return items.filter((it) => it.key !== itemKey);
}

/** What stops one item being listed, in plain words, or null. */
export function bunchItemProblem(it: BunchItem): string | null {
  if (it.flagged) return "This may be an item you can't sell on Declutter, so it can't be listed from here.";
  if (it.photoKeys.length < DECLUTTER_MIN_PHOTOS) return `Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}.`;
  if (it.photoKeys.length > DECLUTTER_MAX_PHOTOS) return `Use at most ${photosWord(DECLUTTER_MAX_PHOTOS)}: split this item or move some photos.`;
  return moveRowProblem({ title: it.title, price: it.price, floor: "" })
    ?.replace("Give each item a name", "Give it a name")
    .replace("Give each item a price", "Give it a price") ?? null;
}

/* ---- Listing them all ---------------------------------------------------- */

export type BunchOutcome =
  | { key: string; title: string; status: "live" | "pending_review" }
  /** `draftId` set: the draft was made (find it under Selling) but a later step failed. */
  | { key: string; title: string; error: unknown; draftId: string | null };

export interface ListDeps {
  createDraft: typeof createDraft;
  addPhoto: typeof addPhoto;
  setHandovers: typeof setHandovers;
  publishMany: (ids: string[], onProgress: (done: number, total: number) => void) => Promise<PublishOutcome[]>;
}

const realDeps: ListDeps = { createDraft, addPhoto, setHandovers, publishMany: (ids, p) => publishMany(ids, p) };

/**
 * Make each item's draft (every listing rule, on the server), upload its
 * photos, set the ways, then list every item that got that far. Each item's
 * failure is its own; the rest carry on. The pickup times and the
 * confirmations are the caller's (once for the batch, before this runs).
 */
export async function listBunch(
  sellerId: string,
  items: BunchItem[],
  photos: Map<string, File>,
  place: PickupPlace,
  ways: SellerHandover[],
  onProgress: (done: number, total: number) => void,
  deps: ListDeps = realDeps,
): Promise<BunchOutcome[]> {
  const total = items.length * 2;
  const out = new Map<string, BunchOutcome>();
  const prepared: { key: string; title: string; id: string }[] = [];
  for (const [i, it] of items.entries()) {
    let id: string | null = null;
    try {
      // The screen lists only ready items; this is the same rule again, so nothing unready is ever made.
      const problem = bunchItemProblem(it);
      if (problem) throw Object.assign(new Error("bunch_item_not_ready"), { userMessage: problem });
      const price = Math.round(Number(it.price.replace(/[$,\s]/g, "")) * 100);
      id = await deps.createDraft({
        title: it.title.trim(),
        description: it.description.trim(),
        category: it.category,
        conditionStars: it.conditionStars,
        deliverySize: it.deliverySize,
        priceCents: price,
        floorPriceCents: price,
        areaLabel: place.areaLabel,
        pickupAddress: place.pickupAddress,
        pickupLat: place.pickupLat,
        pickupLng: place.pickupLng,
      });
      for (const k of it.photoKeys) {
        const f = photos.get(k);
        if (!f) throw new Error("photo_not_uploaded");
        await deps.addPhoto(sellerId, id, f);
      }
      await deps.setHandovers(id, ways);
      prepared.push({ key: it.key, title: it.title, id });
    } catch (error) {
      // Kept for the screen: which item, why, and whether its draft exists to finish by hand.
      out.set(it.key, { key: it.key, title: it.title, error, draftId: id });
    }
    onProgress(i + 1, total);
  }
  if (prepared.length > 0) {
    const results = await deps.publishMany(prepared.map((p) => p.id), (done) => onProgress(items.length + done, total));
    results.forEach((r, i) => {
      const p = prepared[i];
      out.set(p.key, "error" in r ? { key: p.key, title: p.title, error: r.error, draftId: p.id } : { key: p.key, title: p.title, status: r.status });
    });
  }
  onProgress(total, total);
  return items.map((it) => out.get(it.key)!).filter(Boolean);
}
