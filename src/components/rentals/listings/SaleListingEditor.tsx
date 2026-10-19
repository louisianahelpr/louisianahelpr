import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveSaleListing, type RentalListing, type SaleListingFields } from "@/lib/rentals/listings";
import { ACCESSIBILITY_LABEL, PARKING_LABEL, SALE_HOW_IT_WORKS } from "@/lib/rentals/listingCopy";
import { dollarsToCents, rentalsErrorMessage } from "@/lib/rentals/copy";
import { RentalsCard, fieldSelectClass } from "../rentalsUi";
import { Checks, Field, Photos, StatusActions } from "./editorParts";

interface SaleDraft {
  headline: string;
  description: string;
  price: string;
  beds: string;
  baths: string;
  sq_ft: string;
  lot_sq_ft: string;
  year_built: string;
  parking: SaleListingFields["parking"];
  accessibility: string[];
}

const EMPTY: SaleDraft = {
  headline: "",
  description: "",
  price: "",
  beds: "3",
  baths: "2",
  sq_ft: "",
  lot_sq_ft: "",
  year_built: "",
  parking: "driveway",
  accessibility: [],
};

function fromRow(l: RentalListing): SaleDraft {
  const s = (n: number | null) => (n == null ? "" : String(n));
  return {
    headline: l.headline,
    description: l.description,
    price: l.sale_price_cents == null ? "" : String(Number(l.sale_price_cents) / 100),
    beds: String(Number(l.beds)),
    baths: String(Number(l.baths)),
    sq_ft: s(l.sq_ft),
    lot_sq_ft: s(l.lot_sq_ft),
    year_built: s(l.year_built),
    parking: l.parking as SaleDraft["parking"],
    accessibility: l.accessibility,
  };
}

/** The typed form -> the RPC's fields. Blank optional numbers are null; the server checks every range. */
function toFields(d: SaleDraft): SaleListingFields {
  const int = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
  return {
    headline: d.headline.trim(),
    description: d.description.trim(),
    sale_price_cents: dollarsToCents(d.price.replace(/,/g, "")) ?? 0,
    beds: Number(d.beds),
    baths: Number(d.baths),
    sq_ft: int(d.sq_ft),
    lot_sq_ft: int(d.lot_sq_ft),
    year_built: int(d.year_built),
    parking: d.parking,
    accessibility: d.accessibility,
  };
}

/**
 * Homes -> Buy: the owner's for-sale listing (20261019061241). One price, no
 * offers and no commission on our side; the server flags haggling words and
 * fair-housing words alike. A new listing saves as a draft first, then takes
 * photos, then shows.
 */
export function SaleEditorForm({ listing, propertyId, uid }: { listing: RentalListing | null; propertyId: string | null; uid: string }) {
  const [d, setD] = useState<SaleDraft>(listing ? fromRow(listing) : EMPTY);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const set = <K extends keyof SaleDraft>(k: K, v: SaleDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => saveSaleListing(listing?.id ?? null, listing ? null : propertyId, toFields(d)),
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
    <div className="space-y-6">
      <p className="px-1 text-ds-14 text-muted-foreground">{SALE_HOW_IT_WORKS}</p>
      {flags.length > 0 && (
        <p role="alert" className="rounded-2xl border border-destructive p-4 text-ds-14">
          Rewrite these words before the listing can show: {flags.join(", ")}. Give one price and describe the home, not who may live there.
        </p>
      )}
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <RentalsCard title="The home">
          <Field label="Headline">
            <Input value={d.headline} maxLength={80} placeholder="e.g. Three bedroom brick home with a big yard" onChange={(e) => set("headline", e.target.value)} required />
          </Field>
          <Field label="Description">
            <Textarea value={d.description} maxLength={4000} rows={5} placeholder="Rooms, updates, the roof, the yard, what stays with the home." onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bedrooms">
              <select className={fieldSelectClass} value={d.beds} onChange={(e) => set("beds", e.target.value)}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={String(n)}>{n === 0 ? "Studio" : n}</option>
                ))}
              </select>
            </Field>
            <Field label="Bathrooms">
              <select className={fieldSelectClass} value={d.baths} onChange={(e) => set("baths", e.target.value)}>
                {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Home sq ft (optional)">
              <Input inputMode="numeric" value={d.sq_ft} onChange={(e) => set("sq_ft", e.target.value)} />
            </Field>
            <Field label="Lot sq ft (optional)">
              <Input inputMode="numeric" value={d.lot_sq_ft} onChange={(e) => set("lot_sq_ft", e.target.value)} />
            </Field>
            <Field label="Year built (optional)">
              <Input inputMode="numeric" maxLength={4} value={d.year_built} onChange={(e) => set("year_built", e.target.value)} />
            </Field>
            <Field label="Parking">
              <select className={fieldSelectClass} value={d.parking} onChange={(e) => set("parking", e.target.value as SaleDraft["parking"])}>
                {Object.entries(PARKING_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <Checks legend="Accessibility features" options={ACCESSIBILITY_LABEL} value={d.accessibility} onChange={(v) => set("accessibility", v)} />
        </RentalsCard>
        <RentalsCard title="Price">
          <Field label="Price ($)">
            <Input inputMode="decimal" value={d.price} placeholder="e.g. 245,000" onChange={(e) => set("price", e.target.value)} required />
          </Field>
          <p className="text-ds-13 text-muted-foreground">One price, shown as you set it. A title company or attorney handles the closing.</p>
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
