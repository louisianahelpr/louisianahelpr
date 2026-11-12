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
import { useEffect, useRef, useState } from "react";
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
  formatItemPrice,
  priceBoxText,
  HOME_KITCHEN_NOTICE,
  itemPhotoUrl,
  publishShopItem,
  removeShopItemPhoto,
  requestShopItemAiCheck,
  requestShopItemAiDraft,
  requestShopItemAiDraftFromPhotos,
  mergeShopItemSuggestion,
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
  type ShopItemAiDraft,
  type ShopItemKind,
} from "@/lib/shops/items";
import { SHOP_ITEM_MAX_PRICE_CENTS, shopsErrorMessage } from "@/lib/shops/errors";
import { fetchMyDigitalFiles } from "@/lib/shops/digitalFiles";
import { ShopsNotice } from "./shopsUi";
import ShopDigitalFiles from "./ShopDigitalFiles";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { NativeSelect } from "@/components/ui/select";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";

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
  price: i ? priceBoxText(i.price_cents) : "",
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

/** The field a refusal is about, by its code as a whole word in the message (S041: lead time and stock too). */
type ItemField = "title" | "price" | "lead" | "stock";
const FIELD_OF_CODE: Record<string, ItemField> = {
  invalid_title: "title", invalid_price: "price", invalid_lead_time: "lead", invalid_stock: "stock",
};
function itemFieldOfError(err: unknown): ItemField | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  for (const [code, field] of Object.entries(FIELD_OF_CODE)) {
    if (new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(msg)) return field;
  }
  return null;
}

