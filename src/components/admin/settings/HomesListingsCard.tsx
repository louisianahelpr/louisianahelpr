/**
 * Admin -> Settings, Homes listings (Q2187; lead: must ship before Homes opens).
 *
 * Take down a live or paused listing with a reason the owner sees: the take-down
 * is on the whole PROPERTY (every open listing on it goes, either kind, any
 * unit, and nothing on it can be listed again until it is lifted). Lift a
 * mistaken one with a note: its listings go back to draft or paused for the
 * owner to publish again. Both are admin-only on the server, audited, and never
 * gated by the 'rentals' switch (moderation works whatever the audience is), so
 * this card is not either. Search (a link code, headline or label words, a
 * ZIP) and 25 a page with totals, so no listing is out of reach (round 4 #5).
 */
import { useEffect, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** "1-25 of 140" with Previous / Next; nothing when everything fits on one page. */
function Pager({ label, offset, total, size, onMove }: { label: string; offset: number; total: number; size: number; onMove: (o: number) => void }) {
  if (total <= size) return null;
  const last = Math.min(offset + size, total);
  return (
    <div className="flex items-center justify-between gap-2 text-sm" data-testid={`homes-pager-${label}`}>
      <span className="text-muted-foreground">
        {offset + 1}–{last} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onMove(Math.max(offset - size, 0))} aria-label={`Previous ${label}`}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={last >= total} onClick={() => onMove(offset + size)} aria-label={`Next ${label}`}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function HomesListingsCard() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [openOffset, setOpenOffset] = useState(0);
  const [takenOffset, setTakenOffset] = useState(0);
  const q = useQuery({
    queryKey: [...KEY, query, openOffset, takenOffset],
    queryFn: () => fetchAdminListings(query, openOffset, takenOffset),
    placeholderData: keepPreviousData,
  });
  const done = () => qc.invalidateQueries({ queryKey: KEY });
  // A take-down or lift can empty the last page: step back to the new last page.
  const lastPage = (total: number, size: number) => Math.max(0, Math.floor((total - 1) / size) * size);
  useEffect(() => {
    if (!q.data || q.isPlaceholderData) return;
    if (openOffset > 0 && openOffset >= q.data.open_total) setOpenOffset(lastPage(q.data.open_total, q.data.page_size));
    if (takenOffset > 0 && takenOffset >= q.data.taken_down_total) setTakenOffset(lastPage(q.data.taken_down_total, q.data.page_size));
  }, [q.data, q.isPlaceholderData, openOffset, takenOffset]);
  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
    setOpenOffset(0);
    setTakenOffset(0);
  };
  return (
    <AdminCard
      title="Homes: listings"
      subtitle="Take down a listing that breaks the rules: every open listing on that property goes, and nothing on it can be listed again until you lift it."
    >
      <form className="mb-3 flex gap-2" role="search" onSubmit={search}>
        <input
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Search Homes listings"
          placeholder="Link code, headline or ZIP"
          maxLength={100}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>
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
            <p className="text-sm font-semibold">Live and paused{q.data.open_total > 0 ? ` (${q.data.open_total})` : ""}</p>
            {q.data.open.length === 0 ? (
              <p className="text-sm text-muted-foreground">{query ? "No live or paused listing matches." : "No live or paused listings."}</p>
            ) : (
              q.data.open.map((l) => <OpenRow key={l.id} l={l} onDone={done} />)
            )}
            <Pager label="live and paused" offset={openOffset} total={q.data.open_total} size={q.data.page_size} onMove={setOpenOffset} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Taken down{q.data.taken_down_total > 0 ? ` (${q.data.taken_down_total})` : ""}</p>
            {q.data.taken_down.length === 0 ? (
              <p className="text-sm text-muted-foreground">{query ? "No take-down matches." : "Nothing taken down."}</p>
            ) : (
              q.data.taken_down.map((t) => <TakenDownRow key={t.property_id} t={t} onDone={done} />)
            )}
            <Pager label="taken down" offset={takenOffset} total={q.data.taken_down_total} size={q.data.page_size} onMove={setTakenOffset} />
          </div>
        </div>
      )}
    </AdminCard>
  );
}
