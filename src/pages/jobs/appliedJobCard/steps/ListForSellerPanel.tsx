/**
 * LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM): on a "Have a Helpr list it" job, the hired Helpr writes the listings
 * here, on the SELLER's account, and sends them for the seller's approval. The Helpr only sees this job's listings,
 * can change one until it is sent, and never puts one on sale: the seller approves each (or all) on Selling. The job
 * counts as done for the Helpr once they are sent (the server's completion_requires_listings_sent until then).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isSellForMeJob } from "@/lib/declutter/sellForMe";
import { CATEGORIES } from "@/lib/declutter/categoryIcons";
import { formatPrice } from "@/lib/declutter/distance";
import { posterFirstName } from "@/lib/deletedPerson";
import {
  fetchHelprJobListings,
  helprCreateListing,
  helprDeleteListing,
  helprSendListings,
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
type Err = Error & { userMessage?: string };

function AddListingForm({ jobId, helprId, seller, onDone }: { jobId: string; helprId: string; seller: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0].key);
  const [price, setPrice] = useState("");
  const [lowest, setLowest] = useState("");
  const [area, setArea] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const save = useMutation({
    mutationFn: async () => {
      const priceCents = dollars(price);
      const id = await helprCreateListing(jobId, {
        title: title.trim(), description: description.trim(), category, conditionStars: 4, deliverySize: "small",
        priceCents, floorPriceCents: lowest ? dollars(lowest) : priceCents,
      }, area.trim());
      for (const f of photos) await helprUploadListingPhoto(helprId, id, f);
      return id;
    },
    onSuccess: () => { toast("Listing saved. Send it when you're ready."); onDone(); },
    onError: (e: Err) => toast(e.userMessage ?? "We couldn't save that listing. Try again."),
  });
  const ready = title.trim().length >= 3 && dollars(price) >= 100 && area.trim().length >= 2 && photos.length > 0;
  return (
    <form
      className="space-y-3 rounded-2xl border border-border p-3"
      aria-label={`New listing for ${seller}`}
      onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }}
    >
      <label className="block text-ds-13 font-medium">Photos
        <Input type="file" accept="image/*" multiple className="mt-1" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 12))} />
      </label>
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
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-ds-13 font-medium">Price ($)
          <Input className="mt-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="block text-ds-13 font-medium">Lowest price ($)
          <Input className="mt-1" inputMode="decimal" value={lowest} placeholder="Same as price" onChange={(e) => setLowest(e.target.value)} />
        </label>
      </div>
      <label className="block text-ds-13 font-medium">Neighborhood or town
        <Input className="mt-1" value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="rounded-full" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="rounded-full" disabled={!ready || save.isPending}>Save listing</Button>
      </div>
    </form>
  );
}

type PanelProps = {
  jobId: string;
  job: { category?: string | null; helper_completed_at?: string | null };
  posterName?: string | null;
};

/** Mounted on every Helpr job's on-site and working steps; renders (and reads) only on an open Have a Helpr list it job. */
export function ListForSellerPanel(props: PanelProps) {
  return isSellForMeJob(props.job.category) && !props.job.helper_completed_at ? <ListForSellerPanelOpen {...props} /> : null;
}

function ListForSellerPanelOpen({ jobId, posterName }: PanelProps) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const key = ["declutter", "helpr-job-listings", jobId];
  const { data: rows = [] } = useQuery({ queryKey: key, queryFn: () => fetchHelprJobListings(jobId) });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const send = useMutation({
    mutationFn: () => helprSendListings(jobId),
    onSuccess: (n) => { toast(n === 1 ? "Sent. They'll approve it on Declutter." : `Sent ${n} listings. They'll approve them on Declutter.`); refresh(); },
    onError: (e: Err) => toast(e.userMessage ?? "We couldn't send those. Try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => helprDeleteListing(id),
    onSuccess: refresh,
    onError: (e: Err) => toast(e.userMessage ?? "We couldn't delete that. Try again."),
  });
  if (!user) return null;
  const seller = posterFirstName(posterName) || "the seller";
  const drafts = rows.filter((r) => r.status === "draft").length;

  return (
    <section aria-label={`Listings for ${seller}`} data-list-for-seller="" className="space-y-3 text-left">
      <p className="text-ds-13 text-muted-foreground">
        Write each listing here. It goes on {seller}&apos;s account and stays off sale until {seller} approves it.
        Once you send them, you can mark the job done.
      </p>
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((r) => (
            <li key={r.item_id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ds-15 font-medium">{r.title}</p>
                <p className="text-ds-13 text-muted-foreground">{formatPrice(r.price_cents)} · {STATUS_WORDS[r.status]}</p>
              </div>
              {r.status === "draft" && (
                <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(r.item_id)}>Delete</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding
        ? <AddListingForm jobId={jobId} helprId={user.id} seller={seller} onDone={() => { setAdding(false); refresh(); }} />
        : <Button variant="outline" className="w-full rounded-full" onClick={() => setAdding(true)}>Add listing for {seller}</Button>}
      {drafts > 0 && (
        <Button className="w-full rounded-full" disabled={send.isPending} onClick={() => send.mutate()}>
          Send {drafts === 1 ? "it" : `all ${drafts}`} to {seller} for approval
        </Button>
      )}
    </section>
  );
}
