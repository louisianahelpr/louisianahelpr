/**
 * B110 (owner 11-01 1:00 PM): the seller's own MEET SPOTS. A seller adds public places they'd meet a buyer (a store
 * lot, a library), each with its days and times; the police safe spots are one-tap suggestions. At checkout "Meet up"
 * lists them for this seller's buyers, with the address (a public place, so it is shown before paying). Every rule is
 * the server's (declutter_save_my_meetup_spot, 20261101194608). Hidden until that is on the server (PGRST202).
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  fetchMeetupSuggestions, fetchMyMeetupSpots, MAX_MY_MEETUP_SPOTS, MEETUP_SPOTS_NOT_DEPLOYED, MY_MEETUP_SPOTS_KEY,
  removeMyMeetupSpot, saveMyMeetupSpot, type MeetupSuggestion, type MeetupWindow, type MyMeetupSpot,
} from "@/lib/declutter/meetup";
import { meetupErrorMessage } from "@/lib/declutter/meetupErrors";
import { PickupTimesEditor, pickupWindowsProblem, placeHoursLine } from "./DeclutterPickupTimes";
import { SellerAddressField } from "./SellerAddressField";
import { NO_CITY_IN_ADDRESS } from "./sellForm";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { PLACE_CARD_EDGE } from "./SellPorchPlaces";

type Draft = { name: string; address: string; area: string; windows: MeetupWindow[]; point?: { lat: number; lng: number; address: string } };
const START_HOURS: MeetupWindow[] = [{ weekday: 6, starts: "09:00", ends: "12:00" }];

function SpotForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const [d, setD] = useState(initial);
  const place = useExactAddressPoint();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const address = d.address.trim();
      // A suggestion carries its own point; a typed address needs an exact one (a pick from the list).
      const point = d.point && d.point.address.trim() === address ? d.point : await place.locate(address);
      if (!d.area.trim()) throw new Error("no_city_in_address");
      return saveMyMeetupSpot({ id: null, name: d.name.trim(), address, area: d.area.trim(), lat: point.lat, lng: point.lng, windows: d.windows });
    },
    onMutate: () => setProblem(null),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: MY_MEETUP_SPOTS_KEY }); toast("Meet spot saved."); onDone(); },
    onError: (err) => {
      const code = err instanceof Error ? err.message : "";
      if (code === "address_not_exact") return;
      setProblem(code === "no_city_in_address" ? NO_CITY_IN_ADDRESS : meetupErrorMessage(err));
    },
  });
  const hoursProblem = pickupWindowsProblem(d.windows);
  const ready = d.name.trim().length >= 2 && d.address.trim().length >= 5 && !hoursProblem;
  return (
    <div className={`space-y-3 rounded-[16px] border border-border bg-card p-4 ${PLACE_CARD_EDGE}`} data-meetup-spot-form="">
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-name`} className="block text-ds-14 font-semibold text-foreground">Name</label>
        <Input id={`${uid}-name`} maxLength={80} value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Walmart parking lot" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-address`} className="block text-ds-14 font-semibold text-foreground">Address</label>
        <SellerAddressField id={`${uid}-address`} ariaLabel="Address" value={d.address} place={place}
          onChange={(address, area) => { setD((x) => ({ ...x, address, area: x.point && x.point.address.trim() === address.trim() ? x.area : area })); setProblem(null); }} />
        <p className="text-ds-13 text-muted-foreground">Use a busy public place. Buyers see this address before they pay.</p>
      </div>
      <div className="space-y-1.5" role="group" aria-label="Days and times you'll meet here">
        <p className="text-ds-14 font-semibold text-foreground">Days and times you'll meet here</p>
        <PickupTimesEditor windows={d.windows} setWindows={(f) => setD((x) => ({ ...x, windows: f(x.windows) }))} />
      </div>
      {problem && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink">{problem}</p>}
      {/* App-wide rule (owner 11-01): in a side-by-side pair the primary sits on the right. */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="rounded-full" disabled={save.isPending} onClick={onDone}>Cancel</Button>
        <Button type="button" className="rounded-full" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save spot"}
        </Button>
      </div>
    </div>
  );
}

function SpotRow({ spot }: { spot: MyMeetupSpot }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeMyMeetupSpot(spot.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: MY_MEETUP_SPOTS_KEY }),
    onError: (err) => toast.error(meetupErrorMessage(err)),
  });
  return (
    <li className={`flex items-start gap-3 rounded-[16px] border border-border bg-card px-4 py-3 ${PLACE_CARD_EDGE}`} data-my-meetup-spot="">
      <div className="min-w-0 flex-1">
        <p className="text-ds-15 font-semibold text-foreground">{spot.name}</p>
        <p className="text-ds-13 text-muted-foreground">{spot.address}</p>
        {spot.windows && spot.windows.length > 0 && <p className="text-ds-13 text-muted-foreground">{placeHoursLine(spot.windows, [])}</p>}
      </div>
      <Button type="button" variant="ghost" size="iconCompact" aria-label={`Remove ${spot.name}`} disabled={remove.isPending} onClick={() => remove.mutate()}
        className="text-muted-foreground">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

export function SellMeetupSpots() {
  const q = useQuery({ queryKey: MY_MEETUP_SPOTS_KEY, queryFn: fetchMyMeetupSpots });
  const sug = useQuery({ queryKey: ["declutter", "meetup-suggestions"], queryFn: fetchMeetupSuggestions, staleTime: 10 * 60_000 });
  const [draft, setDraft] = useState<Draft | null>(null);
  if (q.data === MEETUP_SPOTS_NOT_DEPLOYED) return null;
  const spots = Array.isArray(q.data) ? q.data : [];
  const taken = new Set(spots.map((s) => s.address.trim().toLowerCase()));
  const suggestions = (sug.data ?? []).filter((s) => !taken.has(s.address.trim().toLowerCase())).slice(0, 6);
  const fromSuggestion = (s: MeetupSuggestion): Draft => ({ name: s.name, address: s.address, area: s.area, windows: START_HOURS, point: { lat: s.lat, lng: s.lng, address: s.address } });
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-labelledby="meet-spots-title" data-testid="sell-meetup-spots">
      <div className="space-y-1">
        <h2 id="meet-spots-title" className="text-base font-semibold text-foreground">Meet spots</h2>
        <p className="text-ds-13 text-muted-foreground">
          Public places where you'll meet a buyer, with the days and times. Buyers choosing Meet up pick one and a time.
        </p>
      </div>
      {q.isError && <ErrorState variant="inline" title="We couldn't load your meet spots." body={declutterErrorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {spots.length > 0 && <ul className="space-y-2">{spots.map((s) => <SpotRow key={s.id} spot={s} />)}</ul>}
      {draft ? (
        <SpotForm initial={draft} onDone={() => setDraft(null)} />
      ) : spots.length < MAX_MY_MEETUP_SPOTS && (
        <div className="space-y-3">
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setDraft({ name: "", address: "", area: "", windows: START_HOURS })}>
            Add a meet spot
          </Button>
          {suggestions.length > 0 && (
            <div className="space-y-1.5" data-meetup-suggestions="">
              <p className="text-ds-13 font-semibold text-foreground">Or start from a police safe exchange spot</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button key={s.id} type="button" variant="outline" size="sm" onClick={() => setDraft(fromSuggestion(s))}
                    className="px-3 text-left text-ds-13">
                    + {s.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
