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
  serviceTypeHint,
  setShopItemAtBuyer,
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
import ShopDigitalFiles from "./ShopDigitalFiles";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { NativeSelect } from "@/components/ui/select";

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

const STOCK_HINT = "Every order still comes to you to accept.";
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

/** The title / price a save refusal is about (its code as a whole word in the message), or null. */
function itemFieldOfError(err: unknown): "title" | "price" | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  if (/(^|[^a-z_])invalid_title($|[^a-z_])/.test(msg)) return "title";
  if (/(^|[^a-z_])invalid_price($|[^a-z_])/.test(msg)) return "price";
  return null;
}

/** Audit 11-10 F11: each thing a draft still needs before Publish, in plain words (the server's own limits). */
export function publishBlockers(x: { photos: number; title: string; price: string; unticked: number; cottageNeedsTick: boolean; cottageUnknown: boolean }): string[] {
  const out: string[] = [];
  if (x.photos < 3) out.push(`Add ${3 - x.photos} more photo${3 - x.photos === 1 ? "" : "s"} (3 to 12).`);
  const t = x.title.trim().length;
  if (t < 3 || t > 80) out.push("Give it a title of 3 to 80 characters.");
  // Read the price the way the save does (cents(): "$", "," and spaces dropped), so "1,200" never blocks Publish.
  const price = x.price.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0) out.push("Enter a price.");
  if (x.unticked > 0) out.push(`Tick ${x.unticked === 1 ? "the confirmation" : `the ${x.unticked} confirmations`} above.`);
  if (x.cottageNeedsTick) out.push("Confirm this year's home-kitchen sales above.");
  if (x.cottageUnknown) out.push("Wait for this year's home-kitchen limit to load.");
  return out;
}

/**
 * `item` is the server's current copy (the parent's shops_shop_items query),
 * null for a new item; the parent remounts this form (key) when it changes
 * which item is open, and `onCreated` hands it the new item's id.
 */
