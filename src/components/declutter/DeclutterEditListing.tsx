/**
 * Edit a live listing (audit 1028 D1-1; owner 2026-10-29, "REVIEW ONLY BIG CHANGES"). Opened from Manage listing.
 * declutter_edit_listing decides from the stored row what changed:
 *   - title, description or category: the automatic check runs again (hidden for those seconds); a clean result puts it
 *     back live by itself, a flag holds it for an admin. Open offers stay open and their buyers are told it changed
 *     (item B, owner 2026-10-29: only a failed automatic check holds a listing);
 *   - condition, size or the ways buyers can get it: saved at once, still live, offers stay open.
 * Photos (audit DC-8 / Q2476, migration 20261030061927): added and removed here with the sell form's own photo grid
 * (SellPhotos), held on the device until Save; a photo change follows the big-change rule above. New photos go up
 * before removed ones come off, so swapping the only photo never trips the one-photo minimum. Title, description,
 * category, condition and size use the sell form's own editors (the input style, ChipGroup), not native selects.
 * The tax checkbox is ticked again on every edit (owner 2026-10-29; the server refuses without it). Price stays under
 * "Change price".
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFeature } from "@/hooks/useFeature";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  addPhotoSteadily, editListing, fetchItem, fetchItemHandovers, fetchPhotos, removePhoto, requestAiCheckWithRetry,
  type DeclutterItem, type DeliverySize, type SellerHandover,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { FULL_LISTING_COPY, DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { CATEGORY_GROUPS, CATEGORY_LABEL, CONDITION_LABEL, SIZE_LABEL, TaxStatementsCheck } from "./declutterUi";
import { ChipGroup } from "./DeclutterSellSteps";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { FieldLabel, SELL_INPUT } from "./SellFormParts";
import { SellHandoverChoices } from "./SellHandoverChoices";

/** What the seller is told after saving (item B: only a failed automatic check holds a listing). */
export const EDIT_SAVED = {
  saved: "Saved.",
  live_again: "Saved. It's live with your changes.",
  held: "Saved. Someone from Louisiana Helpr will look at your changes before buyers see it again.",
} as const;

/** What the screen says before saving: which rule the change follows (the server decides). */
export const EDIT_RULE = {
  checked: "A new photo, title, description or category gets a quick automatic check, so it's hidden for a few seconds. Buyers with open offers are told it changed.",
  instant: "Condition, size and how buyers get it save at once. It stays up and offers stay open.",
} as const;

export function DeclutterEditListing({ item, onDone }: { item: DeclutterItem; onDone: () => void }) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  const saved = useQuery({ queryKey: ["declutter", "handovers", item.id], queryFn: () => fetchItemHandovers(item.id) });
  const photos = useQuery({ queryKey: ["declutter", "item-photos", item.id], queryFn: () => fetchPhotos([item.id]) });
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category);
  const [condition, setCondition] = useState(item.condition_stars);
  const [size, setSize] = useState<DeliverySize>(item.delivery_size);
  const [ways, setWays] = useState<SellerHandover[]>(item.porch_ok ? ["porch"] : []);
  const [attested, setAttested] = useState(false);
  // DC-8: photo changes wait on the device until Save.
  const [held, setHeld] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => { if (saved.data) setWays(saved.data); }, [saved.data]);
  const free = item.price_cents === 0;
  const kept = (photos.data ?? []).filter((p) => !removed.includes(p.id));
  const photoTotal = kept.length + held.length;
  const photosChanged = held.length > 0 || removed.length > 0;
  // DC-4: an older listing may still carry a stored 'delivery' tick; it is not a choice any more, so it is not sent.
  const sentWays: SellerHandover[] = free ? ["porch"] : ways.filter((w) => w !== "delivery");
  // The same rule the server runs, so the seller knows before saving (the server decides).
  const big = title.trim() !== item.title || description.trim() !== item.description || category !== item.category || photosChanged;
  const save = useMutation({
    mutationFn: async (): Promise<keyof typeof EDIT_SAVED> => {
      const status = await editListing(item.id, { title: title.trim(), description: description.trim(), category, conditionStars: condition, deliverySize: size, handovers: sentWays });
      // New photos first, then the removed ones, so the listing always keeps one (too_few_photos).
      for (const f of held) await addPhotoSteadily(user!.id, item.id, f, FULL_LISTING_COPY);
      for (const id of removed) await removePhoto(id);
      if (status === "live" && !photosChanged) return "saved";
      // A big change: the automatic check judges the new words and photos now (asked twice); the server puts a clean
      // listing back live by itself. What the seller is told is read back from the row, never assumed.
      await requestAiCheckWithRetry(item.id, { tries: 2 });
      const now = await fetchItem(item.id);
      return now?.status === "live" ? "live_again" : "held";
    },
    onSuccess: (outcome) => {
      toast(EDIT_SAVED[outcome]);
      onDone();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
    onSettled: () => {
      for (const key of [["declutter", "mine"], ["declutter", "item", item.id], ["declutter", "handovers", item.id], ["declutter", "item-handovers", item.id], ["declutter", "item-photos", item.id]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
  const ready = attested && title.trim().length >= 3 && sentWays.length > 0 && photoTotal >= DECLUTTER_MIN_PHOTOS && !!user && !photos.isLoading && !save.isPending;
  return (
    <form className="space-y-5" data-edit-listing="" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      <div className="space-y-2" data-edit-photos="">
        <p className="text-ds-14 font-semibold text-foreground">Photos</p>
        <SellPhotos
          uploaded={kept}
          held={held}
          onFiles={(list) => setHeld((h) => [...h, ...Array.from(list ?? [])].slice(0, Math.max(0, MAX_PHOTOS - kept.length)))}
          onRemoveUploaded={(id) => setRemoved((r) => [...r, id])}
          onRemoveHeld={(i) => setHeld((h) => h.filter((_, j) => j !== i))}
          uploading={0}
          aiPanel={null}
        />
        {photoTotal < DECLUTTER_MIN_PHOTOS && (
          <p className="text-ds-13 font-semibold text-destructive-ink" data-edit-photo-min="">Keep at least {photosWord(DECLUTTER_MIN_PHOTOS)}.</p>
        )}
      </div>
      <div className="space-y-2">
        <FieldLabel htmlFor="edit-title" text="Title" />
        <input id="edit-title" className={SELL_INPUT} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-2">
        <FieldLabel htmlFor="edit-description" text="Description" />
        <textarea id="edit-description" className={`${SELL_INPUT} h-auto py-3`} rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <ChipGroup label="Category" options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))} groups={CATEGORY_GROUPS} value={category} onChange={setCategory} />
      <ChipGroup label="Condition" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: CONDITION_LABEL[n] }))} value={String(condition)} onChange={(v) => setCondition(Number(v))} />
      <ChipGroup label="Size" options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: SIZE_LABEL[k] }))} value={size} onChange={(v) => setSize(v as DeliverySize)} />
      <SellHandoverChoices ways={ways} setWays={setWays} free={free} sellerDeliveryOpen={sellerDeliveryOpen} />
      <p className="text-ds-13 text-muted-foreground" data-edit-review={big ? "yes" : "no"} aria-live="polite">
        {big ? EDIT_RULE.checked : EDIT_RULE.instant}
      </p>
      <TaxStatementsCheck id="edit-tax" checked={attested} onChange={setAttested} free={free} />
      <button type="submit" className="btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 w-full rounded-full px-5 text-ds-15 font-semibold" disabled={!ready}>
        {save.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
