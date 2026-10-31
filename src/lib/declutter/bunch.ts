/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once before
 * submission"; owner's pop-up choice: the photo tool groups the photos into
 * items and the seller fixes the grouping).
 *
 *   1. The seller picks many photos at once. They stay on the device.
 *   2. groupPhotos sends smaller copies, GROUP_BATCH at a time, to
 *      declutter-ai-draft's 'group' mode: it sorts them into items and drafts
 *      each, and each batch's items reach the screen as it finishes. Nothing is
 *      stored or saved. A photo that can't be cleaned is named and left out; the
 *      rest of its batch still goes.
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
import { blobToBase64, cleanListingPhoto, unusablePhotosNote } from "@/lib/declutter/photos";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { report } from "@/lib/errorLogger";
import { isNetworkFailure } from "@/lib/networkFailure";
import { pageAwayCount, whenPageIsBack, withRetries } from "@/lib/declutter/steadyRetry";
import { addPhotoSteadily, AlreadyPosted, createDraft, fetchItemStatuses, invokeAiBody, removePhoto, setDropPct, setHandovers, setKeepUp, setOfferRules, updateDraft, withdrawItem, type AiHintPoint, type DeliverySize, type SellerHandover } from "@/lib/declutter/api";
import { offersOffAfterPublish, offersOffOnDraft } from "@/lib/declutter/offersOnPost";
import { AI_CHECK_GAP_MS, createMoveDraft, moveRowProblem, publishMany, type PickupPlace, type PublishOutcome } from "@/lib/declutter/moves";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { floorFromPct } from "@/lib/declutter/sellerDefaults";
import type { EarlyUploads } from "@/lib/declutter/bunchStage";
import { priceChoiceToSave } from "@/components/declutter/sellForm";

/** Photos per photo-tool call (the server's GROUP_MAX_PHOTOS). */
export const GROUP_BATCH = 8;
/** Photos one "Sell a bunch" takes: 10 calls, under the photo tool's hourly cap of 20. */
export const BUNCH_MAX_PHOTOS = 80;
/** The grouping call sorts up to 8 photos and writes several listings, so it gets longer than one item's minute. */
const GROUP_TIMEOUT_MS = 100_000;
/**
 * LEAD-BUNCH-34-SLOW (owner 10-31, 34 photos on an iPhone "takes ages, like it's not even accepting the pictures"):
 * photos are made ready (decoded, shrunk, location data removed) this many at a time, all of them from the first tap,
 * instead of one after another inside each batch's turn. A few at once, never all: a phone decodes each full photo whole.
 */
export const PHOTO_WORK_AT_ONCE = 4;

/** Each photo's small copy, or why it couldn't be made, started at once for every photo, PHOTO_WORK_AT_ONCE at a time, in order. */
export function cleanAhead(
  photos: readonly BunchPhoto[],
  clean: (file: File) => Promise<File>,
  onEach?: (key: string, copy: File | null, error?: unknown) => void,
  atOnce = PHOTO_WORK_AT_ONCE,
): Promise<{ copy: File } | { error: unknown }>[] {
  const done: ((r: { copy: File } | { error: unknown }) => void)[] = [];
  const out = photos.map(() => new Promise<{ copy: File } | { error: unknown }>((resolve) => { done.push(resolve); }));
  let next = 0;
  const worker = async () => {
    while (next < photos.length) {
      const i = next++;
      const p = photos[i];
      try {
        const copy = await clean(p.file);
        onEach?.(p.key, copy);
        done[i]({ copy });
      } catch (error) {
        // Not swallowed: the caller names this photo and says why (unusablePhotosNote), and the screen offers it again.
        onEach?.(p.key, null, error);
        done[i]({ error });
      }
    }
  };
  for (let w = 0; w < Math.min(atOnce, photos.length); w++) void worker();
  return out;
}

/** The waits before a batch's further tries. A phone that drops one request usually sends the next. */
const SORT_RETRY_DELAYS_MS = [5_000, 20_000] as const;

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
  /** The photo tool thinks it may be a banned item: marked. It can still be listed; the photo check at listing decides. */
  flagged: boolean;
  /** Dollars as typed. */
  price: string;
  /** The photo tool's suggestion when it filled `price`: a later rewrite may replace that, never one the seller typed. */
  aiPrice?: string;
  /** Given away: price and lowest price 0, porch pickup only (the single form's "Give it away free"). */
  free?: boolean;
  /** The seller changed the name or details: a merge keeps their words, and a written-for-them pass leaves them be. */
  edited?: boolean;
  /** The photo tool hasn't answered the size: only then does the card ask, as the single form does. */
  sizeUnknown?: boolean;
  /** Set once listing has made its draft: trying again finishes that draft, never a second one. */
  draftId?: string;
  /**
   * LEAD-RESUME-REPOSTS: the id its draft is made with, picked and saved before the draft is asked for. A run cut off
   * before its draft id was saved, or work brought back from an older save, asks with the same id again: the server
   * says it is already posted, so it is never listed twice.
   */
  appId?: string;
  /** Photos already on that draft: photo key -> the server's photo id, so one moved off the item can be taken off it. */
  uploaded?: Record<string, string>;
  /** Photos waiting to be sorted, kept together with why: not an item yet, so it can't be listed. The screen offers Sort again. */
  notSorted?: boolean;
  /** The photo that was out of tries when listing stopped: the card marks it and offers Try again. Nothing after it went, so the order holds. */
  failedPhoto?: string;
  /** Why they aren't sorted, in the seller's words. */
  sortReason?: string;
  /** LEAD-OFFERS-CHOICE part (2): this item's own "Accept offers"; unset, it follows the seller's saved default. */
  acceptsOffers?: boolean;
  /** The item this may be the same thing as, when the check across two batches couldn't run. The screen offers to merge. */
  mergeHint?: string;
}

/** What the server's 'group' mode answers for one batch (indexes into the photos sent). */
export interface GroupAnswer {
  items: { photos: number[]; title: string; description: string; category: string; deliverySize: DeliverySize; conditionStars: number; flagged: boolean; priceDollars?: number | null }[];
  leftover: number[];
}

let seq = 0;
/** Unique across reloads: a bunch brought back from the device still holds the keys it was given. */
const nextKey = (p: string) => `${p}${Date.now().toString(36)}_${++seq}`;

/** An item with only photos and no words yet (split off, or the seller said these are one thing). */
export function blankItem(photoKeys: string[]): BunchItem {
  return { key: nextKey("item"), photoKeys, title: "", description: "", category: "other", deliverySize: "large", conditionStars: 3, flagged: false, price: "", sizeUnknown: true };
}