export default function ShopItemEditor({ ownerId, item, onCreated, onDone, hasOptions = false, titleHidden = false }: {
  /** The item has option lists: its stock is set per combination in the Options section (20261106165310). */
  hasOptions?: boolean;
  ownerId: string;
  item: ShopItem | null;
  onCreated: (itemId: string) => void;
  onDone: () => void;
  /** The page itself is titled "Add an item" / "Edit item" (shops audit 11-10 F4): the heading stays for screen readers only. */
  titleHidden?: boolean;
}) {
  const qc = useQueryClient();
  const id = item?.id ?? null;
  const status = item?.status ?? "draft";
  const [d, setD] = useState<Draft>(() => fromItem(item));
  const [ticked, setTicked] = useState<string[]>([]);
  const [underCap, setUnderCap] = useState(false);
  // Audit 11-10 F11: a refused title or price shows under its own field, not only in a toast.
  const [fieldError, setFieldError] = useState<{ field: "title" | "price"; msg: string } | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    if ((k === "title" || k === "price") && fieldError?.field === k) setFieldError(null);
  };
  const digital = d.kind === "digital";
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
    // A download is ready at once and never runs out (20261108182917).
    leadTimeDays: digital ? 0 : wholeNumber(d.lead, "invalid_lead_time"),
    stockCount: !digital && d.readyNow ? wholeNumber(d.stock, "invalid_stock") : null,
  });

  const save = useMutation({
    mutationFn: async () => (id ? { savedId: id, next: await updateShopItem(id, fields()) } : { savedId: await createShopItem(fields()), next: "draft" }),
    onSuccess: async ({ savedId, next }) => {
      // A live item's edit stays live unless it changes the kind or type, or a check flags the new words (owner 2026-11-05).
      toast.success(next === "live" ? "Saved. It's still on your shop." : next === "pending_review" ? "Saved. Our checks sent it for a quick review." : "Saved as a draft.");
      // Wait for the list to hold the new item before the form switches to it.
      await qc.invalidateQueries({ queryKey: ["shops", "items"] });
      if (!id) onCreated(savedId);
    },
    onError: (err) => {
      const field = itemFieldOfError(err);
      if (field) {
        setFieldError({ field, msg: shopsErrorMessage(err) });
        const el = document.getElementById(field === "title" ? "item-title" : "item-price");
        el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        el?.focus?.({ preventScroll: true });
      } else {
        toast.error(shopsErrorMessage(err));
      }
    },
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

  // H8 (b): carpet or furniture cleaning done at the buyer's place is taxed there; saved on its own, like stock.
  const atBuyer = useMutation({
    mutationFn: (v: boolean) => setShopItemAtBuyer(id as string, v),
    onSuccess: () => {
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
      // The photo check is best effort: if it does not answer, the word check decides (the server fails open, as Declutter).
      try {
        await requestShopItemAiCheck(itemId);
      } catch (checkErr) {
        console.warn("[shops] photo check did not run; the word check decides", checkErr);
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
  // F11: what still stands between this draft and Publish, said beside the button.
  const blockers = publishBlockers({
    photos: shown.length,
    title: d.title,
    price: d.price,
    unticked: need.filter((k) => !ticked.includes(k)).length,
    cottageNeedsTick: cottageNeedsTick && !underCap,
    cottageUnknown,
  });

  return (
    <section className="space-y-4 rounded-2xl border border-border p-4" aria-labelledby="item-editor-title">
      <h3 id="item-editor-title" className={titleHidden ? "sr-only" : "text-base font-semibold"}>{id ? "Edit item" : "Add an item"}</h3>
      {review.data?.review_note && (
        <ShopsNotice title="An admin didn't approve this item." tone="warn">
          <p className="[overflow-wrap:anywhere]">{review.data.review_note}</p>
        </ShopsNotice>
      )}
      {id && !draft && (
        <p className="text-sm text-muted-foreground">
          Changes stay on your shop right away. Changing what kind of item it is, or its type, takes it off until you publish it again.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="item-kind">What kind of item</Label>
        <NativeSelect
          id="item-kind"
          
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
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="item-type">Type</Label>
        <NativeSelect
          id="item-type"
          
          value={d.subtype}
          onChange={(e) => {
            set("subtype", e.target.value);
            setTicked([]);
          }}
        >
          {SHOP_ITEM_TYPES[d.kind].map((t) => (
            <option key={t} value={t}>{SHOP_ITEM_TYPE_LABEL[t] ?? t}</option>
          ))}
        </NativeSelect>
        {serviceTypeHint(d.kind, d.subtype) && (
          <p className="text-xs text-muted-foreground">{serviceTypeHint(d.kind, d.subtype)}</p>
        )}
        {d.kind === "home_food" && (
          <p className="text-xs text-muted-foreground">
            Only foods Louisiana allows from a home kitchen, with no meat or fish. Plate lunches and other foods that need a health permit can't be listed yet.
          </p>
        )}
      </div>
      {id && item?.kind === "service" && item.subtype === "fabric_cleaning" && d.subtype === "fabric_cleaning" && (
        <div className="space-y-1.5">
          <Label htmlFor="item-where">Where do you do this work?</Label>
          <NativeSelect
            id="item-where"
            value={item.at_buyer ? "buyer" : "shop"}
            disabled={atBuyer.isPending}
            onChange={(e) => atBuyer.mutate(e.target.value === "buyer")}
          >
            <option value="shop">At my place (they bring it to me)</option>
            <option value="buyer">At the buyer's place</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            At the buyer's place, they give the address when they order, and sales tax is figured there. It is ordered on its own.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="item-title">Title</Label>
        <Input id="item-title" value={d.title} maxLength={80} onChange={(e) => set("title", e.target.value)}
          aria-invalid={fieldError?.field === "title" || undefined} aria-describedby={fieldError?.field === "title" ? "item-title-error" : undefined} />
        {fieldError?.field === "title" && <p id="item-title-error" className="text-sm text-destructive-ink" role="alert">{fieldError.msg}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="item-description">Description</Label>
        <Textarea id="item-description" value={d.description} maxLength={2000} rows={4} onChange={(e) => set("description", e.target.value)} />
        <p className="text-xs text-muted-foreground">No phone numbers, emails or websites: Shops does not allow contact details.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="item-price">Price (dollars)</Label>
          <Input id="item-price" inputMode="decimal" value={d.price} placeholder="e.g. 18" onChange={(e) => set("price", e.target.value)}
            aria-invalid={fieldError?.field === "price" || undefined} aria-describedby={fieldError?.field === "price" ? "item-price-error" : undefined} />
          {fieldError?.field === "price" && <p id="item-price-error" className="text-sm text-destructive-ink" role="alert">{fieldError.msg}</p>}
        </div>
        {!digital && (
        <div className="space-y-1.5">
          <Label htmlFor="item-lead">Days you need to make it</Label>
          <Input id="item-lead" type="number" min={0} max={60} value={d.lead} onChange={(e) => set("lead", e.target.value)} />
        </div>
        )}
      </div>
      {!digital && (
      <div className="space-y-2">
        {hasOptions ? (
          <>
            <p className="text-sm text-muted-foreground" data-testid="item-stock-per-option">How many are ready is set for each option below.</p>
            <p className="text-xs text-muted-foreground">{STOCK_HINT}</p>
          </>
        ) : (
        // The hint is the label's second line, so the label keeps its 44px tap height with no dead band under one
        // line of text (11-10 shot: 44px from "I have some ready now" to the hint below it).
        <div className="flex items-center gap-2" data-testid="item-ready-row">
          <Checkbox id="item-ready" checked={d.readyNow} onCheckedChange={(v) => set("readyNow", v === true)} aria-describedby="item-ready-hint" />
          <Label htmlFor="item-ready" className="flex min-h-11 flex-1 flex-col justify-center font-normal leading-snug">
            <span>I have some ready now</span>
            <span id="item-ready-hint" className="text-xs text-muted-foreground">{STOCK_HINT}</span>
          </Label>
        </div>
        )}
        {d.readyNow && !hasOptions && (
          <div className="space-y-1.5">
            <Label htmlFor="item-stock">How many are ready</Label>
            <Input id="item-stock" type="number" min={0} max={9999} value={d.stock} onChange={(e) => set("stock", e.target.value)} />
          </div>
        )}
      </div>
      )}
      {d.kind === "home_food" && (
        <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs">Shown on this item: “{HOME_KITCHEN_NOTICE}”</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : status === "live" ? "Save changes" : "Save draft"}
        </Button>
        {id && !draft && status !== "rejected" && !digital && (
          <Button type="button" variant="outline" disabled={stock.isPending} onClick={() => stock.mutate()}>
            {hasOptions ? "Save ready time" : "Save stock and ready time"}
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

      {id && digital && item?.kind === "digital" && status !== "rejected" && <ShopDigitalFiles itemId={id} />}

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
              <Label htmlFor={`stmt-${k}`} className="block min-h-11 flex-1 font-normal leading-snug">{SHOP_ITEM_STATEMENTS[k]}</Label>
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
              <Label htmlFor="stmt-cottage" className="block min-h-11 flex-1 font-normal leading-snug">
                {`My home-kitchen food sales this year, in the app and outside it, are under ${dollars(cottage.data?.cap_cents ?? 0)} (the Louisiana limit).`}
              </Label>
            </div>
          )}
          {blockers.length > 0 && (
            <div className="rounded-lg bg-muted/70 px-3 py-2 text-sm" data-testid="item-publish-blockers" aria-live="polite">
              <p className="font-medium">To publish:</p>
              <ul className="list-disc pl-5">
                {blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}
          <Button
            type="button"
            className="btn-grad-primary w-full"
            disabled={busy || blockers.length > 0 || !allTicked || cottageUnknown || (cottageNeedsTick && !underCap)}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
          <p className="text-xs text-muted-foreground">Your item shows on your shop right away. Anything our checks flag gets a quick review first. After a rejection, new items are checked by an admin for 30 days. Edits to a live item keep it live, unless you change what kind of item it is or its type.</p>
        </fieldset>
      )}
    </section>
  );
}
