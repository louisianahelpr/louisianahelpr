/**
 * Admin -> Settings, Homes: first listings (owner 2026-10-19: "admin approves a
 * landlord's FIRST listing"; rent or sale; later listings go live right away).
 *
 * Each waiting listing shows its photos, words, price and the home's street
 * (staff check it against the ownership proof), with the lister's ID and
 * ownership state. Approve puts it live and tells the lister; reject needs a
 * reason the lister sees, and the listing stays a draft for them to fix and
 * send again. rentals_admin_review_first_listing (20261019185022) refuses
 * non-admins and an admin's own listing, re-runs every publish check for the
 * owner, refuses a decision about content edited since it was opened
 * (review_changed), and writes admin_audit_log. Shown only while the hidden
 * 'rentals' switch is on for the admin, as the ownership card above it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { fetchFirstListingsQueue, listingPhotoUrl, reviewFirstListing, type FirstListingReview } from "@/lib/rentals/listings";
import { priceLine, rentLine } from "@/lib/rentals/listingCopy";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { AdminCard } from "../AdminViewShell";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

const KEY = ["admin-homes-first-listings"];

function Waiting({ l, onDone }: { l: FirstListingReview; onDone: () => void }) {
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: (approve: boolean) => reviewFirstListing(l.id, approve, note.trim(), l.first_review_submitted_at),
    onSuccess: (_d, approve) => {
      toast.success(approve ? "Approved. It's live and the lister was told." : "Sent back. The lister sees your reason.");
      onDone();
    },
    onError: (e) => {
      toast.error(rentalsErrorMessage(e));
      onDone();
    },
  });
  const price = l.kind === "sale" ? priceLine(Number(l.sale_price_cents ?? 0)) : rentLine(Number(l.rent_cents ?? 0), l.rent_frequency ?? "monthly");
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm" data-testid="homes-first-listing">
      <div className="flex gap-2 overflow-x-auto">
        {l.photo_refs.map((ref, i) => (
          <img key={ref} src={listingPhotoUrl(ref, 320)} alt={`Photo ${i + 1}`} className="h-20 w-28 shrink-0 rounded-lg object-cover" loading="lazy" />
        ))}
      </div>
      <p className="font-semibold">{l.headline}</p>
      <p className="text-muted-foreground">
        {l.kind === "sale" ? "For sale" : "For rent"} · {price} · {l.beds} bd · {l.baths} ba
      </p>
      <p className="text-muted-foreground">
        {l.street_address}, {l.city} {l.zip_code}
      </p>
      <p className="text-muted-foreground">
        {l.owner_name ?? "No name"} · ID {l.owner_id_verified ? "verified" : "NOT verified"} · ownership {l.ownership_status}
      </p>
      {l.description && <p className="whitespace-pre-line">{l.description}</p>}
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        aria-label="Reason (required to send back)"
        placeholder="Reason (required to send back; the lister sees it)"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={m.isPending} onClick={() => m.mutate(true)}>
          Approve and show it
        </Button>
        <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(false)}>
          Send back
        </Button>
      </div>
    </div>
  );
}

export function HomesFirstListingsCard() {
  const on = useFeature("rentals");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, enabled: on, queryFn: fetchFirstListingsQueue });
  const done = () => qc.invalidateQueries({ queryKey: KEY });
  if (!on) return null;
  return (
    <AdminCard
      title="Homes: first listings"
      subtitle="Everyone's first listing waits here before it shows. Check the photos match the home and the words are fair. Their later listings show right away."
    >
      {q.isError ? (
        <>
          <ReportErrorScreen source="HomesFirstListingsCard.load" title="Homes first listings queue" />
          <p className="text-sm">Couldn't load the queue.</p>
        </>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <div className="space-y-3">
          {q.data.map((l) => (
            <Waiting key={l.id} l={l} onDone={done} />
          ))}
        </div>
      )}
    </AdminCard>
  );
}
