import { toast } from "sonner";
import { hapticSuccess } from "@/lib/haptics";
import { upgradeUnverifiedArrival } from "@/lib/arrivalRefresh";
import type { useActivityData } from "@/hooks/useActivityData";

type AppliedApps = ReturnType<typeof useActivityData>["appliedApps"];

/* THE GESTURE ALSO RE-CHECKS AN UNVERIFIED ARRIVAL (owner, 2026-09-19).
   It is what replaces the "Try My Location Again" chip the same ruling
   removed from the job card's action row — and it had to be built first,
   because that chip was measurably the ONLY claimed -> verified path in
   the product (the row's primary in that state reads "Start Working", not
   "Mark Arrived", so there was nothing else to re-tap).

   DELIBERATELY NOT AWAITED. The gesture's advertised job is refreshing the
   list, and it must finish on time whatever geolocation does — a denied
   prompt or a 15-second timeout cannot be allowed to hold the refresh
   spinner open. `upgradeUnverifiedArrival` never throws, asks for a fix
   ONLY when there is an arrival it could upgrade (so an ordinary refresh
   triggers no prompt and no write at all), and remembers a denial for the
   page's life rather than re-prompting on every pull. The rules and the
   reasoning are in src/lib/arrivalRefresh.ts.

   Only the Helpr's own tab: on My Posts there is nothing a poster could
   check in for. `appliedApps` is this tab's data and the predicate filters
   to `helper_id === user.id` again on top of that. */
export function recheckUnverifiedArrival(appliedApps: AppliedApps, uid: string, refresh: () => unknown): void {
  void upgradeUnverifiedArrival(
    appliedApps.map((a) => ({ id: a.job_id, ...(a.job ?? {}) })),
    uid,
  ).then((res) => {
    // SILENCE UNLESS IT WORKED. A refresh that could not get a fix has
    // broken nothing — the arrival is already recorded and the job is not
    // waiting on it — and the Helpr asked for a refresh, not for this. An
    // apology for unrequested work is worse than saying nothing. The one
    // thing worth interrupting for is the win.
    if (res.outcome === "upgraded") {
      hapticSuccess();
      toast.success("GPS confirmed you were at the job.", { duration: 6000 });
      void refresh();
    }
  });
}
