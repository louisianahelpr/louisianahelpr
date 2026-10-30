/**
 * Edit a live listing (audit 1028 D1-1; owner 2026-10-29, "REVIEW ONLY BIG CHANGES"). Opened from Manage listing.
 * declutter_edit_listing decides from the stored row what changed:
 *   - title, description or category: the automatic check runs again (hidden for those seconds); a clean result puts it
 *     back live by itself, a flag holds it for an admin. Open offers stay open and their buyers are told it changed
 *     (item B, owner 2026-10-29: only a failed automatic check holds a listing);
 *   - condition, size or the ways buyers can get it: saved at once, still live, offers stay open.
 * The tax checkbox is ticked again on every edit (the server refuses without it). Price stays under "Change price";
 * photos are not edited here (the photo functions are draft-only).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { useFeature } from "@/hooks/useFeature";
import {
  editListing, fetchItem, fetchItemHandovers, requestAiCheckWithRetry, type DeclutterItem, type DeliverySize, type SellerHandover,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { CATEGORY_LABEL, CONDITION_LABEL, SIZE_LABEL, TAX_ATTESTATION_SENTENCE } from "./declutterUi";
import { SellHandoverChoices } from "./SellHandoverChoices";

/** What the seller is told after saving (item B: only a failed automatic check holds a listing). */
export const EDIT_SAVED = {
  saved: "Saved.",
  live_again: "Saved. It's live with your changes.",
  held: "Saved. Someone from Louisiana Helpr will look at your changes before buyers see it again.",
} as const;

const field = "w-full rounded-lg border border-input bg-background px-3 py-2 text-ds-15";

export function DeclutterEditListing({ item, onDone }: { item: DeclutterItem; onDone: () => void }) {
  const qc = useQueryClient();
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  const saved = useQuery({ queryKey: ["declutter", "handovers", item.id], queryFn: () => fetchItemHandovers(item.id) });
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category);
  const [condition, setCondition] = useState(item.condition_stars);
  const [size, setSize] = useState<DeliverySize>(item.delivery_size);
  const [ways, setWays] = useState<SellerHandover[]>(item.porch_ok ? ["porch"] : []);
  const [attested, setAttested] = useState(false);
  useEffect(() => { if (saved.data) setWays(saved.data); }, [saved.data]);
  const free = item.price_cents === 0;
  // The same rule the server runs, so the seller knows before saving (the server decides).
  const big = title.trim() !== item.title || description.trim() !== item.description || category !== item.category;
  const save = useMutation({
    mutationFn: async (): Promise<keyof typeof EDIT_SAVED> => {
      const status = await editListing(item.id, { title: title.trim(), description: description.trim(), category, conditionStars: condition, deliverySize: size, handovers: free ? ["porch"] : ways });
      if (status === "live") return "saved";
      // A big change: the automatic check judges the new words now (asked twice); the server puts a clean listing
      // back live by itself. What the seller is told is read back from the row, never assumed.
      await requestAiCheckWithRetry(item.id);
      const now = await fetchItem(item.id);
      return now?.status === "live" ? "live_again" : "held";
    },
    onSuccess: (outcome) => {
      toast.success(EDIT_SAVED[outcome]);
      for (const key of [["declutter", "mine"], ["declutter", "item", item.id], ["declutter", "handovers", item.id], ["declutter", "item-handovers", item.id]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      onDone();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const ready = attested && title.trim().length >= 3 && (free || ways.length > 0) && !save.isPending;
  return (
    <form className="space-y-4" data-edit-listing="" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      {/* Lead 2026-10-29: photo edits on a live listing wait for the photo functions (Q2476). */}
      <p className="text-ds-13 text-muted-foreground" data-edit-photos="">To change photos, take it down and relist.</p>
      <div className="space-y-1">
        <label htmlFor="edit-title" className="block text-ds-14 font-semibold">Title</label>
        <input id="edit-title" className={field} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="edit-description" className="block text-ds-14 font-semibold">Description</label>
        <textarea id="edit-description" className={field} rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="edit-category" className="block text-ds-14 font-semibold">Category</label>
        <select id="edit-category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="edit-condition" className="block text-ds-14 font-semibold">Condition</label>
        <select id="edit-condition" className={field} value={condition} onChange={(e) => setCondition(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{CONDITION_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="edit-size" className="block text-ds-14 font-semibold">Size</label>
        <select id="edit-size" className={field} value={size} onChange={(e) => setSize(e.target.value as DeliverySize)}>
          {(Object.keys(SIZE_LABEL) as DeliverySize[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
        </select>
      </div>
      <SellHandoverChoices ways={ways} setWays={setWays} free={free} sellerDeliveryOpen={sellerDeliveryOpen} />
      <p className="text-ds-13 text-muted-foreground" data-edit-review={big ? "yes" : "no"} aria-live="polite">
        {big
          ? "A new title, description or category gets a quick automatic check, so it's hidden for a few seconds. Buyers with open offers are told it changed."
          : "Condition, size and how buyers get it save at once. It stays up and offers stay open."}
      </p>
      <div className="flex items-start gap-3 text-ds-14">
        <Checkbox id="edit-tax" className="mt-0.5" checked={attested} onCheckedChange={(v) => setAttested(v === true)} />
        <label htmlFor="edit-tax">{TAX_ATTESTATION_SENTENCE}</label>
      </div>
      <button type="submit" className="btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 w-full rounded-full px-5 text-ds-15 font-semibold" disabled={!ready}>
        {save.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
