/**
 * /declutter/sell?mode=bunch — "Sell a bunch" (owner 2026-10-29: "how can
 * they do a lot of listings at once? like just take pictures basically,
 * upload all pictures for everything they want to sell, ai does the forms and
 * they review all at once before submission"). One page, in order:
 *   1. Where buyers pick up: the area buyers see and the private address,
 *      asked once for every item.
 *   2. Add photos: many at once. Smaller copies go to the photo tool, which
 *      sorts them into items and writes each one (lib/declutter/bunch.ts);
 *      nothing is saved until the seller lists.
 *   3. Check each item: every field editable; fix the grouping (move a photo,
 *      split, merge, drop: the owner's pop-up choice). A possibly banned item
 *      is marked, and the photo check decides at listing; an item short of
 *      photos says so.
 *   4. List them together: pickup times, the ways buyers can get them and the
 *      four confirmations once, then each item's draft, photos and publish
 *      (the photo check and review queue still apply). One item failing never
 *      stops the rest; each failure is named with its reason.
 * ?mode=moving is this same page with an optional move-out date on top (lead 2026-10-30: one flow, the room scan and
 * the Move page are retired): with a date, the drafts join the seller's moving sale.
 * Behind the 'declutter' switch (DeclutterGate on the page). Every write is an ordinary declutter_* call that refuses without it.
 */
import { SavedPlacesComeFirst, useHasPorchPlaces } from "./SellPorchPlaces";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { useScreenAwake } from "@/hooks/useScreenAwake";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { fetchMyPickupWindows, requestAiDraftFromPhotos, setPickupWindows, type PickupWindow, type SellerHandover } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { withRetries } from "@/lib/declutter/steadyRetry";
import {
  addPhotosToItem, addSorted, askGroup, BUNCH_MAX_PHOTOS, bulkEdit, bunchItemNeed, bunchItemProblem, bunchListable, bunchNeedsLine, draftsLeftBehind, dropItem, editBunchItem, GROUP_BATCH, groupPhotos, joinSorted, keepCleanablePhotos, listBunch, makeCover, mergeItems, mergePriceClash, movePhoto, movePhotoWithin, notSortedPile, photosInItems, removeBunchDraft, rewrittenPrice, splitItem, startBunchRun, takePhotoOff, unreadyFirst, unusablePhotosNote, watchBunchRun,
  type BunchItem, type BunchOutcome, type BunchPhoto, type BunchRunWatcher, type PhotoProgress,
} from "@/lib/declutter/bunch";
import { louisianaToday, moveDateProblem } from "@/lib/declutter/moves";
import { DeclutterNotice } from "./declutterUi";
import { SellerAddressField } from "./SellerAddressField";
import { AREA_ADDRESS_RE, NO_CITY_IN_ADDRESS } from "./sellForm";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { BunchCard, bunchItemName } from "./DeclutterBunchCard";
import { BunchPileCard } from "./DeclutterBunchPile";
import { BunchMovingSale } from "./DeclutterBunchMovingSale";
import { BunchResults } from "./DeclutterBunchResults";
import { BunchRow } from "./DeclutterBunchRow";
import { BunchFeeGate, useSetupFeeDueCents } from "./BunchFeeGate";
import { BunchDraftsSection } from "./BunchDraftsSection";
import { useBunchSaved } from "./useBunchSaved";
import { samePickupWindows, useBunchChoices } from "./BunchChoices";
import { useBunchStartingPlace } from "./useBunchStartingPlace";
import { BunchBar, type BunchUndo } from "./DeclutterBunchBar";
import { BunchListStep } from "./DeclutterBunchListStep";
import { BunchSection } from "./DeclutterBunchSection";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { useSortingThumbs } from "./useBunchThumbs";
import { useBunchStager } from "./useBunchStager";
import { BunchIntake } from "./DeclutterBunchIntake";
import { ReadingPhotos } from "./SellProgress";

const input = "h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15";

let photoSeq = 0;

function PlacesComeFirstLine() {
  return useHasPorchPlaces() ? <SavedPlacesComeFirst free={false} /> : null;
}

