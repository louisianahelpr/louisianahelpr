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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { useScreenAwake } from "@/hooks/useScreenAwake";
import { geocodeAddress } from "@/lib/geocode";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { fetchMyPickupWindows, requestAiDraftFromPhotos, setPickupWindows, type PickupWindow, type SellerHandover } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  addPhotosToItem, askGroup, BUNCH_MAX_PHOTOS, BUNCH_SECONDS_EACH, bulkEdit, bunchItemNeed, bunchListable, bunchListingMinutes, bunchNeedsLine, draftsLeftBehind, dropItem, editBunchItem, GROUP_BATCH, groupPhotos, keepCleanablePhotos, listBunch, listingProgressLine, makeCover, mergeItems, mergePriceClash, movePhoto, percentOffSuggested, photosInItems, removeBunchDraft, rewrittenPrice, sortProgressLine, splitItem, startBunchRun, takePhotoOff, unusablePhotosNote, watchBunchRun,
  type BunchItem, type BunchOutcome, type BunchPhoto, type BunchRunWatcher,
} from "@/lib/declutter/bunch";
import { louisianaToday, moveDateProblem } from "@/lib/declutter/moves";
import { DeclutterNotice, TaxStatementsCheck } from "./declutterUi";
import { AREA_ADDRESS_RE } from "./sellForm";
import { PickupTimesEditor, pickupWindowsProblem, windowsSummary } from "./DeclutterPickupTimes";
import { handoverSummary, SellHandoverChoices } from "./SellHandoverChoices";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { BunchCard, bunchItemName } from "./DeclutterBunchCard";
import { BunchBulk } from "./DeclutterBunchBulk";
import { BunchMovingSale } from "./DeclutterBunchMovingSale";
import { BunchResults } from "./DeclutterBunchResults";
import { BunchRow } from "./DeclutterBunchRow";
import { BunchFeeGate, useSetupFeeDueCents } from "./BunchFeeGate";
import { BunchDraftsSection } from "./BunchDraftsSection";
import { useBunchSaved } from "./useBunchSaved";
import { BunchChoicesCard, bunchDropsLine, samePickupWindows, useBunchChoices } from "./BunchChoices";
import { UsesSettingsNote } from "./SellLastSetup";
import { useSavedPickup } from "./useSavedPickup";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { useBunchThumbs } from "./useBunchThumbs";

const input = "h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

let photoSeq = 0;