/** The photo tool's suggested price as the field shows it, or "" when it gave none we could use. */
function suggestedPrice(dollars: number | null | undefined): string {
  return typeof dollars === "number" && Number.isFinite(dollars) && dollars >= 1 && dollars <= 1000 ? String(Math.round(dollars)) : "";
}

/** The price after "Write it again": a new suggestion replaces the last one or a blank, never what the seller typed. */
export function rewrittenPrice(it: Pick<BunchItem, "price" | "aiPrice">, dollars: number | null | undefined): Pick<BunchItem, "price" | "aiPrice"> {
  const next = suggestedPrice(dollars);
  const theirs = it.price.trim() !== "" && it.price !== it.aiPrice;
  if (theirs || !next) return { price: it.price, aiPrice: it.aiPrice };
  return { price: next, aiPrice: next };
}

/** Photos that aren't sorted yet, together, with why. Never one item per photo: a few photos of one thing are not a few things. */
export function notSortedPile(photoKeys: string[], sortReason: string): BunchItem {
  return { ...blankItem(photoKeys), notSorted: true, sortReason };
}

const PILE_NOT_PLACED = "We couldn't tell which item these belong to.";
export const PILE_PAGE_CLOSED = "The page closed before these were sorted.";

/** The screen's list with a batch's items added: everything not sorted is one pile, first, where the seller sees it. */
export function addSorted(items: BunchItem[], made: BunchItem[]): BunchItem[] {
  const all = [...items, ...made];
  const piles = all.filter((it) => it.notSorted);
  const rest = all.filter((it) => !it.notSorted);
  if (piles.length === 0) return rest;
  return [{ ...piles[piles.length - 1], key: piles[0].key, photoKeys: piles.flatMap((it) => it.photoKeys) }, ...rest];
}

/** One batch's answer as items. Photos it did not place stay together as not sorted, so none is lost or listed unwritten. */
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
    const price = suggestedPrice(it.priceDollars);
    out.push({ ...blankItem(photoKeys), title: it.title, description: it.description, category: it.category, deliverySize: it.deliverySize, conditionStars: it.conditionStars, flagged: it.flagged !== false, price, aiPrice: price || undefined, sizeUnknown: false });
  }
  const unplaced = batch.filter((_, i) => !placed.has(i)).map((p) => p.key);
  if (unplaced.length > 0) out.push(notSortedPile(unplaced, PILE_NOT_PLACED));
  return out;
}

/** The smaller copy the photo tool sees: cleaned (no location data), sent once and never kept. */
const cleanForGroup = (file: File) => cleanListingPhoto(file, 1024, 0.7);

/**
 * Ask the photo tool to sort one batch of cleaned photos.
 * `at` (the located pickup address) lets the server hold each suggested price to our own sold prices nearby.
 */
export async function askGroup(cleaned: File[], at: AiHintPoint = null): Promise<GroupAnswer> {
  const photos: string[] = [];
  for (const f of cleaned) photos.push(await blobToBase64(f));
  const data = (await invokeAiBody(at ? { mode: "group", photos, at } : { mode: "group", photos }, GROUP_TIMEOUT_MS)) as GroupAnswer | null;
  // An answer without a list is a fault, never "nothing here".
  if (!data || !Array.isArray(data.items)) throw new Error("ai_unavailable");
  return data;
}

export interface GroupResult {
  items: BunchItem[];
  /** Batches whose call still failed after its retries: their photos are together as not sorted, and this says why. */
  failed: { photos: number; error: unknown }[];
  /** Photos that couldn't be cleaned, so can't be sent or listed. They are in no item; the screen names them. */
  unusable: { key: string; name: string; error: unknown }[];
}

/** The screen's words for the photos left out (it lives with the photo rules, for the one-item form too). */
export { unusablePhotosNote };

/** Long enough to tell two items apart: "oak", "the" and "with" say nothing about whether they're the same thing. */
const titleWords = (title: string) => new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["with", "from", "that", "this", "used", "item", "size"].includes(w)));

/** Worth asking whether two items are one: named alike. Each ask is a photo-tool call, so most boundaries never spend one. */
export function mightBeSameThing(a: BunchItem, b: BunchItem): boolean {
  if (a.notSorted || b.notSorted || !a.title.trim() || !b.title.trim()) return false;
  const words = titleWords(a.title);
  return [...titleWords(b.title)].some((w) => words.has(w));
}

/** `from`'s photos joined onto the item `intoKey`, whose words stay. If the seller dropped that item meanwhile, `from` stays itself. */
export function joinSorted(items: BunchItem[], intoKey: string, from: BunchItem): BunchItem[] {
  if (!items.some((it) => it.key === intoKey)) return [...items, from];
  return items.map((it) => (it.key === intoKey ? { ...it, photoKeys: [...it.photoKeys, ...from.photoKeys], flagged: it.flagged || from.flagged } : it));
}

/** What a sort also takes, besides its calls; every one has a real default. */
export interface SortExtras {
  whenBack?: () => Promise<void>;
  awayCount?: () => number;
  /** A try failed and another is coming: the screen says so. */
  onRetry?: () => void;
  /** A batch's first item was the same thing as the last batch's last: its photos joined that item. */
  onJoined?: (intoKey: string, from: BunchItem) => void;
  /** LEAD-BUNCH-34-SLOW: each photo's small copy as soon as it is made (null when it couldn't be), for its thumbnail and the "Adding N of M" count. */
  onCleaned?: (key: string, copy: File | null) => void;
}

/** Too much to send in one go on this connection, or the server said so: half as many may go through. A limit or a busy tool answers the same. */
const sizeMayBeWhy = (error: unknown) =>
  isNetworkFailure(error) || ["ai_timed_out", "group_photos_invalid"].includes(String((error as { message?: unknown } | null)?.message ?? ""));

/**
 * Sort every photo into items, GROUP_BATCH at a time, in the order picked (the same thing's photos are usually taken
 * together). Calls are spaced to stay under the photo tool's per-minute limit. A failed batch is tried again with
 * backoff, and never while the page is away; then in two halves when its size may be why. Photos that still fail stay
 * together, not sorted, with the reason. Once a whole batch has failed on the connection, the next batches get one try
 * each, so a seller with no signal isn't kept waiting for every one in turn; the first that succeeds ends that.
 *
 * An item whose photos fall across two batches comes back as two items. Where the last batch's last item and this
 * batch's first are named alike, a few of their photos go to the same tool together (no change on the server): one item
 * back means one thing, and they join. If that call fails, the later item carries a merge suggestion instead.
 *
 * `onProgress` also gets the items each batch made, so they can show at once. Each photo is cleaned on its own: one
 * that can't be is named in `unusable`, and the others in its batch still go.
 */
