/**
 * Admin -> Settings: Declutter safe meetup spots (Q2425, owner 2026-10-27; migration 20261027204500).
 *
 * Public places buyers and sellers can meet instead of a home (police "safe exchange" lots, busy stores), curated per
 * parish. None are seeded: an admin adds them here. Add, edit, retire (Active off) and bring back; every save is
 * written to the admin audit log by the server (admin_declutter_save_meetup_spot, which refuses a non-admin). A
 * retired spot is never offered again; orders that already picked it keep their snapshot.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { adminSaveMeetupSpot, fetchAllMeetupSpots, type MeetupKind, type MeetupSpotRow } from "@/lib/declutter/meetup";
import { meetupErrorMessage } from "@/lib/declutter/meetupErrors";
import { AdminCard } from "../AdminViewShell";

type Draft = { id: string | null; parish: string; name: string; address: string; lat: string; lng: string; kind: MeetupKind; note: string; active: boolean };
const EMPTY: Draft = { id: null, parish: "", name: "", address: "", lat: "", lng: "", kind: "police", note: "", active: true };
const KIND_LABEL: Record<MeetupKind, string> = { police: "Police safe exchange", store: "Busy store", other: "Other public place" };
const INPUT = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm";

function toDraft(r: MeetupSpotRow): Draft {
  return { id: r.id, parish: r.parish, name: r.name, address: r.address, lat: String(r.lat), lng: String(r.lng), kind: r.kind, note: r.note ?? "", active: r.active };
}

function SpotForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(draft);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => adminSaveMeetupSpot({
      id: d.id, parish: d.parish.trim(), name: d.name.trim(), address: d.address.trim(),
      lat: Number(d.lat), lng: Number(d.lng), kind: d.kind, note: d.note.trim() || null, active: d.active,
    }),
    onSuccess: () => {
      toast(d.id ? "Spot saved." : "Spot added.");
      void qc.invalidateQueries({ queryKey: ["admin", "meetup-spots"] });
      onDone();
    },
    onError: (err) => toast.error(meetupErrorMessage(err)),
  });
  const ready = d.parish.trim().length >= 2 && d.name.trim().length >= 2 && d.address.trim().length >= 5
    && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)) && d.lat !== "" && d.lng !== "";
  const id = d.id ?? "new";
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-meetup-form={id}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">Parish<input className={INPUT} value={d.parish} maxLength={60} onChange={set("parish")} placeholder="East Baton Rouge" /></label>
        <label className="space-y-1 text-xs font-medium">Name<input className={INPUT} value={d.name} maxLength={80} onChange={set("name")} placeholder="BRPD Safe Exchange Zone" /></label>
        <label className="space-y-1 text-xs font-medium sm:col-span-2">Address<input className={INPUT} value={d.address} maxLength={200} onChange={set("address")} /></label>
        <label className="space-y-1 text-xs font-medium">Latitude<input className={INPUT} inputMode="decimal" value={d.lat} onChange={set("lat")} placeholder="30.4515" /></label>
        <label className="space-y-1 text-xs font-medium">Longitude<input className={INPUT} inputMode="decimal" value={d.lng} onChange={set("lng")} placeholder="-91.1871" /></label>
        <label className="space-y-1 text-xs font-medium">Type
          <select className={INPUT} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as MeetupKind })}>
            {(Object.keys(KIND_LABEL) as MeetupKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">Note (optional)<input className={INPUT} value={d.note} maxLength={300} onChange={set("note")} placeholder="Lit lot, cameras, open 24 hours" /></label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0" style={{ accentColor: "hsl(var(--primary))" }} checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Active (offered to buyers)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="button" size="sm" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : d.id ? "Save" : "Add spot"}</Button>
      </div>
    </div>
  );
}

export function MeetupSpotsCard() {
  const on = useFeature("declutter");
  const spots = useQuery({ queryKey: ["admin", "meetup-spots"], queryFn: fetchAllMeetupSpots, enabled: on });
  const [editing, setEditing] = useState<Draft | null>(null);
  if (!on) return null;
  const rows = spots.data ?? [];
  return (
    <AdminCard title="Declutter meetup spots" subtitle="Public places buyers and sellers can meet instead of a home. Buyers see active spots within 25 miles of the items.">
      <div className="space-y-3" data-meetup-spots="">
        {spots.isError && <p className="text-sm" role="alert">The spots couldn't load. Refresh to try again.</p>}
        {!spots.isLoading && !spots.isError && rows.length === 0 && <p className="text-sm text-muted-foreground">No spots yet. Add the first one.</p>}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">{r.name}{r.active ? "" : " (retired)"}</p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.parish} · {KIND_LABEL[r.kind]} · {r.address}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setEditing(toDraft(r))}>Edit</Button>
            </li>
          ))}
        </ul>
        {editing ? (
          <SpotForm key={editing.id ?? "new"} draft={editing} onDone={() => setEditing(null)} />
        ) : (
          <Button type="button" size="sm" onClick={() => setEditing(EMPTY)}>Add a spot</Button>
        )}
      </div>
    </AdminCard>
  );
}
