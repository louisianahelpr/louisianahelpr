/**
 * /declutter/sell[?item=<draft id>] — post an item (spec rows 31, 32, 34, 52,
 * 54, 56, 23, 53). One page, in order:
 *   1. The details: name, price + hidden lowest price (row 56, B3), area
 *      label (never a street address) and the private pickup address.
 *      Saving creates the draft (or edits it: declutter_update_draft).
 *   2. Photos, 3 to 12 (row 31), cleaned of location data before upload
 *      (src/lib/declutter/photos.ts), then "Fill in from my photos" (row 32):
 *      the AI drafts the details for the seller to edit; it also checks for
 *      banned items (row 34), which the server keeps for an admin.
 *   3. The seller's usual pickup times (row 52, B6).
 *   4. The four tax confirmations (row 54).
 *   5. List it: live, or waiting for a review (row 33).
 * Under 18 (row 53) and missing payout setup (row 23) show as plain-English
 * blocks, never as dead buttons; the server refuses both anyway.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useAwardBlockReason } from "@/hooks/useAwardBlockReason";
import { geocodeAddress } from "@/lib/geocode";
import {
  addPhoto,
  attestItem,
  createDraft,
  fetchItem,
  fetchMyItemPrivate,
  fetchMyPickupWindows,
  fetchPhotos,
  photoPublicUrl,
  publishItem,
  removePhoto,
  setPorchOk,
  requestAiCheck,
  requestAiDraft,
  setPickupWindows,
  updateDraft,
  type DeliverySize,
  type DraftFields,
  type PickupWindow,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL, TAX_STATEMENTS } from "./declutterUi";
import { PickupTimesEditor } from "./DeclutterPickupTimes";
import PriceHint from "./DeclutterPriceHint";
import { useDeclutterOrigin } from "./useDeclutterOrigin";

interface FormState {
  title: string;
  description: string;
  category: string;
  conditionStars: number;
  deliverySize: DeliverySize;
  price: string;
  floor: string;
  areaLabel: string;
  pickupAddress: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  category: "other",
  conditionStars: 3,
  deliverySize: "small",
  price: "",
  floor: "",
  areaLabel: "",
  pickupAddress: "",
};

/** Dollars as typed -> whole cents, or null. */
export function dollarsToCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** A house number then a street word (declutter_area_label_problem's first rule; the server also checks the pickup street). */
export const AREA_ADDRESS_RE =
  /(^|[^0-9a-z-])[0-9]+[a-z]?\s+([a-z.'-]+\s+){0,3}(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard|parkway|pkwy|hwy|highway|cir|circle|court|ct|way|place|pl|trail|trl)\b/i;

/** What is wrong with the form, in plain words, or null. Mirrors the server's checks. */
export function formProblem(f: FormState): string | null {
  if (f.title.trim().length < 3) return "Give the item a name of at least 3 characters.";
  const price = dollarsToCents(f.price);
  const floor = dollarsToCents(f.floor);
  if (price === null || price < 100 || price > 100_000) return "Set a price between $1 and $1,000.";
  if (floor === null || floor < 100 || floor > price) {
    return "Set your lowest price: at least $1 and no more than your price.";
  }
  if (f.areaLabel.trim().length < 2) return "Add your neighborhood or town.";
  if (AREA_ADDRESS_RE.test(f.areaLabel)) return "Use your neighborhood or town for the area, not a street address.";
  if (f.pickupAddress.trim().length < 5) return "Add the pickup address. Buyers only see it after they pay.";
  return null;
}

const centsToDollars = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");

export default function SellFlow() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const itemId = params.get("item");
  const { underAge } = useAgeGate();
  const payoutBlock = useAwardBlockReason();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [coords, setCoords] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [publishing, setPublishing] = useState(false);
  // Row 101: porch pickup is the default; the seller turns it off per item.
  const [porchOk, setPorchOkChoice] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  // Where the price hint looks (W12): the pickup address once found, else the
  // saved listing's area, else what we already know about the member.
  // Never asks for location.
  const { origin } = useDeclutterOrigin();

  const item = useQuery({ queryKey: ["declutter", "item", itemId], queryFn: () => fetchItem(itemId!), enabled: !!itemId });
  const priv = useQuery({ queryKey: ["declutter", "private", itemId], queryFn: () => fetchMyItemPrivate(itemId!), enabled: !!itemId });
  const photos = useQuery({ queryKey: ["declutter", "item-photos", itemId], queryFn: () => fetchPhotos([itemId!]), enabled: !!itemId });
  const savedWindows = useQuery({
    queryKey: ["declutter", "windows", user?.id],
    queryFn: () => fetchMyPickupWindows(user!.id),
    enabled: !!user,
  });

  // Load an existing draft into the form once.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || !item.data || !priv.data || loadedFor.current === itemId) return;
    loadedFor.current = itemId;
    const it = item.data;
    setForm({
      title: it.title,
      description: it.description,
      category: it.category,
      conditionStars: it.condition_stars,
      deliverySize: it.delivery_size,
      price: centsToDollars(it.price_cents),
      floor: centsToDollars(priv.data.floor_price_cents),
      areaLabel: it.area_label,
      pickupAddress: priv.data.pickup_address,
    });
    setCoords({ lat: Number(priv.data.pickup_lat), lng: Number(priv.data.pickup_lng), address: priv.data.pickup_address });
    setPorchOkChoice(it.porch_ok !== false);
  }, [itemId, item.data, priv.data]);

  useEffect(() => {
    const rows = savedWindows.data ?? [];
    if (rows.length > 0) {
      setWindows(rows.map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) })));
    }
  }, [savedWindows.data]);

  const photoCount = (photos.data ?? []).length;
  const problem = useMemo(() => formProblem(form), [form]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!user) return null;
  if (underAge) {
    return (
      <AppPage title="Sell an item" backTo="/declutter">
        <DeclutterNotice tone="warn" title="You must be 18 or older to sell on Declutter.">
          You can still look around. Selling opens when your birthday on file says you're 18.
        </DeclutterNotice>
      </AppPage>
    );
  }
  if (itemId && item.data && item.data.status !== "draft") {
    return (
      <AppPage title="Sell an item" backTo="/declutter?view=mine">
        <DeclutterNotice title="This item is already listed.">
          <Link to={`/declutter/item/${itemId}`} className="underline">See the listing</Link>
        </DeclutterNotice>
      </AppPage>
    );
  }

  async function saveDetails(): Promise<string | null> {
    if (problem) {
      toast.error(problem);
      return null;
    }
    setSaving(true);
    try {
      let c = coords;
      if (!c || c.address !== form.pickupAddress.trim()) {
        const g = await geocodeAddress(form.pickupAddress);
        if (!g) throw new Error("invalid_location");
        c = { lat: g.latitude, lng: g.longitude, address: form.pickupAddress.trim() };
        setCoords(c);
      }
      const fields: DraftFields = {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        conditionStars: form.conditionStars,
        deliverySize: form.deliverySize,
        priceCents: dollarsToCents(form.price)!,
        floorPriceCents: dollarsToCents(form.floor)!,
        areaLabel: form.areaLabel.trim(),
        pickupAddress: form.pickupAddress.trim(),
        pickupLat: c.lat,
        pickupLng: c.lng,
      };
      if (itemId) {
        await updateDraft(itemId, fields);
        if (porchOk !== (item.data?.porch_ok !== false)) await setPorchOk(itemId, porchOk);
        toast.success("Saved.");
        void qc.invalidateQueries({ queryKey: ["declutter"] });
        return itemId;
      }
      const id = await createDraft(fields);
      loadedFor.current = id;
      setParams({ item: id }, { replace: true });
      // A new draft allows porch; only a seller who turned it off needs the second
      // call. If it fails the draft still exists with porch on, and the next save retries it.
      if (!porchOk) await setPorchOk(id, false);
      toast.success("Saved. Now add photos.");
      return id;
    } catch (err) {
      toast.error(declutterErrorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || !itemId) return;
    const room = 12 - photoCount;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) toast.error("A listing can have up to 12 photos.");
    setUploading(list.length);
    for (const f of list) {
      try {
        await addPhoto(user!.id, itemId, f);
      } catch (err) {
        toast.error(declutterErrorMessage(err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void qc.invalidateQueries({ queryKey: ["declutter", "item-photos", itemId] });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onRemovePhoto(photoId: string) {
    try {
      await removePhoto(photoId);
      void qc.invalidateQueries({ queryKey: ["declutter", "item-photos", itemId] });
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    }
  }

  async function onAiDraft() {
    if (!itemId) return;
    setAiBusy(true);
    try {
      const d = await requestAiDraft(itemId);
      setForm((f) => ({
        ...f,
        title: d.title,
        description: d.description,
        category: d.category,
        deliverySize: d.deliverySize,
        conditionStars: d.conditionStars,
      }));
      toast.success(
        d.flagged
          ? "Filled in. Check every detail. This item may not be allowed, so someone from Louisiana Helpr will look at it before it goes up."
          : "Filled in. Check every detail, then save.",
      );
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function onPublish() {
    if (!itemId) return;
    if (checks.some((c) => !c)) {
      toast.error("All four statements need a check before you can list this item.");
      return;
    }
    setPublishing(true);
    try {
      const saved = await saveDetails();
      if (!saved) return;
      await setPickupWindows(windows);
      await attestItem(itemId);
      try {
        await requestAiCheck(itemId);
      } catch (err) {
        // Fail-safe: an unchecked listing publishes to an admin's review.
        console.warn("[declutter] photo check unavailable; the listing goes to review", err);
      }
      const status = await publishItem(itemId);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      toast.success(
        status === "live" ? "Your item is for sale." : "Sent for a review. We'll let you know when it's up for sale.",
      );
      navigate("/declutter?view=mine");
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
  return (
    <AppPage title="Sell an item" backTo="/declutter?view=mine">
      {payoutBlock && (
        <DeclutterNotice tone="warn" title="Set up payouts before you list.">
          We pay you through the same payout account Helprs use. You can write the listing now and list it once payouts are set up.{" "}
          <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
        </DeclutterNotice>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="sell-details">
        <h2 id="sell-details" className="text-base font-semibold">1. The item</h2>
        <label className="block text-sm font-medium" htmlFor="sell-title">Name</label>
        <input id="sell-title" className={input} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Oak rocking chair" />
        <label className="block text-sm font-medium" htmlFor="sell-desc">Description</label>
        <textarea id="sell-desc" className={input} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium" htmlFor="sell-category">Category</label>
            <select id="sell-category" className={input} value={form.category} onChange={(e) => set("category", e.target.value)}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="sell-condition">Condition</label>
            <select id="sell-condition" className={input} value={form.conditionStars} onChange={(e) => set("conditionStars", Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{`${n} stars: ${CONDITION_LABEL[n]}`}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium" htmlFor="sell-size">Size</label>
            <select id="sell-size" className={input} value={form.deliverySize} onChange={(e) => set("deliverySize", e.target.value as DeliverySize)}>
              {(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => <option key={k} value={k}>{SIZE_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="sell-price">Price ($)</label>
            <input id="sell-price" className={input} inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="40" />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="sell-floor">Lowest price ($)</label>
            <input id="sell-floor" className={input} inputMode="decimal" value={form.floor} onChange={(e) => set("floor", e.target.value)} placeholder="20" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Only you see your lowest price. If the item doesn't sell, the price drops 5% each evening until it reaches your lowest price. Set it the same as your price for no drops.
        </p>
        <PriceHint
          category={form.category}
          conditionStars={form.conditionStars}
          place="near_you"
          at={
            coords
              ? { lat: coords.lat, lng: coords.lng }
              : item.data
                ? { lat: Number(item.data.area_lat), lng: Number(item.data.area_lng) }
                : origin.status === "ready"
                  ? { lat: origin.lat, lng: origin.lng }
                  : null
          }
        />
        <label className="block text-sm font-medium" htmlFor="sell-area">Area buyers see</label>
        <input id="sell-area" className={input} maxLength={80} value={form.areaLabel} onChange={(e) => set("areaLabel", e.target.value)} placeholder="Mid-City, Baton Rouge" />
        <p className="text-xs text-muted-foreground">Your neighborhood or town, never your street address.</p>
        <label className="block text-sm font-medium" htmlFor="sell-address">Pickup address</label>
        <input id="sell-address" className={input} maxLength={300} value={form.pickupAddress} onChange={(e) => set("pickupAddress", e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
        <p className="text-xs text-muted-foreground">Private. Only the buyer who pays sees it.</p>
        <div className="flex items-start gap-3 text-sm">
          <Checkbox id="sell-porch" className="mt-0.5" checked={porchOk} onCheckedChange={(v) => setPorchOkChoice(v === true)} />
          <label htmlFor="sell-porch">
            <span className="font-medium">Porch pickup</span>
            <span className="block text-xs text-muted-foreground">
              You leave the item out and the buyer picks it up, so you don't have to meet. Turn this off for anything too valuable or too big to leave outside. Buyers then meet you at your home.
            </span>
          </label>
        </div>
        {problem && <p className="text-xs text-muted-foreground" data-testid="sell-form-problem">{problem}</p>}
        <Button type="button" size="sm" disabled={saving} onClick={() => void saveDetails()}>
          {saving ? "Saving…" : itemId ? "Save details" : "Save and add photos"}
        </Button>
      </section>

      {itemId ? (
        <>
          <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="sell-photos">
            <h2 id="sell-photos" className="text-base font-semibold">2. Photos ({photoCount} of 3 to 12)</h2>
            <p className="text-xs text-muted-foreground">Take your own photos of the item. Location data is removed from every photo before it's uploaded.</p>
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {(photos.data ?? []).map((p, i) => (
                <li key={p.id} className="relative">
                  <img src={photoPublicUrl(p.storage_path)} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover rounded-xl bg-muted" />
                  <button
                    type="button"
                    className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center"
                    onClick={() => void onRemovePhoto(p.id)}
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <span className="w-7 h-7 rounded-full bg-background/90 text-foreground shadow flex items-center justify-center" aria-hidden>
                      <X className="w-4 h-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" id="sell-files" onChange={(e) => void onFiles(e.target.files)} />
            <div className="flex flex-wrap gap-2">
              {photoCount < 12 && (
                <Button asChild variant="outline" size="sm" className="cursor-pointer">
                  <label htmlFor="sell-files">{uploading > 0 ? `Adding ${uploading}…` : "Add photos"}</label>
                </Button>
              )}
              {photoCount > 0 && (
                <Button type="button" variant="outline" size="sm" disabled={aiBusy} onClick={() => void onAiDraft()}>
                  {aiBusy ? "Looking at your photos…" : "Fill in from my photos"}
                </Button>
              )}
            </div>
            {photoCount > 0 && (
              <p className="text-xs text-muted-foreground">The photo tool fills in the name, description, category, size and condition. You can change anything, then save.</p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="sell-pickup">
            <h2 id="sell-pickup" className="text-base font-semibold">3. Your usual pickup times</h2>
            <p className="text-xs text-muted-foreground">Buyers pick one of these times. They apply to all your listings.</p>
            <PickupTimesEditor windows={windows} setWindows={setWindows} />
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="sell-tax">
            <h2 id="sell-tax" className="text-base font-semibold">4. Confirm about this item</h2>
            <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. Check all four to list.</p>
            {TAX_STATEMENTS.map((s, i) => (
              <div key={s} className="flex items-start gap-3 text-sm">
                <Checkbox id={`sell-tax-${i}`} className="mt-0.5" checked={checks[i]}
                  onCheckedChange={(v) => setChecks((c) => c.map((x, j) => (j === i ? v === true : x)))} />
                <label htmlFor={`sell-tax-${i}`}>{s}</label>
              </div>
            ))}
          </section>

          <section className="space-y-2" aria-labelledby="sell-publish">
            <h2 id="sell-publish" className="text-base font-semibold">5. List it</h2>
            {photoCount < 3 && <p className="text-sm text-muted-foreground">Add at least 3 photos to list this item.</p>}
            {payoutBlock && <p className="text-sm text-muted-foreground">Set up payouts first (see the note at the top).</p>}
            {photoCount >= 3 && !payoutBlock && (
              <Button type="button" disabled={publishing} onClick={() => void onPublish()}>
                {publishing ? "Listing…" : "List this item"}
              </Button>
            )}
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">After you save, you'll add photos, pickup times and four quick confirmations.</p>
      )}
    </AppPage>
  );
}
