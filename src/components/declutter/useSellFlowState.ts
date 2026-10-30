/**
 * The sell flow's state and server calls, shared by a NEW listing's one screen (SellOneScreen, owner 2026-10-29:
 * "ai should always be doing most of the work for declutter listing") and a saved draft's step form
 * (DeclutterSellView). Kept in its own file so neither screen crosses the god-component line
 * (src/test/componentSizeRatchet.test.ts).
 *
 * A new listing's photos wait on the device until Post (there is no draft to hold them); Claude reads them
 * from the device by itself once the first ones are added (SellAiDraft.tsx). Post creates the draft, uploads
 * them, then runs the same list path a draft's "List it" runs: saveDetails -> setPickupWindows -> attestItem ->
 * requestAiCheckWithRetry (fail-safe) -> publishItem. The server path is the same either way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { useExactAddressPoint } from "./useExactAddressPoint";
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
  setKeepUp,
  setAutoFreeDays,
  type SellerHandover,
  requestAiCheckWithRetry,
  requestAiDraft,
  requestAiDraftFromPhotos,
  setDropPct,
  setPickupWindows,
  updateDraft,
  type DraftFields,
  type PickupWindow,
} from "@/lib/declutter/api";
import { centsToDollars, dollarsToCents } from "@/lib/declutter/money";
import { cleanListingPhoto, unusablePhotosNote } from "@/lib/declutter/photos";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { answerAfterListing, readWantedAnswer } from "@/lib/declutter/wanted";
import { formatPrice } from "@/lib/declutter/distance";
import { startsFree } from "@/lib/declutter/sellChooser";
import { useKeepUp } from "./KeepUpRow";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { MAX_PHOTOS } from "./DeclutterSellPhotos";
import { coverFirst, useSellAiDraft, withCoverFile } from "./SellAiDraft";
import { useLastListingSetup } from "./SellLastSetup";
import { useSavedPickup } from "./useSavedPickup";
import { useSellerDefaultsPrefill } from "./useSellerDefaultsPrefill";
import { useSellSaved } from "./useSellSaved";
import { DEFAULT_DROP_PCT, dropPctOf } from "@/lib/declutter/priceDrop";
import { EMPTY, formProblem, priceChoiceToSave, type FormState } from "./sellForm";

export function useSellFlowState(urlItemId: string | null) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Quick-list from "I have this" (owner 2026-10-30): a NEW listing made from a Wanted post answers it once live.
  const [params] = useSearchParams();
  const answer = urlItemId ? null : readWantedAnswer(params);
  // A new listing's draft once Post created it (the one screen stays on screen; a retry updates this draft).
  const [createdId, setCreatedId] = useState<string | null>(null);
  const itemId = urlItemId ?? createdId;
  const { underAge } = useAgeGate();
  // "Give it away free" from the sell chooser (?free=1, owner 2026-10-30): a NEW listing starts with Free on.
  const [form, setForm] = useState<FormState>(() => (!urlItemId && startsFree(params) ? { ...EMPTY, free: true } : EMPTY));
  const place = useExactAddressPoint();
  const coords = place.point;
  const setCoords = place.setPoint;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  // What Post is doing right now, in words (audit posting 1030 #5: a slow Post only said "Posting…").
  const [postStep, setPostStep] = useState<string | null>(null);
  // Why the last photos didn't go up (audit posting 1030 #2); the photos themselves stay in `held`.
  const [photoFailure, setPhotoFailure] = useState<string | null>(null);
  const failedPhotos = useRef(0);
  // Photos this device can't prepare, said when they are added (audit posting 1030 #4), never counted or held.
  const [refusedNote, setRefusedNote] = useState<string | null>(null);
  // A listing brought back from this device (useSellSaved): the prefills below never overwrite it, and Claude isn't
  // asked again for what it already wrote.
  const [broughtBack, setBroughtBack] = useState<"no" | "unwritten" | "written">("no");
  const [windows, setWindows] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  // One tick for the four tax facts (owner 2026-10-28); attestItem still records all four.
  const [attested, setAttested] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Row 101: porch pickup is the default; the seller turns it off per item.
  // Owner 2026-10-28: the ways the seller ticks (porch pickup by default; pickup at the door is gone).
  const [ways, setWays] = useState<SellerHandover[]>(["porch"]);
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  // A free item is picked up from the porch only (the free checkout's one way of these four).
  // DC-4 (owner 2026-10-29): Helpr delivery is never a tick (buyers can always choose it), so it is never saved as one.
  const savedWays: SellerHandover[] = form.free ? ["porch"] : ways.filter((w) => w !== "delivery" && (w !== "seller_delivery" || sellerDeliveryOpen));
  // Photos chosen before the first save (there is no draft to hold them yet).
  const [held, setHeld] = useState<File[]>([]);
  // The AI's cover pick moves a photo first and says so, with Undo; once the seller has chosen, it never moves it again
  // (audit posting 1030 #9).
  const heldNow = useRef(held);
  heldNow.current = held;
  const [coverUndo, setCoverUndo] = useState<File | null>(null);
  const coverChosen = useRef(false);
  const setCoverFirst = useCallback((d: { coverFile?: File }) => {
    if (coverChosen.current) return;
    const was = heldNow.current;
    const next = coverFirst(was, d.coverFile);
    if (next === was) return;
    setCoverUndo(was[0] ?? null);
    setHeld(next);
  }, []);
  const makeCover = useCallback((i: number) => {
    coverChosen.current = true;
    setCoverUndo(null);
    setHeld((h) => coverFirst(h, h[i]));
  }, []);
  const undoCover = () => {
    coverChosen.current = true;
    const back = coverUndo;
    setCoverUndo(null);
    if (back) setHeld((h) => coverFirst(h, back));
  };
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
  // The same fact as state, for what the RENDER reads (the resumed-draft auto-fill): a ref read during render
  // never schedules the render that would see it, so the auto-fill could miss its turn (CI #3783).
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    if (!itemId || !item.data || !priv.data || loadedFor.current === itemId) return;
    loadedFor.current = itemId;
    setLoadedId(itemId);
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
    // Until the saved ways are read: an older draft offered porch (if on). Helpr delivery is not a tick (DC-4).
    setWays(it.porch_ok !== false ? ["porch"] : []);
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
  const hintAt = coords ? { lat: coords.lat, lng: coords.lng } : item.data ? { lat: Number(item.data.area_lat), lng: Number(item.data.area_lng) } : origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  // Owner 2026-10-28: Claude writes the listing. A new listing's photos are still on the device, so they
  // go in the request (never stored) and it runs by itself once the first ones are added; a saved draft
  // asks from its uploaded photos. Either way "Write it again" asks once more.
  const aiAsk = useMemo(
    () => (itemId ? (photoCount > 0 ? () => requestAiDraft(itemId, hintAt) : null) : held.length > 0 ? withCoverFile(held, (f) => requestAiDraftFromPhotos(f, hintAt)) : null),
    [itemId, photoCount, held],
  );
  // Audit AA9: a resumed draft with photos and an empty title or details is filled by itself too (empty fields only).
  const resumedEmpty = !!urlItemId && loadedId === urlItemId && photoCount > 0 && (!form.title.trim() || !form.description.trim());
  const ai = useSellAiDraft({ ask: aiAsk, form, setForm, autoStart: !urlItemId && held.length > 0 && broughtBack !== "written", autoFillEmpty: resumedEmpty, photosAdded: itemId ? 0 : held.length, onDraft: setCoverFirst });
  const prefillFor = urlItemId || broughtBack !== "no" ? undefined : user?.id;
  const usedLastSetup = useLastListingSetup(prefillFor, { setForm, setWays, setCoords });
  // Saved settings are the source once they exist (owner 2026-10-30): they replace what the last listing filled in,
  // never what the seller typed, and the point comes with them.
  const saved = useSavedPickup(prefillFor, (p, lastAddress) => {
    const mine = (address: string) => !address.trim() || address === lastAddress;
    setForm((f) => (mine(f.pickupAddress) ? { ...f, areaLabel: p.areaLabel, pickupAddress: p.address } : f));
    setCoords((c) => (!c || mine(c.address) ? { lat: p.lat, lng: p.lng, address: p.address } : c));
  });
  const problem = useMemo(() => formProblem(form), [form]);
  // Size is never guessed as chosen (audit single-free #15): the photo tool's answer, or the seller's own pick.
  const [sizePicked, setSizePicked] = useState(false);
  const sizeKnown = sizePicked || ai.state.status === "done";
  const keepUp = useKeepUp(urlItemId);
  // A new listing's "Keep it up until it sells": there is no draft to save it on until Post. ON by default (owner
  // 2026-10-30), or the seller's remembered choice (useSellerDefaultsPrefill).
  const [keepUpWanted, setKeepUpWanted] = useState(true);
  // A new listing's "make it free after __ days" (OWN-FREE): Never by default, saved on the draft at Post.
  const [autoFreeWanted, setAutoFreeWanted] = useState<number | null>(null);
  // The seller's remembered choices pre-fill a NEW listing and are saved again at Post (owner 2026-10-30).
  const prefs = useSellerDefaultsPrefill(prefillFor, { form, setForm, ways, setWays, setKeepUpWanted, setAutoFreeWanted });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Audit posting 1030 #1: a new listing is kept on this device from the first photo. Not one answering a Wanted post
  // (it belongs to that answer).
  const keptWork = useSellSaved(urlItemId || answer ? undefined : user?.id, { form, coords, ways, windows, keepUpWanted, autoFreeWanted, createdId, aiMemory: ai.memory.current, sizeKnown }, held, (back) => {
    setSizePicked(back.sizeKnown === true);
    ai.remember(back.aiMemory ?? null, back.held.length);
    setBroughtBack(back.form.title.trim() ? "written" : "unwritten");
    setForm(back.form);
    setCoords(back.coords);
    setWays(back.ways);
    setWindows(back.windows);
    setKeepUpWanted(back.keepUpWanted);
    setAutoFreeWanted(back.autoFreeWanted);
    setHeld((h) => [...back.held, ...h]);
    if (back.createdId) {
      // The form holds what the seller last had; the draft's own reads must not reset it.
      loadedFor.current = back.createdId;
      dropLoadedFor.current = back.createdId;
      waysLoadedFor.current = back.createdId;
      setLoadedId(back.createdId);
      setCreatedId(back.createdId);
    }
  });

  async function saveDetails(waiting: File[] = held): Promise<string | null> {
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
      const c = await place.locate(form.pickupAddress);
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
        // A new listing's second Post: only the photos that failed go up again.
        if (!urlItemId && waiting.length > 0) await uploadHeld(itemId, waiting);
        if (urlItemId) toast.success("Saved.");
        void qc.invalidateQueries({ queryKey: ["declutter"] });
        return itemId;
      }
      const id = await createDraft(fields);
      loadedFor.current = id;
      setLoadedId(id);
      // The form already holds this draft's step: the drop-state read must not reset it.
      dropLoadedFor.current = id;
      // The one screen stays; if listing fails below, the next Post updates this draft instead of making another.
      setCreatedId(id);
      // The ways the seller ticked (owner 2026-10-28; also sets porch_ok). If it fails the draft still
      // exists with every way open (an older item's), it is said, and the next Post saves again and retries it.
      waysLoadedFor.current = id;
      await setHandovers(id, savedWays);
      // The photos chosen first go up now that the draft exists. One that fails stays held (uploadHeld), and
      // onPublish stops before publishing (audit posting 1030 #2).
      await uploadHeld(id, waiting);
      // The seller's step (a new draft starts at 5%), after the photos so a refusal never leaves a draft
      // without them; it is said, and the next Post retries it. With drops off the
      // lowest price is the price, so it never drops whatever the step.
      if (!form.free) await setDropPct(id, choice.dropPct);
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

  /**
   * A NEW listing's held photos go up one at a time. One that goes up leaves `held` (it is on the draft now); one that
   * fails stays on screen, marked, with why (audit posting 1030 #2: they were cleared first and skipped, and the listing
   * went live without them).
   */
  async function uploadHeld(id: string, list: File[]): Promise<void> {
    const up = new Set<File>();
    const failed: File[] = [];
    let why: string | null = null;
    setUploading(list.length);
    for (const [i, f] of list.entries()) {
      setPostStep(`Uploading photo ${i + 1} of ${list.length}`);
      try {
        await addPhoto(user!.id, id, f);
        up.add(f);
      } catch (err) {
        // Said on screen, with the photo kept and marked: data-photo-trouble in SellOneScreen.
        failed.push(f);
        why = declutterErrorMessage(err);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    setHeld((h) => [...h.filter((f) => !up.has(f)), ...failed.filter((f) => !h.includes(f))]);
    setPhotoFailure(why);
    failedPhotos.current = failed.length;
    // Waited for: the count "Post with n photos" offers is the server's.
    await qc.invalidateQueries({ queryKey: ["declutter", "item-photos", id] });
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photoCount - held.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) toast.error("A listing can have up to 12 photos.");
    if (!itemId) {
      // Each is tried now, so one that can't be used is said at once, on the screen, instead of being lost at Post.
      const good: File[] = [];
      const refused: { key: string; name: string; error: unknown }[] = [];
      setUploading(list.length);
      for (const f of list) {
        try {
          await cleanListingPhoto(f);
          good.push(f);
        } catch (error) {
          // Not swallowed: unusablePhotosNote names this photo and says why, under the photos.
          refused.push({ key: f.name, name: f.name, error });
        } finally {
          setUploading((n) => n - 1);
        }
      }
      setHeld((h) => [...h, ...good]);
      setRefusedNote(unusablePhotosNote(refused));
      return;
    }
    if (urlItemId) await uploadPhotos(itemId, list);
    else await uploadHeld(itemId, list);
  }

  async function onRemovePhoto(photoId: string) {
    try {
      await removePhoto(photoId);
      void qc.invalidateQueries({ queryKey: ["declutter", "item-photos", itemId] });
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    }
  }

  /** `withoutFailed`: the seller's own choice to post with the photos that went up. */
  async function onPublish({ withoutFailed = false }: { withoutFailed?: boolean } = {}) {
    if (!attested) {
      toast.error("Tick the box about this item before you list it.");
      return;
    }
    setPublishing(true);
    setPostStep("Saving your listing");
    failedPhotos.current = 0;
    try {
      if (withoutFailed) {
        setHeld([]);
        setPhotoFailure(null);
      }
      const id = await saveDetails(withoutFailed ? [] : held);
      if (!id) return;
      // A photo didn't go up: nothing goes live until the seller says what to do (data-photo-trouble in SellOneScreen).
      if (failedPhotos.current > 0) return;
      setPostStep("Saving your listing");
      // A new listing's "Keep it up until it sells" goes on the draft Post just made. Not a blocker: if it
      // fails it is said, and the seller can turn it on in Manage listing.
      if (!urlItemId && keepUpWanted) {
        try {
          await setKeepUp(id, true);
        } catch (err) {
          toast.error(`${declutterErrorMessage(err)} You can turn on "Keep it up" from Manage listing.`);
        }
      }
      // The same for "make it free after __ days": a free listing has nothing to choose.
      if (!urlItemId && autoFreeWanted !== null && !form.free) {
        try {
          await setAutoFreeDays(id, autoFreeWanted);
        } catch (err) {
          toast.error(`${declutterErrorMessage(err)} You can choose when it becomes free from Manage listing.`);
        }
      }
      // A new listing uses the times saved in setup and Settings; only a saved draft's step form edits them.
      if (urlItemId) await setPickupWindows(windows);
      await attestItem(id);
      setPostStep("Checking your listing");
      // Asked twice; if it never comes back the listing is held for an admin (the server's fail-safe).
      await requestAiCheckWithRetry(id);
      setPostStep("Putting it up");
      const status = await publishItem(id);
      void keptWork.finish();
      if (!urlItemId) void prefs.rememberChoices(keepUpWanted, autoFreeWanted);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      if (answer) {
        try {
          const out = await answerAfterListing(answer, id, status, form.free ? null : dollarsToCents(form.price));
          if (out.kind === "sent") {
            toast.success(`Listed and sent at ${formatPrice(out.cents)}. They have 48 hours to accept.`);
            navigate("/declutter?view=wanted");
            return;
          }
          toast(out.kind === "checking"
            ? "Listed. We're checking it first; answer their Wanted from Wanted near you once it's live."
            : "Listed for free. A free listing can't answer a Wanted; they can find it in Browse.");
        } catch (err) {
          // The listing is live; only the answer failed. Said, and the seller can answer from Wanted near you.
          toast.error(`Listed, but the answer wasn't sent: ${declutterErrorMessage(err)}`);
        }
      }
      // Board 80: the Selling tab opens the "What next" sheet (ListedWhatNext) instead of a toast.
      navigate("/declutter?tab=selling", { state: { justListed: { itemId: id, status } } });
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setPublishing(false);
      setPostStep(null);
    }
  }

  // A new listing's draft exists only once Post made it, so a photo still held after that is one that failed.
  const failedHeld = !urlItemId && !!createdId && !publishing ? held.length : 0;
  const photoTotal = photoCount + held.length;
  const priceCents = form.free ? null : dollarsToCents(form.price);
  const floorCents = form.free ? null : dollarsToCents(form.floor);
  return {
    saved, sizeKnown, setSizePicked, user, underAge, itemId, item, photos, form, setForm, set, coords, place, saving, uploading, windows, setWindows,
    attested, setAttested, publishing, ways, setWays, savedWays, sellerDeliveryOpen, held, setHeld, hintAt,
    aiAsk, ai, usedLastSetup, problem, keepUp, keepUpWanted, setKeepUpWanted, autoFreeWanted, setAutoFreeWanted, photoCount, photoTotal, priceCents,
    floorCents, saveDetails, onFiles, onRemovePhoto, onPublish, postStep, failedHeld, photoFailure, keptWork, refusedNote, makeCover, coverUndo, undoCover,
  };
}

export type SellFlow = ReturnType<typeof useSellFlowState>;
