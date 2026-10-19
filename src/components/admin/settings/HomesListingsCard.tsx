/**
 * Admin -> Settings, Homes listings (Q2187; lead: must ship before Homes opens).
 *
 * Take down a live or paused listing with a reason the owner sees: the take-down
 * is on the whole PROPERTY (every open listing on it goes, either kind, any
 * unit, and nothing on it can be listed again until it is lifted). Lift a
 * mistaken one with a note: its listings go back to draft or paused for the
 * owner to publish again. Both are admin-only on the server, audited, and never
 * gated by the 'rentals' switch (moderation works whatever the audience is), so
 * this card is not either.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminLiftTakedown, adminRemoveListing, fetchAdminListings, type AdminListings } from "@/lib/rentals/listings";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { AdminCard } from "../AdminViewShell";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

const KEY = ["admin-homes-listings"];

function OpenRow({ l, onDone }: { l: AdminListings["open"][number]; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => adminRemoveListing(l.id, reason.trim()),
    onSuccess: () => {
      toast.success("Taken down. The owner was told why.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm" data-testid="homes-open-listing">
      <p className="font-semibold">{l.headline}</p>
      <p className="text-muted-foreground">
        {l.kind === "sale" ? "For sale" : "For rent"} · {l.status === "live" ? "Live" : "Paused"} · {l.property_label}, {l.city} {l.zip_code}
      </p>
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        aria-label={`Reason to take down ${l.headline}`}
        placeholder="Reason (the owner sees it)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button size="sm" variant="outline" disabled={m.isPending || reason.trim().length < 5} onClick={() => m.mutate()}>
        {m.isPending ? "Taking down…" : "Take down"}
      </Button>
    </div>
  );
}

function TakenDownRow({ t, onDone }: { t: AdminListings["taken_down"][number]; onDone: () => void }) {
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => adminLiftTakedown(t.property_id, note.trim()),
    onSuccess: () => {
      toast.success("Lifted. The owner can publish again.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm" data-testid="homes-taken-down">
      <p className="font-semibold">
        {t.property_label}, {t.city} {t.zip_code}
      </p>
      <p className="text-muted-foreground">Reason: {t.reason}</p>
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        aria-label={`Note to lift the take-down of ${t.property_label}`}
        placeholder="Why it is lifted (kept in the audit log)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button size="sm" variant="outline" disabled={m.isPending || note.trim().length < 5} onClick={() => m.mutate()}>
        {m.isPending ? "Lifting…" : "Lift take-down"}
      </Button>
    </div>
  );
}

export function HomesListingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: fetchAdminListings });
  const done = () => qc.invalidateQueries({ queryKey: KEY });
  return (
    <AdminCard
      title="Homes: listings"
      subtitle="Take down a listing that breaks the rules: every open listing on that property goes, and nothing on it can be listed again until you lift it."
    >
      {q.isError ? (
        <>
          <ReportErrorScreen source="HomesListingsCard.load" title="Homes listings" />
          <p className="text-sm">Couldn't load the listings.</p>
        </>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Live and paused</p>
            {q.data.open.length === 0 ? (
              <p className="text-sm text-muted-foreground">No live or paused listings.</p>
            ) : (
              q.data.open.map((l) => <OpenRow key={l.id} l={l} onDone={done} />)
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Taken down</p>
            {q.data.taken_down.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing taken down.</p>
            ) : (
              q.data.taken_down.map((t) => <TakenDownRow key={t.property_id} t={t} onDone={done} />)
            )}
          </div>
        </div>
      )}
    </AdminCard>
  );
}
