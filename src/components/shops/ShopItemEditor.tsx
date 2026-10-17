/**
 * Add or edit one shop item (Shops slice 2; docs/specs/local-shops-prep.md
 * L5-L22, L51, L52 and the dated defaults D1-D11). Kind and type from the
 * fixed list (the server refuses anything else), title, description, price,
 * lead time, an optional ready-now count, 3 to 12 photos (cleaned of their
 * location by Declutter's cleanListingPhoto), AI help from the photos, the
 * kind's confirmations, the home-food yearly limit, then Publish.
 *
 * Who may do what is decided on the server (shops_* RPCs); this form shows
 * the server's words when it refuses. A first item, or one the photo or word
 * check flags, waits for an admin (L52), and the form says so.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addShopItemPhoto,
  attestShopItem,
  confirmCottageYear,
  createShopItem,
  fetchCottageStatus,
  fetchMyItemReview,
  HOME_KITCHEN_NOTICE,
  itemPhotoUrl,
  publishShopItem,
  removeShopItemPhoto,
  requestShopItemAiCheck,
  requestShopItemAiDraft,
  requiredStatements,
  setShopItemStock,
  SHOP_ITEM_KIND_LABEL,
  SHOP_ITEM_STATEMENTS,
  SHOP_ITEM_TYPE_LABEL,
  SHOP_ITEM_TYPES,
  updateShopItem,
  type ShopItem,
  type ShopItemKind,
} from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

interface Draft {
  kind: ShopItemKind;
  subtype: string;
  title: string;
  description: string;
  price: string;
  lead: string;
  readyNow: boolean;
  stock: string;
}

const fromItem = (i: ShopItem | null): Draft => ({
  kind: i?.kind ?? "made",
  subtype: i?.subtype ?? "crafts",
  title: i?.title ?? "",
  description: i?.description ?? "",
  price: i ? String(i.price_cents / 100) : "",
  lead: i ? String(i.lead_time_days) : "1",
  readyNow: i?.stock_count != null,
  stock: i?.stock_count != null ? String(i.stock_count) : "",
});

const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);
/**
 * A whole number typed in a box, or the server's refusal code when the box is
 * empty or not a number (lh-silent-failure review should-fix 2: an empty box
 * must never quietly become 0, which publishes as "same day" or "sold out").
 */
function wholeNumber(s: string, code: string): number {
  const t = s.trim();
  if (!/^\d+$/.test(t)) throw new Error(code);
  return Number(t);
}
const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * `item` is the server's current copy (the parent's shops_shop_items query),
 * null for a new item; the parent remounts this form (key) when it changes
 * which item is open, and `onCreated` hands it the new item's id.
 */