/** The last change that can be taken back: what the list and photos were, and what to say about it. */
interface BunchUndo {
  said: string;
  before: BunchItem[];
  photos: BunchPhoto[];
  /** A merge set aside a price the seller typed: offered here, as a choice. */
  otherPrice?: { intoKey: string; price: string };
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
  const [coords, setCoords] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const movingOpen = useFeature("declutter_moving_out");
  const today = louisianaToday();
  const [undo, setUndo] = useState<BunchUndo | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  // Rows open by the seller's tap; a flagged item starts open, so its notice is read.
  const [openRows, setOpenRows] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [found, setFound] = useState(0);
  const runNames = useRef<string[]>([]);
  const [photos, setPhotos] = useState<BunchPhoto[]>([]);
  const [items, setItems] = useState<BunchItem[]>([]);
  const [sorting, setSorting] = useState<{ done: number; total: number } | null>(null);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  const [ways, setWays] = useState<SellerHandover[]>(["porch"]);
  // One tick for the four statements covers the whole run (owner 2026-10-30); attestItem still records all four per item.
  const [attested, setAttested] = useState(false);
  const [listing, setListing] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<BunchOutcome[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const thumbs = useBunchThumbs(photos);
  // Photos of listed and dropped items stop counting toward the cap. Not mid-sort: a batch's photos aren't in an item yet.
  useEffect(() => {
    if (!sorting) setPhotos((ps) => photosInItems(ps, items));
  }, [items, sorting]);
  const files = useMemo(() => new Map(photos.map((p) => [p.key, p.file])), [photos]);
  const [askingStartOver, setAskingStartOver] = useState(false);
  useScreenAwake(!!sorting || !!listing || listingDrafts);
  const saved = useBunchSaved(
    user?.id,
    { areaLabel, pickupAddress, coords, moveDate, photos, items, sorting: !!sorting, finished: !!results && items.length === 0 },
    setItems,
    (back) => {
      setAreaLabel(back.areaLabel);
      setPickupAddress(back.pickupAddress);
      setCoords(back.coords);
      setMoveDate(back.moveDate);
      setPhotos(back.photos);
      setItems(back.items);
      setSortNote(unusablePhotosNote(back.unusable));
    },
  );
  const draftsOnTheList = useMemo(() => new Set(items.flatMap((it) => (it.draftId ? [it.draftId] : []))), [items]);

  // A run outlives this screen (the back link). Coming back during one shows it and takes it over; it never starts a second.
  const runDone = useRef<BunchRunWatcher["onDone"]>(() => {});
  const runStep = useRef(saved.applyStep);
  runStep.current = saved.applyStep;
  const watcher = useMemo<BunchRunWatcher>(() => ({
    onProgress: (done, total) => setListing({ done, total }),
    onStep: (key, patch) => runStep.current(key, patch),
    onDone: (result) => runDone.current(result),
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

  // The area and pickup address start from the seller's last listing (the single form's "Remember my setup": the
  // same read and cache entry). Applied once, only to a box still blank. A failed read is extra help lost, not a
  // blocker: the boxes start blank, and the app's QueryCache reports the error.
  const lastSetup = useQuery({ queryKey: ["declutter", "last-setup", user?.id], queryFn: () => fetchLastSetup(user!.id), enabled: !!user, staleTime: 60_000 });
  // Saved settings are the source once they exist (owner 2026-10-30, "I don't need to keep adding it every time"):
  // they replace what the last listing filled in, never what the seller typed or a bunch that came back.
  const savedSetup = useSavedPickup(user?.id, (p, lastAddress) => {
    const mine = (address: string) => !address.trim() || address === lastAddress;
    setPickupAddress((a) => (mine(a) ? p.address : a));
    setAreaLabel((a) => (!a.trim() || a === lastSetup.data?.areaLabel ? p.areaLabel : a));
    setCoords((c) => (!c || mine(c.address) ? { lat: p.lat, lng: p.lng, address: p.address } : c));
  });
  const placeLoaded = useRef(false);
  useEffect(() => {
    const s = lastSetup.data;
    if (!s || placeLoaded.current) return;
    placeLoaded.current = true;
    setAreaLabel((a) => (a.trim() ? a : s.areaLabel));
    if (!s.pickup) return;
    setPickupAddress((a) => (a.trim() ? a : s.pickup!.address));
    setCoords((c) => c ?? { ...s.pickup! });
  }, [lastSetup.data]);

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
    areaLabel.trim().length < 2 ? "Add your neighborhood or town."
      : AREA_ADDRESS_RE.test(areaLabel) ? "Use your neighborhood or town for the area, not a street address."
        : pickupAddress.trim().length < 5 ? "Add the pickup address. Buyers only see it after they pay."
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

  async function locate(): Promise<{ lat: number; lng: number } | null> {
    const address = pickupAddress.trim();
    if (coords && coords.address === address) return coords;
    const g = await geocodeAddress(address);
    if (!g) return null;
    const c = { lat: g.latitude, lng: g.longitude, address };
    setCoords(c);
    return c;
  }

  /** Where the price suggestions look: the located address, or none. A failed lookup never stops the photos. */
  async function hintPoint(): Promise<{ lat: number; lng: number } | null> {
    if (pickupAddress.trim().length < 5) return null;
    try {
      const c = await locate();
      return c ? { lat: c.lat, lng: c.lng } : null;
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
    setSorting({ done: 0, total: Math.ceil(added.length / GROUP_BATCH) });
    setFound(0);
    try {
      const at = await hintPoint();
      const res = await groupPhotos(added, (done, total, made) => {
        setSorting({ done, total });
        setFound((n) => n + made.length);
        // Items just came in, so "before" would lose them.
        if (made.length > 0) setUndo(null);
        setItems((its) => [...its, ...made]);
      }, (batch) => askGroup(batch, at));
      const n = res.failed.reduce((s, f) => s + f.photos, 0);
      const notSorted = n > 0 ? `${n} ${n === 1 ? "photo wasn't" : "photos weren't"} sorted: ${declutterErrorMessage(res.failed[0].error)} They're below as items for you to name, or tap Write it again.` : null;
      const note = [notSorted, unusablePhotosNote(res.unusable)].filter(Boolean).join(" ");
      if (note) setSortNote(note);
    } finally {
      setSorting(null);
    }
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
    try {
      const d = await requestAiDraftFromPhotos(it.photoKeys.map((k) => files.get(k)!).filter(Boolean), await hintPoint());
      setItems((its) => its.map((x) => {
        if (x.key !== key) return x;
        const words = keepTyped && x.edited ? {} : { title: d.title, description: d.description };
        return { ...x, ...words, category: d.category, deliverySize: d.deliverySize, sizeUnknown: false, conditionStars: d.conditionStars, flagged: d.flagged !== false, ...rewrittenPrice(x, d.priceDollars) };
      }));
    } catch (err) {
      // Not silent: the reason is shown above the list; the seller can fill the item in themselves.
      setSortNote(`We couldn't write "${name}" again: ${declutterErrorMessage(err)}`);
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

  /** What the bulk row changes: the chosen items, or all of them when none is chosen. */
  const bulkKeys = (): ReadonlySet<string> => {
    const live = items.filter((it) => chosen.has(it.key)).map((it) => it.key);
    return new Set(live.length > 0 ? live : items.map((it) => it.key));
  };
  const counted = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
  function onBulkPercent(pct: number) {
    const res = percentOffSuggested(items, bulkKeys(), pct);
    const skipped = res.skipped > 0 ? ` ${res.skipped} with no suggestion ${res.skipped === 1 ? "was" : "were"} left alone.` : "";
    regroup(() => res.items, `Took ${pct}% off ${counted(res.changed)}.${skipped}`);
  }

  async function onListAll() {
    setProblem(null);
    const p = placeProblem
      ?? (savedWays.length === 0 ? "Tick at least one way buyers can get your items." : null)
      ?? (moveDate ? moveDateProblem(moveDate, today) : null)
      ?? (!attested ? "Tick the box under the four statements before you list these items." : null)
      ?? (ready.length === 0 ? "No item is ready to list yet." : null);
    if (p) {
      setProblem(p);
      // Beside the thing it's about, so the seller isn't left hunting up the page.
      const at = p === placeProblem ? (areaLabel.trim().length < 2 || AREA_ADDRESS_RE.test(areaLabel) ? "bunch-area" : "bunch-address") : !attested ? "bunch-tax" : moveDate && p === moveDateProblem(moveDate, today) ? "bunch-move-date" : null;
      if (at) document.getElementById(at)?.focus();
      return;
    }
    setUndo(null);
    runNames.current = ready.map((it) => it.title);
    const total = ready.length * 2;
    setListing({ done: 0, total });
    const started = startBunchRun(user!.id, watcher, total, async (onProgress, onStep) => {
      const c = await locate();
      if (!c) throw new Error("invalid_location");
      // Only a change is saved: the times on screen may be older than the seller's saved ones (another tab, Settings).
      if (!samePickupWindows(windows, savedWindows.data ?? [])) await setPickupWindows(windows);
      return listBunch(
        user!.id, ready, files,
        { areaLabel: areaLabel.trim(), pickupAddress: pickupAddress.trim(), pickupLat: c.lat, pickupLng: c.lng },
        savedWays, onProgress, undefined, onStep, { ...choices.choices, moveOutOn: moveDate || null },
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
    } else {
      // Not silent: the address, pickup-times or listing refusal is shown beside the button (role="alert"),
      // and the items stay on screen to try again.
      setProblem(declutterErrorMessage(result.error));
    }
    setListing(null);
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
    return items
      .map((it, i) => ({ key: it.key, name: names.filter((n) => n === names[i]).length > 1 ? `${names[i]} (${i + 1})` : names[i], photoKey: it.photoKeys[0] }))
      .filter((o) => o.key !== key);
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

  return (
    <AppPage title={pageTitle} backTo="/declutter?view=selling">
      <p className="text-sm text-muted-foreground">
        Add photos of everything you want to sell. We sort them into items and write each listing. You check them all, then list them together.
      </p>
      {results && <BunchResults results={results} userId={user.id} inSale={!!moveDate} onFix={jumpTo} onListMore={() => { setResults(null); document.getElementById("bunch-files")?.focus(); }} />}
      <SellerPayoutPrompt />
      {feeDue != null && <BunchFeeGate cents={feeDue} />}
      <BunchDraftsSection userId={user.id} exclude={draftsOnTheList} busy={busy} feeDue={feeDue != null} onBusy={setListingDrafts} />

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
      <Section id="bunch-where" title="1. Where buyers pick up">
        <label className="block text-sm font-medium" htmlFor="bunch-area">Area buyers see</label>
        <input id="bunch-area" className={input} maxLength={80} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder="Mid-City, Baton Rouge" />
        <label className="block text-sm font-medium" htmlFor="bunch-address">Pickup address</label>
        <input id="bunch-address" className={input} maxLength={300} value={pickupAddress} autoComplete="street-address" placeholder="Street, city, ZIP"
          onChange={(e) => setPickupAddress(e.target.value)} onBlur={() => { if (pickupAddress.trim().length >= 5) void locate(); }} />
        <p className="text-xs text-muted-foreground">It's the same for every item. Only the buyer who pays sees the address.</p>
      </Section>
      )}

      <Section id="bunch-photos" title={`${firstStep}. Add photos`}>
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
        {sortNote && <p className="text-sm text-foreground" role="alert" data-bunch-note="">{sortNote}</p>}
      </Section>

      {items.length > 0 && (
        <Section id="bunch-check" title={`${firstStep + 1}. Check each item (${ready.length + heldForFee} of ${items.length} ready)`}>
          <p className="text-xs text-muted-foreground">
            Fix anything we got wrong. Tap an item to open it. If two items are the same thing, merge them; if one holds two things, split it.
          </p>
          {/* Nothing on a card can change while a run works on it: a draft dropped mid-run would be listed or lost. */}
          <fieldset disabled={!!listing || listingDrafts} className="contents">
          {items.length > 1 && (
            <BunchBulk
              total={items.length}
              chosen={items.filter((it) => chosen.has(it.key)).length}
              onToggleAll={(on) => setChosen(new Set(on ? items.map((it) => it.key) : []))}
              onSetPrice={(price) => { const keys = bulkKeys(); regroup((its) => bulkEdit(its, keys, { price, free: false }), `Set the price on ${counted(keys.size)}.`); }}
              onPercentOff={onBulkPercent}
              onFree={() => { const keys = bulkKeys(); regroup((its) => bulkEdit(its, keys, { free: true }), `Made ${counted(keys.size)} free.`); }}
              onCondition={(conditionStars) => { const keys = bulkKeys(); regroup((its) => bulkEdit(its, keys, { conditionStars }), `Set the condition on ${counted(keys.size)}.`); }}
            />
          )}
          <ul className="space-y-2">
            {items.map((it, i) => (
              <BunchRow
                key={it.key}
                item={it}
                index={i}
                url={thumbs.get(it.photoKeys[0])}
                open={openRows.get(it.key) ?? it.flagged}
                chosen={chosen.has(it.key)}
                nextPriceId={items.slice(i + 1).find((x) => !x.free) ? `price-${items.slice(i + 1).find((x) => !x.free)!.key}` : null}
                onToggleOpen={() => setOpenRows((m) => new Map(m).set(it.key, !(m.get(it.key) ?? it.flagged)))}
                onToggleChosen={(on) => setChosen((c) => { const n = new Set(c); if (on) n.add(it.key); else n.delete(it.key); return n; })}
                onPrice={(price) => { setUndo(null); setItems((its) => editBunchItem(its, it.key, { price })); }}
              >
                <BunchCard
                  item={it}
                  index={i}
                  others={others(it.key)}
                  urls={thumbs}
                  files={files}
                  at={coords}
                  rewriting={rewriting === it.key}
                  onChange={(patch) => { setUndo(null); setOpenRows((m) => new Map(m).set(it.key, true)); setItems((its) => editBunchItem(its, it.key, patch)); }}
                  onMove={(keys, to) => regroup((its) => keys.reduce((acc, k) => movePhoto(acc, k, to), its), `Moved ${keys.length === 1 ? "a photo" : `${keys.length} photos`} to ${nameOf(to)}.`)}
                  onSplit={(keys) => onSplit(it.key, keys)}
                  onRemovePhoto={(k) => regroup((its) => takePhotoOff(its, it.key, k), it.photoKeys.length === 1 ? `Removed ${nameOf(it.key)}: that was its last photo.` : "Photo removed.")}
                  onCover={(k) => setItems((its) => makeCover(its, it.key, k))}
                  onAddPhotos={(list) => void onAddPhotos(it.key, list)}
                  onMerge={(into) => onMerge(it.key, into)}
                  onDrop={() => regroup((its) => dropItem(its, it.key), `Removed ${nameOf(it.key)}.`)}
                  onRewrite={() => void onRewrite(it.key)}
                />
              </BunchRow>
            ))}
          </ul>
          </fieldset>
        </Section>
      )}

      {items.length > 0 && (
        <>
        <span id="bunch-list-step" tabIndex={-1} className="block focus:outline-none" />
        <Section id="bunch-list" title={`${firstStep + 2}. List ${ready.length} ${ready.length === 1 ? "item" : "items"}`}>
          {savedSetup.hasSettings && savedWindows.isSuccess && savedWays.length > 0 && !pickupWindowsProblem(windows) ? (
            <div className="space-y-1" data-bunch-list-saved="">
              <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{[handoverSummary(savedWays), windowsSummary(windows)].filter(Boolean).join(" · ")}</p>
              {items.some((it) => !it.free) && <p className="text-ds-14 text-foreground" data-bunch-outcome="">{bunchDropsLine(choices.choices)}</p>}
              {savedSetup.pickup && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-saved-pickup="">{savedSetup.pickup.line}</p>}
              <UsesSettingsNote />
            </div>
          ) : (<>
          <h3 className="text-sm font-semibold">Your usual pickup times</h3>
          <p className="text-xs text-muted-foreground">Buyers pick one of these times. They apply to all your listings.</p>
          {savedWindows.isError ? (
            <ErrorState variant="inline" title="We couldn't load your pickup times." body={declutterErrorMessage(savedWindows.error)} onRetry={() => void savedWindows.refetch()} />
          ) : savedWindows.isSuccess ? (
            <PickupTimesEditor windows={windows} setWindows={setWindows} />
          ) : (
            <p className="text-sm text-muted-foreground" role="status">Loading your pickup times…</p>
          )}
          <BunchChoicesCard c={choices} anyPriced={items.some((it) => !it.free)} />
          <h3 className="pt-2 text-sm font-semibold">How buyers can get them</h3>
          <SellHandoverChoices ways={ways} setWays={setWays} free={false} sellerDeliveryOpen={sellerDeliveryOpen} pickupDays={windows.map((w) => w.weekday)} />
          </>)}
          {items.some((it) => it.free) && <p className="text-xs text-muted-foreground" data-bunch-free-note="">Free items are claimed, not bought: no offers and no price drops, and they're picked up from your porch.</p>}
          <h3 className="pt-2 text-sm font-semibold">Confirm about these items</h3>
          <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. One tick covers every item you list now.</p>
          <TaxStatementsCheck id="bunch-tax" checked={attested} onChange={setAttested} free={items.every((it) => it.free)} />
          {heldForFee > 0 && <p className="text-sm" data-bunch-fee-held="">{heldForFee} priced {heldForFee === 1 ? "item waits" : "items wait"} for the setup fee above. {heldForFee === 1 ? "It stays" : "They stay"} on this list.</p>}
          {problem && <p className="text-sm text-destructive-ink" role="alert" data-bunch-problem-list="">{problem}</p>}
          <Button type="button" disabled={blocked || ready.length === 0 || !savedWindows.isSuccess} onClick={() => void onListAll()}>
            {listing ? "Listing…" : `List ${ready.length} ${ready.length === 1 ? "item" : "items"}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Each item gets the same photo check and review as a single listing, so some may wait for a review first. Listing takes about {BUNCH_SECONDS_EACH} seconds each{ready.length > 1 ? `, so about ${bunchListingMinutes(ready.length)} ${bunchListingMinutes(ready.length) === 1 ? "minute" : "minutes"} for these` : ""}. Keep this page open and your phone unlocked until it's done.
          </p>
        </Section>
        </>
      )}

      {(sorting || listing || undo || items.length > 0) && (
        <div className="sticky bottom-3 z-20 space-y-2 rounded-2xl border border-border bg-card p-3 shadow-md" data-bunch-bar="">
          {sorting && (
            <p className="text-sm text-foreground" role="status" aria-live="polite" data-bunch-sorting="">
              {sortProgressLine(sorting.done, sorting.total, found)} Keep this page open.
            </p>
          )}
          {listing && (
            <p className="text-sm text-foreground" role="status" aria-live="polite" data-bunch-progress="">
              {listingProgressLine(listing.done, listing.total, runNames.current)} Keep this page open.
            </p>
          )}
          {undo && !listing && (
            <div className="flex flex-wrap items-center gap-2" role="status" data-bunch-undo="">
              <p className="min-w-0 flex-1 text-sm">{undo.said}{undo.otherPrice ? " We kept its price." : ""}</p>
              {undo.otherPrice && (
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => { const { intoKey, price } = undo.otherPrice!; setItems((its) => bulkEdit(its, new Set([intoKey]), { price })); setUndo({ ...undo, otherPrice: undefined }); }}>
                  Use ${undo.otherPrice.price} instead
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onUndo}>Undo</Button>
            </div>
          )}
          {!listing && !sorting && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {needs && firstUnready ? (
                <Button type="button" variant="link" size="sm" className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left underline" data-bunch-needs="" onClick={() => jumpTo(firstUnready.key)}>{needs}</Button>
              ) : (
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">All {items.length === 1 ? "set" : `${items.length} set`}.</span>
              )}
              <Button type="button" size="sm" className="rounded-full" disabled={ready.length === 0} data-bunch-next="" onClick={toListing}>Next: list {ready.length} {ready.length === 1 ? "item" : "items"}</Button>
            </div>
          )}
        </div>
      )}
    </AppPage>
  );
}
