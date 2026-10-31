/**
 * "Go online for deliveries" on Deliver for pay (Q2440, owner-approved 2026-10-27). Online, a new
 * delivery near the Helpr is sent to them at once (bell + push) with its pay, miles and pickup town;
 * they take it here through the usual Accept. It turns itself off after the hours they chose. Near
 * means their saved area, or the position they shared on this screen ("Nearest first"); nothing
 * tracks them in the background.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchOnlineStatus, isOnline, setOnline } from "@/lib/helprTasks/online";
import { currentPosition } from "@/lib/declutter/position";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { Chip } from "./DeclutterFilterPanel";

const HOURS = [2, 4, 8] as const;
const MILES = [5, 10, 15, 25] as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const ONLINE_QUERY_KEY = (userId: string) => ["helpr-tasks", "online", userId] as const;

export function GoOnlineCard({ userId, where }: { userId: string; where: { lat: number; lng: number } | null }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ONLINE_QUERY_KEY(userId), queryFn: () => fetchOnlineStatus(userId), meta: { persist: false } });
  const [hours, setHours] = useState<number>(4);
  const [miles, setMiles] = useState<number | null>(null);
  const online = isOnline(status.data);
  const radius = miles ?? status.data?.radius_miles ?? 15;
  // Deep audit #39: with no shared position and no area saved in the profile, the server refused
  // (location_needed) only AFTER the press. Now the card says so first, and the press asks for the
  // device's location once and sends it.
  // Audit DD D3: with no saved point, the area comes from the profile's ZIP or parish through useDeclutterOrigin
  // (deriveFallbackLocation, the chain the rest of Declutter uses), so a Helpr with a ZIP is not told "No area".
  const { profile } = useCurrentUser();
  const { origin } = useDeclutterOrigin();
  const hasArea = profile?.latitude != null && profile?.longitude != null;
  const derived = !hasArea && origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const needsLocation = !where && !hasArea && !derived;
  const flip = useMutation({
    mutationFn: async (on: boolean) => {
      if (!on) return setOnline(false, {});
      const point = where ?? (hasArea ? null : derived ?? await currentPosition());
      return setOnline(true, { hours, radiusMiles: radius, where: point });
    },
    onSuccess: (_r, on) => {
      toast(on ? "You're online. New deliveries near you are sent to you." : "You're offline.");
      void qc.invalidateQueries({ queryKey: ["helpr-tasks", "online"] });
    },
    onError: (err) =>
      toast.error((err as { message?: unknown })?.message === "location_required"
        ? "Turn on location, or add your area in your profile, to go online."
        : declutterErrorMessage(err)),
  });
  const id = `go-online-${userId}`;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="Go online for deliveries">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Go online for deliveries</h2>
          <p className="text-ds-13 text-muted-foreground" role="status">
            {status.isLoading ? "Checking…"
              : online && status.data?.online_until ? `Online until ${clock(status.data.online_until)}. New deliveries within ${status.data.radius_miles} mi are sent to you.`
              : "Offline. Go online to get new deliveries near you as soon as they're posted."}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={online} aria-labelledby={`${id}-label`} disabled={flip.isPending || status.isLoading}
          onClick={() => flip.mutate(!online)}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${online ? "bg-primary" : "bg-muted-foreground/30"}`}>
          <span id={`${id}-label`} className="sr-only">Online for deliveries</span>
          <span aria-hidden className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${online ? "translate-x-7" : "translate-x-1"}`} />
        </button>
      </div>
      {/* Browse's 44px chips, not two native selects (lead 2026-10-28: in WebKit they drew about 30px tall). */}
      {!online && (
        <div className="space-y-3" data-go-online-choices="">
          <div className="space-y-1.5">
            <p id={`${id}-for`} className="text-ds-13 font-semibold">For</p>
            <div role="group" aria-labelledby={`${id}-for`} className="flex flex-wrap gap-2">
              {HOURS.map((h) => <Chip key={h} on={hours === h} onClick={() => setHours(h)}>{`${h} hours`}</Chip>)}
            </div>
          </div>
          <div className="space-y-1.5">
            <p id={`${id}-within`} className="text-ds-13 font-semibold">Within</p>
            <div role="group" aria-labelledby={`${id}-within`} className="flex flex-wrap gap-2">
              {[...new Set([...MILES, radius])].sort((x, y) => x - y).map((m) => <Chip key={m} on={radius === m} onClick={() => setMiles(m)}>{`${m} miles`}</Chip>)}
            </div>
          </div>
        </div>
      )}
      <p className="text-ds-12 text-muted-foreground">
        {where
          ? "Near the location you shared on this screen."
          : needsLocation
            ? "No area in your profile yet, so going online asks for your location once."
            : derived && origin.status === "ready" && origin.source === "zip" ? "Near your ZIP code's area."
            : derived && origin.status === "ready" && origin.source === "parish" ? "Near your parish."
            : derived ? "Near the location you shared."
            : "Near the area in your profile."}{" "}
        We don't track you in the background. It turns off by itself.
      </p>
    </section>
  );
}
