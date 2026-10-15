/**
 * Rentals S1 (Q6, Q53): properties whose ownership proof waits for an admin.
 * Shown only while the hidden 'rentals' switch is on for the admin. The proof
 * file opens from the private user-documents bucket (admins already read it);
 * approve or reject (with a reason the landlord sees). rentals_admin_review_property
 * refuses non-admins, an admin's own property, and writes admin_audit_log.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { fetchPendingOwnership, reviewOwnership, signedFileUrl, type RentalProperty } from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { AdminCard } from "../AdminViewShell";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

function Row({ p, onDone }: { p: RentalProperty; onDone: () => void }) {
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: (approve: boolean) => reviewOwnership(p.id, approve, note),
    onSuccess: onDone,
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <div className="rounded-xl border border-border p-3 space-y-2 text-sm">
      <p className="font-semibold">{p.label}</p>
      <p className="text-muted-foreground">
        {p.street_address}, {p.city} {p.zip_code}
      </p>
      {p.ownership_proof_path && (
        <button
          type="button"
          className="underline font-semibold"
          onClick={() =>
            signedFileUrl(p.ownership_proof_path as string).then(
              (u) => window.open(u, "_blank", "noopener"),
              (e) => toast.error(rentalsErrorMessage(e)),
            )
          }
        >
          Open ownership proof
        </button>
      )}
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        aria-label="Note (required to reject)"
        placeholder="Note (required to reject; the landlord sees it)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={m.isPending} onClick={() => m.mutate(true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(false)}>
          Reject
        </Button>
      </div>
    </div>
  );
}

export function RentalsOwnershipCard() {
  const on = useFeature("rentals");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-rentals-ownership"], enabled: on, queryFn: fetchPendingOwnership });
  if (!on) return null;
  return (
    <AdminCard title="Rentals: ownership proof" subtitle="Check the owner's name on the deed, tax bill or assessor page before the property can invite tenants.">
      {q.isError ? (
        <>
          <ReportErrorScreen source="RentalsOwnershipCard.load" title="Rentals ownership queue" />
          <p className="text-sm">Couldn't load the queue.</p>
        </>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <div className="space-y-2">
          {q.data.map((p) => (
            <Row key={p.id} p={p} onDone={() => qc.invalidateQueries({ queryKey: ["admin-rentals-ownership"] })} />
          ))}
        </div>
      )}
    </AdminCard>
  );
}
