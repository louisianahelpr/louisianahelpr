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
 * Behind the 'declutter' switch only (DeclutterGate on the page); no move
 * date. Every write is an ordinary declutter_* call that refuses without it.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { useScreenAwake } from "@/hooks/useScreenAwake";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { fetchMyPickupWindows, requestAiDraftFromPhotos, setPickupWindows, type PickupWindow, type SellerHandover } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { withRetries } from "@/lib/declutter/steadyRetry";
import {
  addSorted, askGroup, BUNCH_MAX_PHOTOS, BUNCH_SECONDS_EACH, bunchItemProblem, bunchListable, bunchListingMinutes, draftsLeftBehind, dropItem, editBunchItem, GROUP_BATCH, groupPhotos, joinSorted, listBunch, mergeItems, movePhoto, photosInItems, removeBunchDraft, rewrittenPrice, splitItem, startBunchRun, unusablePhotosNote, watchBunchRun,
  type BunchItem, type BunchOutcome, type BunchPhoto, type BunchRunWatcher, type PhotoProgress,
} from "@/lib/declutter/bunch";
import { DeclutterNotice, TAX_STATEMENTS } from "./declutterUi";
import { AREA_ADDRESS_RE } from "./sellForm";
import { PickupTimesEditor } from "./DeclutterPickupTimes";
import { SellHandoverChoices } from "./SellHandoverChoices";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { BunchCard, bunchItemName } from "./DeclutterBunchCard";
import { BunchPileCard } from "./DeclutterBunchPile";
import { BunchFeeGate, useSetupFeeDueCents } from "./BunchFeeGate";
import { BunchDraftsSection } from "./BunchDraftsSection";
import { useBunchSaved } from "./useBunchSaved";
import { BunchChoicesCard, samePickupWindows, useBunchChoices } from "./BunchChoices";
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

