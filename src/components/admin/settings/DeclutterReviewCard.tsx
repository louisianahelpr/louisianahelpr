import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { fetchPendingForAdmin, photoPublicUrl, reviewListing } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { AdminCard } from "../AdminViewShell";

/**
 * Declutter listings waiting for an admin (spec row 33, build decision B8):
 * a new seller's first 3 listings, and any listing the photo check flagged
 * or could not check (row 34, B19). Approve puts it up for sale; reject
 * needs a reason, which the seller reads. The server refuses a non-admin,
 * an admin's own listing, and approving a seller who cannot sell right now
 * (declutter_admin_review_item). Shown only while the 'declutter' switch is
 * on for this admin; it lives beside that switch (B23).
 */
interface PendingRow {
  item_id: string;
  seller_id: string;
  title: string;
  description: string;
  price_cents: number;
  area_label: string;
  ai_checked_at: string | null;
  ai_flag_reason: string | null;
  approved_listings: number;
  photo_paths: string[];
}

export function whyWaiting(row: Pick<PendingRow, "ai_checked_at" | "ai_flag_reason" | "approved_listings">): string {
  if (row.ai_flag_reason) return `Photo check flagged it: ${row.ai_flag_reason}`;
  if (row.approved_listings < 3) return `New seller (${row.approved_listings} of 3 approved listings)`;
  if (!row.ai_checked_at) return "The photo check did not run";
  return "Waiting for a review";
}

function PendingItem({ row }: { row: PendingRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => reviewListing(row.item_id, approve, approve ? null : note.trim()),
    onSuccess: (status) => {
      toast.success(status === "live" ? "Approved: it's for sale now." : "Rejected. The seller will see your reason.");
      void qc.invalidateQueries({ queryKey: ["declutter", "admin-pending"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex gap-2 overflow-x-auto">
        {row.photo_paths.map((p) => (
          <img key={p} src={photoPublicUrl(p)} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover bg-muted" />
        ))}
      </div>
      <p className="font-semibold">{row.title} · {formatPrice(row.price_cents)}</p>
      <p className="text-xs text-muted-foreground">{row.area_label} · {whyWaiting(row)}</p>
      {row.description && <p className="text-sm whitespace-pre-line">{row.description}</p>}
      <label className="block text-xs font-medium" htmlFor={`dcl-note-${row.item_id}`}>Reason, if you reject it (the seller sees this)</label>
      <input
        id={`dcl-note-${row.item_id}`}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={() => decide.mutate(true)} disabled={decide.isPending}>Approve</Button>
        <Button variant="outline" onClick={() => decide.mutate(false)} disabled={decide.isPending || !note.trim()}>
          Reject
        </Button>
      </div>
    </li>
  );
}

export function DeclutterReviewCard() {
  const on = useFeature("declutter");
  const pending = useQuery({
    queryKey: ["declutter", "admin-pending"],
    queryFn: async () => (await fetchPendingForAdmin()) as PendingRow[],
    enabled: on,
  });
  if (!on) return null;
  return (
    <AdminCard title="Declutter: listings to review" subtitle="New sellers' first 3 listings and anything the photo check flagged.">
      {pending.isError ? (
        <p className="text-sm" role="alert">{declutterErrorMessage(pending.error)}</p>
      ) : pending.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : (pending.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="space-y-3">
          {(pending.data ?? []).map((row) => <PendingItem key={row.item_id} row={row} />)}
        </ul>
      )}
    </AdminCard>
  );
}
