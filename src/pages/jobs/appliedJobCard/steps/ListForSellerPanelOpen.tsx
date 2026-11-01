/**
 * Loaded on demand by ListForSellerPanel (so the Declutter modules stay out of the Jobs chunk).
 * LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM): on a "Have a Helpr list it" job, the hired Helpr writes the listings
 * here, on the SELLER's account, and sends them for the seller's approval. The Helpr only sees this job's listings,
 * can change one until it is sent, and never puts one on sale: the seller approves each (or all) on Selling. The job
 * counts as done for the Helpr once they are sent (the server's completion_requires_listings_sent until then).
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CATEGORIES } from "@/lib/declutter/categoryIcons";
import { CONDITION_LABEL, SIZE_LABEL } from "@/components/declutter/declutterUi";
import { formatPrice } from "@/lib/declutter/distance";
import { posterFirstName } from "@/lib/deletedPerson";
import { requestAiDraftFromPhotos, type DeliverySize } from "@/lib/declutter/api";
import { AiPriceLine, SellAiDraftPanel, useSellAiDraft, withCoverFile, type AiFields } from "@/components/declutter/SellAiDraft";
import {
  fetchHelprJobListings,
  helprCreateListing,
  helprDeleteListing,
  helprSendListings,
  helprUpdateListing,
  helprUploadListingPhoto,
  type HelprJobListing,
} from "@/lib/declutter/listForSeller";

const STATUS_WORDS: Record<HelprJobListing["status"], string> = {
  draft: "Not sent yet",
  pending_seller_approval: "Waiting for their approval",
  approved: "Approved",
  declined: "Not used",
};

const dollars = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100);
const cents = (n: number) => (n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2));
type Err = Error & { userMessage?: string };

/** The Helpr's add form, and the edit form of an unsent draft (`editing`): the area is kept as first written. */
function ListingForm({ jobId, helprId, seller, editing, onDone }: {
  jobId: string; helprId: string; seller: string; editing?: HelprJobListing; onDone: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [category, setCategory] = useState<string>(editing?.category ?? CATEGORIES[0].key);
  const [condition, setCondition] = useState(editing?.condition_stars ?? 4);
  const [size, setSize] = useState<keyof typeof SIZE_LABEL>(
    editing && editing.delivery_size in SIZE_LABEL ? (editing.delivery_size as keyof typeof SIZE_LABEL) : "small");
  const [price, setPrice] = useState(editing ? cents(editing.price_cents) : "");
  const [lowest, setLowest] = useState(editing && editing.floor_price_cents !== editing.price_cents ? cents(editing.floor_price_cents) : "");
  const [area, setArea] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  // The same photo draft and price suggestion as Sell one (lead 11-01): the photos on the device are read (never
  // stored by the read), the empty fields are written, and "Write it again" asks once more. Only a NEW listing starts
  // it by itself; an unsent draft being edited asks only when the Helpr taps.
  const aiForm: AiFields = { title, description, category, deliverySize: size as DeliverySize, conditionStars: condition, price };
  const setAiForm = useCallback((update: (f: AiFields) => AiFields) => {
    const next = update({ title, description, category, deliverySize: size as DeliverySize, conditionStars: condition, price });
    setTitle(next.title);
    setDescription(next.description);
    if (CATEGORIES.some((c) => c.key === next.category)) setCategory(next.category);
    if (next.deliverySize in SIZE_LABEL) setSize(next.deliverySize as keyof typeof SIZE_LABEL);
    setCondition(next.conditionStars);
    setPrice(next.price);
  }, [title, description, category, size, condition, price]);
  const aiAsk = useMemo(() => (photos.length > 0 ? withCoverFile(photos, (f) => requestAiDraftFromPhotos(f)) : null), [photos]);
  const ai = useSellAiDraft({ ask: aiAsk, form: aiForm, setForm: setAiForm, autoStart: !editing && photos.length > 0, photosAdded: photos.length });
  const save = useMutation({
    mutationFn: async () => {
      const priceCents = dollars(price);
      const fields = {
        title: title.trim(), description: description.trim(), category, conditionStars: condition, deliverySize: size,
        priceCents, floorPriceCents: lowest ? dollars(lowest) : priceCents,
      };
      let id: string;
      if (editing) {
        id = editing.item_id;
        await helprUpdateListing(id, fields);
      } else {
        id = await helprCreateListing(jobId, fields, area.trim());
      }
      for (const f of photos) await helprUploadListingPhoto(helprId, id, f);
      return id;
    },
    onSuccess: () => { toast(editing ? "Listing updated." : "Listing saved. Send it when you're ready."); onDone(); },
    onError: (e: Err) => toast(e.userMessage ?? "We couldn't save that listing. Try again."),
  });
  const hasPhoto = photos.length > 0 || (editing?.photo_count ?? 0) > 0;
  const ready = title.trim().length >= 3 && dollars(price) >= 100 && (editing || area.trim().length >= 2) && hasPhoto;
  return (
    <form
      className="space-y-3 rounded-2xl border border-border p-3"
      aria-label={editing ? `Edit ${editing.title}` : `New listing for ${seller}`}
      onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }}
    >
      <label className="block text-ds-13 font-medium">{editing ? `Add photos (has ${editing.photo_count})` : "Photos"}
        <Input type="file" accept="image/*" multiple className="mt-1" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 12))} />
      </label>
      {photos.length > 0 && <SellAiDraftPanel state={ai.state} onRun={ai.run} oneScreen />}
      <label className="block text-ds-13 font-medium">Title
        <Input className="mt-1" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-ds-13 font-medium">Description
        <Textarea className="mt-1" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="block text-ds-13 font-medium">Category
        <select className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      <label className="block text-ds-13 font-medium">Condition
        <select className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3" value={condition} onChange={(e) => setCondition(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{CONDITION_LABEL[n]}</option>)}
        </select>
      </label>
      <label className="block text-ds-13 font-medium">Size
        <select className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3" value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZE_LABEL)}>
          {(Object.keys(SIZE_LABEL) as (keyof typeof SIZE_LABEL)[]).map((k) => <option key={k} value={k}>{SIZE_LABEL[k]}</option>)}
        </select>
      </label>
      {/* One per line on a phone: side by side, "Same as price" was cut off at 375. */}
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        {ai.state.status === "done" && <AiPriceLine draft={ai.state.draft} />}
        <label className="block text-ds-13 font-medium">Price ($)
          <Input className="mt-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="block text-ds-13 font-medium">Lowest price ($)
          <Input className="mt-1" inputMode="decimal" value={lowest} placeholder="Same as price" onChange={(e) => setLowest(e.target.value)} />
        </label>
      </div>
      {!editing && (
        <label className="block text-ds-13 font-medium">Neighborhood or town
          <Input className="mt-1" value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="rounded-full" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="rounded-full" disabled={!ready || save.isPending}>{editing ? "Save changes" : "Save listing"}</Button>
      </div>
    </form>
  );
}