export default function BunchFlow() {
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
  const [photos, setPhotos] = useState<BunchPhoto[]>([]);
  const [items, setItems] = useState<BunchItem[]>([]);
  const [sorting, setSorting] = useState<{ done: number; total: number; retrying?: boolean } | null>(null);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [rewriteNote, setRewriteNote] = useState<{ key: string; text: string } | null>(null);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  const [ways, setWays] = useState<SellerHandover[]>(["porch"]);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [listing, setListing] = useState<{ done: number; total: number } | null>(null);
  const [photoProgress, setPhotoProgress] = useState<PhotoProgress | null>(null);
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
    { areaLabel, pickupAddress, coords, photos, items, sorting: !!sorting, finished: !!results && items.length === 0 },
    setItems,
    (back) => {
      setAreaLabel(back.areaLabel);
      setPickupAddress(back.pickupAddress);
      place.setPoint(back.coords);
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

  // The area and pickup address start from the seller's last listing (the single form's "Remember my setup": the
  // same read and cache entry). Applied once, only to a box still blank. A failed read is extra help lost, not a
  // blocker: the boxes start blank, and the app's QueryCache reports the error.
  const lastSetup = useQuery({ queryKey: ["declutter", "last-setup", user?.id], queryFn: () => fetchLastSetup(user!.id), enabled: !!user, staleTime: 60_000 });
  const placeLoaded = useRef(false);
  useEffect(() => {
    const s = lastSetup.data;
    if (!s || placeLoaded.current) return;
    placeLoaded.current = true;
    setAreaLabel((a) => (a.trim() ? a : s.areaLabel));
    if (!s.pickup) return;
    setPickupAddress((a) => (a.trim() ? a : s.pickup!.address));
    place.setPoint((c) => c ?? { ...s.pickup! });
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
    try {
      const at = await hintPoint();
      const res = await groupPhotos(batch, (done, total, made) => {
        setSorting({ done, total });
        setItems((its) => addSorted(its, made));
      }, (cleaned) => askGroup(cleaned, at), undefined, undefined, undefined, {
        onRetry: () => setSorting((s) => (s ? { ...s, retrying: true } : s)),
        onJoined: (into, from) => setItems((its) => joinSorted(its, into, from)),
      });
      const n = res.failed.reduce((s, f) => s + f.photos, 0);
      const notSorted = n > 0 ? `${n} ${n === 1 ? "photo isn't" : "photos aren't"} sorted yet: ${declutterErrorMessage(res.failed[0].error)} ${n === 1 ? "It's" : "They're"} kept together below. Tap Sort again.` : null;
      const note = [notSorted, unusablePhotosNote(res.unusable)].filter(Boolean).join(" ");
      if (note) setSortNote(note);
    } finally {
      setSorting(null);
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
    setItems((its) => its.filter((it) => it.key !== key));
    await sortPhotos(batch);
  }

  /** A change to the grouping. A draft it leaves with no item comes off the server, or it would stay under Selling. */
  function regroup(change: (its: BunchItem[]) => BunchItem[]) {
    const next = change(items);
    setItems(next);
    for (const { id, item } of draftsLeftBehind(items, next)) void takeDownDraft(id, item);
  }

  async function takeDownDraft(id: string, item: BunchItem) {
    const name = item.title.trim() || "that item";
    try {
      const done = await removeBunchDraft(id);
      if (done === "already_listed") setSortNote(`"${name}" was already listed, so it's still up. You can take it down under Selling.`);
    } catch (err) {
      // Not silent: the draft is still under Selling, and the seller is told, with the reason, where to take it down.
      setSortNote(`We couldn't remove the draft of "${name}": ${declutterErrorMessage(err)} You can take it down under Selling.`);
    } finally {
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  async function onRewrite(key: string) {
    const it = items.find((x) => x.key === key);
    if (!it) return;
    setRewriting(key);
    setRewriteNote(null);
    try {
      const point = await hintPoint();
      const d = await withRetries(() => requestAiDraftFromPhotos(it.photoKeys.map((k) => files.get(k)!).filter(Boolean), point), { delays: [4_000] });
      setItems((its) => its.map((x) => (x.key === key
        ? { ...x, title: d.title, description: d.description, category: d.category, deliverySize: d.deliverySize, conditionStars: d.conditionStars, flagged: d.flagged !== false, ...rewrittenPrice(x, d.priceDollars) }
        : x)));
    } catch (err) {
      // Not silent: the reason is shown on its card; the seller can try again or fill the item in themselves.
      setRewriteNote({ key, text: `We couldn't write "${bunchItemName(it, items.indexOf(it))}": ${declutterErrorMessage(err)}` });
    } finally {
      setRewriting(null);
    }
  }

  /** Lists every ready item, or just `only`: the one whose photo is being tried again. */
  async function onListAll(only?: BunchItem) {
    setProblem(null);
    const toList = only ? [only] : ready;
    const p = placeProblem
      ?? (savedWays.length === 0 ? "Tick at least one way buyers can get your items." : null)
      ?? (checks.some((c) => !c) ? "All four statements need a check before you can list these items." : null)
      ?? (only ? bunchItemProblem(only) : null)
      ?? (toList.length === 0 ? "No item is ready to list yet." : null);
    if (p) {
      setProblem(p);
      return;
    }
    const total = toList.length * 2;
    setListing({ done: 0, total });
    const started = startBunchRun(user!.id, watcher, total, async (onProgress, onStep, onPhoto) => {
      const c = await place.locate(pickupAddress);
      // Only a change is saved: the times on screen may be older than the seller's saved ones (another tab, Settings).
      if (!samePickupWindows(windows, savedWindows.data ?? [])) await setPickupWindows(windows);
      return listBunch(
        user!.id, toList, files,
        { areaLabel: areaLabel.trim(), pickupAddress: pickupAddress.trim(), pickupLat: c.lat, pickupLng: c.lng },
        savedWays, onProgress, undefined, onStep, choices.choices, onPhoto,
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

  const others = (key: string) => items.flatMap((it, i) => (it.key === key || it.notSorted ? [] : [{ key: it.key, name: bunchItemName(it, i) }]));
  const live = results?.filter((r) => "status" in r && r.status === "live").length ?? 0;
  const review = results?.filter((r) => "status" in r && r.status === "pending_review").length ?? 0;
  const keepUpFailed = results?.filter((r) => "keepUpFailed" in r && r.keepUpFailed).length ?? 0;
  const failed = (results ?? []).filter((r): r is Extract<BunchOutcome, { error: unknown }> => "error" in r);

  return (
    <AppPage title="Sell a bunch" backTo="/declutter?view=selling">
      <p className="text-sm text-muted-foreground">
        Add photos of everything you want to sell. We sort them into items and write each listing. You check them all, then list them together.
      </p>
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

      <Section id="bunch-where" title="1. Where buyers pick up">
        <label className="block text-sm font-medium" htmlFor="bunch-area">Area buyers see</label>
        <input id="bunch-area" className={input} maxLength={80} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder="Mid-City, Baton Rouge" />
        <label className="block text-sm font-medium" htmlFor="bunch-address">Pickup address</label>
        <input id="bunch-address" className={input} maxLength={300} value={pickupAddress} autoComplete="street-address" placeholder="Street, city, ZIP"
          onChange={(e) => setPickupAddress(e.target.value)} onBlur={() => {
            if (pickupAddress.trim().length < 5) return;
            // Early, for the note under the address and the price hints. A failure is said at "List": nothing was asked for yet.
            place.locate(pickupAddress).catch((e: unknown) => console.warn("[bunch] address check on blur:", e instanceof Error ? e.message : "unknown"));
          }} />
        <AddressNeedsExactSpot typedAddress={pickupAddress} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} />
        <p className="text-xs text-muted-foreground">It's the same for every item. Only the buyer who pays sees the address.</p>
      </Section>

      <Section id="bunch-photos" title="2. Add photos">
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
        {sorting && (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-bunch-sorting="">
            We're sorting your photos ({sorting.done} of {sorting.total} {sorting.total === 1 ? "batch" : "batches"} done). {sorting.retrying ? "The connection dropped, so we're trying again. " : ""}Keep this page open.
          </p>
        )}
        {sortNote && <p className="text-sm text-foreground" role="alert" data-bunch-note="">{sortNote}</p>}
      </Section>

      {items.length > 0 && (
        <Section id="bunch-check" title={`3. Check each item (${ready.length + heldForFee} of ${items.length} ready)`}>
          <p className="text-xs text-muted-foreground">
            Fix anything we got wrong. If two items are the same thing, merge them; if one holds two things, choose the photos and split them off.
          </p>
          {/* Nothing on a card can change while a run works on it: a draft dropped mid-run would be listed or lost. */}
          <fieldset disabled={!!listing || listingDrafts} className="contents">
          <ul className="space-y-3">
            {items.map((it, i) => it.notSorted ? (
              <BunchPileCard
                key={it.key}
                item={it}
                urls={thumbs}
                busy={busy}
                onSortAgain={() => void onSortAgain(it.key)}
                onOneItem={() => setItems((its) => editBunchItem(its, it.key, { notSorted: false, sortReason: undefined }))}
                onDrop={() => regroup((its) => dropItem(its, it.key))}
              />
            ) : (
              <BunchCard
                key={it.key}
                item={it}
                index={i}
                others={others(it.key)}
                urls={thumbs}
                at={coords}
                rewriting={rewriting === it.key}
                rewriteNote={rewriteNote?.key === it.key ? rewriteNote.text : null}
                onChange={(patch) => setItems((its) => editBunchItem(its, it.key, patch))}
                onMove={(keys, to) => regroup((its) => keys.reduce((acc, k) => movePhoto(acc, k, to), its))}
                onSplit={(keys) => setItems((its) => splitItem(its, it.key, keys))}
                onMerge={(into) => regroup((its) => mergeItems(its, it.key, into))}
                onDrop={() => regroup((its) => dropItem(its, it.key))}
                onRewrite={() => void onRewrite(it.key)}
                onRetryUpload={() => void onListAll(it)}
              />
            ))}
          </ul>
          </fieldset>
        </Section>
      )}

      {items.length > 0 && (
        <Section id="bunch-list" title={`4. List ${ready.length} ${ready.length === 1 ? "item" : "items"}`}>
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
          {items.some((it) => it.free) && <p className="text-xs text-muted-foreground" data-bunch-free-note="">Free items are claimed, not bought: no offers and no price drops, and they're picked up from your porch.</p>}
          <h3 className="pt-2 text-sm font-semibold">Confirm about these items</h3>
          <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. Each statement counts for every item you list now.</p>
          {TAX_STATEMENTS.map((s, i) => (
            <div key={s} className="flex items-start gap-3 text-sm">
              <Checkbox id={`bunch-tax-${i}`} className="mt-0.5" checked={checks[i]} onCheckedChange={(v) => setChecks((c) => c.map((x, j) => (j === i ? v === true : x)))} />
              <label htmlFor={`bunch-tax-${i}`}>{s}</label>
            </div>
          ))}
          {heldForFee > 0 && <p className="text-sm" data-bunch-fee-held="">{heldForFee} priced {heldForFee === 1 ? "item waits" : "items wait"} for the setup fee above. {heldForFee === 1 ? "It stays" : "They stay"} on this list.</p>}
          {problem && <p className="text-sm text-destructive-ink" role="alert" data-bunch-problem-list="">{problem}</p>}
          <Button type="button" disabled={blocked || ready.length === 0 || !savedWindows.isSuccess} onClick={() => void onListAll()}>
            {listing ? `Listing… (${Math.min(listing.done, listing.total)} of ${listing.total} steps)` : `List ${ready.length} ${ready.length === 1 ? "item" : "items"}`}
          </Button>
          {listing && photoProgress && (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-bunch-photo-progress="">
              Sending photo {photoProgress.photo} of {photoProgress.of}{photoProgress.itemName ? ` (${photoProgress.itemName})` : ""}.{photoProgress.retrying ? " The connection dropped, so we're trying again." : ""}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Each item gets the same photo check and review as a single listing, so some may wait for a review first. Listing takes about {BUNCH_SECONDS_EACH} seconds each{ready.length > 1 ? `, so about ${bunchListingMinutes(ready.length)} ${bunchListingMinutes(ready.length) === 1 ? "minute" : "minutes"} for these` : ""}. Keep this page open and your phone unlocked until it's done.
          </p>
        </Section>
      )}

      {results && (
        <Section id="bunch-done" title="What happened">
          {live + review > 0 && (
            <p className="text-sm" data-bunch-listed="">
              {[live > 0 ? `${live} for sale` : null, review > 0 ? `${review} waiting for a review` : null].filter(Boolean).join(", ")}.{" "}
              <Link className="underline" to="/declutter?view=selling">See your listings</Link>
            </p>
          )}
          {keepUpFailed > 0 && (
            <p className="text-sm" data-bunch-keepup-failed="">
              "Keep it up" didn't turn on for {keepUpFailed} {keepUpFailed === 1 ? "item" : "items"}. You can turn it on from Manage listing.
            </p>
          )}
          {failed.length > 0 && (
            <ul className="space-y-1 text-sm" data-bunch-failed="">
              {failed.map((f) => (
                <li key={f.key}>
                  <span className="font-semibold">{f.title || "An item"}</span> wasn't listed: {declutterErrorMessage(f.error)}
                  {f.stays ? " It's still above, to fix and list again." : " It's saved as a draft under Selling, to finish there."}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </AppPage>
  );
}