export async function groupPhotos(
  photos: BunchPhoto[],
  onProgress: (done: number, total: number, batchItems: BunchItem[]) => void,
  ask: (cleaned: File[]) => Promise<GroupAnswer> = askGroup,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock: () => number = () => Date.now(),
  clean: (file: File) => Promise<File> = cleanForGroup,
  extras: SortExtras = {},
): Promise<GroupResult> {
  const { whenBack = whenPageIsBack, awayCount = pageAwayCount, onRetry, onJoined, onCleaned } = extras;
  // LEAD-BUNCH-34-SLOW: every photo starts being made ready now, a few at a time, so a batch's copies are waiting when its turn comes.
  const ahead = cleanAhead(photos, clean, onCleaned ? (key, copy) => onCleaned(key, copy) : undefined);
  const batches: BunchPhoto[][] = [];
  for (let i = 0; i < photos.length; i += GROUP_BATCH) batches.push(photos.slice(i, i + GROUP_BATCH));
  const items: BunchItem[] = [];
  const failed: GroupResult["failed"] = [];
  const unusable: GroupResult["unusable"] = [];
  let last = -Infinity;
  let connectionDown = false;
  const spacedAsk = async (cleaned: File[]) => {
    const gap = last + AI_CHECK_GAP_MS - clock();
    if (gap > 0) await wait(gap);
    last = clock();
    return ask(cleaned);
  };
  const sendPart = async (part: BunchPhoto[], cleaned: File[], delays: readonly number[]): Promise<BunchItem[]> =>
    itemsFromAnswer(await withRetries(() => spacedAsk(cleaned), { delays, pause: wait, whenBack, awayCount, onRetry: () => onRetry?.() }), part);
  /** The pile for photos out of tries, with why. Also recorded where we can read it: a dropped request reaches no server log. */
  const giveUp = (part: BunchPhoto[], cleaned: File[], error: unknown): BunchItem[] => {
    failed.push({ photos: part.length, error });
    report(error, { severity: "warning", tags: { source: "declutter.bunch.sort" }, context: { photos: part.length, bytes: cleaned.reduce((n, f) => n + f.size, 0), hidden: typeof document !== "undefined" && document.visibilityState === "hidden" } });
    const count = part.length === 1 ? "this photo" : `these ${part.length} photos`;
    return [notSortedPile(part.map((p) => p.key), `We couldn't sort ${count} yet: ${declutterErrorMessage(error)}`)];
  };
  // The previous batch's small copies, for the check across a boundary.
  let lastCleaned = new Map<string, File>();
  for (const [i, batch] of batches.entries()) {
    const good: BunchPhoto[] = [];
    const cleaned: File[] = [];
    for (const [n, p] of batch.entries()) {
      const made = await ahead[i * GROUP_BATCH + n];
      if ("copy" in made) {
        cleaned.push(made.copy);
        good.push(p);
      } else {
        // The screen names this photo and says why (unusablePhotosNote).
        unusable.push({ key: p.key, name: p.file.name, error: made.error });
      }
    }
    let made: BunchItem[] = [];
    if (good.length > 0) {
      try {
        made = await sendPart(good, cleaned, connectionDown ? [] : SORT_RETRY_DELAYS_MS);
        connectionDown = false;
      } catch (error) {
        if (!connectionDown && good.length >= 2 && sizeMayBeWhy(error)) {
          const half = Math.ceil(good.length / 2);
          let anyWent = false;
          for (const [from, to] of [[0, half], [half, good.length]]) {
            const part = good.slice(from, to);
            const partCleaned = cleaned.slice(from, to);
            try {
              made.push(...await sendPart(part, partCleaned, SORT_RETRY_DELAYS_MS.slice(0, 1)));
              anyWent = true;
            } catch (partError) {
              // Not swallowed: giveUp keeps these photos with the reason, and records it.
              made.push(...giveUp(part, partCleaned, partError));
            }
          }
          connectionDown = !anyWent && isNetworkFailure(error);
        } else {
          // Not swallowed: giveUp keeps these photos with the reason, and records it.
          made = giveUp(good, cleaned, error);
          connectionDown = isNetworkFailure(error);
        }
      }
      // The check across the boundary with the last batch.
      const beforeAt = items.map((it) => !it.notSorted).lastIndexOf(true);
      const before = beforeAt >= 0 ? items[beforeAt] : null;
      const first = made.find((it) => !it.notSorted);
      if (before && first && !connectionDown && mightBeSameThing(before, first) && before.photoKeys.length + first.photoKeys.length <= DECLUTTER_MAX_PHOTOS) {
        const copies = new Map([...lastCleaned, ...good.map((p, n) => [p.key, cleaned[n]] as const)]);
        const sent = [...before.photoKeys.slice(-2), ...first.photoKeys.slice(0, 2)].flatMap((k) => {
          const copy = copies.get(k);
          return copy ? [copy] : [];
        });
        try {
          const answer = await spacedAsk(sent);
          if (answer.items?.length === 1 && new Set(answer.items[0].photos).size === sent.length) {
            items[beforeAt] = joinSorted([before], before.key, first)[0];
            made = made.filter((it) => it !== first);
            onJoined?.(before.key, first);
          }
        } catch (error) {
          // Not silent: the check is extra help, and the seller gets the suggestion on the card instead of the join.
          console.warn("[declutter] could not check two items across a batch", error);
          made = made.map((it) => (it === first ? { ...it, mergeHint: before.key } : it));
        }
      }
      lastCleaned = new Map(good.map((p, n) => [p.key, cleaned[n]]));
    }
    items.push(...made);
    onProgress(i + 1, batches.length, made);
  }
  return { items, failed, unusable };
}

/**
 * Photos brought back after a crash. One still being sorted was never cleaned, and one that can't be would come back as
 * a blank item and fail only at listing: it is left out here and named, as a live sort does. One on an item already passed.
 */
