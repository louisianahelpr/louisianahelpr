/**
 * /declutter/sell[?item=<draft id>] — post an item in FIVE steps (boards 31a,
 * 48, 31b, 49, 158; spec v2 §3 "Step-by-step flows"; rows 31, 32, 34, 52, 54,
 * 56, 23, 53):
 *   1. Show it off: photos, at least 1 up to 12 (DeclutterSellPhotos.tsx),
 *      cleaned of location data before upload (src/lib/declutter/photos.ts).
 *      Before the first save they wait on the device. "Fill in from my photos"
 *      (row 32) drafts the details once photos are on a saved draft; it also
 *      checks for banned items (row 34), which the server keeps.
 *   2. What is it: title, category, condition, size, notes.
 *   3. Price + the private lowest price (row 56, B3), with the real nightly
 *      drop rule drawn (priceDrop.ts); never a promised schedule.
 *   4. How buyers get it: porch pickup (row 101), the area label (never a
 *      street address), the private pickup address and pickup times (row 52).
 *      Continue SAVES the draft (create or declutter_update_draft) and uploads
 *      the held photos.
 *   5. Ready to list: the preview, the four tax confirmations (row 54), List it
 *      (live, or waiting for a review: row 33).
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
import { Switch } from "@/components/ui/switch";
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
  photoPublicUrl,
} from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { PRICE_DROP_RUN_UTC } from "@/lib/declutter/priceDrop";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL, TAX_STATEMENTS } from "./declutterUi";
import { DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { PickupTimesEditor } from "./DeclutterPickupTimes";
import PriceHint from "./DeclutterPriceHint";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { SellItForMeEntry } from "./SellItForMe";

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
  // Board 31a-158: which of the 5 steps is on screen.
  const [step, setStep] = useState(1);
  // Row 101: porch pickup is the default; the seller turns it off per item.
  const [porchOk, setPorchOkChoice] = useState(true);
  // Photos chosen before the first save (there is no draft to hold them yet).
  const [held, setHeld] = useState<File[]>([]);
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
      <AppPage title="Sell an item" backTo="/declutter?view=selling">
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
      // The photos chosen first go up now that the draft exists. A photo that
      // fails says so (uploadPhotos) and can simply be added again.
      const waiting = held;
      setHeld([]);
      const added = await uploadPhotos(id, waiting);
      toast.success(added > 0 ? "Saved with your photos." : "Saved. Now add photos.");
      return id;
    } catch (err) {
      toast.error(declutterErrorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  /** Uploads each photo to the draft; a failed one is said out loud and skipped. Returns how many went up. */
  async function uploadPhotos(id: string, list: File[]): Promise<number> {
    let added = 0;
    setUploading(list.length);
    for (const f of list) {
      try {
        await addPhoto(user!.id, id, f);
        added += 1;
      } catch (err) {
        toast.error(declutterErrorMessage(err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void qc.invalidateQueries({ queryKey: ["declutter", "item-photos", id] });
    return added;
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photoCount - held.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) toast.error("A listing can have up to 12 photos.");
    if (!itemId) {
      setHeld((h) => [...h, ...list]);
      return;
    }
    await uploadPhotos(itemId, list);
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
      navigate("/declutter?view=selling");
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  const input = "w-full h-[52px] rounded-[14px] border border-border bg-card px-4 text-ds-15 text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground/70";
  const chip = (on: boolean) =>
    `flex min-h-10 items-center rounded-full px-4 text-ds-13 font-semibold ${on ? "btn-grad-primary text-primary-foreground" : "border border-border bg-card text-foreground"}`;
  const photoTotal = photoCount + held.length;
  const priceCents = dollarsToCents(form.price);
  const floorCents = dollarsToCents(form.floor);
  const stepProblem = sellStepProblem(step, form, photoTotal);
  const next = async () => {
    if (stepProblem) {
      toast.error(stepProblem);
      return;
    }
    // Step 4 saves the draft (and uploads the photos held on the device), so step 5 lists a real draft.
    if (step === 4) {
      const saved = await saveDetails();
      if (!saved) return;
    }
    setStep((s) => Math.min(5, s + 1));
    window.scrollTo?.({ top: 0 });
  };
  const back = () => (step > 1 ? setStep((s) => s - 1) : navigate("/declutter?tab=selling"));
  const label = (htmlFor: string, text: string, extra?: string) => (
    <label className="block text-ds-14 font-semibold text-foreground" htmlFor={htmlFor}>
      {text}
      {extra && <span className="font-normal text-muted-foreground"> {extra}</span>}
    </label>
  );
  return (
    <AppPage title="Sell an item" onBack={back} phoneHidesTitle>
      {/* Board 31a/48/31b/49/158: one question per step, "n of 5" progress (spec §3 "Step-by-step flows"). */}
      <div className="mx-auto w-full max-w-xl space-y-5">
      <div className="flex items-center gap-3" data-sell-progress={step}>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
        <span className="text-ds-13 font-semibold text-muted-foreground">{step} of 5</span>
      </div>

      {/* Said up front (step 1) and again where it blocks (step 5). */}
      {payoutBlock && (step === 1 || step === 5) && (
        <DeclutterNotice tone="warn" title="Set up payouts before you list.">
          We pay you through the same payout account Helprs use. You can write the listing now and list it once payouts are set up.{" "}
          <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
        </DeclutterNotice>
      )}

      {step === 1 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="Show it off" sub={`Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}, up to ${MAX_PHOTOS}. The first one is the cover.`} />
          <SellPhotos
            uploaded={photos.data ?? []}
            held={held}
            onFiles={(f) => void onFiles(f)}
            onRemoveUploaded={(photoId) => void onRemovePhoto(photoId)}
            onRemoveHeld={(i) => setHeld((h) => h.filter((_, j) => j !== i))}
            uploading={uploading}
            ai={itemId && photoCount > 0 ? { busy: aiBusy, run: () => void onAiDraft() } : null}
          />
          {/* "Sell it for me" (owner 2026-10-19): a new listing only, never on a draft already started. */}
          {!itemId && <SellItForMeEntry />}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="What is it?" sub="Plain words work best. Buyers search for what they'd call it." />
          <div className="space-y-2">
            {label("sell-title", "Title")}
            <input id="sell-title" className={input} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Oak rocking chair" />
          </div>
          <ChipGroup label="Category" options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))} value={form.category} onChange={(v) => set("category", v)} chip={chip} />
          <ChipGroup label="Condition" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: CONDITION_LABEL[n] }))} value={String(form.conditionStars)} onChange={(v) => set("conditionStars", Number(v))} chip={chip} />
          <ChipGroup label="Size" options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: SIZE_LABEL[k] }))} value={form.deliverySize} onChange={(v) => set("deliverySize", v as DeliverySize)} chip={chip} />
          <div className="space-y-2">
            {label("sell-desc", "Anything else?", "(optional)")}
            <textarea id="sell-desc" className={`${input} h-auto py-3`} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Works great. Small scuff on the base." />
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="What's your price?" sub="You keep the whole price. Buyers pay a small fee on top." />
          <div className="flex items-center justify-center gap-4">
            <StepperButton label="Lower the price by $1" disabled={!priceCents || priceCents <= 100} onClick={() => set("price", centsToDollars(Math.max(100, (priceCents ?? 100) - 100)))}>−</StepperButton>
            <div className="flex min-w-0 items-baseline justify-center text-[hsl(var(--burnt-sienna))]">
              <span className="text-ds-40 font-bold" aria-hidden>$</span>
              <input
                id="sell-price"
                aria-label="Price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                style={{ width: `${Math.max(1, form.price.length || 1) + 0.5}ch` }}
                className="max-w-[7ch] bg-transparent text-left text-ds-40 font-bold tabular-nums outline-none focus-visible:outline-none placeholder:text-[hsl(var(--burnt-sienna)/0.4)]"
              />
            </div>
            <StepperButton label="Raise the price by $1" disabled={(priceCents ?? 0) >= 100_000} onClick={() => set("price", centsToDollars(Math.min(100_000, (priceCents ?? 0) + 100)))}>+</StepperButton>
          </div>
          <div className="space-y-2">
            {label("sell-floor", "Lowest you'll take")}
            <div className="flex h-[52px] items-center gap-1 rounded-[14px] border border-border bg-card px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
              <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>
              <input id="sell-floor" inputMode="decimal" value={form.floor} onChange={(e) => set("floor", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 30"
                className="w-full bg-transparent text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/70" />
            </div>
            <p className="text-ds-13 text-muted-foreground">
              Only you see this.{priceCents ? ` Set it to ${formatPrice(priceCents)} for no drops.` : " Set it the same as your price for no drops."}
            </p>
          </div>
          <DropSchedule priceCents={priceCents} floorCents={floorCents} />
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
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="How can buyers get it?" sub="Turn on every way that works for you." />
          <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
            <li className="flex items-start gap-3 px-4 py-3.5">
              <label htmlFor="sell-porch" className="min-w-0 flex-1">
                <span className="block text-ds-15 font-semibold text-foreground">Porch pickup</span>
                <span className="block text-ds-13 text-muted-foreground">
                  You leave it out and the buyer picks it up, so you don't have to meet. Turn this off for anything too valuable or too big to leave outside.
                </span>
              </label>
              <Switch id="sell-porch" checked={porchOk} onCheckedChange={(v) => setPorchOkChoice(v === true)} />
            </li>
            <li className="px-4 py-3.5">
              <span className="block text-ds-15 font-semibold text-foreground">Pickup at your door</span>
              <span className="block text-ds-13 text-muted-foreground">Always on. The buyer gets your address after they pay.</span>
            </li>
            <li className="px-4 py-3.5">
              <span className="block text-ds-15 font-semibold text-foreground">Helpr delivery</span>
              <span className="block text-ds-13 text-muted-foreground">Always on. A local Helpr can pick it up and bring it to the buyer, who pays for it.</span>
            </li>
          </ul>
          <div className="space-y-2">
            {label("sell-area", "Area buyers see")}
            <input id="sell-area" className={input} maxLength={80} value={form.areaLabel} onChange={(e) => set("areaLabel", e.target.value)} placeholder="e.g. Mid-City, Baton Rouge" />
            <p className="text-ds-13 text-muted-foreground">Your neighborhood or town, never your street address.</p>
          </div>
          <div className="space-y-2">
            {label("sell-address", "Pickup address")}
            <input id="sell-address" className={input} maxLength={300} value={form.pickupAddress} onChange={(e) => set("pickupAddress", e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
            <p className="text-ds-13 text-muted-foreground">Private. Only the buyer who pays sees it.</p>
          </div>
          <div className="space-y-2" aria-labelledby="sell-pickup">
            <h3 id="sell-pickup" className="text-ds-14 font-semibold text-foreground">Your usual pickup times</h3>
            <p className="text-ds-13 text-muted-foreground">Buyers pick one of these times. They apply to all your listings.</p>
            <PickupTimesEditor windows={windows} setWindows={setWindows} />
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="Ready to list?" sub="This is your listing." />
          <div className="rounded-[20px] border border-border bg-card p-4 space-y-2" data-sell-preview="">
            {photos.data?.[0] && (
              <img src={photoPublicUrl(photos.data[0].storage_path)} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover bg-photo-empty" />
            )}
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-ds-17 font-bold text-foreground">{form.title.trim()}</p>
              {priceCents && <p className="shrink-0 text-ds-17 font-bold text-[hsl(var(--burnt-sienna))]">{formatPrice(priceCents)}</p>}
            </div>
            <p className="text-ds-13 text-muted-foreground">
              {[CONDITION_LABEL[form.conditionStars], CATEGORY_LABEL[form.category], form.areaLabel.trim()].filter(Boolean).join(" · ")}
            </p>
            <ul className="flex flex-wrap gap-2 pt-1" aria-label="How buyers get it">
              {porchOk && <li className="rounded-full border border-border px-3 py-1 text-ds-13 font-medium">Porch pickup</li>}
              <li className="rounded-full border border-border px-3 py-1 text-ds-13 font-medium">Pickup at your door</li>
              <li className="rounded-full border border-border px-3 py-1 text-ds-13 font-medium">Helpr delivery</li>
            </ul>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
            <ReviewRow title="Price drops" body={priceCents && floorCents && floorCents < priceCents ? `5% each evening at ${dropRunTime()}, never below ${formatPrice(floorCents)}` : "Off: your lowest price is your price"} onEdit={() => setStep(3)} />
            <ReviewRow title="Photos" body={`${photosWord(photoCount)} · the first is the cover`} onEdit={() => setStep(1)} />
            <ReviewRow title="Pickup" body={porchOk ? "Porch pickup, at your door, Helpr delivery" : "At your door, Helpr delivery"} onEdit={() => setStep(4)} />
          </ul>
          <div className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-labelledby="sell-tax">
            <h3 id="sell-tax" className="text-ds-15 font-semibold text-foreground">Confirm about this item</h3>
            <p className="text-ds-13 text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. Check all four to list.</p>
            {TAX_STATEMENTS.map((st, i) => (
              <div key={st} className="flex items-start gap-3 text-ds-14">
                <Checkbox id={`sell-tax-${i}`} className="mt-0.5" checked={checks[i]}
                  onCheckedChange={(v) => setChecks((c) => c.map((x, j) => (j === i ? v === true : x)))} />
                <label htmlFor={`sell-tax-${i}`}>{st}</label>
              </div>
            ))}
          </div>
          {photoCount < DECLUTTER_MIN_PHOTOS && <p className="text-ds-14 text-muted-foreground">Add at least {photosWord(DECLUTTER_MIN_PHOTOS)} to list this item.</p>}
        </section>
      )}

      {stepProblem && step < 5 && <p className="text-ds-13 text-muted-foreground" data-testid="sell-form-problem">{stepProblem}</p>}
      {step === 3 && priceCents && (
        <p className="flex items-baseline justify-between text-ds-14 text-foreground" data-sell-keep="">
          You get if it sells today
          <span className="font-bold text-[hsl(var(--burnt-sienna))]">{formatPrice(priceCents)}</span>
        </p>
      )}
      {step < 5 ? (
        <Button type="button" className="w-full rounded-full" disabled={saving} onClick={() => void next()}>
          {step === 4 ? (saving ? "Saving…" : "Save and continue") : "Continue"}
        </Button>
      ) : (
        photoCount >= DECLUTTER_MIN_PHOTOS && !payoutBlock && (
          <Button type="button" className="w-full rounded-full" disabled={publishing} onClick={() => void onPublish()}>
            {publishing ? "Listing…" : "List it"}
          </Button>
        )
      )}
      </div>
    </AppPage>
  );
}

