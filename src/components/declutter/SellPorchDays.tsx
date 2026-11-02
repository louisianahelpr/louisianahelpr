/**
 * Porch days on the sell form (owner 2026-10-29, builder 23's leftover), shown while "Porch pickup" is ticked.
 * Audit 1030 DC-3 (lead decision 2026-10-30): the form had two Sun-Sat pickers (these porch chips and the pickup
 * times' Days), with different chip sizes. The pickup times' Days picker stays; here there is ONE choice,
 * "Porch only on some of these days?", and ticking it offers only the seller's pickup days, on the same shared
 * chip (DayChip). Per SELLER (every listing), saved as they tap (declutter_set_porch_days). Not ticked = none
 * picked = buyers pick any of the pickup-time days, as before (declutter_is_porch_day's fallback).
 * A porch day already saved that is no longer a pickup day stays shown, so the seller can still take it off.
 * Hidden until the migration is on the server (PGRST202), and on a failed read (said, not silent).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMyPickupWindows } from "@/lib/declutter/api";
import { fetchMyPorchDays, saveMyPorchDays, PORCH_DAYS_NOT_DEPLOYED } from "@/lib/declutter/porchDays";
import { fetchMyPorchPlaces, MY_PORCH_PLACES_KEY } from "@/lib/declutter/porchPlaces";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DayChip, shortDays } from "./DeclutterPickupTimes";

const KEY = ["declutter", "my-porch-days"] as const;

/**
 * `pickupDays`: the weekdays of the pickup times the form is editing right now (the sell form, a bunch). Left out
 * (Edit listing, which has no pickup-times editor), the seller's saved pickup times are read instead.
 */
export function SellPorchDays({ pickupDays }: { pickupDays?: number[] }) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const mine = useQuery({ queryKey: KEY, queryFn: fetchMyPorchDays });
  const saved = useQuery({
    queryKey: ["declutter", "windows", user?.id],
    queryFn: () => fetchMyPickupWindows(user!.id),
    enabled: pickupDays === undefined && !!user,
  });
  // D-NEW14: a seller with saved pickup places sets days per place (SellPorchPlaces), so these chips would mean nothing.
  const places = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces });
  const [asked, setAsked] = useState(false);
  const save = useMutation({
    mutationFn: saveMyPorchDays,
    onSuccess: (days) => qc.setQueryData(KEY, days.length ? days : null),
  });
  if (mine.data === PORCH_DAYS_NOT_DEPLOYED || mine.isLoading) return null;
  if (Array.isArray(places.data) && places.data.length > 0) return null;
  if (mine.isError) return <ErrorState variant="inline" title="We couldn't load your porch days." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  if (pickupDays === undefined && saved.isError) return <ErrorState variant="inline" title="We couldn't load your pickup days." body={declutterErrorMessage(saved.error)} onRetry={() => void saved.refetch()} />;
  if (pickupDays === undefined && !saved.isSuccess) return null;
  const picked = mine.data ?? [];
  const pickup = [...new Set(pickupDays ?? (saved.data ?? []).map((w) => w.weekday))].sort((a, b) => a - b);
  const offered = [...new Set([...pickup, ...picked])].sort((a, b) => a - b);
  // No pickup days yet: porch pickup simply follows them once they are picked, so there is nothing to choose.
  if (offered.length === 0) return null;
  const only = picked.length > 0 || asked;
  const toggleDay = (d: number) => save.mutate(picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort((a, b) => a - b));
  const choose = (on: boolean) => {
    setAsked(on);
    if (!on && picked.length) save.mutate([]);
  };
  return (
    <div className="space-y-2" data-porch-days="">
      {pickup.length > 0 && <p className="text-ds-13 text-muted-foreground" data-porch-pickup-days="">Your pickup days: {shortDays(pickup)}.</p>}
      <div className="flex items-start gap-3 text-ds-14">
        <Checkbox id="sell-porch-only" className="mt-0.5" checked={only} disabled={save.isPending} onCheckedChange={(v) => choose(v === true)} />
        <label htmlFor="sell-porch-only" className="min-h-11 flex-1 font-semibold text-foreground">Porch only on some of these days?</label>
      </div>
      {only && (
        <div className="space-y-2 pl-8" role="group" aria-label="Porch days">
          <div className="flex flex-wrap gap-2">
            {offered.map((d) => <DayChip key={d} day={d} on={picked.includes(d)} disabled={save.isPending} onToggle={() => toggleDay(d)} />)}
          </div>
          <p className="text-ds-13 text-muted-foreground">
            {picked.length ? `Porch pickup only on ${shortDays(picked)}. This applies to all your listings.` : "Tap the days you put things out."}
          </p>
        </div>
      )}
      {!only && <p className="text-ds-13 text-muted-foreground">Buyers can pick any of your pickup days for porch pickup.</p>}
      {save.isError && <p role="alert" className="text-ds-13 text-foreground">{declutterErrorMessage(save.error)}</p>}
    </div>
  );
}
