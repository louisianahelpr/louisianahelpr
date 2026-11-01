/**
 * Admin -> Settings: Declutter partner charities (Q2428, owner 2026-10-27; migration 20261027222743).
 *
 * Charities a haul-away can take unsold items to (Goodwill, St. Vincent de Paul, ...), curated per parish. None are
 * seeded: an admin adds them here. Add, edit, retire (Active off) and bring back; every save is written to the admin
 * audit log by the server (admin_declutter_save_donation_partner, which refuses a non-admin). A retired partner is
 * never offered again; a seller's choice and every receipt keep their snapshot of the name and address.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { adminSaveDonationPartner, fetchAllDonationPartners, type DonationPartnerRow } from "@/lib/declutter/donate";
import { haulAwayErrorMessage } from "@/lib/declutter/haulAwayErrors";
import { AdminCard } from "../AdminViewShell";

type Draft = { id: string | null; parish: string; name: string; address: string; lat: string; lng: string; takes: string; active: boolean };
const EMPTY: Draft = { id: null, parish: "", name: "", address: "", lat: "", lng: "", takes: "", active: true };
const INPUT = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm";

function toDraft(r: DonationPartnerRow): Draft {
  return { id: r.id, parish: r.parish, name: r.name, address: r.address, lat: String(r.lat), lng: String(r.lng), takes: r.takes ?? "", active: r.active };
}

function PartnerForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(draft);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => adminSaveDonationPartner({
      id: d.id, parish: d.parish.trim(), name: d.name.trim(), address: d.address.trim(),
      lat: Number(d.lat), lng: Number(d.lng), takes: d.takes.trim() || null, active: d.active,
    }),
    onSuccess: () => {
      toast(d.id ? "Partner saved." : "Partner added.");
      void qc.invalidateQueries({ queryKey: ["admin", "donation-partners"] });
      onDone();
    },
    onError: (err) => toast.error(haulAwayErrorMessage(err)),
  });
  const ready = d.parish.trim().length >= 2 && d.name.trim().length >= 2 && d.address.trim().length >= 5
    && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)) && d.lat !== "" && d.lng !== "";
  const id = d.id ?? "new";
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-donation-partner-form={id}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">Parish<input className={INPUT} value={d.parish} maxLength={60} onChange={set("parish")} placeholder="East Baton Rouge" /></label>
        <label className="space-y-1 text-xs font-medium">Name<input className={INPUT} value={d.name} maxLength={80} onChange={set("name")} placeholder="Goodwill Mid-City" /></label>
        <label className="space-y-1 text-xs font-medium sm:col-span-2">Address<input className={INPUT} value={d.address} maxLength={200} onChange={set("address")} /></label>
        <label className="space-y-1 text-xs font-medium">Latitude<input className={INPUT} inputMode="decimal" value={d.lat} onChange={set("lat")} placeholder="30.4515" /></label>
        <label className="space-y-1 text-xs font-medium">Longitude<input className={INPUT} inputMode="decimal" value={d.lng} onChange={set("lng")} placeholder="-91.1871" /></label>
        <label className="space-y-1 text-xs font-medium sm:col-span-2">What they take (optional)<input className={INPUT} value={d.takes} maxLength={300} onChange={set("takes")} placeholder="Furniture, clothes, housewares. No mattresses." /></label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0" style={{ accentColor: "hsl(var(--primary))" }} checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Active (offered to sellers)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="button" size="sm" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : d.id ? "Save" : "Add partner"}</Button>
      </div>
    </div>
  );
}

export function DonationPartnersCard() {
  const on = useFeature("declutter");
  const partners = useQuery({ queryKey: ["admin", "donation-partners"], queryFn: fetchAllDonationPartners, enabled: on });
  const [editing, setEditing] = useState<Draft | null>(null);
  if (!on) return null;
  const rows = partners.data ?? [];
  return (
    <AdminCard title="Declutter partner charities" subtitle="Where a seller can have unsold items donated. Sellers see active partners within 30 miles of the items.">
      <div className="space-y-3" data-donation-partners="">
        {partners.isError && <p className="text-sm" role="alert">The partners couldn't load. Refresh to try again.</p>}
        {!partners.isLoading && !partners.isError && rows.length === 0 && <p className="text-sm text-muted-foreground">No partners yet. Add the first one.</p>}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">{r.name}{r.active ? "" : " (retired)"}</p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.parish} · {r.address}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setEditing(toDraft(r))}>Edit</Button>
            </li>
          ))}
        </ul>
        {editing ? (
          <PartnerForm key={editing.id ?? "new"} draft={editing} onDone={() => setEditing(null)} />
        ) : (
          <Button type="button" size="sm" onClick={() => setEditing(EMPTY)}>Add a partner</Button>
        )}
      </div>
    </AdminCard>
  );
}
