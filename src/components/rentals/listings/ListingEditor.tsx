import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  addListingPhoto,
  fetchListingPhotos,
  fetchMyListing,
  listingPhotoUrl,
  removeListingPhoto,
  saveListing,
  setListingStatus,
  type ListingFields,
  type RentalListing,
} from "@/lib/rentals/listings";
import {
  ACCESSIBILITY_LABEL,
  ASSISTANCE_ANIMALS_LINE,
  PARKING_LABEL,
  PETS_LABEL,
  UTILITY_LABEL,
  VOUCHERS_LABEL,
  listingShowing,
  listingStatusLabel,
} from "@/lib/rentals/listingCopy";
import { dollarsToCents, rentalsErrorMessage } from "@/lib/rentals/copy";
import { RentalsCard, fieldSelectClass } from "../rentalsUi";
import { isListingId, ListingUnavailable } from "./ListingView";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const selectClass = fieldSelectClass;

type Draft = Omit<ListingFields, "rent_cents" | "deposit_cents" | "beds" | "baths" | "sq_ft" | "lease_months_min" | "lease_months_max"> & {
  rent: string;
  deposit: string;
  beds: string;
  baths: string;
  sq_ft: string;
  lease_min: string;
  lease_max: string;
};

const EMPTY: Draft = {
  headline: "",
  description: "",
  rent: "",
  rent_frequency: "monthly",
  deposit: "",
  beds: "1",
  baths: "1",
  sq_ft: "",
  available_on: "",
  lease_min: "",
  lease_max: "",
  pets: "ask",
  pet_rules: "",
  parking: "none",
  utilities_included: [],
  accepts_vouchers: "ask",
  accessibility: [],
};

function fromRow(l: RentalListing): Draft {
  const s = (n: number | null) => (n == null ? "" : String(n));
  return {
    headline: l.headline,
    description: l.description,
    rent: String(l.rent_cents / 100),
    rent_frequency: l.rent_frequency as Draft["rent_frequency"],
    deposit: l.deposit_cents == null ? "" : String(l.deposit_cents / 100),
    beds: String(Number(l.beds)),
    baths: String(Number(l.baths)),
    sq_ft: s(l.sq_ft),
    available_on: l.available_on,
    lease_min: s(l.lease_months_min),
    lease_max: s(l.lease_months_max),
    pets: l.pets as Draft["pets"],
    pet_rules: l.pet_rules,
    parking: l.parking as Draft["parking"],
    utilities_included: l.utilities_included,
    accepts_vouchers: l.accepts_vouchers as Draft["accepts_vouchers"],
    accessibility: l.accessibility,
  };
}

/** The typed form -> the RPC's fields. Blank optional numbers are null; the server checks every range. */
function toFields(d: Draft): ListingFields {
  const int = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    headline: d.headline.trim(),
    description: d.description.trim(),
    rent_cents: dollarsToCents(d.rent) ?? 0,
    rent_frequency: d.rent_frequency,
    deposit_cents: d.deposit.trim() === "" ? null : dollarsToCents(d.deposit),
    beds: Number(d.beds),
    baths: Number(d.baths),
    sq_ft: int(d.sq_ft),
    available_on: d.available_on,
    lease_months_min: int(d.lease_min),
    lease_months_max: int(d.lease_max),
    pets: d.pets,
    pet_rules: d.pet_rules.trim(),
    parking: d.parking,
    utilities_included: d.utilities_included,
    accepts_vouchers: d.accepts_vouchers,
    accessibility: d.accessibility,
  };
}

