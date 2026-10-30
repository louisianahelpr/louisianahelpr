/**
 * /declutter/move — moving-out mode (docs/specs/declutter-moving-out.md).
 * One page, in order:
 *   1. The move: move-out date, the area buyers see, the private pickup
 *      address (asked once for every item).
 *   2. Room photos (1 to 4 per room): the photo tool lists what it sees.
 *      The room photos are only sent to the tool; never saved or shown.
 *   3. Check the list: keep or drop each item, name it, price it. Saving
 *      makes drafts (declutter_create_move_drafts: every listing rule).
 *   4. The moving-sale items: each draft still needs photos of its own
 *      (DECLUTTER_MIN_PHOTOS to DECLUTTER_MAX_PHOTOS), added in the ordinary listing form.
 *   5. List the ready ones together: pickup times, the four confirmations,
 *      then one publish per item (the review queue still applies).
 *   6. Moving day: change the date or end the sale; hire a Helpr for help
 *      or to haul away what's left (links only; those features are their own).
 * Hidden unless both the 'declutter' and 'declutter_moving_out' switches are
 * on; every RPC refuses without them anyway.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerField } from "@/components/DatePickerField";
import { MovingSaleDetails } from "./DeclutterMovingSaleDetails";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { featureSwitchSettled } from "@/lib/featureSwitchQuery";
import NotFound from "@/pages/info/NotFound";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { fetchMyItemPrivate, fetchMyPickupWindows, fetchPhotos, setPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import {
  chunk,
  createMoveDrafts,
  fetchMyMoveItems,
  fetchMyMoveOutDate,
  formatMoveDate,
  louisianaToday,
  MOVE_ROOM_PHOTOS_MAX,
  MOVE_SAVE_BATCH,
  moveDateProblem,
  moveRowProblem,
  publishMany,
  scanRoom,
  setMoveOutDate,
  toMoveRows,
  type MoveRow,
} from "@/lib/declutter/moves";
import { CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL, sellerStatusLabel, TaxStatementsCheck } from "./declutterUi";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { readMoveDraft, writeMoveDraft } from "@/lib/declutter/moveDraft";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
import { movingDayPostJobPath } from "@/lib/declutter/movingDayJob";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { AREA_ADDRESS_RE } from "./sellForm";
import { PickupTimesEditor, pickupWindowsProblem, windowsSummary } from "./DeclutterPickupTimes";
import { LastSetupNote } from "./SellLastSetup";
import { useSavedPickup } from "./useSavedPickup";

// The shared field look (DatePickerField / Input): one height and radius on this page (board 164).
const input = "h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15";

/** The 404 unless 'declutter_moving_out' is on too (DeclutterGate checks 'declutter'). */
export function MovingOutGate({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const on = useFeature("declutter_moving_out");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  const settled = isReady && (!user || featureSwitchSettled(qc, "declutter_moving_out", user.id));
  if (on) return <>{children}</>;
  if (!settled) return <>{skeleton}</>;
  return <NotFound />;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function MoveFlow() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const { underAge } = useAgeGate();
  const today = louisianaToday();

  const [date, setDate] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const addressPoint = useExactAddressPoint();
  const [rows, setRows] = useState<MoveRow[]>([]);
  // Saved settings are the source once they exist (owner 2026-10-30): the address, area and exact point, asked once,
  // only for a box still blank (a move already under way keeps its own).
  const savedSetup = useSavedPickup(user?.id, (p) => {
    setAreaLabel((a) => a || p.areaLabel);
    setPickupAddress((a) => a || p.address);
  });
  const [whereOpen, setWhereOpen] = useState(false);
  const [listOptionsOpen, setListOptionsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  // One tick for the four statements covers the whole run (owner 2026-10-30); attestItem still records all four per item.
  const [attested, setAttested] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [changingDate, setChangingDate] = useState(false);
  const [askEnd, setAskEnd] = useState(false);
  const scans = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const moveItems = useQuery({ queryKey: ["declutter", "move-items", user?.id], queryFn: () => fetchMyMoveItems(user!.id), enabled: !!user });
  const inPlay = useMemo(
    () => (moveItems.data ?? []).filter((i) => ["draft", "pending_review", "live", "paused", "reserved"].includes(i.status)),
    [moveItems.data],
  );
  const drafts = useMemo(() => inPlay.filter((i) => i.status === "draft"), [inPlay]);
  // D4-6: the listed, unsold sale items "Haul away what's left" pre-fills (Post a job keeps the ones a haul-away takes).
  const haulIds = useMemo(() => inPlay.filter((i) => i.status === "live" || i.status === "paused").map((i) => i.id), [inPlay]);
  const photos = useQuery({
    queryKey: ["declutter", "move-photos", drafts.map((d) => d.id).join(",")],
    queryFn: () => fetchPhotos(drafts.map((d) => d.id)),
    enabled: drafts.length > 0,
  });
  const photoCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos.data ?? []) m.set(p.item_id, (m.get(p.item_id) ?? 0) + 1);
    return m;
  }, [photos.data]);
  const ready = drafts.filter((d) => (photoCount.get(d.id) ?? 0) >= DECLUTTER_MIN_PHOTOS);
  const chosen = ready.filter((d) => (picked ? picked.has(d.id) : true));
  const savedWindows = useQuery({ queryKey: ["declutter", "windows", user?.id], queryFn: () => fetchMyPickupWindows(user!.id), enabled: !!user });
  const myDate = useQuery({ queryKey: ["declutter", "my-move-date", user?.id], queryFn: fetchMyMoveOutDate, enabled: !!user });
  const current = myDate.data ?? null;
  const prefillFrom = inPlay[0]?.id ?? null;
  const priv = useQuery({ queryKey: ["declutter", "private", prefillFrom], queryFn: () => fetchMyItemPrivate(prefillFrom!), enabled: !!prefillFrom });

  // Audit #33: what isn't saved yet survives a reload (moveDraft.ts). Restored first, so the prefill
  // below fills only what the draft left empty; kept on every change after that.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || restored.current === user.id) return;
    restored.current = user.id;
    const d = readMoveDraft(user.id);
    if (!d) return;
    setDate((x) => x || d.date);
    setAreaLabel((x) => x || d.areaLabel);
    setPickupAddress((x) => x || d.pickupAddress);
    if (d.rows.length > 0) {
      setRows((rs) => (rs.length ? rs : d.rows));
      scans.current = d.rows.length;
    }
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id || restored.current !== user.id) return;
    writeMoveDraft(user.id, { date, areaLabel, pickupAddress, rows });
  }, [user?.id, date, areaLabel, pickupAddress, rows]);

  // Carry the move's date, area and address forward from what is saved.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !inPlay[0] || !priv.data || !myDate.isSuccess) return;
    prefilled.current = true;
    setDate((d) => d || myDate.data || "");
    setAreaLabel((a) => a || inPlay[0].area_label);
    setPickupAddress((p) => p || priv.data.pickup_address);
  }, [inPlay, priv.data, myDate.isSuccess, myDate.data]);
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
      <AppPage title="Moving out" backTo="/declutter?view=selling">
        <DeclutterNotice tone="warn" title="You must be 18 or older to sell on Declutter.">
          You can still look around. Selling opens when your birthday on file says you're 18.
        </DeclutterNotice>
      </AppPage>
    );
  }

  const dateProblem = moveDateProblem(date, today);
  const placeProblem =
    areaLabel.trim().length < 2 ? "Add your neighborhood or town."
      : AREA_ADDRESS_RE.test(areaLabel) ? "Use your neighborhood or town for the area, not a street address."
        : pickupAddress.trim().length < 5 ? "Add the pickup address. Buyers only see it after they pay."
          : null;
  // Saved settings fold to one line; Change opens them, and a move already under way shows its own address.
  const whereFolded = !!savedSetup.pickup && !whereOpen && !placeProblem && pickupAddress.trim() === savedSetup.pickup.address;
  const moveDetailsProblem = dateProblem ?? placeProblem;
  const kept = rows.filter((r) => r.keep);
  const rowProblem = kept.map(moveRowProblem).find((p) => p) ?? null;
  const setRow = (key: string, patch: Partial<MoveRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function onRoomPhotos(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileRef.current) fileRef.current.value = "";
    if (list.length === 0) return;
    if (list.length > MOVE_ROOM_PHOTOS_MAX) {
      toast.error(`Pick up to ${MOVE_ROOM_PHOTOS_MAX} photos of one room at a time.`);
      return;
    }
    setScanning(true);
    try {
      const found = await scanRoom(list);
      scans.current += 1;
      if (found.length === 0) {
        toast.error("The photo tool didn't find anything to sell in those photos. Try a wider photo of the room.");
        return;
      }
      setRows((rs) => [...rs, ...toMoveRows(found, `room${scans.current}`)]);
      toast.success(`Found ${found.length} ${found.length === 1 ? "item" : "items"}. Check each one below.`);
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  async function onSave() {
    const problem = dateProblem ?? placeProblem ?? rowProblem ?? (kept.length === 0 ? "Keep at least one item to save." : null);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      // The saved address keeps its saved point, exactly; anything typed is looked up.
      const known = savedSetup.pickup && savedSetup.pickup.address === pickupAddress.trim() ? { lat: savedSetup.pickup.lat, lng: savedSetup.pickup.lng } : null;
      const g = known ?? await addressPoint.locate(pickupAddress);
      const place = { areaLabel: areaLabel.trim(), pickupAddress: pickupAddress.trim(), pickupLat: g.lat, pickupLng: g.lng };
      for (const batch of chunk(kept, MOVE_SAVE_BATCH)) {
        const ids = await createMoveDrafts(date, place, batch);
        if (ids.length !== batch.length) throw new Error("invalid_items");
        saved += ids.length;
        const done = new Set(batch.map((r) => r.key));
        setRows((rs) => rs.filter((r) => !done.has(r.key)));
      }
      toast.success(`Saved ${saved} ${saved === 1 ? "item" : "items"}. Next, add photos of each one.`);
    } catch (err) {
      // A later batch refused after an earlier one saved: say both.
      toast.error(saved > 0
        ? `Saved ${saved} of ${kept.length}. The other ${kept.length - saved} didn't save: ${declutterErrorMessage(err)}`
        : declutterErrorMessage(err));
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  async function onListAll() {
    if (!attested) {
      toast.error("Tick the box under the four statements before you list these items.");
      return;
    }
    if (chosen.length === 0) return;
    setProgress({ done: 0, total: chosen.length });
    try {
      await setPickupWindows(windows);
      const results = await publishMany(chosen.map((d) => d.id), (done, total) => setProgress({ done, total }));
      const live = results.filter((r) => "status" in r && r.status === "live").length;
      const review = results.filter((r) => "status" in r && r.status === "pending_review").length;
      const failed = results.filter((r) => "error" in r);
      if (live + review > 0) {
        toast.success(
          [live > 0 ? `${live} for sale` : null, review > 0 ? `${review} waiting for a review` : null].filter(Boolean).join(", ") + ".",
        );
      }
      if (failed.length > 0) {
        const first = failed[0] as { error: unknown };
        toast.error(`${failed.length} ${failed.length === 1 ? "item wasn't" : "items weren't"} listed. ${declutterErrorMessage(first.error)}`);
      }
      setPicked(null);
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  async function onChangeDate(next: string | null) {
    if (next !== null) {
      const p = moveDateProblem(next, today);
      if (p) {
        toast.error(p);
        return;
      }
    }
    setChangingDate(true);
    try {
      const n = await setMoveOutDate(next);
      if (n === 0) toast("None of your moving-sale items are still up, so nothing changed.");
      else toast.success(next === null ? "Moving sale ended. Your items stay up as ordinary listings." : `Move-out date changed on ${n} ${n === 1 ? "item" : "items"}.`);
      if (next === null) setDate("");
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setChangingDate(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  const stepNo = moveStepNumber(rows.length > 0, ready.length > 0 && !photos.isError);

  return (
    <AppPage title="Moving out" backTo="/declutter?view=selling">
      {/* Board 164: the moment headline (spec v2 §1.2: Bodoni for flow headlines). */}
      <p className="font-moment text-ds-32 leading-tight" data-move-hero="">Everything goes</p>
      <p className="text-sm text-muted-foreground">
        Photograph each room. The photo tool lists what it sees, you set the prices, and everything goes up together as one moving sale on your profile.
      </p>
      <SellerPayoutPrompt />

      {/* The numbers count only the sections on screen (audit #30: they skipped 1, 2, 4, 6 while "Check"
          and "List" were hidden). */}
      <Section id="move-when" title={`${stepNo("when")}. Your move`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-sm font-medium" htmlFor="move-date">Move-out date</label>
            <DatePickerField id="move-date" value={date} min={today} onChange={setDate} placeholder="Pick a date" />
          </div>
          {!whereFolded && (
          <div className="min-w-0">
            <label className="block text-sm font-medium" htmlFor="move-area">Area buyers see</label>
            <input id="move-area" className={input} maxLength={80} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder="Mid-City, Baton Rouge" />
          </div>
          )}
        </div>
        {whereFolded ? (
          <div className="space-y-1" data-move-where-saved="">
            <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{[savedSetup.pickup?.line, areaLabel.trim()].join(" · ")}</p>
            <LastSetupNote saved onChange={() => setWhereOpen(true)} />
          </div>
        ) : (<>
        <label className="block text-sm font-medium" htmlFor="move-address">Pickup address</label>
        <input id="move-address" className={input} maxLength={300} value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
        <AddressNeedsExactSpot typedAddress={pickupAddress} inexact={addressPoint.inexact} locating={addressPoint.locating} shareMyLocation={addressPoint.shareMyLocation} />
        </>)}
        <p className="text-xs text-muted-foreground">
          Buyers see your area and your move-out date. Only the buyer who pays sees the address.
        </p>
        {/* Audit #33: a wrong or missing date used to surface only at Save, after a minute-long photo scan.
            Once something is typed, the date's problem shows here, beside the field it is about. */}
        {date && dateProblem && <p className="text-xs text-destructive-ink" role="status" data-move-date-problem="">{dateProblem}</p>}
        {current && date && date !== current && !dateProblem && (
          <Button type="button" variant="outline" size="sm" disabled={changingDate} onClick={() => void onChangeDate(date)}>
            {changingDate ? "Changing…" : `Change the date on my moving-sale items to ${formatMoveDate(date)}`}
          </Button>
        )}
        {/* Board 164 / Q2269: the sale's name and start, once there is a moving sale to name. */}
        {user && current && <MovingSaleDetails userId={user.id} moveOutOn={current} today={today} />}
      </Section>

      <Section id="move-rooms" title={`${stepNo("rooms")}. Photograph a room`}>
        <p className="text-xs text-muted-foreground">
          Up to {MOVE_ROOM_PHOTOS_MAX} photos of one room at a time. They're only used to find the items. They aren't saved or shown to buyers.
        </p>
        {/* Audit #33: the move's details come first, so the scan's items can be saved the moment they're checked. */}
        {moveDetailsProblem ? (
          <p className="text-xs text-muted-foreground" data-move-needs-details="">First, fill in your move above: {moveDetailsProblem}</p>
        ) : null}
        {/* Its own name too: while the move's details are missing there is no <label> for it (axe "label", critical). */}
        <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" id="move-files" disabled={!!moveDetailsProblem || scanning}
          aria-label="Add room photos"
          onChange={(e) => void onRoomPhotos(e.target.files)} />
        {moveDetailsProblem ? (
          // A real disabled button (the shared disabled look), not a label that only looks inert.
          <Button type="button" variant="outline" size="sm" disabled>Add room photos</Button>
        ) : (
          <Button asChild variant="outline" size="sm" className="cursor-pointer">
            <label htmlFor="move-files">{scanning ? "Looking at your photos…" : "Add room photos"}</label>
          </Button>
        )}
      </Section>

      {rows.length > 0 && (
        <Section id="move-check" title={`${stepNo("check")}. Check each item (${kept.length} of ${rows.length} kept)`}>
          <p className="text-xs text-muted-foreground">
            Untick anything you're keeping. Give each item a price. Leave the lowest price blank to keep the price as it is; fill it in and the price drops 5% each evening, rounded down to a whole dollar, until it gets there.
          </p>
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key} className="rounded-xl border border-border p-3 space-y-2" data-testid="move-row">
                <div className="flex items-start gap-3">
                  <Checkbox id={`keep-${r.key}`} className="mt-1" checked={r.keep} onCheckedChange={(v) => setRow(r.key, { keep: v === true })} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <label className="sr-only" htmlFor={`keep-${r.key}`}>Sell this item</label>
                    <label className="sr-only" htmlFor={`title-${r.key}`}>Name</label>
                    <input id={`title-${r.key}`} className={input} maxLength={80} value={r.title} disabled={!r.keep} onChange={(e) => setRow(r.key, { title: e.target.value })} />
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABEL[r.category] ?? "Other"} · {SIZE_LABEL[r.deliverySize]} · {CONDITION_LABEL[r.conditionStars]}
                    </p>
                    {r.flagged && (
                      <p className="text-xs text-amber-800 dark:text-amber-200">This item may not be allowed. Check our list of items you can't sell; its own photos get a closer check when you list it.</p>
                    )}
                    {r.keep && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <label className="block text-xs font-medium" htmlFor={`price-${r.key}`}>Price ($)</label>
                          <input id={`price-${r.key}`} className={input} inputMode="decimal" value={r.price} onChange={(e) => setRow(r.key, { price: e.target.value })} placeholder="40" />
                        </div>
                        <div className="min-w-0">
                          <label className="block text-xs font-medium" htmlFor={`floor-${r.key}`}>Lowest price ($)</label>
                          <input id={`floor-${r.key}`} className={input} inputMode="decimal" value={r.floor} onChange={(e) => setRow(r.key, { floor: e.target.value })} placeholder="Same" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {(dateProblem ?? placeProblem ?? rowProblem) && (
            <p className="text-xs text-muted-foreground" data-testid="move-problem">{dateProblem ?? placeProblem ?? rowProblem}</p>
          )}
          <Button type="button" size="sm" disabled={saving || kept.length === 0} onClick={() => void onSave()}>
            {saving ? "Saving…" : `Save ${kept.length} ${kept.length === 1 ? "item" : "items"}`}
          </Button>
        </Section>
      )}

      <Section id="move-items" title={`${stepNo("items")}. Your moving-sale items`}>
        {moveItems.isError || photos.isError ? (
          <ErrorState
            variant="inline"
            title="We couldn't load your moving-sale items."
            body={declutterErrorMessage(moveItems.error ?? photos.error)}
            onRetry={() => void (moveItems.isError ? moveItems.refetch() : photos.refetch())}
          />
        ) : moveItems.isLoading || photos.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your items…</p>
        ) : inPlay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet. Add room photos to start.</p>
        ) : (
          <>
            {/* Audit #33: this said "3 to 12 photos" after one photo became enough (owner 2026-10-20); it reads the rule now. */}
            <p className="text-xs text-muted-foreground" data-move-photo-rule="">
              Each item needs at least {photosWord(DECLUTTER_MIN_PHOTOS)} of its own (up to {DECLUTTER_MAX_PHOTOS}) before it can be listed. Tap an item to add them.
            </p>
            <ul className="divide-y divide-border">
              {inPlay.map((it) => {
                const n = photoCount.get(it.id) ?? 0;
                const isDraft = it.status === "draft";
                return (
                  <li key={it.id} className="py-2 flex items-center gap-3 min-w-0">
                    {isDraft && n >= DECLUTTER_MIN_PHOTOS ? (
                      <Checkbox
                        id={`pick-${it.id}`}
                        checked={picked ? picked.has(it.id) : true}
                        onCheckedChange={(v) =>
                          setPicked((p) => {
                            const s = new Set(p ?? ready.map((d) => d.id));
                            if (v === true) s.add(it.id);
                            else s.delete(it.id);
                            return s;
                          })
                        }
                        aria-label={`List ${it.title}`}
                      />
                    ) : (
                      <span className="w-4 shrink-0" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" title={it.title}>{it.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {itemPriceLabel(it.current_price_cents)} · {isDraft ? (n >= DECLUTTER_MIN_PHOTOS ? photosWord(n) : `${n} of ${photosWord(DECLUTTER_MIN_PHOTOS)}`) : sellerStatusLabel(it)}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link to={isDraft ? `/declutter/sell?item=${it.id}` : `/declutter/item/${it.id}`}>{isDraft ? (n >= DECLUTTER_MIN_PHOTOS ? "Edit" : "Add photos") : "View"}</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Section>

      {ready.length > 0 && !photos.isError && (
        <Section id="move-list" title={`${stepNo("list")}. List ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`}>
          {savedSetup.hasSettings && !listOptionsOpen && savedWindows.isSuccess && !pickupWindowsProblem(windows) ? (
            <div className="space-y-1" data-move-list-saved="">
              <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{windowsSummary(windows)}</p>
              <LastSetupNote saved onChange={() => setListOptionsOpen(true)} />
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
          </>)}
          <h3 className="text-sm font-semibold pt-2">Confirm about these items</h3>
          <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. One tick covers every item you list now.</p>
          <TaxStatementsCheck id="move-tax" checked={attested} onChange={setAttested} />
          <Button type="button" disabled={!!progress || chosen.length === 0 || !savedWindows.isSuccess} onClick={() => void onListAll()}>
            {progress ? `Listing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `List ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Each item gets the same photo check and review as a single listing, so some may wait for a review first. Listing many takes a few seconds each.
          </p>
        </Section>
      )}

      <Section id="move-day" title={`${stepNo("day")}. Moving day`}>
        <p className="text-sm text-muted-foreground">
          Need a hand carrying things out, or a truck for whatever doesn't sell? Hire a Helpr for the job.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* D4-6: both open a pre-filled job, never a blank Post a job. */}
          <Button asChild variant="outline" size="sm">
            <Link to={movingDayPostJobPath(current)}>Hire a Helpr for moving day</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={haulIds.length > 0 ? haulAwayPostJobPath(haulIds) : movingDayPostJobPath(current)}>Haul away what's left</Link>
          </Button>
        </div>
        {current && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={changingDate}
            onClick={() => setAskEnd(true)}
          >
            End the moving sale
          </Button>
        )}
        <ConfirmSheet open={askEnd} title="End the moving sale?" confirmLabel="End the moving sale" pending={changingDate}
          onConfirm={() => { setAskEnd(false); void onChangeDate(null); }} onClose={() => setAskEnd(false)} testId="move-end-sale">
          Your items stay up as ordinary listings.
        </ConfirmSheet>
      </Section>
    </AppPage>
  );
}

/** The moving-out steps on screen, in order; a section's number is its place here (audit #30). */
export function moveStepNumber(showCheck: boolean, showList: boolean): (key: string) => number {
  const shown = ["when", "rooms", showCheck && "check", "items", showList && "list", "day"].filter(Boolean);
  return (key: string) => shown.indexOf(key) + 1;
}
