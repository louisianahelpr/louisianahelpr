/**
 * Rentals S1 (Q6, Q53): properties whose ownership proof waits for an admin,
 * and (owner 2026-10-19, replacing the paid Stripe check) the landlord's photo
 * ID beside it: one group per landlord, ID on the left, each property's proof
 * on the right, each approved or rejected on its own with a note.
 * rentals_admin_review_landlord_id refuses non-admins and an admin's own ID,
 * writes admin_audit_log, and an approval makes the landlord ID-verified in
 * every section (the one identity rule).
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
import {
  fetchLandlordIds,
  fetchPendingLandlordIds,
  fetchPendingOwnership,
  fetchTakedownMatches,
  fetchTakenDownProperties,
  reviewLandlordId,
  reviewOwnership,
  signedFileUrl,
  type LandlordIdReview,
  type RentalProperty,
  type TakedownMatch,
} from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { openSignedDocument } from "@/lib/openSignedDocument";
import { AdminCard } from "../AdminViewShell";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

function OpenFile({ path, label }: { path: string; label: string }) {
  return (
    <button
      type="button"
      className="underline font-semibold"
      // The tab opens inside the click, before any await, or WebKit blocks it silently (Q295).
      onClick={() =>
        void openSignedDocument({
          open: (url, target) => window.open(url, target),
          sign: () => signedFileUrl(path),
          toastError: (msg) => toast.error(msg),
        })
      }
    >
      {label}
    </button>
  );
}

const ID_STATUS_WORDS: Record<string, string> = {
  approved: "ID approved.",
  rejected: "ID rejected; waiting for a new photo.",
};

/** The landlord's photo ID: open front / back, approve or reject with a note. */
function IdColumn({ r, onDone }: { r: LandlordIdReview | undefined; onDone: () => void }) {
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => reviewLandlordId((r as LandlordIdReview).user_id, approve, note, (r as LandlordIdReview).submitted_at),
    onSuccess: onDone,
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  if (!r || r.status !== "pending_review") {
    return (
      <p className="text-muted-foreground">
        {r ? ID_STATUS_WORDS[r.status] ?? r.status : "No ID photo sent (verified another way, or not yet)."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {r.front_path && <OpenFile path={r.front_path} label="Open ID (front)" />}
        {r.back_path && <OpenFile path={r.back_path} label="Open ID (back)" />}
      </div>
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        aria-label="ID note (required to reject)"
        placeholder="Note (required to reject; the landlord sees it)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
          Reject ID
        </Button>
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          Approve ID
        </Button>
      </div>
    </div>
  );
}

interface LandlordGroup {
  userId: string;
  id: LandlordIdReview | undefined;
  properties: RentalProperty[];
  /** The owner's properties under a Homes take-down: shown so a reviewer sees the history (Q2187). */
  takenDown: RentalProperty[];
  /** Per pending property: taken-down properties (ANY owner's) at the same normalised address (round 4 #2). */
  matches: Map<string, TakedownMatch[]>;
}

/** Pending proofs and pending IDs, one group per landlord (oldest first). */
async function fetchQueue(): Promise<LandlordGroup[]> {
  const [properties, pendingIds] = await Promise.all([fetchPendingOwnership(), fetchPendingLandlordIds()]);
  const owners = [...new Set(properties.map((p) => p.owner_id))].filter((u) => !pendingIds.some((r) => r.user_id === u));
  const ownerIds = await fetchLandlordIds(owners);
  const groups = new Map<string, LandlordGroup>();
  for (const r of [...pendingIds, ...ownerIds]) groups.set(r.user_id, { userId: r.user_id, id: r, properties: [], takenDown: [], matches: new Map() });
  for (const p of properties) {
    const g: LandlordGroup = groups.get(p.owner_id) ?? { userId: p.owner_id, id: undefined, properties: [], takenDown: [], matches: new Map() };
    g.properties.push(p);
    groups.set(p.owner_id, g);
  }
  // Only landlords with something to decide: a pending ID or a pending proof.
  const open = [...groups.values()].filter((g) => g.id?.status === "pending_review" || g.properties.length > 0);
  const [history, matches] = await Promise.all([
    fetchTakenDownProperties(open.map((g) => g.userId)),
    fetchTakedownMatches(properties.map((p) => p.id)),
  ]);
  for (const g of open) {
    g.takenDown = history.filter((p) => p.owner_id === g.userId);
    for (const p of g.properties) g.matches.set(p.id, matches.filter((m) => m.property_id === p.id));
  }
  return open;
}

function Row({ p, matches, onDone }: { p: RentalProperty; matches: TakedownMatch[]; onDone: () => void }) {
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
      {matches.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2" data-testid="takedown-address-match">
          <p className="font-semibold">Same address as a taken-down home</p>
          {matches.map((m) => (
            <p key={m.matched_property_id}>
              {m.matched_street}, {m.matched_city} {m.matched_zip} ({m.same_owner ? "this owner" : "another owner"}): {m.reason ?? "no reason"}
            </p>
          ))}
        </div>
      )}
      {p.ownership_proof_path && <OpenFile path={p.ownership_proof_path} label="Open ownership proof" />}
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        aria-label="Note (required to reject)"
        placeholder="Note (required to reject; the landlord sees it)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(false)}>
          Reject
        </Button>
        <Button size="sm" disabled={m.isPending} onClick={() => m.mutate(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}

export function RentalsOwnershipCard() {
  const on = useFeature("rentals");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-rentals-ownership"], enabled: on, queryFn: fetchQueue });
  const done = () => qc.invalidateQueries({ queryKey: ["admin-rentals-ownership"] });
  if (!on) return null;
  return (
    <AdminCard
      title="Homes: ownership proof"
      subtitle="Check the photo ID and the owner's name on the deed, tax bill or assessor page before the property can invite tenants. An approved ID counts as ID-verified everywhere in the app."
    >
      {q.isError ? (
        <>
          <ReportErrorScreen source="RentalsOwnershipCard.load" title="Homes ownership queue" />
          <p className="text-sm">Couldn't load the queue.</p>
        </>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <div className="space-y-3">
          {q.data.map((g) => (
            <div key={g.userId} data-testid="landlord-review-group" className="grid gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-2">
              {g.takenDown.length > 0 && (
                <p role="note" className="rounded-lg bg-muted px-3 py-2 sm:col-span-2">
                  <span className="font-semibold">Earlier take-down:</span>{" "}
                  {g.takenDown.map((p) => `${p.label} (${p.listings_taken_down_reason ?? "no reason"})`).join("; ")}
                </p>
              )}
              <div className="space-y-2">
                <p className="font-semibold">Photo ID</p>
                <IdColumn r={g.id} onDone={done} />
              </div>
              <div className="space-y-2">
                <p className="font-semibold">Ownership proof</p>
                {g.properties.length === 0 ? (
                  <p className="text-muted-foreground">No proof waiting.</p>
                ) : (
                  g.properties.map((p) => <Row key={p.id} p={p} matches={g.matches.get(p.id) ?? []} onDone={done} />)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}