export default function ShopItemEditor({ ownerId, item, onCreated, onDone }: {
  ownerId: string;
  item: ShopItem | null;
  onCreated: (itemId: string) => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const id = item?.id ?? null;
  const status = item?.status ?? "draft";
  const [d, setD] = useState<Draft>(() => fromItem(item));
  const [ticked, setTicked] = useState<string[]>([]);
  const [underCap, setUnderCap] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const refresh = () => void qc.invalidateQueries({ queryKey: ["shops", "items"] });

  const cottage = useQuery({ queryKey: ["shops", "cottage"], queryFn: fetchCottageStatus, enabled: d.kind === "home_food" });
  // The admin's note shows while the item has one: a re-saved rejected item
  // is a draft, and the reason must stay in view until it is republished
  // (lh-silent-failure review nit 7).
  const review = useQuery({
    queryKey: ["shops", "item-review", id],
    queryFn: () => fetchMyItemReview(id as string),
    enabled: !!id && (status === "rejected" || status === "draft"),
  });

  const fields = () => ({
    kind: d.kind,
    subtype: d.subtype,
    title: d.title,
    description: d.description,
    priceCents: cents(d.price),
    leadTimeDays: wholeNumber(d.lead, "invalid_lead_time"),
    stockCount: d.readyNow ? wholeNumber(d.stock, "invalid_stock") : null,
  });

  const save = useMutation({
    mutationFn: async () => (id ? (await updateShopItem(id, fields()), id) : createShopItem(fields())),
    onSuccess: async (savedId) => {
      toast.success("Saved as a draft.");
      // Wait for the list to hold the new item before the form switches to it.
      await qc.invalidateQueries({ queryKey: ["shops", "items"] });
      if (!id) onCreated(savedId);
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const stock = useMutation({
    mutationFn: () => {
      const f = fields();
      return setShopItemStock(id as string, f.stockCount, f.leadTimeDays);
    },
    onSuccess: () => {
      toast.success("Stock and ready time saved.");
      refresh();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const addPhoto = useMutation({
    mutationFn: (file: File) => addShopItemPhoto(ownerId, id as string, file),
    onSuccess: () => refresh(),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const removePhoto = useMutation({
    mutationFn: (photoId: string) => removeShopItemPhoto(photoId),
    onSuccess: () => refresh(),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const ai = useMutation({
    mutationFn: () => requestShopItemAiDraft(id as string),
    onSuccess: (s) => {
      // A new kind or type asks for its own confirmations (review nit 9).
      if (s.kind !== d.kind || s.subtype !== d.subtype) setTicked([]);
      setD((x) => ({ ...x, kind: s.kind, subtype: s.subtype, title: s.title, description: s.description }));
      // The suggestion's own verdict is not saved; the check at Publish decides (review should-fix 1).
      toast.success(
        s.flagged
          ? "Suggested. Our checks may send this item to an admin before it's listed."
          : "Suggested from your photos. Check it, then save.",
      );
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const need = requiredStatements(d.kind, d.subtype);
  const allTicked = need.every((k) => ticked.includes(k));
  const publish = useMutation({
    mutationFn: async () => {
      const itemId = id as string;
      // Unsaved edits are saved first, so the confirmations match what is listed.
      if (JSON.stringify(fromItem(item)) !== JSON.stringify(d)) await updateShopItem(itemId, fields());
      await attestShopItem(itemId, need);
      if (d.kind === "home_food" && cottage.data && !cottage.data.confirmed) await confirmCottageYear();
      // The photo check is best effort: an unchecked item waits for an admin (the server's fail-safe).
      try {
        await requestShopItemAiCheck(itemId);
      } catch (checkErr) {
        console.warn("[shops] photo check did not run; the item waits for an admin", checkErr);
      }
      return publishShopItem(itemId);
    },
    onSuccess: (next) => {
      toast.success(next === "live" ? "Listed on your shop." : "Sent for a quick review. It shows on your shop once approved.");
      refresh();
      void qc.invalidateQueries({ queryKey: ["shops", "cottage"] });
      onDone();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const draft = status === "draft";
  const busy = save.isPending || publish.isPending || addPhoto.isPending || removePhoto.isPending || ai.isPending;
  const shown = item?.photos ?? [];
  const cottageNeedsTick = d.kind === "home_food" && !!cottage.data && !cottage.data.confirmed;
  // Home food cannot publish until the yearly status is known (review should-fix 5).
  const cottageUnknown = d.kind === "home_food" && !cottage.data;

  return (
    <section className="space-y-4 rounded-2xl border border-border p-4" aria-labelledby="item-editor-title">
      <h3 id="item-editor-title" className="text-base font-semibold">{id ? "Edit item" : "Add an item"}</h3>
      {review.data?.review_note && (
        <ShopsNotice title="An admin didn't approve this item." tone="warn">
          <p className="[overflow-wrap:anywhere]">{review.data.review_note}</p>
        </ShopsNotice>
      )}
      {id && !draft && (
        <p className="text-sm text-muted-foreground">
          Changing the details below takes this item off your shop until you publish it again. Stock and ready time change right away.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="item-kind">What kind of item</Label>
        <select
          id="item-kind"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm"
          value={d.kind}
          onChange={(e) => {
            const kind = e.target.value as ShopItemKind;
            setD((x) => ({ ...x, kind, subtype: SHOP_ITEM_TYPES[kind][0] }));
            setTicked([]);
          }}
        >
          {(Object.keys(SHOP_ITEM_TYPES) as ShopItemKind[]).map((k) => (
            <option key={k} value={k}>{SHOP_ITEM_KIND_LABEL[k]}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="item-type">Type</Label>
        <select
          id="item-type"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm"
          value={d.subtype}
          onChange={(e) => {
            set("subtype", e.target.value);
            setTicked([]);
          }}
        >
          {SHOP_ITEM_TYPES[d.kind].map((t) => (
            <option key={t} value={t}>{SHOP_ITEM_TYPE_LABEL[t] ?? t}</option>
          ))}
        </select>
        {d.kind === "home_food" && (
          <p className="text-xs text-muted-foreground">
            Only foods Louisiana allows from a home kitchen, with no meat or fish. Plate lunches and other foods that need a health permit can't be listed yet.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="item-title">Title</Label>
        <Input id="item-title" value={d.title} maxLength={80} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="item-description">Description</Label>
        <Textarea id="item-description" value={d.description} maxLength={2000} rows={4} onChange={(e) => set("description", e.target.value)} />
        <p className="text-xs text-muted-foreground">No phone numbers, emails or websites: Shops does not allow contact details.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="item-price">Price (dollars)</Label>
          <Input id="item-price" inputMode="decimal" value={d.price} placeholder="18" onChange={(e) => set("price", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-lead">Days you need to make it</Label>
          <Input id="item-lead" type="number" min={0} max={60} value={d.lead} onChange={(e) => set("lead", e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Checkbox id="item-ready" checked={d.readyNow} onCheckedChange={(v) => set("readyNow", v === true)} />
          <Label htmlFor="item-ready" className="font-normal leading-snug">I have some ready now</Label>
        </div>
        {d.readyNow && (
          <div className="space-y-1.5">
            <Label htmlFor="item-stock">How many are ready</Label>
            <Input id="item-stock" type="number" min={0} max={9999} value={d.stock} onChange={(e) => set("stock", e.target.value)} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Every order still comes to you to accept.</p>
      </div>
      {d.kind === "home_food" && (
        <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs">Shown on this item: “{HOME_KITCHEN_NOTICE}”</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save draft"}
        </Button>
        {id && !draft && status !== "rejected" && (
          <Button type="button" variant="outline" disabled={stock.isPending} onClick={() => stock.mutate()}>
            Save stock and ready time
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>

      {id && draft && (
        <section className="space-y-2" aria-labelledby="item-photos">
          <h4 id="item-photos" className="text-sm font-medium">Photos (3 to 12)</h4>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex">
              <span className="sr-only">Add a photo</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) addPhoto.mutate(f);
                }}
              />
              <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm" aria-hidden>
                Add a photo
              </span>
            </label>
            <Button type="button" variant="outline" size="sm" disabled={busy || shown.length === 0} onClick={() => ai.mutate()}>
              <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              {ai.isPending ? "Looking…" : "Suggest details from my photos"}
            </Button>
          </div>
          {shown.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {shown.map((p) => (
                <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                  <img src={itemPhotoUrl(p.storage_path)} alt="" className="h-full w-full object-cover" />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="absolute bottom-1 right-1 px-2 text-xs"
                    disabled={busy}
                    onClick={() => removePhoto.mutate(p.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {id && draft && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Before you publish, confirm</legend>
          {need.map((k) => (
            <div key={k} className="flex items-start gap-2">
              <Checkbox
                id={`stmt-${k}`}
                checked={ticked.includes(k)}
                onCheckedChange={(v) => setTicked((t) => (v === true ? [...t, k] : t.filter((x) => x !== k)))}
              />
              <Label htmlFor={`stmt-${k}`} className="font-normal leading-snug">{SHOP_ITEM_STATEMENTS[k]}</Label>
            </div>
          ))}
          {d.kind === "home_food" && cottage.data?.warn && !cottage.data.reached && (
            <ShopsNotice title="You're close to this year's home-kitchen limit." tone="warn">
              <p>{`Your home-kitchen sales in the app this year: ${dollars(cottage.data.sales_cents)} of ${dollars(cottage.data.cap_cents)}.`}</p>
            </ShopsNotice>
          )}
          {d.kind === "home_food" && cottage.data?.reached && (
            <ShopsNotice title="You've reached this year's home-kitchen limit." tone="warn">
              <p>New home-kitchen items can be listed again in January.</p>
            </ShopsNotice>
          )}
          {d.kind === "home_food" && cottage.isError && (
            <ShopsNotice title="We couldn't load this year's home-kitchen limit." tone="warn">
              <ReportErrorScreen source="ShopItemEditor.cottageLimit" title="We couldn't load this year's home-kitchen limit." />
              <p>{shopsErrorMessage(cottage.error)}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void cottage.refetch()}>
                Try again
              </Button>
            </ShopsNotice>
          )}
          {cottageNeedsTick && (
            <div className="flex items-start gap-2">
              <Checkbox id="stmt-cottage" checked={underCap} onCheckedChange={(v) => setUnderCap(v === true)} />
              <Label htmlFor="stmt-cottage" className="font-normal leading-snug">
                {`My home-kitchen food sales this year, in the app and outside it, are under ${dollars(cottage.data?.cap_cents ?? 0)} (the Louisiana limit).`}
              </Label>
            </div>
          )}
          <Button
            type="button"
            className="btn-grad-primary w-full"
            disabled={busy || !allTicked || cottageUnknown || (cottageNeedsTick && !underCap)}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
          <p className="text-xs text-muted-foreground">Your first 3 items, and anything our checks flag, get a quick review before they show.</p>
        </fieldset>
      )}
    </section>
  );
}
