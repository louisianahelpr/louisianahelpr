/**
 * Porch pickup places, the seller's side (D-NEW14, owner-approved design 2026-10-29): up to 5 places, each with its
 * own weekdays. With at least one saved, SellPorchDays steps aside (the place's days apply) and the buyer picks a
 * place at checkout; with none, porch pickup works exactly as before. Saved as the seller taps Save, per SELLER, like
 * the pickup times, so it applies to all their listings. The server keeps every rule (declutter_save_porch_place).
 * Hidden until the migration is on the server (PGRST202), and on a failed read (said, not silent).
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { geocodeAddress } from "@/lib/geocode";
import {
  deleteMyPorchPlace, fetchMyPorchPlaces, MAX_PORCH_PLACES, MY_PORCH_PLACES_KEY, PORCH_PLACES_NOT_DEPLOYED,
  saveMyPorchPlace, type MyPorchPlace,
} from "@/lib/declutter/porchPlaces";
import { DayChip, shortDays } from "./DeclutterPickupTimes";

type Draft = { id: string | null; label: string; address: string; area: string; weekdays: number[] };

const EMPTY: Draft = { id: null, label: "", address: "", area: "", weekdays: [] };
const WEEK = [0, 1, 2, 3, 4, 5, 6];

function PlaceForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const [d, setD] = useState(initial);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: async () => {
      const g = await geocodeAddress(d.address);
      if (!g) throw new Error("invalid_location");
      return saveMyPorchPlace({ ...d, label: d.label.trim(), address: d.address.trim(), area: d.area.trim(), lat: g.latitude, lng: g.longitude });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
      onDone();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const ready = d.label.trim().length > 0 && d.address.trim().length >= 5 && d.area.trim().length > 0 && d.weekdays.length > 0;
  const toggle = (day: number) => set({ weekdays: d.weekdays.includes(day) ? d.weekdays.filter((x) => x !== day) : [...d.weekdays, day].sort((a, b) => a - b) });
  return (
    <div className="space-y-3 rounded-[16px] border border-border bg-card p-4" data-porch-place-form="">
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-label`} className="block text-ds-14 font-semibold text-foreground">Name</label>
        <Input id={`${uid}-label`} maxLength={40} value={d.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Home, Mom's house" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-address`} className="block text-ds-14 font-semibold text-foreground">Address</label>
        <Input id={`${uid}-address`} maxLength={300} value={d.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street, city, ZIP" autoComplete="street-address" />
        <p className="text-ds-13 text-muted-foreground">Private. Only the buyer who pays and picks this place sees it.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-area`} className="block text-ds-14 font-semibold text-foreground">Area buyers see</label>
        <Input id={`${uid}-area`} maxLength={80} value={d.area} onChange={(e) => set({ area: e.target.value })} placeholder="e.g. Mid-City, Baton Rouge" />
      </div>
      <div className="space-y-1.5" role="group" aria-label="Days at this place">
        <p className="text-ds-14 font-semibold text-foreground">Days at this place</p>
        <div className="flex flex-wrap gap-2">
          {WEEK.map((day) => <DayChip key={day} day={day} on={d.weekdays.includes(day)} disabled={save.isPending} onToggle={() => toggle(day)} />)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="rounded-full" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save place"}
        </Button>
        <Button type="button" variant="outline" className="rounded-full" disabled={save.isPending} onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function PlaceRow({ place, onEdit }: { place: MyPorchPlace; onEdit: () => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteMyPorchPlace(place.id),
    onSuccess: () => {
      setAsking(false);
      void qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li className="space-y-2 rounded-[16px] border border-border bg-card p-4" data-porch-place="">
      <div className="min-w-0">
        <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{place.label}</p>
        <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{place.address}</p>
        <p className="text-ds-13 text-muted-foreground">{shortDays(place.weekdays)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onEdit} aria-label={`Edit ${place.label}`}>Edit</Button>
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setAsking(true)} aria-label={`Remove ${place.label}`}>Remove</Button>
      </div>
      <BrandConfirmDialog open={asking} onOpenChange={setAsking} title={`Remove ${place.label}?`}
        description="Buyers can't pick it anymore. Orders already placed still use it."
        primaryLabel={remove.isPending ? "Removing…" : "Remove place"} primaryTone="sienna" primaryDisabled={remove.isPending}
        onPrimary={() => remove.mutate()} secondaryLabel="Keep it" />
    </li>
  );
}

export function SellPorchPlaces() {
  const mine = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces });
  // null: no form open; a draft: adding (id null) or editing that place.
  const [draft, setDraft] = useState<Draft | null>(null);
  if (mine.data === PORCH_PLACES_NOT_DEPLOYED || mine.isLoading) return null;
  if (mine.isError) return <ErrorState variant="inline" title="We couldn't load your pickup places." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  const places = mine.data ?? [];
  return (
    <div className="space-y-2" data-porch-places="">
      <p className="text-ds-14 font-semibold text-foreground">Pickup places</p>
      <p className="text-ds-13 text-muted-foreground">
        {places.length > 0
          ? "Buyers pick one of these. They only get its address after paying. This applies to all your listings."
          : `Keep things in more than one place? Save up to ${MAX_PORCH_PLACES}, each with its own days. Buyers pick one and only get its address after paying.`}
      </p>
      {places.length > 0 && (
        <ul className="grid gap-2 lg:grid-cols-2">
          {places.map((p) => <PlaceRow key={p.id} place={p} onEdit={() => setDraft({ id: p.id, label: p.label, address: p.address, area: p.area, weekdays: p.weekdays })} />)}
        </ul>
      )}
      {draft
        ? <PlaceForm key={draft.id ?? "new"} initial={draft} onDone={() => setDraft(null)} />
        : places.length < MAX_PORCH_PLACES && (
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setDraft(EMPTY)}>Add a pickup place</Button>
        )}
    </div>
  );
}