/** A step's Bodoni question and its one-line helper (spec §1.2, §3 "Step-by-step flows"). */
function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="space-y-1">
      <h2 id="sell-step" className="font-display font-moment text-ds-32 font-semibold leading-tight text-foreground">{title}</h2>
      <p className="text-ds-14 text-muted-foreground">{sub}</p>
    </div>
  );
}

function ChipGroup({ label, options, value, onChange, chip }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; chip: (on: boolean) => string }) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={label}>
      <p className="text-ds-14 font-semibold text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={chip(value === o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepperButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-ds-22 text-foreground disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

function ReviewRow({ title, body, onEdit }: { title: string; body: string; onEdit: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <span className="min-w-0 flex-1">
        <span className="block text-ds-15 font-semibold text-foreground">{title}</span>
        <span className="block text-ds-13 text-muted-foreground">{body}</span>
      </span>
      <button type="button" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`} className="min-h-11 px-2 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">
        Edit
      </button>
    </li>
  );
}

/** The real nightly run (priceDrop.ts PRICE_DROP_RUN_UTC) in Louisiana time: "6:07 PM" (CDT) or "5:07 PM" (CST). */
function dropRunTime(now: Date = new Date()): string {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PRICE_DROP_RUN_UTC.hour, PRICE_DROP_RUN_UTC.minute));
  return run.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

/**
 * Board 31b's "If it doesn't sell" strip, from the REAL rule (priceDrop.ts):
 * each evening's drop is to floor(current * 0.95), never below the lowest
 * price. The stop above the floor is private even from the seller (B42), so
 * the strip says the drops may stop sooner; never a promised schedule.
 */
function DropSchedule({ priceCents, floorCents }: { priceCents: number | null; floorCents: number | null }) {
  if (!priceCents || !floorCents || floorCents >= priceCents || floorCents < 100) return null;
  const steps: number[] = [];
  let cur = priceCents;
  while (steps.length < 6 && cur > floorCents) {
    cur = Math.max(floorCents, Math.floor(cur * 0.95));
    steps.push(cur);
  }
  const max = priceCents;
  return (
    <div className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-drop-schedule="">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-ds-14 font-semibold text-foreground">If it doesn't sell</p>
        <p className="text-ds-12 text-muted-foreground">5% less each evening, {dropRunTime()}</p>
      </div>
      <ol className="flex items-end gap-1.5" aria-label="The lowest it could be each evening">
        {steps.map((c, i) => (
          <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              aria-hidden
              className={`w-full rounded-lg ${c === floorCents ? "bg-[hsl(var(--burnt-sienna))]" : "bg-[hsl(var(--burnt-sienna)/0.14)]"}`}
              style={{ height: `${Math.max(16, Math.round((c / max) * 56))}px` }}
            />
            <span className="text-ds-11 font-bold tabular-nums text-[hsl(var(--sienna-ink))]">{formatPrice(c)}</span>
          </li>
        ))}
      </ol>
      <p className="text-ds-12 text-muted-foreground">
        The first drop comes after it has been up 12 hours. It never goes below {formatPrice(floorCents)}, and may stop sooner.
      </p>
    </div>
  );
}

/** What blocks leaving a step, in the same words as formProblem (the server's checks). */
function sellStepProblem(step: number, f: FormState, photoTotal: number): string | null {
  if (step === 1) return photoTotal < DECLUTTER_MIN_PHOTOS ? `Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}.` : null;
  if (step === 2) return f.title.trim().length < 3 ? "Give the item a name of at least 3 characters." : null;
  const all = formProblem(f);
  if (step === 3) return all && /price/i.test(all) ? all : null;
  if (step === 4) return all;
  return null;
}
