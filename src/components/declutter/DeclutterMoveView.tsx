/**
 * /declutter/move — moving-out mode (docs/specs/declutter-moving-out.md).
 * One page, in order:
 *   1. The move: move-out date, the area buyers see, the private pickup
 *      address (asked once for every item).
 *   2. Room photos (1 to 4 per room): the photo tool lists what it sees.
 *      The room photos are only sent to the tool; never saved or shown.
 *   3. Check the list: keep or drop each item, name it, price it. Saving
 *      makes drafts (declutter_create_move_drafts: every listing rule).
 *   4. The moving-sale items: each draft still needs its own 3 to 12 photos
 *      (row 31), added in the ordinary listing form.
 *   5. List the ready ones together: pickup times, the four confirmations,
 *      then one publish per item (the review queue still applies).
 *   6. Moving day: change the date or end the sale; hire a Helpr for help
 *      or to haul away what's left (links only; those features are their own).
 * Hidden unless both the 'declutter' and 'declutter_moving_out' switches are
 * on; every RPC refuses without them anyway.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useAwardBlockReason } from "@/hooks/useAwardBlockReason";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import NotFound from "@/pages/info/NotFound";
import { geocodeAddress } from "@/lib/geocode";
import { fetchMyItemPrivate, fetchMyPickupWindows, fetchPhotos, setPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import {
  chunk,
  createMoveDrafts,
  fetchMyMoveItems,
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
import { CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL, STATUS_LABEL, TAX_STATEMENTS } from "./declutterUi";
import { AREA_ADDRESS_RE } from "./DeclutterSellView";
import { PickupTimesEditor } from "./DeclutterPickupTimes";

const input = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm";

/** The 404 unless 'declutter_moving_out' is on too (DeclutterGate checks 'declutter'). */
export function MovingOutGate({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const on = useFeature("declutter_moving_out");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  const state = qc.getQueryState(["feature-enabled", "declutter_moving_out", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
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
  const payoutBlock = useAwardBlockReason();
  const today = louisianaToday();

  const [date, setDate] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [rows, setRows] = useState<MoveRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [changingDate, setChangingDate] = useState(false);
  const scans = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const moveItems = useQuery({ queryKey: ["declutter", "move-items", user?.id], queryFn: () => fetchMyMoveItems(user!.id), enabled: !!user });
  const inPlay = useMemo(
    () => (moveItems.data ?? []).filter((i) => ["draft", "pending_review", "live", "reserved"].includes(i.status)),
    [moveItems.data],
  );
  const drafts = useMemo(() => inPlay.filter((i) => i.status === "draft"), [inPlay]);
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
  const ready = drafts.filter((d) => (photoCount.get(d.id) ?? 0) >= 3);
  const chosen = ready.filter((d) => (picked ? picked.has(d.id) : true));
  const savedWindows = useQuery({ queryKey: ["declutter", "windows", user?.id], queryFn: () => fetchMyPickupWindows(user!.id), enabled: !!user });
  const current = inPlay[0]?.move_out_on ?? null;
  const prefillFrom = inPlay[0]?.id ?? null;
  const priv = useQuery({ queryKey: ["declutter", "private", prefillFrom], queryFn: () => fetchMyItemPrivate(prefillFrom!), enabled: !!prefillFrom });

  // Carry the move's date, area and address forward from what is saved.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !inPlay[0] || !priv.data) return;
    prefilled.current = true;
    setDate((d) => d || inPlay[0].move_out_on);
    setAreaLabel((a) => a || inPlay[0].area_label);
    setPickupAddress((p) => p || priv.data.pickup_address);
  }, [inPlay, priv.data]);
  useEffect(() => {
    const saved = savedWindows.data ?? [];
    if (saved.length > 0) setWindows(saved.map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) })));
  }, [savedWindows.data]);

  if (!user) return null;
  if (underAge) {
    return (
      <AppPage title="Moving out" backTo="/declutter?view=mine">
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
    try {
      const g = await geocodeAddress(pickupAddress);
      if (!g) throw new Error("invalid_location");
      const place = { areaLabel: areaLabel.trim(), pickupAddress: pickupAddress.trim(), pickupLat: g.latitude, pickupLng: g.longitude };
      let saved = 0;
      for (const batch of chunk(kept, MOVE_SAVE_BATCH)) {
        await createMoveDrafts(date, place, batch);
        saved += batch.length;
        const done = new Set(batch.map((r) => r.key));
        setRows((rs) => rs.filter((r) => !done.has(r.key)));
      }
      toast.success(`Saved ${saved} ${saved === 1 ? "item" : "items"}. Next, add photos of each one.`);
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  async function onListAll() {
    if (checks.some((c) => !c)) {
      toast.error("All four statements need a check before you can list these items.");
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
      toast.success(next === null ? "Moving sale ended. Your items stay up as ordinary listings." : `Move-out date changed on ${n} ${n === 1 ? "item" : "items"}.`);
      if (next === null) setDate("");
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setChangingDate(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  return (
    <AppPage title="Moving out" backTo="/declutter?view=mine">
      <p className="text-sm text-muted-foreground">
        Photograph each room. The photo tool lists what it sees, you set the prices, and everything goes up together as one moving sale on your profile.
      </p>
      {payoutBlock && (
        <DeclutterNotice tone="warn" title="Set up payouts before you list.">
          You can save your items now and list them once payouts are set up.{" "}
          <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
        </DeclutterNotice>
      )}

      <Section id="move-when" title="1. Your move">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-sm font-medium" htmlFor="move-date">Move-out date</label>
            <input id="move-date" type="date" className={input} value={date} min={today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium" htmlFor="move-area">Area buyers see</label>
            <input id="move-area" className={input} maxLength={80} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder="Mid-City, Baton Rouge" />
          </div>
        </div>
        <label className="block text-sm font-medium" htmlFor="move-address">Pickup address</label>
        <input id="move-address" className={input} maxLength={300} value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
        <p className="text-xs text-muted-foreground">
          Buyers see your area and your move-out date. Only the buyer who pays sees the address.
        </p>
        {current && date && date !== current && !dateProblem && (
          <Button type="button" variant="outline" size="sm" disabled={changingDate} onClick={() => void onChangeDate(date)}>
            {changingDate ? "Changing…" : `Change the date on my moving-sale items to ${formatMoveDate(date)}`}
          </Button>
        )}
      </Section>

      <Section id="move-rooms" title="2. Photograph a room">
        <p className="text-xs text-muted-foreground">
          Up to {MOVE_ROOM_PHOTOS_MAX} photos of one room at a time. They're only used to find the items. They aren't saved or shown to buyers.
        </p>
        <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" id="move-files" onChange={(e) => void onRoomPhotos(e.target.files)} />
        <Button asChild variant="outline" size="sm" className="cursor-pointer">
          <label htmlFor="move-files">{scanning ? "Looking at your photos…" : "Add room photos"}</label>
        </Button>
      </Section>

      {rows.length > 0 && (
        <Section id="move-check" title={`3. Check each item (${kept.length} of ${rows.length} kept)`}>
          <p className="text-xs text-muted-foreground">
            Untick anything you're keeping. Give each item a price. Leave the lowest price blank to keep the price as it is; fill it in and the price drops 5% each evening until it gets there.
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
                      {CATEGORY_LABEL[r.category] ?? "Other"} · {SIZE_LABEL[r.deliverySize]} · {r.conditionStars} stars: {CONDITION_LABEL[r.conditionStars]}
                    </p>
                    {r.flagged && (
                      <p className="text-xs text-amber-800 dark:text-amber-200">This item may not be allowed, so someone from Louisiana Helpr will look at it before it goes up.</p>
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

      <Section id="move-items" title="4. Your moving-sale items">
        {moveItems.isError ? (
          <p className="text-sm text-muted-foreground">{declutterErrorMessage(moveItems.error)}</p>
        ) : moveItems.isLoading || photos.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your items…</p>
        ) : inPlay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet. Add room photos to start.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Each item needs 3 to 12 photos of its own before it can be listed. Tap an item to add them.</p>
            <ul className="divide-y divide-border">
              {inPlay.map((it) => {
                const n = photoCount.get(it.id) ?? 0;
                const isDraft = it.status === "draft";
                return (
                  <li key={it.id} className="py-2 flex items-center gap-3 min-w-0">
                    {isDraft && n >= 3 ? (
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
                        {formatPrice(it.current_price_cents)} · {isDraft ? `${n} of 3 photos` : STATUS_LABEL[it.status]}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link to={isDraft ? `/declutter/sell?item=${it.id}` : `/declutter/item/${it.id}`}>{isDraft ? (n >= 3 ? "Edit" : "Add photos") : "View"}</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Section>

      {ready.length > 0 && (
        <Section id="move-list" title={`5. List ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`}>
          <h3 className="text-sm font-semibold">Your usual pickup times</h3>
          <p className="text-xs text-muted-foreground">Buyers pick one of these times. They apply to all your listings.</p>
          <PickupTimesEditor windows={windows} setWindows={setWindows} />
          <h3 className="text-sm font-semibold pt-2">Confirm about these items</h3>
          <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. Each statement counts for every item you list now.</p>
          {TAX_STATEMENTS.map((s, i) => (
            <div key={s} className="flex items-start gap-3 text-sm">
              <Checkbox id={`move-tax-${i}`} className="mt-0.5" checked={checks[i]}
                onCheckedChange={(v) => setChecks((c) => c.map((x, j) => (j === i ? v === true : x)))} />
              <label htmlFor={`move-tax-${i}`}>{s}</label>
            </div>
          ))}
          {payoutBlock ? (
            <p className="text-sm text-muted-foreground">Set up payouts first (see the note at the top).</p>
          ) : (
            <Button type="button" disabled={!!progress || chosen.length === 0} onClick={() => void onListAll()}>
              {progress ? `Listing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `List ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Each item gets the same photo check and review as a single listing, so some may wait for a review first. Listing many takes a few seconds each.
          </p>
        </Section>
      )}

      <Section id="move-day" title="6. Moving day">
        <p className="text-sm text-muted-foreground">
          Need a hand carrying things out, or a truck for whatever doesn't sell? Hire a Helpr for the job.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/post-job">Hire a Helpr for moving day</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/post-job">Haul away what's left</Link>
          </Button>
        </div>
        {current && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={changingDate}
            onClick={() => {
              if (window.confirm("End the moving sale? Your items stay up as ordinary listings.")) void onChangeDate(null);
            }}
          >
            End the moving sale
          </Button>
        )}
      </Section>
    </AppPage>
  );
}