/** Audit 11-10 F11: each thing a draft still needs before Publish, in plain words (the server's own limits). */
export function publishBlockers(x: {
  photos: number; title: string; price: string; unticked: number; cottageNeedsTick: boolean; cottageUnknown: boolean;
  /** A download's file count (S041): 0 blocks Publish (files_required); undefined/null while unknown or not a download. */
  digitalFiles?: number | null;
}): string[] {
  const out: string[] = [];
  if (x.photos < 3) out.push(`Add ${3 - x.photos} more photo${3 - x.photos === 1 ? "" : "s"} (3 to 12).`);
  if (x.photos > 12) out.push(`Remove ${x.photos - 12} photo${x.photos - 12 === 1 ? "" : "s"} (3 to 12).`);
  const t = x.title.trim().length;
  if (t < 3 || t > 80) out.push("Give it a title of 3 to 80 characters.");
  // Read the price the way the save does (cents(): "$", "," and spaces dropped), so "1,200" never blocks Publish.
  const price = x.price.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0) out.push("Enter a price.");
  // S041: the server's own range (invalid_price), said here instead of a refusal toast after Publish.
  else if (Math.round(Number(price) * 100) < 100 || Math.round(Number(price) * 100) > SHOP_ITEM_MAX_PRICE_CENTS) {
    out.push(`Set a price from $1 to $${(SHOP_ITEM_MAX_PRICE_CENTS / 100).toLocaleString("en-US")}.`);
  }
  if (x.digitalFiles === 0) out.push("Add 1 to 5 files for buyers to download.");
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
/** S054: a held (not yet uploaded) photo's preview; its object URL is let go when it leaves. */
function HeldPhoto({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // A soft tile while the local preview is made (never an empty box; photoPlaceholderEverywhere).
  return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-muted" aria-hidden />;
}

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
  // The form as of the last render, for an AI answer that lands after more typing (S2-006).
  const dRef = useRef(d);
  dRef.current = d;
  // S2-006: true once the owner picks a kind or type themselves; a suggestion then leaves both alone.
  const [kindPicked, setKindPicked] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [underCap, setUnderCap] = useState(false);
  // S054 (Shops audit 11-12): a NEW item's photos, held on the device (Declutter's photos-first draft). The AI reads
  // the first 4; all of them are added to the item right after its first save.
  const [held, setHeld] = useState<File[]>([]);
  // Audit 11-10 F11: a refused title or price shows under its own field, not only in a toast. S041: lead time and
  // stock too, from Save, Publish and "Save stock and ready time" alike.
  const [fieldError, setFieldError] = useState<{ field: ItemField; msg: string } | null>(null);
  // S2-007 (Shops audit 2): leaving with typed changes or held photos asks first (Cancel), and closing the tab warns.
  const unsaved = held.length > 0 || JSON.stringify(d) !== JSON.stringify(fromItem(item));
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (!unsaved) return;
    const warnNow = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warnNow);
    return () => window.removeEventListener("beforeunload", warnNow);
  }, [unsaved]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    if (fieldError?.field === k) setFieldError(null);
  };
  const errorUnderFieldOrToast = (err: unknown) => {
    const field = itemFieldOfError(err);
    if (field) {
      setFieldError({ field, msg: shopsErrorMessage(err) });
      const el = document.getElementById(`item-${field}`);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      el?.focus?.({ preventScroll: true });
    } else {
      toast.error(shopsErrorMessage(err));
    }
  };
  const fieldErrorProps = (f: ItemField) => ({
    "aria-invalid": fieldError?.field === f || undefined,
    "aria-describedby": fieldError?.field === f ? `item-${f}-error` : undefined,
  });
  const fieldErrorLine = (f: ItemField) =>
    fieldError?.field === f ? <p id={`item-${f}-error`} className="text-sm text-destructive-ink" role="alert">{fieldError.msg}</p> : null;
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
      // S054: the photos held before the first save go onto the new item now, in order.
      if (!id && held.length > 0) {
        let failed = 0;
        for (const f of held) {
          try {
            await addShopItemPhoto(ownerId, savedId, f);
          } catch (err) {
            failed += 1;
            console.warn("[shops] a held photo did not upload", err);
          }
        }
        setHeld([]);
        if (failed > 0) toast.error(failed === 1 ? "1 photo didn't upload. Add it again under Photos." : `${failed} photos didn't upload. Add them again under Photos.`);
      }
      // Wait for the list to hold the new item before the form switches to it.
      await qc.invalidateQueries({ queryKey: ["shops", "items"] });
      if (!id) onCreated(savedId);
    },
    onError: errorUnderFieldOrToast,
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
    onError: errorUnderFieldOrToast,
  });

  // H8 (b): carpet or furniture cleaning done at the buyer's place is taxed there; saved on its own, like stock.
  const atBuyer = useMutation({
    mutationFn: (v: boolean) => setShopItemAtBuyer(id as string, v),
    onSuccess: () => {
      refresh();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  // S009 (Shops audit 11-12): a LIVE item's photos change too. The change clears its photo check, so it runs again
  // on the live item (best effort, as at Publish: no answer leaves it live). Only a flag takes it off the shop.
  const recheckLive = async () => {
    if (status !== "live" || !id) return;
    try {
      const v = await requestShopItemAiCheck(id);
      if (v.flagged) toast.warning("Our checks flagged a photo. The item is off your shop until our team looks at it.");
    } catch (checkErr) {
      console.warn("[shops] photo check did not run on the live item; it stays live", checkErr);
    }
  };
  const addPhoto = useMutation({
    mutationFn: async (file: File) => {
      await addShopItemPhoto(ownerId, id as string, file);
      await recheckLive();
    },
    onSuccess: () => refresh(),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const removePhoto = useMutation({
    mutationFn: async (photoId: string) => {
      await removeShopItemPhoto(photoId);
      await recheckLive();
    },
    onSuccess: () => refresh(),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  // S2-006: one handler for both suggestion buttons. It fills only empty fields and keeps a kind and type the owner
  // picked (a listed item's own kind counts as picked; a draft's may still be the default), against the form as it is when the answer lands.
  const applySuggestion = (s: ShopItemAiDraft) => {
    const merged = mergeShopItemSuggestion(dRef.current, s, kindPicked || (!!item && item.status !== "draft"));
    dRef.current = merged.form;
    setD(merged.form);
    // A new kind or type asks for its own confirmations (review nit 9).
    if (merged.kindChanged) setTicked([]);
    // The suggestion's own verdict is not saved; the check at Publish decides (review should-fix 1).
    toast.success(
      s.flagged
        ? "Suggested. Our checks may send this item to an admin before it's listed."
        : merged.filled ? "Suggested from your photos. Check it, then save." : "Your words are kept. Clear a field to get a suggestion for it.",
    );
  };
  // S054: suggestions for a new item from its held photos (nothing uploaded by this call).
  const aiPhotos = useMutation({
    mutationFn: () => requestShopItemAiDraftFromPhotos(held),
    onSuccess: applySuggestion,
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const ai = useMutation({
    mutationFn: () => requestShopItemAiDraft(id as string),
    onSuccess: applySuggestion,
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
    onError: errorUnderFieldOrToast,
  });

  const draft = status === "draft";
  // S009: photos can change on a draft or a live item (not while it waits for an admin).
  const photosEditable = draft || status === "live";
  const busy = save.isPending || publish.isPending || addPhoto.isPending || removePhoto.isPending || ai.isPending || aiPhotos.isPending;
  const shown = item?.photos ?? [];
  const cottageNeedsTick = d.kind === "home_food" && !!cottage.data && !cottage.data.confirmed;
  // Home food cannot publish until the yearly status is known (review should-fix 5).
  const cottageUnknown = d.kind === "home_food" && !cottage.data;
  // F11: what still stands between this draft and Publish, said beside the button.
  // S041: a download's files, the same read (and cache key) as ShopDigitalFiles, so Publish says when none are added.
  const digitalFiles = useQuery({
    queryKey: ["shops", "digital-files", id],
    queryFn: () => fetchMyDigitalFiles(id as string),
    enabled: !!id && digital && item?.kind === "digital" && status === "draft",
  });
  const blockers = publishBlockers({
    digitalFiles: digital && digitalFiles.isSuccess ? digitalFiles.data.length : null,
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
      {/* S2-008 (Shops audit 2): the live line only on a live item; a waiting item is told what Save draft does. */}
      {id && status === "live" && (
        <p className="text-sm text-muted-foreground">
          Changes stay on your shop right away. Changing what kind of item it is, or its type, takes it off until you publish it again.
        </p>
      )}
      {id && status === "pending_review" && (
        <p className="text-sm text-muted-foreground" data-testid="item-waiting-save-note">
          This item is waiting for review. Saving takes it out of review; publish it again after.
        </p>
      )}
      {!id && (
        <section className="space-y-2" aria-labelledby="item-start-photos" data-testid="item-start-photos">
          <h4 id="item-start-photos" className="text-sm font-medium">Start with photos</h4>
          <p className="text-xs text-muted-foreground">Add photos and we'll suggest the details. They go on the item when you save it.</p>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex">
              <span className="sr-only">Add photos</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={busy || held.length >= 12}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  // S2-011: say so when photos past 12 are left out (they were dropped silently).
                  const over = held.length + files.length - 12;
                  if (over > 0) toast(`An item can have up to 12 photos. ${over} of them ${over === 1 ? "was" : "were"} left out.`);
                  setHeld((h) => [...h, ...files].slice(0, 12));
                }}
              />
              <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm" aria-hidden>
                Add photos
              </span>
            </label>
            <Button type="button" variant="outline" size="sm" disabled={busy || held.length === 0} onClick={() => aiPhotos.mutate()}>
              <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              {aiPhotos.isPending ? "Looking…" : "Suggest details from my photos"}
            </Button>
          </div>
          {held.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {held.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                  <HeldPhoto file={f} />
                  <Button type="button" size="sm" variant="outline" className="absolute bottom-1 right-1 px-2 text-xs" disabled={busy}
                    onClick={() => setHeld((h) => h.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
            setKindPicked(true);
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
            setKindPicked(true);
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
        {hasOptions && item ? (
          // S2-004: with options the price is each option's own; the item's price is the lowest of them (the server's
          // rollup), so an editable box here only snapped back after Save.
          <div className="space-y-1.5" data-testid="item-price-per-option">
            <p className="text-sm font-medium">Price</p>
            <p className="text-sm text-muted-foreground">From {formatItemPrice(item.price_cents)}, set per option below.</p>
          </div>
        ) : (
        <div className="space-y-1.5">
          <Label htmlFor="item-price">Price (dollars)</Label>
          <Input id="item-price" inputMode="decimal" value={d.price} placeholder="e.g. 18" onChange={(e) => set("price", e.target.value)}
            aria-invalid={fieldError?.field === "price" || undefined} aria-describedby={fieldError?.field === "price" ? "item-price-error" : undefined} />
          {fieldError?.field === "price" && <p id="item-price-error" className="text-sm text-destructive-ink" role="alert">{fieldError.msg}</p>}
        </div>
        )}
        {!digital && (
        <div className="space-y-1.5">
          <Label htmlFor="item-lead">Days you need to make it</Label>
          <Input id="item-lead" type="number" min={0} max={60} value={d.lead} onChange={(e) => set("lead", e.target.value)} {...fieldErrorProps("lead")} />
          {fieldErrorLine("lead")}
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
            <Input id="item-stock" type="number" min={0} max={9999} value={d.stock} onChange={(e) => set("stock", e.target.value)} {...fieldErrorProps("stock")} />
            {fieldErrorLine("stock")}
          </div>
        )}
      </div>
      )}
      {d.kind === "home_food" && (
        <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs">Shown on this item: “{HOME_KITCHEN_NOTICE}”</p>
      )}
      {/* S2-035 (Shops audit 2): a new item's first screen had only an outline "Save draft", which read as the end.
          Its main button now says what comes next, and a line names the steps before Publish. */}
      {!id && (
        <p className="text-sm text-muted-foreground" data-testid="item-new-next-steps">
          Saves it as a draft. Next: 3 or more photos, then Publish.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={id ? "outline" : "default"} className={id ? undefined : "btn-grad-primary"} disabled={busy} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : !id ? "Save and continue" : status === "live" ? "Save changes" : "Save draft"}
        </Button>
        {id && !draft && status !== "rejected" && !digital && (
          <Button type="button" variant="outline" disabled={stock.isPending} onClick={() => stock.mutate()}>
            {hasOptions ? "Save ready time" : "Save stock and ready time"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => (unsaved ? setConfirmLeave(true) : onDone())}>Cancel</Button>
      </div>
      <BrandConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave without saving?"
        description={held.length > 0 ? "Your changes and the photos you picked aren't saved yet." : "Your changes aren't saved yet."}
        primaryLabel="Leave"
        onPrimary={() => { setConfirmLeave(false); onDone(); }}
        secondaryLabel="Keep editing"
      />

      {id && photosEditable && (
        <section className="space-y-2" aria-labelledby="item-photos">
          <h4 id="item-photos" className="text-sm font-medium">Photos (3 to 12)</h4>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex">
              <span className="sr-only">Add a photo</span>
              {/* S2-010: an item holds up to 12 photos; the control says so and stops at 12. */}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy || shown.length >= 12}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) addPhoto.mutate(f);
                }}
              />
              <span className={`inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm ${shown.length >= 12 ? "opacity-60" : "cursor-pointer"}`} aria-hidden>
                {shown.length >= 12 ? "12 photos (the most)" : "Add a photo"}
              </span>
            </label>
            {draft && (
              <Button type="button" variant="outline" size="sm" disabled={busy || shown.length === 0} onClick={() => ai.mutate()}>
                <Sparkles className="mr-1 h-4 w-4" aria-hidden />
                {ai.isPending ? "Looking…" : "Suggest details from my photos"}
              </Button>
            )}
          </div>
          {!draft && <p className="text-xs text-muted-foreground">New photos get our quick photo check. The item stays on your shop unless it flags one.</p>}
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
                    // S009: a live item keeps 3 photos (the server says so too).
                    disabled={busy || (!draft && shown.length <= 3)}
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