function Checks({ legend, options, value, onChange }: { legend: string; options: Record<string, string>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(options).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function Photos({ listing, uid }: { listing: RentalListing; uid: string }) {
  const qc = useQueryClient();
  const photos = useQuery({ queryKey: ["rentals-listing-photos", listing.id], queryFn: () => fetchListingPhotos(listing.id) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rentals-listing-photos", listing.id] });
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
              <img src={listingPhotoUrl(p.storage_path)} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-xl bg-muted object-cover" />
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

function StatusActions({ listing }: { listing: RentalListing }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: (s: "live" | "paused" | "leased" | "removed") => setListingStatus(listing.id, s),
    onSuccess: (_d, s) => {
      qc.invalidateQueries({ queryKey: ["rentals-my-listing", listing.id] });
      qc.invalidateQueries({ queryKey: ["rentals-home"] });
      qc.invalidateQueries({ queryKey: ["rentals-browse"] });
      toast.success(s === "live" ? "Your listing is showing for 30 days." : s === "paused" ? "Paused." : s === "leased" ? "Marked as rented." : "Listing removed.");
      if (s === "removed") navigate("/rentals");
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const showing = listingShowing(listing.status, listing.expires_at);
  return (
    <RentalsCard title="Show it">
      <p className="text-sm">Status: {listingStatusLabel(listing.status, listing.expires_at)}</p>
      <div className="flex flex-wrap gap-2">
        {!showing && listing.status !== "removed" && listing.status !== "leased" && (
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
          <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate("leased")}>
            Mark as rented
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

function EditorForm({ listing, unitId, uid }: { listing: RentalListing | null; unitId: string | null; uid: string }) {
  const [d, setD] = useState<Draft>(listing ? fromRow(listing) : EMPTY);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => saveListing(listing?.id ?? null, listing ? null : unitId, toFields(d)),
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["rentals-my-listing", id] });
      qc.invalidateQueries({ queryKey: ["rentals-home"] });
      toast.success("Saved.");
      if (!listing) navigate(`/rentals/listings/${id}/edit`, { replace: true });
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const flags = listing?.wording_flags ?? [];
  return (
    <div className="max-w-2xl space-y-4">
      {flags.length > 0 && (
        <p role="alert" className="rounded-xl border border-destructive p-3 text-sm">
          Fair housing law doesn't allow a listing to say who may live in a home. Rewrite these words before it can show: {flags.join(", ")}.
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <RentalsCard title="The home">
          <Field label="Headline">
            <Input value={d.headline} maxLength={80} placeholder="e.g. Bright 2 bedroom near the park" onChange={(e) => set("headline", e.target.value)} required />
          </Field>
          <Field label="Description">
            <Textarea value={d.description} maxLength={4000} rows={5} placeholder="Describe the home: rooms, updates, appliances, the yard." onChange={(e) => set("description", e.target.value)} />
          </Field>
          <p className="text-xs text-muted-foreground">Describe the home, not the tenant you want: fair housing law doesn't allow words about who may live here.</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bedrooms">
              <select className={selectClass} value={d.beds} onChange={(e) => set("beds", e.target.value)}>
                <option value="0">Studio</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Bathrooms">
              <select className={selectClass} value={d.baths} onChange={(e) => set("baths", e.target.value)}>
                {[1, 1.5, 2, 2.5, 3, 3.5, 4].map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Sq ft (optional)">
              <Input inputMode="numeric" value={d.sq_ft} onChange={(e) => set("sq_ft", e.target.value)} />
            </Field>
            <Field label="Parking">
              <select className={selectClass} value={d.parking} onChange={(e) => set("parking", e.target.value as Draft["parking"])}>
                {Object.entries(PARKING_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
        </RentalsCard>
        <RentalsCard title="Rent and lease">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rent ($)">
              <Input inputMode="decimal" value={d.rent} onChange={(e) => set("rent", e.target.value)} required />
            </Field>
            <Field label="Every">
              <select className={selectClass} value={d.rent_frequency} onChange={(e) => set("rent_frequency", e.target.value as Draft["rent_frequency"])}>
                <option value="monthly">Month</option>
                <option value="biweekly">2 weeks</option>
                <option value="weekly">Week</option>
              </select>
            </Field>
            <Field label="Deposit ($, optional)">
              <Input inputMode="decimal" value={d.deposit} onChange={(e) => set("deposit", e.target.value)} />
            </Field>
            <Field label="Available from">
              <Input type="date" className="min-w-0" value={d.available_on} onChange={(e) => set("available_on", e.target.value)} required />
            </Field>
            <Field label="Shortest lease (months)">
              <Input inputMode="numeric" value={d.lease_min} onChange={(e) => set("lease_min", e.target.value)} />
            </Field>
            <Field label="Longest lease (months)">
              <Input inputMode="numeric" value={d.lease_max} onChange={(e) => set("lease_max", e.target.value)} />
            </Field>
          </div>
          <Checks legend="Utilities included" options={UTILITY_LABEL} value={d.utilities_included} onChange={(v) => set("utilities_included", v)} />
          <Field label="Housing vouchers">
            <select className={selectClass} value={d.accepts_vouchers} onChange={(e) => set("accepts_vouchers", e.target.value as Draft["accepts_vouchers"])}>
              {Object.entries(VOUCHERS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </RentalsCard>
        <RentalsCard title="Pets and access">
          <Field label="Pets">
            <select className={selectClass} value={d.pets} onChange={(e) => set("pets", e.target.value as Draft["pets"])}>
              {Object.entries(PETS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          {d.pets === "none" && <p className="text-xs text-muted-foreground">Your listing will say: {ASSISTANCE_ANIMALS_LINE}</p>}
          <Field label="Pet rules (optional)">
            <Input value={d.pet_rules} maxLength={300} placeholder="e.g. Up to 2 cats" onChange={(e) => set("pet_rules", e.target.value)} />
          </Field>
          <Checks legend="Accessibility features" options={ACCESSIBILITY_LABEL} value={d.accessibility} onChange={(v) => set("accessibility", v)} />
        </RentalsCard>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : listing ? "Save changes" : "Save and add photos"}
        </Button>
      </form>
      {listing && <Photos listing={listing} uid={uid} />}
      {listing && <StatusActions listing={listing} />}
    </div>
  );
}

/**
 * /rentals/listings/new?unit=<unit id> and /rentals/listings/:id/edit
 * (Homes -> Rent, RL1a): the landlord's listing editor. A new listing saves as
 * a draft first, then takes photos, then shows. The server checks every rule
 * (approved ownership, 5-25 photos, the fair-housing wording check).
 */
export default function ListingEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useCurrentUser();
  const uid = user?.id ?? "";
  const isNew = id === undefined;
  const unitId = params.get("unit");
  const q = useQuery({
    queryKey: ["rentals-my-listing", id],
    enabled: !isNew && isListingId(id) && !!uid,
    queryFn: () => fetchMyListing(id as string),
  });
  const title = isNew ? "List a home for rent" : "Edit listing";
  if (isNew && !(unitId && UUID.test(unitId))) return <ListingUnavailable />;
  if (!isNew && (!isListingId(id) || q.isError || q.data === null)) return <ListingUnavailable />;
  if (!isNew && !q.data) {
    return (
      <AppPage title={title} backTo="/rentals">
        <div role="status" aria-label="Loading the listing">
          <Skeleton className="h-64 w-full rounded-2xl" aria-hidden />
        </div>
      </AppPage>
    );
  }
  return (
    <AppPage title={title} backTo="/rentals">
      <EditorForm key={q.data?.updated_at ?? "new"} listing={q.data ?? null} unitId={unitId} uid={uid} />
    </AppPage>
  );
}