export default function BunchFlow({ moving = false }: { moving?: boolean }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const { underAge } = useAgeGate();
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  const feeDue = useSetupFeeDueCents();
  const [listingDrafts, setListingDrafts] = useState(false);

  const [areaLabel, setAreaLabel] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const place = useExactAddressPoint();
  const coords = place.point;
  const [moveDate, setMoveDate] = useState("");
  const movingOpen = useFeature("declutter_moving_out");
  const today = louisianaToday();
  const [undo, setUndo] = useState<BunchUndo | null>(null);
  // Rows open by the seller's tap; one with something to read (a flag, a photo that failed, a merge suggestion) starts open.
  const [openRows, setOpenRows] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [found, setFound] = useState(0);
  const runNames = useRef<string[]>([]);
  const [photos, setPhotos] = useState<BunchPhoto[]>([]);
  const [items, setItems] = useState<BunchItem[]>([]);
  const [sorting, setSorting] = useState<{ done: number; total: number; retrying?: boolean } | null>(null);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [rewriteNote, setRewriteNote] = useState<{ key: string; text: string } | null>(null);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  const [ways, setWays] = useState<SellerHandover[]>(["porch"]);
  // One tick for the four statements covers the whole run (owner 2026-10-30); attestItem still records all four per item.
  const [attested, setAttested] = useState(false);
  const [listing, setListing] = useState<{ done: number; total: number } | null>(null);
  const [photoProgress, setPhotoProgress] = useState<PhotoProgress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<BunchOutcome[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // LEAD-BUNCH-34-SLOW: while sorting, each photo's thumbnail is its small copy, shown the moment it is made (no second
  // decode of the full photo); "Adding N of M" counts them. The preview maker fills in the rest once sorting is done.
  const [adding, setAdding] = useState<{ ready: number; total: number } | null>(null);
  const [thumbs, setCopyUrls] = useSortingThumbs(photos, !!sorting);
  // Photos of listed and dropped items stop counting toward the cap. Not mid-sort: a batch's photos aren't in an item yet.
  useEffect(() => {
    if (!sorting) setPhotos((ps) => photosInItems(ps, items));
  }, [items, sorting]);
  const files = useMemo(() => new Map(photos.map((p) => [p.key, p.file])), [photos]);
  const stager = useBunchStager(user?.id, items, files, !!listing, setItems); // LEAD-BUNCH-34-SLOW early upload
  const [askingStartOver, setAskingStartOver] = useState(false);
  useScreenAwake(!!sorting || !!listing || listingDrafts);
  const saved = useBunchSaved(
    user?.id,
    { areaLabel, pickupAddress, coords, moveDate, photos, items, sorting: !!sorting, finished: !!results && items.length === 0 },
    setItems,
    (back) => {
      setAreaLabel(back.areaLabel);
      setPickupAddress(back.pickupAddress);
      place.setPoint(back.coords);
      setMoveDate(back.moveDate);
      setPhotos(back.photos);
      setItems(back.items);
      setSortNote(unusablePhotosNote(back.unusable));
    },
  );
  const draftsOnTheList = useMemo(() => new Set(items.flatMap((it) => (it.draftId ? [it.draftId] : []))), [items]);
  const [pricedDraftsOffered, setPricedDraftsOffered] = useState(false);

  // A run outlives this screen (the back link). Coming back during one shows it and takes it over; it never starts a second.
  const runDone = useRef<BunchRunWatcher["onDone"]>(() => {});
  const runStep = useRef(saved.applyStep);
  runStep.current = saved.applyStep;
  const watcher = useMemo<BunchRunWatcher>(() => ({
    onProgress: (done, total) => setListing({ done, total }),
    onStep: (key, patch) => runStep.current(key, patch),
    onDone: (result) => runDone.current(result),
    onPhoto: setPhotoProgress,
  }), []);
  useEffect(() => {
    if (!user?.id) return;
    const running = watchBunchRun(user.id, watcher);
    if (running) setListing(running);
  }, [user?.id, watcher]);

  const choices = useBunchChoices(user?.id, setWays);
  const savedWindows = useQuery({ queryKey: ["declutter", "windows", user?.id], queryFn: () => fetchMyPickupWindows(user!.id), enabled: !!user });
  const windowsLoaded = useRef(false);
  useEffect(() => {
    const saved = savedWindows.data ?? [];
    if (windowsLoaded.current || !savedWindows.isSuccess) return;
    windowsLoaded.current = true;
    if (saved.length > 0) setWindows(saved.map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) })));
  }, [savedWindows.data, savedWindows.isSuccess]);

  const savedSetup = useBunchStartingPlace(user?.id, setAreaLabel, setPickupAddress, place.setPoint);

  if (!user) return null;
  if (underAge) {
    return (
      <AppPage title="Sell a bunch" backTo="/declutter?view=selling">
        <DeclutterNotice tone="warn" title="You must be 18 or older to sell on Declutter.">
          You can still look around. Selling opens when your birthday on file says you're 18.
        </DeclutterNotice>
      </AppPage>
    );
  }

  const placeProblem =
    pickupAddress.trim().length < 5 ? "Add the pickup address. Buyers only see it after they pay."
      : areaLabel.trim().length < 2 || AREA_ADDRESS_RE.test(areaLabel) ? NO_CITY_IN_ADDRESS
        : null;
  // The setup gate (SellerSetup) has them save it first; the boxes are only for a saved address that stopped reading.
  const whereFolded = !!savedSetup.pickup && !placeProblem && pickupAddress.trim() === savedSetup.pickup.address;
  const firstStep = whereFolded ? 1 : 2;
  // While the setup fee is due only free items can go (the server asks no fee at price 0); priced ones stay on the list.
  const ready = bunchListable(items, feeDue != null);
  const heldForFee = feeDue != null ? bunchListable(items, false).length - ready.length : 0;
  const savedWays = ways.filter((w) => w !== "delivery" && (w !== "seller_delivery" || sellerDeliveryOpen));
  const busy = !!sorting || !!listing || listingDrafts;
  const blocked = busy;

  /** Where the price suggestions look: the located address, or none. A failed lookup never stops the photos. */
  async function hintPoint(): Promise<{ lat: number; lng: number } | null> {
    if (pickupAddress.trim().length < 5) return null;
    try {
      const c = await place.locate(pickupAddress);
      return { lat: c.lat, lng: c.lng };
    } catch (err) {
      console.warn("[declutter] could not locate the pickup address for price suggestions", err);
      return null;
    }
  }

  async function onPhotos(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (fileRef.current) fileRef.current.value = "";
    if (picked.length === 0) return;
    const room = BUNCH_MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setSortNote(`That's the most for one go (${BUNCH_MAX_PHOTOS} photos). List these first, then start another.`);
      return;
    }
    const added = picked.slice(0, room).map((file) => ({ key: `ph${Date.now().toString(36)}_${++photoSeq}`, file }));
    setPhotos((ps) => [...ps, ...added]);
    setSortNote(picked.length > room ? `Only the first ${room} were added: one go takes up to ${BUNCH_MAX_PHOTOS} photos.` : null);
    await sortPhotos(added);
  }

  /** Sort these photos. Each batch's items reach the list as it finishes; what can't be sorted comes back together, with why. */
  async function sortPhotos(batch: BunchPhoto[]) {
    setSorting({ done: 0, total: Math.ceil(batch.length / GROUP_BATCH) });
    setFound(0);
    setAdding({ ready: 0, total: batch.length });
    try {
      // LEAD-BUNCH-34-SLOW: the photos start being made ready now; the address check runs beside them, not before them.
      const at = hintPoint();
      const res = await groupPhotos(batch, (done, total, made) => {
        setSorting({ done, total });
        setFound((n) => n + made.length);
        // Items just came in, so "before" would lose them.
        if (made.length > 0) setUndo(null);
        setItems((its) => addSorted(its, made));
      }, async (cleaned) => askGroup(cleaned, await at), undefined, undefined, undefined, {
        onRetry: () => setSorting((s) => (s ? { ...s, retrying: true } : s)),
        onJoined: (into, from) => setItems((its) => joinSorted(its, into, from)),
        onCleaned: (key, copy) => {
          setAdding((a) => (a ? { ...a, ready: a.ready + 1 } : a));
          if (copy) setCopyUrls((m) => new Map(m).set(key, URL.createObjectURL(copy)));
        },
      });
      // A photo that couldn't be read is kept, with why, in a pile the seller can Sort again (it is read again then).
      if (res.unusable.length > 0) {
        const n = res.unusable.length;
        setItems((its) => addSorted(its, [notSortedPile(res.unusable.map((u) => u.key), `We couldn't read ${n === 1 ? "this photo" : `these ${n} photos`}. Tap Sort again to try once more.`)]));
      }
      const n = res.failed.reduce((s, f) => s + f.photos, 0);
      const notSorted = n > 0 ? `${n} ${n === 1 ? "photo isn't" : "photos aren't"} sorted yet: ${declutterErrorMessage(res.failed[0].error)} ${n === 1 ? "It's" : "They're"} kept together below. Tap Sort again.` : null;
      const note = [notSorted, unusablePhotosNote(res.unusable)].filter(Boolean).join(" ");
      if (note) setSortNote(note);
    } finally {
      setSorting(null);
      setAdding(null);
    }
  }

  /** The pile, sorted again. It leaves the list while it goes; whatever still can't be sorted comes back as a pile. */
  async function onSortAgain(key: string) {
    const pile = items.find((it) => it.key === key);
    if (!pile) return;
    const batch = pile.photoKeys.flatMap((k) => {
      const file = files.get(k);
      return file ? [{ key: k, file }] : [];
    });
    setSortNote(null);
    setUndo(null);
    setItems((its) => its.filter((it) => it.key !== key));
    await sortPhotos(batch);
  }

  /**
   * A change that can be undone: the words say what happened, and Undo puts the list and photos back. A draft it leaves
   * with no item comes off the server at once, or it would stay under Selling; Undo then makes a new one at listing.
   */
  function regroup(change: (its: BunchItem[]) => BunchItem[], said: string, otherPrice?: BunchUndo["otherPrice"]) {
    const next = change(items);
    setItems(next);
    setUndo({ said, before: items, photos, otherPrice });
    for (const { id, item } of draftsLeftBehind(items, next)) void takeDownDraft(id, item);
  }

  function onUndo() {
    if (!undo) return;
    const gone = new Set(draftsLeftBehind(undo.before, items).map((d) => d.id));
    setPhotos(undo.photos);
    setItems(undo.before.map((it) => (it.draftId && gone.has(it.draftId) ? { ...it, draftId: undefined, uploaded: undefined } : it)));
    setUndo(null);
  }

  function nameOf(key: string): string {
    const i = items.findIndex((it) => it.key === key);
    return i < 0 ? "that item" : bunchItemName(items[i], i);
  }

  /** Open a row and go to the field it needs. */
  function jumpTo(key: string) {
    const it = items.find((x) => x.key === key);
    const need = it ? bunchItemNeed(it) : null;
    setOpenRows((m) => new Map(m).set(key, true));
    const id = need === "name" ? `title-${key}` : need === "size" ? `size-${key}` : need === "photos" ? `add-photo-${key}` : `price-${key}`;
    requestAnimationFrame(() => {
      const el = document.getElementById(id) ?? document.querySelector(`[data-bunch-row="${key}"]`);
      (el as HTMLElement | null)?.focus();
      el?.scrollIntoView?.({ block: "center" });
    });
  }

  /** Photos added to one item, straight on, without the photo tool. One that can't be used is named and left out. */
  async function onAddPhotos(key: string, list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const room = BUNCH_MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setSortNote(`That's the most for one go (${BUNCH_MAX_PHOTOS} photos). List these first, then start another.`);
      return;
    }
    const added = picked.slice(0, room).map((file) => ({ key: `ph${Date.now().toString(36)}_${++photoSeq}`, file }));
    const { photos: usable, unusable } = await keepCleanablePhotos(added, []);
    setSortNote(unusablePhotosNote(unusable));
    if (usable.length === 0) return;
    setPhotos((ps) => [...ps, ...usable]);
    setItems((its) => addPhotosToItem(its, key, usable.map((p) => p.key)));
  }

  async function takeDownDraft(id: string, item: BunchItem) {
    const name = item.title.trim() || "that item";
    try {
      const done = await removeBunchDraft(id);
      // Undo must not bring back an item that is already up.
      if (done === "already_listed") setUndo(null);
      if (done === "already_listed") setSortNote(`"${name}" was already listed, so it's still up. You can take it down under Selling.`);
    } catch (err) {
      // Not silent: the draft is still under Selling, and the seller is told, with the reason, where to take it down.
      setSortNote(`We couldn't remove the draft of "${name}": ${declutterErrorMessage(err)} You can take it down under Selling.`);
    } finally {
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  /** The photo tool writes this item. `keepTyped`: it fills only what the seller hasn't touched (a split, on its own). */
  async function writeItem(it: BunchItem, name: string, keepTyped: boolean) {
    const key = it.key;
    setRewriting(key);
    setRewriteNote(null);
    try {
      const point = await hintPoint();
      const d = await withRetries(() => requestAiDraftFromPhotos(it.photoKeys.map((k) => files.get(k)!).filter(Boolean), point), { delays: [4_000] });
      setItems((its) => its.map((x) => {
        if (x.key !== key) return x;
        const words = keepTyped && x.edited ? {} : { title: d.title, description: d.description };
        return { ...x, ...words, category: d.category, deliverySize: d.deliverySize, sizeUnknown: false, conditionStars: d.conditionStars, flagged: d.flagged !== false, ...rewrittenPrice(x, d.priceDollars) };
      }));
    } catch (err) {
      // Not silent: the reason is shown on its card; the seller can try again or fill the item in themselves.
      setRewriteNote({ key, text: `We couldn't write "${name}": ${declutterErrorMessage(err)}` });
    } finally {
      setRewriting(null);
    }
  }

  async function onRewrite(key: string) {
    const it = items.find((x) => x.key === key);
    if (it) await writeItem(it, bunchItemName(it, items.indexOf(it)), false);
  }

  /** The split-off item is a different thing: it gets its own words without another tap. */
  function onSplit(key: string, photoKeys: string[]) {
    const next = splitItem(items, key, photoKeys);
    setItems(next);
    setUndo(null);
    const had = new Set(items.map((x) => x.key));
    const made = next.find((x) => !had.has(x.key));
    if (made) {
      setOpenRows((m) => new Map(m).set(made.key, true));
      void writeItem(made, `Item ${next.indexOf(made) + 1}`, true);
    }
  }

  function onMerge(fromKey: string, intoKey: string) {
    const other = mergePriceClash(items, fromKey, intoKey);
    const said = `Merged ${nameOf(fromKey)} into ${nameOf(intoKey)}.`;
    regroup((its) => mergeItems(its, fromKey, intoKey), said, other ? { intoKey, price: other } : undefined);
  }

  // LEAD-BUNCH-REMOVE-PCT (owner 10-31): no bulk-edit box; each item is edited on its own (tap to open, price on its row).
  /** Lists every ready item, or just `only`: the one whose photo is being tried again. */
  async function onListAll(only?: BunchItem) {
    setProblem(null);
    const toList = only ? [only] : ready;
    const p = placeProblem
      ?? (savedWays.length === 0 ? "Tick at least one way buyers can get your items." : null)
      ?? (moveDate ? moveDateProblem(moveDate, today) : null)
      ?? (!attested ? "Tick the box under the four statements before you list these items." : null)
      ?? (only ? bunchItemProblem(only) : null)
      ?? (toList.length === 0 ? "No item is ready to list yet." : null);
    if (p) {
      setProblem(p);
      // Beside the thing it's about, so the seller isn't left hunting up the page.
      const at = p === placeProblem ? "bunch-address" : !attested ? "bunch-tax" : moveDate && p === moveDateProblem(moveDate, today) ? "bunch-move-date" : null;
      if (at) document.getElementById(at)?.focus();
      return;
    }
    setUndo(null);
    runNames.current = toList.map((it) => it.title);
    const total = toList.length * 2;
    setListing({ done: 0, total });
    const started = startBunchRun(user!.id, watcher, total, async (onProgress, onStep, onPhoto) => {
      const c = await place.locate(pickupAddress);
      // Only a change is saved: the times on screen may be older than the seller's saved ones (another tab, Settings).
      if (!samePickupWindows(windows, savedWindows.data ?? [])) await setPickupWindows(windows);
      return listBunch(
        user!.id, toList, files,
        { areaLabel: areaLabel.trim(), pickupAddress: pickupAddress.trim(), pickupLat: c.lat, pickupLng: c.lng },
        savedWays, onProgress, undefined, onStep, { ...choices.choices, moveOutOn: moveDate || null }, onPhoto, stager ?? undefined,
      );
    });
    if (!started) {
      setListing(null);
      setProblem("Your last listing run is still going. Wait for it to finish, then try again.");
    }
  }

  runDone.current = (result) => {
    if ("out" in result) {
      setResults(result.out);
      if (result.out.some((o) => "status" in o)) void choices.remember(savedWays);
      // Listed items and items refused at publish leave the list (that draft is finished under Selling);
      // an item that failed getting ready stays with its photos, to fix and try again.
      const gone = new Set(result.out.filter((o) => "status" in o || !o.stays).map((o) => o.key));
      setItems((its) => its.filter((it) => !gone.has(it.key)));
      // LEAD-RESUME-REPOSTS: the moment the post leaves nothing on the list, the kept work goes, so it is never offered back.
      if (items.every((it) => gone.has(it.key))) saved.clearSaved();
    } else {
      // Not silent: the address, pickup-times or listing refusal is shown beside the button (role="alert"),
      // and the items stay on screen to try again.
      setProblem(declutterErrorMessage(result.error));
    }
    setListing(null);
    setPhotoProgress(null);
    void qc.invalidateQueries({ queryKey: ["declutter"] });
  };

  function startOver() {
    setPhotos([]);
    setItems([]);
    setResults(null);
    setSortNote(null);
    setProblem(null);
    setAskingStartOver(false);
    saved.clearSaved();
  }

  const others = (key: string) => {
    const names = items.map((it, i) => bunchItemName(it, i));
    return items.flatMap((it, i) => (it.key === key || it.notSorted ? [] : [{ key: it.key, name: names.filter((n) => n === names[i]).length > 1 ? `${names[i]} (${i + 1})` : names[i], photoKey: it.photoKeys[0] }]));
  };
  const needs = bunchNeedsLine(items);
  const firstUnready = items.find((it) => bunchItemNeed(it));
  const showMove = movingOpen && (moving || !!moveDate);
  const pageTitle = moving ? "Moving out sale" : "Sell a bunch";
  const toListing = () => {
    const el = document.getElementById("bunch-list-step");
    el?.focus();
    el?.scrollIntoView?.({ block: "start" });
  };
  const startsOpen = (it: BunchItem) => it.flagged || !!it.failedPhoto || !!it.mergeHint;
  const isRowOpen = (it: BunchItem) => openRows.get(it.key) ?? startsOpen(it);

  return (
    <AppPage title={pageTitle} backTo="/declutter?view=selling">
      <p className="text-sm text-muted-foreground">
        Add photos of everything you want to sell. We sort them into items and write each listing. You check them all, then list them together.
      </p>
      {results && <BunchResults results={results} userId={user.id} inSale={!!moveDate} onFix={jumpTo} onListMore={() => { setResults(null); document.getElementById("bunch-files")?.focus(); }} />}
      <SellerPayoutPrompt />
      {feeDue != null && <BunchFeeGate cents={feeDue} />}
      <BunchDraftsSection userId={user.id} exclude={draftsOnTheList} busy={busy} feeDue={feeDue != null} onBusy={setListingDrafts} attested={attested} setAttested={setAttested} listStepShown={items.length > 0} onPricedOffered={setPricedDraftsOffered} />

      {saved.note && <p className="text-sm text-foreground" role="alert" data-bunch-not-saved="">{saved.note}</p>}
      {saved.restoredCount > 0 && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm" role="status" data-bunch-restored="">
          <p className="min-w-0 flex-1">We kept your work from last time: {saved.restoredCount} {saved.restoredCount === 1 ? "item" : "items"}, with their photos{items.some((it) => it.price.trim() !== "") ? " and prices" : ""}.</p>
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => setAskingStartOver(true)}>Start over</Button>
        </div>
      )}
      <ConfirmSheet open={askingStartOver} title="Start over?" confirmLabel="Start over" onConfirm={startOver} onClose={() => setAskingStartOver(false)} testId="bunch-start-over">
        Your photos, item details and prices on this page are removed from this device. Listings you already posted stay up.
      </ConfirmSheet>

      {showMove && <BunchMovingSale userId={user.id} date={moveDate} setDate={setMoveDate} today={today} />}

      {whereFolded ? null : (
      <BunchSection id="bunch-where" title="1. Where buyers pick up">
        {/* Q2492: the same rule and words as the one-item form; the server's rule is the same (declutter_start_checkout). */}
        <PlacesComeFirstLine />
        <label className="block text-sm font-medium" htmlFor="bunch-address">Pickup address</label>
        <SellerAddressField id="bunch-address" ariaLabel="Pickup address" className={input} value={pickupAddress} place={place}
          onChange={(a, city) => { setPickupAddress(a); setAreaLabel(city); }} onBlurred={() => {
            if (pickupAddress.trim().length < 5) return;
            // Early, for the note under the address and the price hints. A failure is said at "List": nothing was asked for yet.
            place.locate(pickupAddress).catch((e: unknown) => console.warn("[bunch] address check on blur:", e instanceof Error ? e.message : "unknown"));
          }} />
        <AddressNeedsExactSpot typedAddress={pickupAddress} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} />
        <p className="text-xs text-muted-foreground">It's the same for every item. Only the buyer who pays sees the address.</p>
      </BunchSection>
      )}

      <BunchSection id="bunch-photos" title={`${firstStep}. Add photos`}>
        <p className="text-xs text-muted-foreground">
          Pick them all at once, up to {BUNCH_MAX_PHOTOS}. Take a few of each thing, one thing at a time. Smaller copies, with location data removed, are sent to sort them and write your listings. Nothing is saved or shown to buyers until you list.
        </p>
        <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" id="bunch-files" aria-label="Add photos" disabled={blocked} onChange={(e) => void onPhotos(e.target.files)} />
        {blocked ? (
          <Button type="button" variant="outline" size="sm" disabled>Add photos</Button>
        ) : (
          <Button asChild variant="outline" size="sm" className="cursor-pointer">
            <label htmlFor="bunch-files">{photos.length > 0 ? "Add more photos" : "Add photos"}</label>
          </Button>
        )}
        {sorting && <ReadingPhotos adding={adding} sorting={sorting} found={found} />}
        {sorting && (
          <BunchIntake keys={photos.filter((p) => !items.some((it) => it.photoKeys.includes(p.key))).map((p) => p.key)} urls={thumbs}
            ready={adding?.ready ?? 0} total={adding?.total ?? 0} />
        )}
        {sortNote && <p className="text-sm text-foreground" role="alert" data-bunch-note="">{sortNote}</p>}
      </BunchSection>

      {items.length > 0 && (
        <BunchSection id="bunch-check" title={`${firstStep + 1}. Check each item (${ready.length + heldForFee} of ${items.length} ready)`}>
          <p className="text-xs text-muted-foreground">
            Fix anything we got wrong. Tap an item to open it. If two items are the same thing, merge them; if one holds two things, split it.
          </p>
          {/* Nothing on a card can change while a run works on it: a draft dropped mid-run would be listed or lost. */}
          <fieldset disabled={!!listing || listingDrafts} className="contents">
          <ul className="space-y-2">
            {items.map((it, i) => it.notSorted ? (
              <BunchPileCard
                key={it.key}
                item={it}
                urls={thumbs}
                busy={busy}
                onSortAgain={() => void onSortAgain(it.key)}
                onOneItem={() => { setOpenRows((m) => new Map(m).set(it.key, true)); setItems((its) => editBunchItem(its, it.key, { notSorted: false, sortReason: undefined })); }}
                onDrop={() => regroup((its) => dropItem(its, it.key), `Removed ${it.photoKeys.length} ${it.photoKeys.length === 1 ? "photo" : "photos"}.`)}
              />
            ) : (
              <BunchRow
                key={it.key}
                item={it}
                index={i}
                url={thumbs.get(it.photoKeys[0])}
                open={isRowOpen(it)}
                canDrop={!listing && !listingDrafts}
                onPhotoDrop={(k) => regroup((its) => movePhoto(its, k, it.key), `Moved a photo to ${nameOf(it.key)}.`)}
                nextPriceId={items.slice(i + 1).find((x) => !x.free && !x.notSorted) ? `price-${items.slice(i + 1).find((x) => !x.free && !x.notSorted)!.key}` : null}
                onToggleOpen={() => setOpenRows((m) => new Map(m).set(it.key, !isRowOpen(it)))}
                onPrice={(price) => { setUndo(null); setItems((its) => editBunchItem(its, it.key, { price })); }}
              >
                <BunchCard
                  item={it}
                  offersDefault={choices.choices.acceptsOffers}
                  index={i}
                  others={others(it.key)}
                  urls={thumbs}
                  files={files}
                  at={coords}
                  rewriting={rewriting === it.key}
                  rewriteNote={rewriteNote?.key === it.key ? rewriteNote.text : null}
                  onChange={(patch) => { setUndo(null); setOpenRows((m) => new Map(m).set(it.key, true)); setItems((its) => editBunchItem(its, it.key, patch)); }}
                  onMove={(keys, to) => regroup((its) => keys.reduce((acc, k) => movePhoto(acc, k, to), its), `Moved ${keys.length === 1 ? "a photo" : `${keys.length} photos`} to ${nameOf(to)}.`)}
                  onSplit={(keys) => onSplit(it.key, keys)}
                  onRemovePhoto={(k) => regroup((its) => takePhotoOff(its, it.key, k), it.photoKeys.length === 1 ? `Removed ${nameOf(it.key)}: that was its last photo.` : "Photo removed.")}
                  onCover={(k) => setItems((its) => makeCover(its, it.key, k))}
                  onReorder={(k, before) => setItems((its) => movePhotoWithin(its, it.key, k, before))}
                  canDrag={!listing && !listingDrafts}
                  onAddPhotos={(list) => void onAddPhotos(it.key, list)}
                  onMerge={(into) => onMerge(it.key, into)}
                  onDrop={() => regroup((its) => dropItem(its, it.key), `Removed ${nameOf(it.key)}.`)}
                  onRewrite={() => void onRewrite(it.key)}
                  onRetryUpload={() => void onListAll(it)}
                />
              </BunchRow>
            ))}
          </ul>
          </fieldset>
        </BunchSection>
      )}

      {items.length > 0 && (
        <BunchListStep
          step={firstStep + 2} items={items} pricedDraftsOffered={pricedDraftsOffered} readyCount={ready.length} heldForFee={heldForFee} savedSetup={savedSetup} savedWindows={savedWindows} savedWays={savedWays} windows={windows} setWindows={setWindows}
          choices={choices} ways={ways} setWays={setWays} sellerDeliveryOpen={sellerDeliveryOpen} attested={attested} setAttested={setAttested} problem={problem} blocked={blocked} listing={!!listing} photoProgress={photoProgress} listingProgress={listing} runNames={runNames.current} onList={() => void onListAll()}
        />
      )}

      <BunchBar sorting={sorting} found={found} listing={listing} runNames={runNames.current} undo={undo} itemCount={items.length} readyCount={ready.length} needs={needs} onNeeds={firstUnready ? () => { setItems(unreadyFirst); jumpTo(firstUnready.key); } : null} onNext={toListing} onUndo={onUndo}
        onUseOtherPrice={() => { const { intoKey, price } = undo!.otherPrice!; setItems((its) => bulkEdit(its, new Set([intoKey]), { price })); setUndo({ ...undo!, otherPrice: undefined }); }} />
    </AppPage>
  );
}
