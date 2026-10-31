/**
 * "Your vehicle" on Deliver (moved out of DeclutterDeliveryViews.tsx, audit DD D1, so that file stays under the
 * 600-line limit). Behaviour unchanged.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { PhotoPickButton } from "@/components/ui/PhotoPickButton";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchMyVehicle, saveVehicle, uploadVehiclePhoto } from "@/lib/helprTasks/api";

const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";

/**
 * Row 41: "I have a car" (every delivery needs one, owner 2026-10-28, Q2452), "I have a truck"
 * (+ "I can bring a second person") with a vehicle photo. A truck is a car.
 */
export function VehicleForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const vehicle = useQuery({ queryKey: ["helpr-tasks", "vehicle", userId], queryFn: () => fetchMyVehicle(userId) });
  const [car, setCar] = useState<boolean | null>(null);
  const [truck, setTruck] = useState<boolean | null>(null);
  const [second, setSecond] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const hasTruck = truck ?? vehicle.data?.has_truck ?? false;
  const hasCar = hasTruck || (car ?? vehicle.data?.has_car ?? false);
  const twoPeople = hasTruck && (second ?? vehicle.data?.second_person ?? false);
  const save = useMutation({
    mutationFn: async () => {
      const path = hasTruck ? (photo ? await uploadVehiclePhoto(userId, photo) : vehicle.data?.photo_path ?? null) : null;
      await saveVehicle(hasCar, hasTruck, twoPeople, path);
    },
    onSuccess: () => {
      setPhoto(null);
      void qc.invalidateQueries({ queryKey: ["helpr-tasks"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (vehicle.isError) {
    return <ErrorState variant="inline" title="We couldn't load your vehicle." body={declutterErrorMessage(vehicle.error)} onRetry={() => void vehicle.refetch()} />;
  }
  const photoId = `helpr-vehicle-photo-${userId}`;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-2" aria-label="Your vehicle">
      <h2 className="text-base font-semibold">Your vehicle</h2>
      {/* Deep audit #38: say what THIS Helpr can take, never "need a truck" to someone whose truck is saved. */}
      <p className="text-sm text-muted-foreground" data-vehicle-reach="">
        {hasTruck && twoPeople
          ? "With a truck and a second person you can take every size."
          : hasTruck
            ? "With a truck you can take small and large items. Extra large items also need a second person."
            : "You need a car to take deliveries. Large and extra large items need a truck."}
      </p>
      {/* The shared Checkbox (lead 2026-10-28: the raw box rendered as an empty square); the label is the 44px tap target. */}
      <div className="flex items-center gap-3 min-h-11">
        <Checkbox id={`helpr-car-${userId}`} checked={hasCar} disabled={hasTruck} onCheckedChange={(v) => { save.reset(); setCar(v === true); }} />
        <label htmlFor={`helpr-car-${userId}`} className="flex min-h-11 flex-1 items-center text-sm">I have a car</label>
      </div>
      <div className="flex items-center gap-3 min-h-11">
        <Checkbox id={`helpr-truck-${userId}`} checked={hasTruck} onCheckedChange={(v) => { save.reset(); setTruck(v === true); }} />
        <label htmlFor={`helpr-truck-${userId}`} className="flex min-h-11 flex-1 items-center text-sm">I have a truck</label>
      </div>
      {hasTruck && (
        <>
          <div className="flex items-center gap-3 min-h-11">
            <Checkbox id={`helpr-second-${userId}`} checked={twoPeople} onCheckedChange={(v) => { save.reset(); setSecond(v === true); }} />
            <label htmlFor={`helpr-second-${userId}`} className="flex min-h-11 flex-1 items-center text-sm">I can bring a second person (for extra large items)</label>
          </div>
          <label htmlFor={photoId} className="block text-xs font-medium">
            {vehicle.data?.photo_path ? "Truck photo saved. Add a new one to replace it." : "Photo of your truck"}
          </label>
          <PhotoPickButton id={photoId} picked={photo} onPick={setPhoto} />
        </>
      )}
      <button type="button" className={primary}
        disabled={save.isPending || (hasTruck && !photo && !vehicle.data?.photo_path)} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {/* Audit 1c D3-8: a plain success toast renders nothing (toastPolicy), so "Saved." never showed. */}
      {save.isSuccess && <p className="text-sm font-medium" role="status">Vehicle saved.</p>}
    </section>
  );
}