export async function keepCleanablePhotos(
  photos: BunchPhoto[],
  items: BunchItem[],
  clean: (file: File) => Promise<File> = cleanForGroup,
): Promise<{ photos: BunchPhoto[]; unusable: GroupResult["unusable"] }> {
  const held = new Set(items.flatMap((it) => it.photoKeys));
  // LEAD-BUNCH-34-SLOW: a few at a time, as a live sort does (34 photos brought back mid-sort were read one by one first).
  const loose = photos.filter((p) => !held.has(p.key));
  const checks = new Map(cleanAhead(loose, clean).map((c, i) => [loose[i].key, c] as const));
  const kept: BunchPhoto[] = [];
  const unusable: GroupResult["unusable"] = [];
  for (const p of photos) {
    const check = checks.get(p.key);
    if (!check) {
      kept.push(p);
      continue;
    }
    const r = await check;
    if ("copy" in r) kept.push(p);
    // The screen names this photo and says why (unusablePhotosNote).
    else unusable.push({ key: p.key, name: p.file.name, error: r.error });
  }
  return { photos: kept, unusable };
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

/** A price the seller typed, not our suggestion. */
const typedPrice = (it: Pick<BunchItem, "price" | "aiPrice">) => it.price.trim() !== "" && it.price !== it.aiPrice;

/**
 * Merge `fromKey` into `intoKey`: its photos join the end, still flagged if either was. What the seller typed survives:
 * their words win over the tool's, the longer details stay, and a typed price wins over a suggestion. When both have
 * typed prices the kept item's stands, and mergePriceClash lets the screen offer the other.
 */
export function mergeItems(items: BunchItem[], fromKey: string, intoKey: string): BunchItem[] {
  const from = items.find((it) => it.key === fromKey);
  if (!from || fromKey === intoKey || !items.some((it) => it.key === intoKey)) return items;
  return items
    .filter((it) => it.key !== fromKey)
    .map((it) => {
      if (it.key !== intoKey) return it;
      const theirWords = !!from.edited && !it.edited;
      const priced = typedPrice(it) ? it : typedPrice(from) ? from : it.price.trim() ? it : from;
      return {
        ...it,
        photoKeys: [...it.photoKeys, ...from.photoKeys],
        flagged: it.flagged || from.flagged,
        title: theirWords || !it.title.trim() ? from.title : it.title,
        description: from.description.trim().length > it.description.trim().length ? from.description : it.description,
        category: theirWords ? from.category : it.category,
        conditionStars: theirWords ? from.conditionStars : it.conditionStars,
        edited: it.edited || from.edited,
        price: priced.price,
        aiPrice: priced.aiPrice,
      };
    });
}

/** The price a merge would set aside: both items had one the seller typed, and they differ. Otherwise null. */
export function mergePriceClash(items: BunchItem[], fromKey: string, intoKey: string): string | null {
  const from = items.find((it) => it.key === fromKey);
  const into = items.find((it) => it.key === intoKey);
  if (!from || !into || !typedPrice(from) || !typedPrice(into) || from.price.trim() === into.price.trim()) return null;
  return from.price.trim();
}

/** Take one photo off an item. An item left with no photo is removed (the screen offers Undo). */
export function takePhotoOff(items: BunchItem[], itemKey: string, photoKey: string): BunchItem[] {
  return withoutEmpty(items.map((it) => (it.key === itemKey ? { ...it, photoKeys: it.photoKeys.filter((k) => k !== photoKey) } : it)));
}

/** This photo first: the cover buyers see, and the one the photo tool leads with. */
export function makeCover(items: BunchItem[], itemKey: string, photoKey: string): BunchItem[] {
  return items.map((it) => (it.key === itemKey && it.photoKeys.includes(photoKey) ? { ...it, photoKeys: [photoKey, ...it.photoKeys.filter((k) => k !== photoKey)] } : it));
}

/** A photo to just before another on its own item, or to the end (null). The first is the cover. */
export function movePhotoWithin(items: BunchItem[], itemKey: string, photoKey: string, beforeKey: string | null): BunchItem[] {
  return items.map((it) => {
    if (it.key !== itemKey || !it.photoKeys.includes(photoKey) || photoKey === beforeKey) return it;
    const rest = it.photoKeys.filter((k) => k !== photoKey);
    const at = beforeKey ? rest.indexOf(beforeKey) : -1;
    return { ...it, photoKeys: at < 0 ? [...rest, photoKey] : [...rest.slice(0, at), photoKey, ...rest.slice(at)] };
  });
}

/**
 * A photo dropped on another takes that photo's place, whichever way it travelled. movePhotoWithin inserts BEFORE a key,
 * so a forward drag has to name what follows the target (nothing, when the target is last) or it lands one short.
 */
export function dropBeforeKey(keys: readonly string[], photoKey: string, targetKey: string): string | null {
  const to = keys.indexOf(targetKey);
  return keys.indexOf(photoKey) < to ? keys[to + 1] ?? null : targetKey;
}

/** New photos on the end of an item, without the photo tool. */
export function addPhotosToItem(items: BunchItem[], itemKey: string, photoKeys: string[]): BunchItem[] {
  return items.map((it) => (it.key === itemKey ? { ...it, photoKeys: [...it.photoKeys, ...photoKeys] } : it));
}

/* ---- Changing many at once (pure) ---------------------------------------- */

/** The same change on these items. Not the words, so it never clears a flag. */
export function bulkEdit(items: BunchItem[], keys: ReadonlySet<string>, patch: Partial<Pick<BunchItem, "price" | "free" | "conditionStars">>): BunchItem[] {
  return items.map((it) => (keys.has(it.key) ? { ...it, ...patch } : it));
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

/**
 * Drafts a change to the grouping left with no item: the seller dropped it ("Don't sell this"), merged it away, or moved
 * its last photo off. Nothing on this list can finish them any more, so they must not stay under Selling.
 */
export function draftsLeftBehind(before: BunchItem[], after: BunchItem[]): { id: string; item: BunchItem }[] {
  const kept = new Set(after.flatMap((it) => (it.draftId ? [it.draftId] : [])));
  return before.flatMap((it) => (it.draftId && !kept.has(it.draftId) ? [{ id: it.draftId, item: it }] : []));
}

/**
 * Take a left-behind draft off the server. Only a draft: an item a cut-off run already listed stays up, and the answer
 * says so (taking it down is the seller's choice, under Selling, where its offers are shown).
 */
export async function removeBunchDraft(id: string, deps: Pick<ListDeps, "itemStatuses" | "withdrawItem"> = realDeps): Promise<"removed" | "already_listed"> {
  const status = (await deps.itemStatuses([id])).get(id);
  if (status && status !== "draft") return "already_listed";
  if (status === "draft") await deps.withdrawItem(id);
  return "removed";
}

/**
 * The seller's edit. Changing the name or details clears the flag, which was about the old words. Only the mark
 * goes: the photo check at listing still runs, and the server holds anything that check flags for an admin.
 */
export function editBunchItem(items: BunchItem[], itemKey: string, patch: Partial<BunchItem>): BunchItem[] {
  const reworded = "title" in patch || "description" in patch;
  const sized = "deliverySize" in patch ? { sizeUnknown: false } : null;
  return items.map((it) => (it.key === itemKey ? { ...it, ...patch, ...sized, flagged: reworded ? false : it.flagged, edited: reworded || it.edited } : it));
}

/** The photos some item still holds. Listed and dropped items' photos leave, so they stop counting toward the cap. */
export function photosInItems(photos: BunchPhoto[], items: BunchItem[]): BunchPhoto[] {
  const held = new Set(items.flatMap((it) => it.photoKeys));
  const kept = photos.filter((p) => held.has(p.key));
  return kept.length === photos.length ? photos : kept;
}

/**
 * What stops one item being listed, in plain words, or null. A possibly banned item is not stopped: it goes through
 * the same photo check as any listing, and declutter_publish_item holds a flagged one for an admin (owner's rule:
 * live at once; admin only on reports or a failed automatic check).
 */
export function bunchItemProblem(it: BunchItem): string | null {
  if (it.notSorted) return "These photos aren't sorted yet.";
  if (it.photoKeys.length < DECLUTTER_MIN_PHOTOS) return `Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}.`;
  if (it.photoKeys.length > DECLUTTER_MAX_PHOTOS) return `Use at most ${photosWord(DECLUTTER_MAX_PHOTOS)}: split this item or move some photos.`;
  const row = moveRowProblem({ title: it.title, price: it.free ? "1" : it.price, floor: "" })
    ?.replace("Give each item a name", "Give it a name")
    .replace("Give each item a price", "Give it a price");
  if (row) return row;
  return it.sizeUnknown ? BUNCH_SIZE_PROBLEM : null;
}

const BUNCH_SIZE_PROBLEM = "Pick a size, so buyers know what it takes to move it.";

/** Which field an item's problem is about, so the screen can go straight to it. */
export type BunchNeed = "photos" | "name" | "price" | "size";
export function bunchItemNeed(it: BunchItem): BunchNeed | null {
  // A not-sorted pile has its own card and its own Sort again: it isn't an item waiting for a field.
  if (it.notSorted) return null;
  const p = bunchItemProblem(it);
  if (!p) return null;
  if (p === BUNCH_SIZE_PROBLEM) return "size";
  if (/photo/i.test(p)) return "photos";
  return /name/i.test(p) ? "name" : "price";
}

/** "1 needs a name, 2 need a price": what is left, in the seller's words. */
export function bunchNeedsLine(items: BunchItem[]): string | null {
  const words: Record<BunchNeed, string> = { photos: "photos", name: "a name", price: "a price", size: "a size" };
  const counts = new Map<BunchNeed, number>();
  for (const it of items) {
    const need = bunchItemNeed(it);
    if (need) counts.set(need, (counts.get(need) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts].map(([need, n]) => `${n} ${n === 1 ? "needs" : "need"} ${words[need]}`).join(", ");
}

/** What still needs something first, each group in its own order. Run on a tap, never while typing: a row must not jump under the keyboard. */
export function unreadyFirst(items: BunchItem[]): BunchItem[] {
  return [...items.filter((it) => bunchItemNeed(it)), ...items.filter((it) => !bunchItemNeed(it))];
}

/**
 * The photos already on an item's draft that have to come off: moved to another item, or out of place now. Each photo
 * takes the next place on the listing as it is sent, so a new cover or order only reaches the listing by sending those
 * again. If one of those files is gone, the order stays as sent: a wrong order beats a lost photo.
 */
export function sentPhotosToTakeOff(it: Pick<BunchItem, "photoKeys" | "uploaded">, photos: ReadonlyMap<string, File>): string[] {
  const sent = Object.keys(it.uploaded ?? {});
  const stay = sent.filter((k) => it.photoKeys.includes(k));
  let n = 0;
  while (n < stay.length && it.photoKeys[n] === stay[n]) n += 1;
  const outOfPlace = stay.slice(n);
  const canSendAgain = outOfPlace.every((k) => photos.has(k));
  return sent.filter((k) => !it.photoKeys.includes(k) || (canSendAgain && outOfPlace.includes(k)));
}

/**
 * The items a listing run takes. While the setup fee is due, only the free ones: declutter_setup_fee_before_list asks
 * no fee at price 0. The server stays the protection; this only keeps a priced item from being refused after its work.
 */
export function bunchListable(items: BunchItem[], feeDue: boolean): BunchItem[] {
  return items.filter((it) => !bunchItemProblem(it) && (!feeDue || !!it.free));
}

/* ---- Listing them all ---------------------------------------------------- */

/**
 * What listing takes, honestly: each item waits for its photo check (AI_CHECK_GAP_MS) and uploads its photos.
 * 50 items is over 12 minutes, which is why the screen says so before it starts.
 */
export const BUNCH_SECONDS_EACH = 15;
export const bunchListingMinutes = (items: number) => Math.ceil((items * BUNCH_SECONDS_EACH) / 60);

/** Time left, said plainly. */
function timeLeft(seconds: number): string {
  if (seconds < 45) return "Less than a minute left.";
  const minutes = Math.round(seconds / 60);
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left.`;
}

/** Sorting, in the seller's terms: what's been found and how long is left, never batches. */
export function sortProgressLine(done: number, total: number, found: number): string {
  const so = found > 0 ? `Found ${found} ${found === 1 ? "item" : "items"} so far.` : "Looking through your photos.";
  return `${so} ${timeLeft(((total - done) * AI_CHECK_GAP_MS) / 1000)}`;
}

/** Listing, in the seller's terms. A run's steps are every item made ready, then every item listed. */
export function listingProgressLine(done: number, total: number, names: readonly string[]): string {
  const n = Math.max(1, total / 2);
  const getting = done < n;
  const at = Math.min(n, (getting ? done : done - n) + 1);
  const name = names[at - 1]?.trim();
  const left = ((total - done) * BUNCH_SECONDS_EACH) / 2;
  return `${getting ? "Getting" : "Listing"} ${at} of ${n}${getting ? " ready" : ""}${name ? `: ${name}` : ""}. ${timeLeft(left)}`;
}

export type BunchOutcome =
  /** `offersFailed`: listed, but taking offers although the seller turned them off (they can, from Manage listing). */
  /** `keepUpFailed`: it is listed, but "Keep it up" could not be turned on (the seller can, from Manage listing). `id`: its listing. */
  | { key: string; title: string; status: "live" | "pending_review"; keepUpFailed?: boolean; offersFailed?: boolean; id?: string }
  /**
   * `draftId` set: the draft was made but a later step failed. `stays`: it failed getting ready (an upload, the phone
   * locking), so it stays on the list with its photos to try again; otherwise it is finished under Selling.
   */
  | { key: string; title: string; error: unknown; draftId: string | null; stays?: boolean };

/** Where a run has got to, photo by photo. `retrying`: this one's connection dropped, and it is being tried again. */
export interface PhotoProgress {
  itemName: string;
  /** 1 for the first photo of the run. */
  photo: number;
  of: number;
  retrying: boolean;
}

export interface ListDeps {
  createDraft: typeof createDraft;
  /** The same draft, in the seller's moving sale (a move-out date was given). */
  createMoveDraft: typeof createMoveDraft;
  updateDraft: typeof updateDraft;
  addPhoto: typeof addPhotoSteadily;
  removePhoto: typeof removePhoto;
  /** Each id's status now; an id with no row is gone. */
  itemStatuses: typeof fetchItemStatuses;
  withdrawItem: typeof withdrawItem;
  setHandovers: typeof setHandovers;
  setDropPct: typeof setDropPct;
  setKeepUp: typeof setKeepUp;
  setOfferRules: typeof setOfferRules;
  publishMany: (ids: string[], onProgress: (done: number, total: number, index: number) => void) => Promise<PublishOutcome[]>;
}

const realDeps: ListDeps = { createDraft, createMoveDraft, updateDraft, addPhoto: addPhotoSteadily, removePhoto, itemStatuses: fetchItemStatuses, withdrawItem, setHandovers, setDropPct, setKeepUp, setOfferRules, publishMany: (ids, p) => publishMany(ids, p) };

/** The single form's listing choices, once for the batch (they start from the seller's remembered ones). */
export interface BunchChoices {
  keepUp: boolean;
  drops: boolean;
  dropPct: number;
  /** Each item's lowest price, as a percent of its price (rounded by floorFromPct, as the single form does). */
  floorPct: number;
  /** The move-out date (YYYY-MM-DD): new drafts join the seller's moving sale. Blank or absent: ordinary listings. */
  moveOutOn?: string | null;
  /** The seller's saved "Accept offers" (Settings): an item with no choice of its own follows it. Absent: on. */
  acceptsOffers?: boolean;
}

/** Whether this item goes up taking offers: its own switch, else the saved default. A free item is claimed, never offered on. */
export function bunchItemTakesOffers(it: Pick<BunchItem, "free" | "acceptsOffers">, choices: Pick<BunchChoices, "acceptsOffers">): boolean {
  return !it.free && (it.acceptsOffers ?? choices.acceptsOffers ?? true);
}

/** Taking a photo off a draft. Already gone (a run cut off after this step, before it was saved) is what was asked for. */
async function removeDraftPhoto(deps: ListDeps, photoId: string): Promise<void> {
  try {
    await deps.removePhoto(photoId);
  } catch (err) {
    if (!String((err as Error)?.message ?? "").includes("photo_not_found")) throw err;
  }
}

const NO_CHOICES: BunchChoices = { keepUp: false, drops: false, dropPct: 5, floorPct: 50 };

/** Who hears about the run in progress. A screen opened during it takes over from the one that started it. */
export interface BunchRunWatcher {
  onProgress: (done: number, total: number) => void;
  onStep: (key: string, patch: Partial<BunchItem> | null) => void;
  onDone: (result: { out: BunchOutcome[] } | { error: unknown }) => void;
  onPhoto?: (progress: PhotoProgress) => void;
}

interface BunchRun {
  userId: string;
  watcher: BunchRunWatcher;
  done: number;
  total: number;
}

let activeRun: BunchRun | null = null;

/** The id a bunch item's draft is made with (crypto.randomUUID; the server checks its form). */
function newBunchItemId(): string {
  return crypto.randomUUID();
}

/**
 * LEAD-RESUME-REPOSTS (owner 2026-10-31: "Continue where you left off" offered Sell a bunch items she had already
 * posted, and posting them made duplicates). Work brought back from the device, against what the server says of its
 * ids: an item whose draft or app id is already posted (any status but draft) is left out, with the photos only it
 * held, so it is never offered again; an item whose draft is gone keeps its place and gets a new draft at listing.
 * `statuses` null (the read failed): nothing is left out here, and listing asks again.
 */
export function withoutPosted<T extends { key: string }>(items: BunchItem[], photos: T[], statuses: Map<string, string> | null): { items: BunchItem[]; photos: T[]; posted: number } {
  if (!statuses) return { items, photos, posted: 0 };
  const isPosted = (id?: string) => !!id && statuses.has(id) && statuses.get(id) !== "draft";
  const kept = items.filter((it) => !isPosted(it.draftId) && !isPosted(it.appId));
  const posted = items.length - kept.length;
  if (posted === 0) return { items, photos, posted };
  const held = new Set(kept.flatMap((it) => it.photoKeys));
  const goneOnly = new Set(items.filter((it) => !kept.includes(it)).flatMap((it) => it.photoKeys).filter((k) => !held.has(k)));
  return { items: kept, photos: photos.filter((p) => !goneOnly.has(p.key)), posted };
}

/** Every id the server may know a kept item by: its draft and its app id. */
export function keptItemIds(items: BunchItem[]): string[] {
  return [...new Set(items.flatMap((it) => [it.draftId, it.appId].filter((x): x is string => !!x)))];
}

/**
 * One listing run at a time on this device. A run outlives its screen (the back link), and the screen brought back holds
 * the same drafts: a second run would publish them again (item_not_a_draft) and upload their photos twice.
 * Returns false, and starts nothing, while one is going.
 */
export function startBunchRun(
  userId: string,
  watcher: BunchRunWatcher,
  total: number,
  work: (onProgress: BunchRunWatcher["onProgress"], onStep: BunchRunWatcher["onStep"], onPhoto: NonNullable<BunchRunWatcher["onPhoto"]>) => Promise<BunchOutcome[]>,
): boolean {
  if (activeRun) return false;
  const run: BunchRun = { userId, watcher, done: 0, total };
  activeRun = run;
  void work(
    (done, of) => {
      run.done = done;
      run.total = of;
      run.watcher.onProgress(done, of);
    },
    (key, patch) => run.watcher.onStep(key, patch),
    (progress) => run.watcher.onPhoto?.(progress),
  ).then((out) => ({ out }), (error: unknown) => ({ error })).then((result) => {
    activeRun = null;
    run.watcher.onDone(result);
  });
  return true;
}

/** A screen opening during this member's run takes it over; where it has got to, or null when there is none. */
export function watchBunchRun(userId: string, watcher: BunchRunWatcher): { done: number; total: number } | null {
  if (activeRun?.userId !== userId) return null;
  activeRun.watcher = watcher;
  return { done: activeRun.done, total: activeRun.total };
}

/**
 * Make each item's draft (every listing rule, on the server), upload its
 * photos, set the ways, then list every item that got that far. Each item's
 * failure is its own; the rest carry on. The pickup times and the
 * confirmations are the caller's (once for the batch, before this runs).
 */
/** A turn each, in the order asked: the promise gives the function that ends the turn. */
function oneAtATime(): () => Promise<() => void> {
  let tail: Promise<void> = Promise.resolve();
  return () => {
    let end!: () => void;
    const before = tail;
    tail = new Promise<void>((r) => (end = r));
    return before.then(() => end);
  };
}

/** LEAD-BUNCH-34-SLOW: items made ready side by side, as many as publishMany lists at once. */
const PREPARE_AT_ONCE = 3;

export async function listBunch(
  sellerId: string,
  items: BunchItem[],
  photos: Map<string, File>,
  place: PickupPlace,
  ways: SellerHandover[],
  onProgress: (done: number, total: number) => void,
  deps: ListDeps = realDeps,
  /** Each lasting step on one item, to save at once: its draft, each photo, and null once it has been listed or refused. */
  onStep: (key: string, patch: Partial<BunchItem> | null) => void = () => {},
  choices: BunchChoices = NO_CHOICES,
  /** Each photo as it starts to go, and again if it is tried again. */
  onPhoto?: (progress: PhotoProgress) => void,
  /**
   * LEAD-BUNCH-34-SLOW: photos already sent while the seller sorted (BunchStager). A new draft is created with the id
   * they went up under, and each such photo is only attached.
   */
  early?: EarlyUploads,
): Promise<BunchOutcome[]> {
  const total = items.length * 2;
  const photosToSend = items.reduce((n, it) => {
    const off = sentPhotosToTakeOff(it, photos);
    return n + it.photoKeys.filter((k) => !(k in (it.uploaded ?? {})) || off.includes(k)).length;
  }, 0);
  let photosStarted = 0;
  const out = new Map<string, BunchOutcome>();
  const prepared: { at: number; key: string; title: string; id: string; keepUpFailed: boolean; offersAfter: boolean; offersFailed: boolean }[] = [];
  // A run cut off by a crash or a reload may have listed a draft before it could save that. Asked first, not refused later.
  const held = keptItemIds(items);
  let statuses: Map<string, string> | null = null;
  if (held.length > 0) {
    try {
      statuses = await deps.itemStatuses(held);
    } catch (err) {
      // Extra care lost, not a blocker: each step below still asks the server, and a refusal is named on its item.
      console.warn("[declutter] could not read the drafts' statuses before listing", err);
    }
  }
  let finished = 0;
  // A photo sent whole goes one at a time across the run (the phone's upload is the limit, and the owner's photos timed
  // out when they raced, 10-30); an item keeps the turn until its photos are done, so they go in order. Only attaching a
  // photo already up (early) needs no turn.
  const uploadTurn = oneAtATime();
  /** "already_posted": its app id is the seller's posted listing; the caller counts it done and clears it from the list. */
  const prepareOne = async (i: number, original: BunchItem): Promise<"already_posted" | void> => {
    let it = original;
    // Its app id is already one of the seller's items (a run cut off before its draft id was saved): that is its draft.
    const byAppId = !it.draftId && it.appId && statuses ? statuses.get(it.appId) : undefined;
    if (byAppId !== undefined && it.appId) {
      it = { ...it, draftId: it.appId };
      onStep(it.key, { draftId: it.appId });
    }
    if (it.draftId && statuses) {
      const status = statuses.get(it.draftId);
      if (status === "live" || status === "pending_review") {
        out.set(it.key, { key: it.key, title: it.title, status, id: it.draftId });
        onStep(it.key, null);
        onProgress(++finished, total);
        return;
      }
      if (status === undefined) {
        // Its draft is gone (taken down under Selling). The seller still has it on the list, so it gets a new one.
        it = { ...it, draftId: undefined, uploaded: undefined };
        onStep(it.key, { draftId: undefined, uploaded: undefined });
      } else if (status !== "draft") {
        out.set(it.key, { key: it.key, title: it.title, error: new Error("item_not_a_draft"), draftId: it.draftId });
        onStep(it.key, null);
        onProgress(++finished, total);
        return;
      }
    }
    let id: string | null = it.draftId ?? null;
    try {
      // The screen lists only ready items; this is the same rule again, so nothing unready is ever made.
      const problem = bunchItemProblem(it);
      if (problem) throw Object.assign(new Error("bunch_item_not_ready"), { userMessage: problem });
      const dollars = it.price.replace(/[$,\s]/g, "");
      const price = it.free ? 0 : Math.round(Number(dollars) * 100);
      const choice = priceChoiceToSave({ free: !!it.free, price: dollars, floor: floorFromPct(dollars, choices.floorPct), drops: choices.drops, dropPct: choices.dropPct });
      if (!choice) throw new Error("invalid_floor_price");
      const fields = {
        title: it.title.trim(),
        description: it.description.trim(),
        category: it.category,
        conditionStars: it.conditionStars,
        deliverySize: it.deliverySize,
        priceCents: price,
        floorPriceCents: choice.floorCents,
        areaLabel: place.areaLabel,
        pickupAddress: place.pickupAddress,
        pickupLat: place.pickupLat,
        pickupLng: place.pickupLng,
      };
      if (id) {
        // Its draft exists from an earlier try: the seller's edits go onto it.
        await deps.updateDraft(id, fields);
      } else {
        // ONE id per item (lead, 10-31): its saved app id (LEAD-RESUME-REPOSTS) is the id the draft is made with AND the
        // folder its photos went up into early (LEAD-BUNCH-34-SLOW, BunchStager). Picked here only when it has none yet,
        // and saved before the draft is asked for, so a cut-off run asks with the same id and never makes a second.
        const appId = it.appId ?? early?.idFor(it.key) ?? newBunchItemId();
        if (!it.appId) onStep(it.key, { appId });
        try {
          id = choices.moveOutOn
            ? await deps.createMoveDraft(choices.moveOutOn, place, fields)
            : await deps.createDraft(fields, appId);
        } catch (err) {
          // LEAD-RESUME-REPOSTS: that id is already the seller's posted listing. Never a second copy: it leaves the list.
          if (err instanceof AlreadyPosted) {
            out.set(it.key, { key: it.key, title: it.title, error: err, draftId: err.itemId });
            return "already_posted";
          }
          throw err;
        }
        onStep(it.key, { draftId: id });
      }
      const uploaded = { ...it.uploaded };
      // A photo moved off this item since its draft was made leaves the draft, or it would be listed with the wrong thing.
      // One whose place changed comes off too, and goes back in its new place below.
      for (const k of sentPhotosToTakeOff({ photoKeys: it.photoKeys, uploaded }, photos)) {
        await removeDraftPhoto(deps, uploaded[k]);
        delete uploaded[k];
        onStep(it.key, { uploaded: { ...uploaded } });
      }
      const draftId = id;
      const sendPhotos = async () => {
        let endTurn: (() => void) | null = null;
        try {
          for (const k of it.photoKeys) {
            if (k in uploaded) continue;
            const f = photos.get(k);
            if (!f) throw new Error("photo_not_uploaded");
            // LEAD-BUNCH-34-SLOW: a photo already in this draft's folder is only attached (the id it went up under).
            const uploadedPath = (await early?.path(draftId, k)) ?? undefined;
            if (!uploadedPath && !endTurn) endTurn = await uploadTurn();
            photosStarted += 1;
            const progress = { itemName: it.title.trim(), photo: photosStarted, of: photosToSend };
            onPhoto?.({ ...progress, retrying: false });
            try {
              // One at a time, in order (uploadTurn): the phone's upload speed is the limit, so two at once finish no sooner, and each
              // photo takes the next place on the listing. Out of tries, this item stops here, so a later photo never takes
              // this one's place; the run goes on to the next item.
              const hooks = { ...(onPhoto ? { onRetry: () => onPhoto({ ...progress, retrying: true }) } : {}), ...(uploadedPath ? { uploadedPath } : {}) };
              uploaded[k] = Object.keys(hooks).length > 0 ? await deps.addPhoto(sellerId, draftId, f, hooks) : await deps.addPhoto(sellerId, draftId, f);
              early?.used(draftId, k);
            } catch (err) {
              // A try that failed may have removed that copy: the next try uploads the photo afresh.
              early?.used(draftId, k);
              onStep(it.key, { failedPhoto: k });
              throw err;
            }
            onStep(it.key, { uploaded: { ...uploaded }, ...(it.failedPhoto ? { failedPhoto: undefined } : {}) });
          }
        } finally {
          endTurn?.();
        }
      };
      // LEAD-BUNCH-34-SLOW: the draft's settings need none of its photos, so they go while the photos are attached.
      const settle = async () => {
        // A free item is picked up from the porch only (the free checkout's one way).
        await deps.setHandovers(draftId, it.free ? ["porch"] : ways);
        if (!it.free) await deps.setDropPct(draftId, choice.dropPct);
      };
      const keepUp = async () => {
        if (!choices.keepUp) return false;
        try {
          await deps.setKeepUp(draftId, true);
          return false;
        } catch (err) {
          // Not a blocker, as on the single form: the item still lists, and the screen says this one wasn't turned on.
          console.warn("[declutter] could not turn on Keep it up", err);
          return true;
        }
      };
      // "Accept offers" off (LEAD-OFFERS-CHOICE) goes on the draft beside the other settings, so it never goes live
      // taking offers and waits for nothing. Not a blocker: "after" sends it again once the item is up.
      const offersOff = async (): Promise<"done" | "after" | "failed"> => {
        // A free item is claimed, never offered on: nothing to turn off.
        if (it.free || bunchItemTakesOffers(it, choices)) return "done";
        try {
          return await offersOffOnDraft(draftId, deps.setOfferRules);
        } catch (err) {
          console.warn("[declutter] could not turn offers off", err);
          return "failed";
        }
      };
      // allSettled, never all: a setting refused first must not end this item while its photos are still being
      // attached, or a quick Try again finds a photo not yet marked as sent and attaches it a second time. All of them
      // finish, then the first failure is the item's.
      const [sent, settled, kept, offers] = await Promise.allSettled([sendPhotos(), settle(), keepUp(), offersOff()]);
      const failed = [sent, settled, kept, offers].find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
      const keepUpFailed = kept.status === "fulfilled" && kept.value;
      const offersAfter = offers.status === "fulfilled" && offers.value === "after";
      const offersFailed = offers.status === "fulfilled" && offers.value === "failed";
      prepared.push({ at: i, key: it.key, title: it.title, id: draftId, keepUpFailed, offersAfter, offersFailed });
    } catch (error) {
      // Kept for the screen: which item, why, and whether its draft exists to finish by hand.
      out.set(it.key, { key: it.key, title: it.title, error, draftId: id, stays: true });
    }
    onProgress(++finished, total);
  };
  // LEAD-BUNCH-34-SLOW: a few items get ready at once (each one's draft, photos and settings are its own), in order.
  let nextItem = 0;
  const readyWorker = async () => {
    while (nextItem < items.length) {
      const i = nextItem++;
      if ((await prepareOne(i, items[i])) === "already_posted") {
        onStep(items[i].key, null);
        onProgress(++finished, total);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREPARE_AT_ONCE, items.length) }, readyWorker));
  prepared.sort((a, b) => a.at - b.at);
  if (prepared.length > 0) {
    // LEAD-BUNCH-34-SLOW: listed a few at once, so they finish in any order; each one's own step is saved as it goes.
    const results = await deps.publishMany(prepared.map((p) => p.id), (done, _total, index) => {
      onProgress(items.length + done, total);
      const p = prepared[index];
      if (p) onStep(p.key, null);
    });
    for (const [i, r] of results.entries()) {
      const p = prepared[i];
      if ("error" in r) {
        out.set(p.key, { key: p.key, title: p.title, error: r.error, draftId: p.id });
        continue;
      }
      let offersFailed = p.offersFailed;
      if (p.offersAfter) {
        // A server without 20261031201036 refuses a draft: sent again now that it is up.
        try {
          await offersOffAfterPublish(p.id, r.status, deps.setOfferRules);
        } catch (err) {
          console.warn("[declutter] could not turn offers off after listing", err);
          offersFailed = true;
        }
      }
      out.set(p.key, { key: p.key, title: p.title, status: r.status, id: p.id, ...(p.keepUpFailed ? { keepUpFailed: true } : {}), ...(offersFailed ? { offersFailed: true } : {}) });
    }
  }
  onProgress(total, total);
  return items.map((it) => out.get(it.key)!).filter(Boolean);
}