export type PanelProps = {
  jobId: string;
  job: { category?: string | null; helper_completed_at?: string | null };
  posterName?: string | null;
};

export default function ListForSellerPanelOpen({ jobId, posterName }: PanelProps) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const key = ["declutter", "helpr-job-listings", jobId];
  const { data: rows = [] } = useQuery({ queryKey: key, queryFn: () => fetchHelprJobListings(jobId) });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const send = useMutation({
    mutationFn: () => helprSendListings(jobId),
    onSuccess: (n) => { toast(n === 1 ? "Sent. They'll approve it on Declutter." : `Sent ${n} listings. They'll approve them on Declutter.`); refresh(); },
    onError: (e: Err) => toast(e.userMessage ?? "We couldn't send those. Try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => helprDeleteListing(user?.id ?? "", id),
    onSuccess: refresh,
    onError: (e: Err) => toast(e.userMessage ?? "We couldn't delete that. Try again."),
  });
  if (!user) return null;
  const seller = posterFirstName(posterName) || "the seller";
  const drafts = rows.filter((r) => r.status === "draft").length;
  const editing = rows.find((r) => r.item_id === editingId && r.status === "draft");
  const close = () => { setAdding(false); setEditingId(null); refresh(); };

  return (
    <section aria-label={`Listings for ${seller}`} data-list-for-seller="" className="space-y-3 text-left">
      <p className="text-ds-13 text-muted-foreground">
        Write each listing here. It goes on {seller}&apos;s account and stays off sale until {seller} approves it.
      </p>
      {/* The two actions come first, above the list, so on a phone they are on screen without scrolling past every
          listing (b55's 375 check: below the fold, under the bottom bar). */}
      {adding || editing
        ? <ListingForm key={editing?.item_id ?? "new"} jobId={jobId} helprId={user.id} seller={seller} editing={editing} onDone={close} />
        : (
          <div className="space-y-2" data-list-for-seller-actions="">
            {drafts > 0 && (
              <Button className="w-full rounded-full" disabled={send.isPending} onClick={() => send.mutate()}>
                Send {drafts === 1 ? "it" : `all ${drafts}`} to {seller} for approval
              </Button>
            )}
            <Button variant="outline" className="w-full rounded-full" onClick={() => setAdding(true)}>Add listing for {seller}</Button>
          </div>
        )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((r) => (
            <li key={r.item_id} className="flex items-center gap-0.5 py-2 pl-3 pr-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ds-15 font-medium">{r.title}</p>
                <p className="text-ds-13 text-muted-foreground">{formatPrice(r.price_cents)} · {STATUS_WORDS[r.status]}</p>
              </div>
              {r.status === "draft" && (
                <>
                  <Button variant="ghost" className="px-2" aria-label={`Edit ${r.title}`} disabled={adding || !!editing}
                    onClick={() => setEditingId(r.item_id)}>Edit</Button>
                  <Button variant="ghost" className="px-2" aria-label={`Delete ${r.title}`} disabled={remove.isPending}
                    onClick={() => remove.mutate(r.item_id)}>Delete</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
