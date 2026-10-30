/**
 * /declutter/sell?mode=bunch — "Sell a bunch" (owner 2026-10-29: "how can
 * they do a lot of listings at once? like just take pictures basically,
 * upload all pictures for everything they want to sell, ai does the forms and
 * they review all at once before submission"). One page, in order:
 *   1. Where buyers pick up: the area buyers see and the private address,
 *      asked once for every item.
 *   2. Add photos: many at once. They stay on the device; the photo tool
 *      sorts them into items and writes each one (lib/declutter/bunch.ts).
 *   3. Check each item: every field editable; fix the grouping (move a photo,
 *      split, merge, drop: the owner's pop-up choice). A possibly banned item
 *      is marked and cannot be listed; an item short of photos says so.
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
import { geocodeAddress } from "@/lib/geocode";
import { fetchMyPickupWindows, requestAiDraftFromPhotos, setPickupWindows, type PickupWindow, type SellerHandover } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  askGroup, BUNCH_MAX_PHOTOS, BUNCH_SECONDS_EACH, bunchItemProblem, bunchListingMinutes, dropItem, GROUP_BATCH, groupPhotos, listBunch, mergeItems, movePhoto, rewrittenPrice, splitItem,
  type BunchItem, type BunchOutcome, type BunchPhoto,
} from "@/lib/declutter/bunch";
import { DeclutterNotice, TAX_STATEMENTS } from "./declutterUi";
import { AREA_ADDRESS_RE } from "./sellForm";
import { PickupTimesEditor } from "./DeclutterPickupTimes";
import { SellHandoverChoices } from "./SellHandoverChoices";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { BunchCard, bunchItemName } from "./DeclutterBunchCard";
import { BunchFeeGate, useSetupFeeDueCents } from "./BunchFeeGate";
import { BunchDraftsSection } from "./BunchDraftsSection";
import { useBunchSaved } from "./useBunchSaved";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

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
  const [coords, setCoords] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [photos, setPhotos] = useState<BunchPhoto[]>([]);
  const [items, setItems] = useState<BunchItem[]>([]);
  const [sorting, setSorting] = useState<{ done: number; total: number } | null>(null);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  const [ways, setWays] = useState<SellerHandover[]>(["porch"]);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [listing, setListing] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<BunchOutcome[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // One preview address per photo, made once and released when the page closes.
  const urls = useRef(new Map<string, string>());
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
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
      setCoords(back.coords);
      for (const p of back.photos) urls.current.set(p.key, URL.createObjectURL(p.file));
      setPhotos(back.photos);
      setItems(back.items);
    },
  );
  const draftsOnTheList = useMemo(() => new Set(items.flatMap((it) => (it.draftId ? [it.draftId] : []))), [items]);

  const savedWindows = useQuery({ queryKey: ["declutter", "windows", user?.id], queryFn: () => fetchMyPickupWindows(user!.id), enabled: !!user });
  const windowsLoaded = useRef(false);
  useEffect(() => {
    const saved = savedWindows.data ?? [];
    if (windowsLoaded.current || !savedWindows.isSuccess) return;
    windowsLoaded.current = true;
    if (saved.length > 0) setWindows(saved.map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) })));
  }, [savedWindows.data, savedWindows.isSuccess]);

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
  const ready = items.filter((it) => !bunchItemProblem(it));
  const savedWays = ways.filter((w) => w !== "seller_delivery" || sellerDeliveryOpen);
  const busy = !!sorting || !!listing || listingDrafts;
  const blocked = busy || feeDue != null;

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
    for (const p of added) urls.current.set(p.key, URL.createObjectURL(p.file));
    setPhotos((ps) => [...ps, ...added]);
    setSortNote(picked.length > room ? `Only the first ${room} were added: one go takes up to ${BUNCH_MAX_PHOTOS} photos.` : null);
    setSorting({ done: 0, total: Math.ceil(added.length / GROUP_BATCH) });
    try {
      const at = await hintPoint();
      const res = await groupPhotos(added, (done, total) => setSorting({ done, total }), (batch) => askGroup(batch, at));
      setItems((its) => [...its, ...res.items]);
      if (res.failed.length > 0) {
        const n = res.failed.reduce((s, f) => s + f.photos, 0);
        setSortNote(`${n} ${n === 1 ? "photo wasn't" : "photos weren't"} sorted: ${declutterErrorMessage(res.failed[0].error)} They're below as items for you to name, or tap Write it again.`);
      }
    } finally {
      setSorting(null);
    }
  }

  async function onRewrite(key: string) {
    const it = items.find((x) => x.key === key);
    if (!it) return;
    setRewriting(key);
    try {
      const d = await requestAiDraftFromPhotos(it.photoKeys.map((k) => files.get(k)!).filter(Boolean), await hintPoint());
      setItems((its) => its.map((x) => (x.key === key
        ? { ...x, title: d.title, description: d.description, category: d.category, deliverySize: d.deliverySize, conditionStars: d.conditionStars, flagged: d.flagged !== false, ...rewrittenPrice(x, d.priceDollars) }
        : x)));
    } catch (err) {
      // Not silent: the reason is shown above the list; the seller can fill the item in themselves.
      setSortNote(`We couldn't write "${bunchItemName(it, items.indexOf(it))}" again: ${declutterErrorMessage(err)}`);
    } finally {
      setRewriting(null);
    }
  }

  async function onListAll() {
    setProblem(null);
    const p = (feeDue != null ? "Pay the one-time setup fee above first, then list these items." : null)
      ?? placeProblem
      ?? (savedWays.length === 0 ? "Tick at least one way buyers can get your items." : null)
      ?? (checks.some((c) => !c) ? "All four statements need a check before you can list these items." : null)
      ?? (ready.length === 0 ? "No item is ready to list yet." : null);
    if (p) {
      setProblem(p);
      return;
    }
    setListing({ done: 0, total: ready.length * 2 });
    try {
      const c = await locate();
      if (!c) throw new Error("invalid_location");
      await setPickupWindows(windows);
      const out = await listBunch(
        user!.id, ready, files,
        { areaLabel: areaLabel.trim(), pickupAddress: pickupAddress.trim(), pickupLat: c.lat, pickupLng: c.lng },
        savedWays, (done, total) => setListing({ done, total }), undefined, saved.applyStep,
      );
      setResults(out);
      // Listed items and items refused at publish leave the list (that draft is finished under Selling);
      // an item that failed getting ready stays with its photos, to fix and try again.
      const gone = new Set(out.filter((o) => "status" in o || !o.stays).map((o) => o.key));
      setItems((its) => its.filter((it) => !gone.has(it.key)));
    } catch (err) {
      // Not silent: the address, pickup-times or listing refusal is shown beside the button (role="alert"),
      // and the items stay on screen to try again.
      setProblem(declutterErrorMessage(err));
    } finally {
      setListing(null);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  function startOver() {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current.clear();
    setPhotos([]);
    setItems([]);
    setResults(null);
    setSortNote(null);
    setProblem(null);
    setAskingStartOver(false);
    saved.clearSaved();
  }

  const others = (key: string) => items.map((it, i) => ({ key: it.key, name: bunchItemName(it, i) })).filter((o) => o.key !== key);
  const live = results?.filter((r) => "status" in r && r.status === "live").length ?? 0;
  const review = results?.filter((r) => "status" in r && r.status === "pending_review").length ?? 0;
  const failed = (results ?? []).filter((r): r is Extract<BunchOutcome, { error: unknown }> => "error" in r);

  return (
    <AppPage title="Sell a bunch" backTo="/declutter?view=selling">
      <p className="font-moment text-ds-32 leading-tight">Sell a bunch</p>
      <p className="text-sm text-muted-foreground">
        Add photos of everything you want to sell. We sort them into items and write each listing. You check them all, then list them together.
      </p>
      <SellerPayoutPrompt />
      {feeDue != null && <BunchFeeGate cents={feeDue} />}
      {feeDue == null && <BunchDraftsSection userId={user.id} exclude={draftsOnTheList} busy={busy} onBusy={setListingDrafts} />}

      {saved.note && <p className="text-sm text-foreground" role="alert" data-bunch-not-saved="">{saved.note}</p>}
      {saved.restoredCount > 0 && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm" role="status" data-bunch-restored="">
          <p className="min-w-0 flex-1">We kept your work from last time: {saved.restoredCount} {saved.restoredCount === 1 ? "item" : "items"}, with their photos and prices.</p>
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
          onChange={(e) => setPickupAddress(e.target.value)} onBlur={() => { if (pickupAddress.trim().length >= 5) void locate(); }} />
        <p className="text-xs text-muted-foreground">It's the same for every item. Only the buyer who pays sees the address.</p>
      </Section>

      <Section id="bunch-photos" title="2. Add photos">
        <p className="text-xs text-muted-foreground">
          Pick them all at once, up to {BUNCH_MAX_PHOTOS}. Take a few of each thing, one thing at a time. Location data is removed before anything is sent, and nothing goes up until you list.
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
            We're sorting your photos ({sorting.done} of {sorting.total} {sorting.total === 1 ? "batch" : "batches"} done). Keep this page open.
          </p>
        )}
        {sortNote && <p className="text-sm text-foreground" role="alert" data-bunch-note="">{sortNote}</p>}
      </Section>

      {items.length > 0 && (
        <Section id="bunch-check" title={`3. Check each item (${ready.length} of ${items.length} ready)`}>
          <p className="text-xs text-muted-foreground">
            Fix anything we got wrong. If two items are the same thing, merge them; if one holds two things, choose the photos and split them off.
          </p>
          <ul className="space-y-3">
            {items.map((it, i) => (
              <BunchCard
                key={it.key}
                item={it}
                index={i}
                others={others(it.key)}
                urls={urls.current}
                at={coords}
                rewriting={rewriting === it.key}
                onChange={(patch) => setItems((its) => its.map((x) => (x.key === it.key ? { ...x, ...patch } : x)))}
                onMove={(keys, to) => setItems((its) => keys.reduce((acc, k) => movePhoto(acc, k, to), its))}
                onSplit={(keys) => setItems((its) => splitItem(its, it.key, keys))}
                onMerge={(into) => setItems((its) => mergeItems(its, it.key, into))}
                onDrop={() => setItems((its) => dropItem(its, it.key))}
                onRewrite={() => void onRewrite(it.key)}
              />
            ))}
          </ul>
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
          <h3 className="pt-2 text-sm font-semibold">How buyers can get them</h3>
          <SellHandoverChoices ways={ways} setWays={setWays} free={false} sellerDeliveryOpen={sellerDeliveryOpen} pickupDays={windows.map((w) => w.weekday)} />
          <h3 className="pt-2 text-sm font-semibold">Confirm about these items</h3>
          <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. Each statement counts for every item you list now.</p>
          {TAX_STATEMENTS.map((s, i) => (
            <div key={s} className="flex items-start gap-3 text-sm">
              <Checkbox id={`bunch-tax-${i}`} className="mt-0.5" checked={checks[i]} onCheckedChange={(v) => setChecks((c) => c.map((x, j) => (j === i ? v === true : x)))} />
              <label htmlFor={`bunch-tax-${i}`}>{s}</label>
            </div>
          ))}
          {problem && <p className="text-sm text-destructive-ink" role="alert" data-bunch-problem-list="">{problem}</p>}
          <Button type="button" disabled={blocked || ready.length === 0 || !savedWindows.isSuccess} onClick={() => void onListAll()}>
            {listing ? `Listing… (${Math.min(listing.done, listing.total)} of ${listing.total} steps)` : `List ${ready.length} ${ready.length === 1 ? "item" : "items"}`}
          </Button>
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
