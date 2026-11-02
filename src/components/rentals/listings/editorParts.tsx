import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addListingPhoto,
  fetchListingPhotos,
  listingPhotoUrl,
  removeListingPhoto,
  setListingStatus,
  type RentalListing,
} from "@/lib/rentals/listings";
import { useRefreshOnExpiredRef } from "./useRefreshOnExpiredRef";
import { listingShowing, listingStatusLabel } from "@/lib/rentals/listingCopy";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { RentalsCard } from "../rentalsUi";

/**
 * The pieces both listing editors share (Rent: ListingEditor's form; Buy:
 * SaleListingEditor's): a labelled field, a checkbox group, the photos (5-25,
 * the first is the cover) and the show / pause / end / remove actions.
 */
export function Checks({ legend, options, value, onChange }: { legend: string; options: Record<string, string>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(options).map(([k, label]) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }}
              checked={value.includes(k)}
              onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Photos({ listing, uid }: { listing: RentalListing; uid: string }) {
  const qc = useQueryClient();
  const photos = useQuery({ queryKey: ["rentals-listing-photos", listing.id], queryFn: () => fetchListingPhotos(listing.id) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rentals-listing-photos", listing.id] });
  const refreshExpired = useRefreshOnExpiredRef([["rentals-listing-photos", listing.id]]);
  const add = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await addListingPhoto(uid, listing.id, f);
    },
    onSettled: refresh,
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const remove = useMutation({ mutationFn: removeListingPhoto, onSettled: refresh, onError: (e) => toast.error(rentalsErrorMessage(e)) });
  const n = photos.data?.length ?? 0;
  return (
    <RentalsCard title={`Photos (${n} of 5 to 25)`}>
      {!photos.data ? (
        <Skeleton className="h-24 w-full rounded-xl" aria-hidden />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.data.map((p, i) => (
            <div key={p.id} className="relative">
              <img src={listingPhotoUrl(p.ref, 320)} onError={() => refreshExpired(p.ref)} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-xl bg-muted object-cover" />
              {i === 0 && (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-card px-2 py-0.5 text-ds-11 font-semibold shadow-sm">Cover</span>
              )}
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(p.id)}
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
                  <X className="h-4 w-4" aria-hidden />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      <label
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-4 text-ds-15 font-semibold focus-within:ring-2 focus-within:ring-ring ${add.isPending || n >= 25 ? "cursor-not-allowed text-muted-foreground" : ""}`}
      >
        <ImagePlus className="h-5 w-5" aria-hidden />
        <span>{add.isPending ? "Adding photos…" : "Add photos"}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={add.isPending || n >= 25}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).slice(0, 25 - n);
            e.target.value = "";
            if (files.length) add.mutate(files);
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">Show every room, the outside and the kitchen. Location data is removed from photos before they upload.</p>
    </RentalsCard>
  );
}

export function StatusActions({ listing }: { listing: RentalListing }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: (s: "live" | "paused" | "leased" | "sold" | "removed") => setListingStatus(listing.id, s),
    onSuccess: (_d, s) => {
      qc.invalidateQueries({ queryKey: ["rentals-my-listing", listing.id] });
      qc.invalidateQueries({ queryKey: ["rentals-home"] });
      qc.invalidateQueries({ queryKey: ["rentals-browse"] });
      qc.invalidateQueries({ queryKey: ["rentals-browse-sale"] });
      toast.success(
        s === "live" ? "Your listing is showing for 30 days." : s === "paused" ? "Paused." : s === "leased" ? "Marked as rented." : s === "sold" ? "Marked as sold." : "Listing removed.",
      );
      if (s === "removed") navigate("/rentals");
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const showing = listingShowing(listing.status, listing.expires_at);
  return (
    <RentalsCard title="Show it">
      <p className="text-sm">Status: {listingStatusLabel(listing.status, listing.expires_at)}</p>
      <div className="flex flex-wrap gap-2">
        {!showing && listing.status !== "removed" && listing.status !== "leased" && listing.status !== "sold" && (
          <Button type="button" size="sm" disabled={m.isPending} onClick={() => m.mutate("live")}>
            {listing.status === "live" ? "Renew for 30 days" : "Show my listing"}
          </Button>
        )}
        {showing && (
          <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate("paused")}>
            Pause
          </Button>
        )}
        {(listing.status === "live" || listing.status === "paused") && (
          <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(listing.kind === "sale" ? "sold" : "leased")}>
            {listing.kind === "sale" ? "Mark as sold" : "Mark as rented"}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate("removed")}>
          Remove
        </Button>
        <Link to={`/rentals/listings/${listing.id}`} className="inline-flex items-center text-sm font-semibold underline">
          Preview
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">A listing shows for 30 days, then you renew it. It needs at least 5 photos.</p>
    </RentalsCard>
  );
}

