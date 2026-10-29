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
 *   5. Ready to list: the preview, ONE tax checkbox stating the four facts
 *      (row 54; owner 2026-10-28; attestItem records all four), List it
 *      (live, or waiting for a review: row 33).
 * Under 18 (row 53) and missing payout setup (row 23) show as plain-English
 * blocks, never as dead buttons; the server refuses both anyway.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { geocodeAddress } from "@/lib/geocode";
import {
  addPhoto,
  attestItem,
  createDraft,
  fetchItem,
  fetchMyItemPrivate,
  fetchMyPickupWindows,
  fetchItemDropState,
  fetchPhotos,
  publishItem,
  removePhoto,
  fetchItemHandovers,
  setHandovers,
  type SellerHandover,
  requestAiCheck,
  requestAiDraft,
  requestAiDraftFromPhotos,
  setDropPct,
  setPickupWindows,
  updateDraft,
  type DeliverySize,
  type DraftFields,
  type PickupWindow,
  photoPublicUrl,
} from "@/lib/declutter/api";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { centsToDollars, dollarsToCents } from "@/lib/declutter/money";
import { ChipGroup, DropSchedule, LISTING_LIFETIME, ReviewRow, StepHead, StepperButton, dropRunTime } from "./DeclutterSellSteps";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL, TAX_ATTESTATION_SENTENCE } from "./declutterUi";
import { DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { PickupTimesEditor, pickupWindowsProblem } from "./DeclutterPickupTimes";
import PriceHint from "./DeclutterPriceHint";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { SellItForMeEntry } from "./SellItForMe";
import { SellAiDraftPanel, useSellAiDraft } from "./SellAiDraft";
import { HANDOVER_CHOICE, SellHandoverChoices, handoverSummary } from "./SellHandoverChoices";
import { DEFAULT_DROP_PCT, DROP_PCT_CHOICES, dropPctOf } from "@/lib/declutter/priceDrop";
import { EMPTY, formProblem, priceChoiceToSave, sellStepProblem, type FormState } from "./sellForm";

export default function SellFlow() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const itemId = params.get("item");
  const { underAge } = useAgeGate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [coords, setCoords] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  // One tick for the four tax facts (owner 2026-10-28); attestItem still records all four.
  const [attested, setAttested] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Audit #45: Continue is always a live button, so what a step still needs is said once it is tapped, beside it,
  // not printed in advance under a button that looks ready (it read as a disabled future step).
  const [triedStep, setTriedStep] = useState<number | null>(null);
  // Board 31a-158: which of the 5 steps is on screen.
  const [step, setStep] = useState(1);
  // Row 101: porch pickup is the default; the seller turns it off per item.
  // Owner 2026-10-28: the ways the seller ticks (porch pickup by default; pickup at the door is gone).
  const [ways, setWays] = useState<SellerHandover[]>(["porch"]);
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  // A free item is picked up from the porch only (the free checkout's one way of these four).
  const savedWays: SellerHandover[] = form.free ? ["porch"] : ways.filter((w) => w !== "seller_delivery" || sellerDeliveryOpen);
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
      price: it.price_cents === 0 ? "" : centsToDollars(it.price_cents),
      floor: it.price_cents === 0 ? "" : centsToDollars(priv.data.floor_price_cents),
      // A lowest price under the price is a draft that drops; its step comes from the drop-state read below.
      drops: it.price_cents > 0 && priv.data.floor_price_cents < it.price_cents,
      dropPct: DEFAULT_DROP_PCT,
      free: it.price_cents === 0,
      areaLabel: it.area_label,
      pickupAddress: priv.data.pickup_address,
    });
    setCoords({ lat: Number(priv.data.pickup_lat), lng: Number(priv.data.pickup_lng), address: priv.data.pickup_address });
    // Until the saved ways are read: an older draft offered porch (if on) and Helpr delivery.
    setWays(it.porch_ok !== false ? ["porch", "delivery"] : ["delivery"]);
  }, [itemId, item.data, priv.data]);

  // The saved draft's own step (declutter_items.drop_pct); 0 means the seller turned drops off.
  const dropState = useQuery({ queryKey: ["declutter", "drop-state", itemId], queryFn: () => fetchItemDropState(itemId!), enabled: !!itemId });
  // The draft's saved ways (owner 2026-10-28), once, after the draft itself is in the form.
  const savedHandovers = useQuery({ queryKey: ["declutter", "handovers", itemId], queryFn: () => fetchItemHandovers(itemId!), enabled: !!itemId });
  const waysLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || savedHandovers.data === undefined || loadedFor.current !== itemId || waysLoadedFor.current === itemId) return;
    waysLoadedFor.current = itemId;
    if (savedHandovers.data && savedHandovers.data.length > 0) setWays(savedHandovers.data);
  }, [itemId, savedHandovers.data, form.title]);
  const dropLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || !dropState.data || loadedFor.current !== itemId || dropLoadedFor.current === itemId) return;
    dropLoadedFor.current = itemId;
    const pct = dropPctOf(dropState.data);
    setForm((f) => (pct > 0 ? { ...f, dropPct: pct } : { ...f, drops: false }));
  }, [itemId, dropState.data, form.title]);

  useEffect(() => {
    const rows = savedWindows.data ?? [];
    if (rows.length > 0) {
      setWindows(rows.map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) })));
    }
  }, [savedWindows.data]);

  const photoCount = (photos.data ?? []).length;
  // Owner 2026-10-28: Claude writes the listing. A new listing's photos are still on the device, so they
  // go in the request (never stored) and it runs by itself once the first ones are added; a saved draft
  // asks from its uploaded photos. Either way "Write it again" asks once more.
  const aiAsk = useMemo(
    () => (itemId ? (photoCount > 0 ? () => requestAiDraft(itemId) : null) : held.length > 0 ? () => requestAiDraftFromPhotos(held) : null),
    [itemId, photoCount, held],
  );
  // Audit AA9: a resumed draft with photos and an empty title or details is filled by itself too (empty fields only).
  const resumedEmpty = !!itemId && loadedFor.current === itemId && photoCount > 0 && (!form.title.trim() || !form.description.trim());
  const ai = useSellAiDraft({ ask: aiAsk, form, setForm, autoStart: !itemId && held.length > 0, autoFillEmpty: resumedEmpty });
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
    const choice = priceChoiceToSave(form);
    if (!choice) {
      toast.error("Set a price between $1 and $1,000.");
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
        priceCents: form.free ? 0 : dollarsToCents(form.price)!,
        floorPriceCents: choice.floorCents,
        areaLabel: form.areaLabel.trim(),
        pickupAddress: form.pickupAddress.trim(),
        pickupLat: c.lat,
        pickupLng: c.lng,
      };
      if (itemId) {
        await updateDraft(itemId, fields);
        // The ways (also sets porch_ok). Owner 2026-10-28.
        await setHandovers(itemId, savedWays);
        // Only once the saved step was read: a failed read must not overwrite it with the form's 5% default.
        if (!form.free && dropLoadedFor.current === itemId) await setDropPct(itemId, choice.dropPct);
        toast.success("Saved.");
        void qc.invalidateQueries({ queryKey: ["declutter"] });
        return itemId;
      }
      const id = await createDraft(fields);
      loadedFor.current = id;
      // The form already holds this draft's step: the drop-state read must not reset it.
      dropLoadedFor.current = id;
      setParams({ item: id }, { replace: true });
      // The ways the seller ticked (owner 2026-10-28; also sets porch_ok). If it fails the draft still
      // exists with every way open (an older item's), it is said, and the next save (List it saves again) retries it.
      waysLoadedFor.current = id;
      await setHandovers(id, savedWays);
      // The photos chosen first go up now that the draft exists. A photo that
      // fails says so (uploadPhotos) and can simply be added again.
      const waiting = held;
      setHeld([]);
      const added = await uploadPhotos(id, waiting);
      // The seller's step (a new draft starts at 5%), after the photos so a refusal never leaves a draft
      // without them; it is said, and the next save (List it saves again) retries it. With drops off the
      // lowest price is the price, so it never drops whatever the step.
      if (!form.free) await setDropPct(id, choice.dropPct);
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

  async function onPublish() {
    if (!itemId) return;
    if (!attested) {
      toast.error("Tick the box about this item before you list it.");
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
      // Board 80: the Selling tab opens the "What next" sheet (ListedWhatNext) instead of a toast.
      navigate("/declutter?view=selling", { state: { justListed: { itemId, status } } });
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  const input = "w-full h-[52px] rounded-[14px] border border-border bg-card px-4 text-ds-15 text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground";
  const photoTotal = photoCount + held.length;
  const priceCents = form.free ? null : dollarsToCents(form.price);
  const floorCents = form.free ? null : dollarsToCents(form.floor);
  // Step 4 also needs pickup times the server takes (1-21, each ending after it starts).
  const stepProblem = sellStepProblem(step, form, photoTotal)
    ?? (step === 4 && savedWays.length === 0 ? "Tick at least one way buyers can get it." : null)
    ?? (step === 4 ? pickupWindowsProblem(windows) : null);
  const next = async () => {
    if (stepProblem) {
      setTriedStep(step);
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

      {/* Payouts: only once money is owed (owner 2026-10-27, list first, set up at first sale). */}
      {step === 1 && <SellerPayoutPrompt />}

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
            aiPanel={aiAsk || ai.state.status !== "idle" ? <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} /> : null}
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
          <ChipGroup label="Category" options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))} value={form.category} onChange={(v) => set("category", v)} />
          <ChipGroup label="Condition" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: CONDITION_LABEL[n] }))} value={String(form.conditionStars)} onChange={(v) => set("conditionStars", Number(v))} />
          <ChipGroup label="Size" options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: SIZE_LABEL[k] }))} value={form.deliverySize} onChange={(v) => set("deliverySize", v as DeliverySize)} />
          <div className="space-y-2">
            {label("sell-desc", "Anything else?", "(optional)")}
            <textarea id="sell-desc" className={`${input} h-auto py-3`} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Works great. Small scuff on the base." />
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="What's your price?" sub={form.free ? "Someone nearby picks it up for free." : "You keep the whole price."} />
          <label className="flex min-h-11 items-center gap-3 rounded-[14px] border border-border bg-card px-4 text-ds-15 font-semibold text-foreground" data-sell-free="">
            <Checkbox checked={form.free} onCheckedChange={(v) => setForm((f) => ({ ...f, free: v === true }))} />
            Give it away free
          </label>
          {form.free ? (
            <p className="text-ds-14 text-muted-foreground" data-sell-free-note="">
              Free items are claimed, not bought: no offers and no price drops. The person who claims it picks it up at
              your door or from your porch, and nothing is charged.
            </p>
          ) : (<>
          <div className="flex items-center justify-center gap-4">
            <StepperButton label="Lower the price by $1" disabled={!priceCents || priceCents <= 100} onClick={() => set("price", centsToDollars(Math.max(100, (priceCents ?? 100) - 100)))}>−</StepperButton>
            {/* text-ds-40 on the WRAPPER too (deep audit #43): on a phone index.css floors every input at
                max(16px, 1em), which beats the input's own text-ds-40, and 1em is this wrapper's size. Without it
                the digits drew at 16px beside a 40px "$". Guard: src/test/bigDigitInputsKeepTheirSize.test.ts. */}
            <div className="flex min-w-0 items-baseline justify-center text-ds-40 text-[hsl(var(--burnt-sienna))]">
              <span className="text-ds-40 font-bold" aria-hidden>$</span>
              <input
                id="sell-price"
                aria-label="Price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                style={{ width: `${Math.max(1, form.price.length || 1) + 0.5}ch` }}
                className="max-w-[7ch] bg-transparent text-left text-ds-40 font-bold tabular-nums outline-none focus-visible:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <StepperButton label="Raise the price by $1" disabled={(priceCents ?? 0) >= 100_000} onClick={() => set("price", centsToDollars(Math.min(100_000, (priceCents ?? 0) + 100)))}>+</StepperButton>
          </div>
          {/* Owner 2026-10-28: the seller turns drops on and picks the step; a lowest price never turns them on. */}
          <div className="space-y-4 rounded-[20px] border border-border bg-card p-4" data-sell-drops={form.drops ? "on" : "off"}>
            <div className="flex items-start gap-3">
              <label htmlFor="sell-drops" className="min-w-0 flex-1">
                <span className="block text-ds-15 font-semibold text-foreground">Lower the price if it doesn't sell?</span>
                <span className="block text-ds-13 text-muted-foreground">
                  {form.drops ? `It drops ${form.dropPct}% each evening at ${dropRunTime()}, to a whole dollar, never below your lowest price.` : "Off. It stays at your price until you change it."}
                </span>
              </label>
              <Switch id="sell-drops" checked={form.drops} onCheckedChange={(v) => setForm((f) => ({ ...f, drops: v === true }))} />
            </div>
            {form.drops && (<>
              <ChipGroup label="How much each evening" options={DROP_PCT_CHOICES.map((p) => ({ value: String(p), label: `${p}%` }))} value={String(form.dropPct)} onChange={(v) => set("dropPct", Number(v))} />
              <div className="space-y-2">
                {label("sell-floor", "Lowest you'll take")}
                <div className="flex h-[52px] items-center gap-1 rounded-[14px] border border-border bg-background px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
                  <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>
                  <input id="sell-floor" inputMode="decimal" value={form.floor} onChange={(e) => set("floor", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 30"
                    className="w-full bg-transparent text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground" />
                </div>
                <p className="text-ds-13 text-muted-foreground">Only you see this. The drops stop here.</p>
              </div>
              <DropSchedule priceCents={priceCents} floorCents={floorCents} pct={form.dropPct} />
            </>)}
          </div>
          </>)}
          {!form.free && <PriceHint
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
          />}
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="How can buyers get it?" sub="Choose the ways you're happy with. Buyers only see these." />
          <SellHandoverChoices ways={ways} setWays={setWays} free={form.free} sellerDeliveryOpen={sellerDeliveryOpen} />
          {/* Owner 2026-10-28: no "Area buyers see" field; buyers see the town the server works out from this
              address (declutter_town_for_pickup), and the seller can fill it from where they are. */}
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
              {(form.free || priceCents) && <p className="shrink-0 text-ds-17 font-bold text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(form.free ? 0 : (priceCents as number))}</p>}
            </div>
            <p className="text-ds-13 text-muted-foreground">
              {[CONDITION_LABEL[form.conditionStars], CATEGORY_LABEL[form.category], form.areaLabel.trim()].filter(Boolean).join(" · ")}
            </p>
            <ul className="flex flex-wrap gap-2 pt-1" aria-label="How buyers get it">
              {savedWays.map((w) => <li key={w} className="rounded-full border border-border px-3 py-1 text-ds-13 font-medium">{HANDOVER_CHOICE[w].title}</li>)}
            </ul>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
            {form.free
              ? <ReviewRow title="Price" body="Free: claimed, never bought. No offers or price drops." onEdit={() => setStep(3)} />
              : <ReviewRow title="Price drops" body={form.drops && priceCents && floorCents && floorCents < priceCents ? `${form.dropPct}% each evening at ${dropRunTime()}, to a whole dollar, never below ${formatPrice(floorCents)}` : "Off: it stays at your price"} onEdit={() => setStep(3)} />}
            <ReviewRow title="Photos" body={`${photosWord(photoCount)} · the first is the cover`} onEdit={() => setStep(1)} />
            <ReviewRow title="How buyers get it" body={handoverSummary(savedWays)} onEdit={() => setStep(4)} />
            {/* Owner 2026-10-28: "it also never said how long it will stay open"; the rule the server runs (Q2461). */}
            <ReviewRow title="How long it stays up" body={LISTING_LIFETIME} />
          </ul>
          <div className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-labelledby="sell-tax-head">
            <h3 id="sell-tax-head" className="text-ds-15 font-semibold text-foreground">Confirm about this item</h3>
            <p className="text-ds-13 text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things.</p>
            <div className="flex items-start gap-3 text-ds-14">
              <Checkbox id="sell-tax" className="mt-0.5" checked={attested} onCheckedChange={(v) => setAttested(v === true)} />
              <label htmlFor="sell-tax">{TAX_ATTESTATION_SENTENCE}</label>
            </div>
          </div>
          {photoCount < DECLUTTER_MIN_PHOTOS && <p className="text-ds-14 text-muted-foreground">Add at least {photosWord(DECLUTTER_MIN_PHOTOS)} to list this item.</p>}
        </section>
      )}

      {stepProblem && step < 5 && triedStep === step && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-problem">{stepProblem}</p>}
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
        photoCount >= DECLUTTER_MIN_PHOTOS && (
          <Button type="button" className="w-full rounded-full" disabled={publishing} onClick={() => void onPublish()}>
            {publishing ? "Listing…" : "List it"}
          </Button>
        )
      )}
      </div>
    </AppPage>
  );
}
