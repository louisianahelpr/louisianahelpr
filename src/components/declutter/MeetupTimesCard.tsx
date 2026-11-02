/**
 * Declutter settings' "Meetup times" (lead's product call on the LEAD-PLACE-TIMES review, 2026-10-31): pickup places
 * govern porch, door and Helpr pickup, each with its own days and hours; the seller's usual times stay ONLY for
 * meetups, so they are named that, and shown only when the seller offers a safe meetup (their listing defaults).
 * The same times declutter_set_pickup_windows saves (it replaces the whole set, for every listing). Restored from
 * the Pickup times card d0b832e1e5 removed.
 *
 * A3-64 (audit 7, 11-01): beside "Meet spots" (each with its own times) the card read "Meetup times · 2 pickup times",
 * so a seller couldn't tell which times a buyer sees. These times apply to the police safe spots (and an own spot with no
 * times of its own; DeclutterTradeViews' spotHours), so the card says that, and its line lists the hours themselves.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchMyPickupWindows, setPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchSellerDefaults } from "@/lib/declutter/sellerDefaults";
import { PickupTimesEditor, pickupWindowsProblem } from "./DeclutterPickupTimes";
import { weekHoursLine } from "@/lib/declutter/pickupSlots";

const START: PickupWindow = { weekday: 6, starts: "09:00", ends: "12:00" };
const toWindows = (rows: { weekday: number; starts_local: string; ends_local: string }[]) =>
  rows.map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) }));

export function MeetupTimesCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  // The same key the Listing defaults card reads, so ticking Safe meeting spot and saving shows this card.
  const defaults = useQuery({ queryKey: ["declutter", "seller-defaults", userId], queryFn: () => fetchSellerDefaults(userId) });
  const saved = useQuery({ queryKey: ["declutter", "windows", userId], queryFn: () => fetchMyPickupWindows(userId) });
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<PickupWindow[]>([START]);
  const save = useMutation({
    mutationFn: () => setPickupWindows(windows),
    onSuccess: () => {
      toast("Meetup times saved.");
      void qc.invalidateQueries({ queryKey: ["declutter", "windows"] });
      setOpen(false);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!defaults.data?.handovers.includes("meetup")) return null;
  if (saved.isError) return <ErrorState variant="inline" title="We couldn't load your meetup times." body={declutterErrorMessage(saved.error)} onRetry={() => void saved.refetch()} />;
  const rows = saved.data ?? [];
  const problem = pickupWindowsProblem(windows);
  const toggle = () => {
    if (!open) setWindows(rows.length ? toWindows(rows) : [START]);
    setOpen((o) => !o);
  };
  return (
    <section className="rounded-2xl border border-border bg-card" aria-label="Police spot meetup times" data-meetup-times-card="">
      <button type="button" className="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left" aria-expanded={open} disabled={saved.isLoading} onClick={toggle}>
        <Clock className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Police spot meetup times</span>
          <span className="block text-xs text-muted-foreground">{saved.isLoading ? "Loading…" : rows.length ? weekHoursLine(toWindows(rows)) : "None yet"}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">When you can meet a buyer at a police safe exchange spot, or at one of your meet spots with no times of its own.</p>
          <PickupTimesEditor windows={windows} setWindows={setWindows} />
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={save.isPending || !!problem} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save times"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
