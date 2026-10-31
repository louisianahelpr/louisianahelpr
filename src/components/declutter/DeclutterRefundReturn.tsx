/**
 * Declutter returns (migration 20261030071818_declutter_returns.sql): the way a full-refund item goes back to the seller, inside the
 * refund panel (DeclutterRefundRequest.tsx) and nowhere else (src/test/declutterReturns.test.ts). Owner 2026-10-29:
 * only the two free ways, no paid Helpr trip. Every rule is the server's; this only shows them and sends choices.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthReady } from "@/hooks/useAuthReady";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { hapticLight } from "@/lib/haptics";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { meetupMapUrl } from "@/lib/declutter/meetup";
import { currentPosition } from "@/lib/declutter/position";
import type { RefundRequestView } from "@/lib/declutter/refundRequests";
import {
  returnDayChoices,
  returnDayWords,
  returnDroppedOff,
  setReturnAddress,
  uploadReturnPhoto,
  type ReturnWay,
} from "@/lib/declutter/refundReturns";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

/**
 * "the seller" at the start of a sentence. Audit BUY-32: the panels were handed an already capitalised `who`, so the
 * middle of a sentence read "Bring the item back to The seller's pickup address". `who` stays as it reads mid-sentence;
 * only a sentence's first word goes through this.
 */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const at = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The seller's pick, kept in the answer form until "Send answer". */
export interface ReturnPick {
  way: ReturnWay;
  day: string;
  /** A collect time from a datetime-local box ("2026-10-30T15:00"), or "". */
  local: string;
}

export function emptyReturnPick(canDropOff = true): ReturnPick {
  return { way: canDropOff ? "drop_off" : "collect", day: returnDayChoices()[0] ?? "", local: "" };
}

/** What the RPC takes: a drop-off sends its day; a collect sends its time. Null when the pick isn't complete. */
export function returnPickArgs(p: ReturnPick): { day: string | null; atIso: string | null } | null {
  if (p.way === "drop_off") return p.day ? { day: p.day, atIso: null } : null;
  const t = p.local ? new Date(p.local) : null;
  return t && !Number.isNaN(t.getTime()) ? { day: null, atIso: t.toISOString() } : null;
}

/** The seller picks how the item comes back (shown under "Refund in full"). */
export function DeclutterReturnWayPicker({ id, who, canDropOff, value, onChange }: {
  id: string;
  who: string;
  /** BUY-23: off on a meeting-spot, delivered or shipped sale: the seller's address stays private there. */
  canDropOff: boolean;
  value: ReturnPick;
  onChange: (p: ReturnPick) => void;
}) {
  const days = returnDayChoices();
  return (
    <fieldset className="space-y-2" data-return-way="">
      <legend className="text-xs font-medium">{canDropOff ? "How does it come back? Both ways are free." : "How it comes back. It's free."}</legend>
      {/* The app's one "pick one" list (D2-15), not browser radios. */}
      <RadioCardList
        label="How does it come back?"
        required
        options={[
          ...(canDropOff ? [{ value: "drop_off", label: `${cap(who)} brings it back`, sub: "To your pickup address, on the day you pick or after, with a photo taken there." }] : []),
          { value: "collect", label: "I'll pick it up", sub: `You go to the address ${who} gives you, at the time you pick.` },
        ]}
        value={value.way}
        onChange={(w, via) => { if (via === "click") hapticLight(); onChange({ ...value, way: w as ReturnWay }); }}
      />
      {value.way === "drop_off" ? (
        <div>
          <label htmlFor={`${id}-day`} className="block text-xs font-medium">From which day?</label>
          <select id={`${id}-day`} className={input} value={value.day} onChange={(e) => onChange({ ...value, day: e.target.value })}>
            {days.map((d) => <option key={d} value={d}>{returnDayWords(d)}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label htmlFor={`${id}-at`} className="block text-xs font-medium">When will you come? (within 7 days)</label>
          <input id={`${id}-at`} type="datetime-local" className={`${input} min-w-0`} value={value.local} onChange={(e) => onChange({ ...value, local: e.target.value })} />
        </div>
      )}
    </fieldset>
  );
}

function useRefreshRefund(orderId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["declutter", "refund-request", orderId] });
}

/** The buyer, while the item is coming back: what to do for the way the seller picked. */
export function DeclutterReturnBuyer({ v, who }: { v: RefundRequestView; who: string }) {
  const r = v.request;
  const { user } = useAuthReady();
  const refresh = useRefreshRefund(v.order_id);
  const [address, setAddress] = useState("");
  const place = useExactAddressPoint("address_not_found");
  const drop = useMutation({
    mutationFn: async (file: File) => {
      if (!r || !user) throw new Error("not_authenticated");
      const where = await currentPosition();
      const path = await uploadReturnPhoto(user.id, v.order_id, file);
      return returnDroppedOff(r.id, path, where);
    },
    onSuccess: () => { toast(`Dropped off. ${cap(who)} is told.`); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const addr = useMutation({
    mutationFn: async () => {
      if (!r) throw new Error("refund_not_found");
      // No distance check reads this point; it is only the seller's map link, so a refund never waits on the house.
      const g = await place.locate(address, { allowApproximate: true });
      await setReturnAddress(r.id, address.trim(), { lat: g.lat, lng: g.lng });
      return { approximate: g.approximate === true };
    },
    onSuccess: ({ approximate }) => {
      toast(approximate
        ? `Saved. ${cap(who)} is told where to pick it up. Their map may only show the area, but they'll read the address you typed.`
        : `Saved. ${cap(who)} is told where to pick it up.`);
      setAddress("");
      refresh();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!r || r.status !== "returning" || !r.return_way) return null;
  if (r.return_way === "drop_off") {
    if (r.return_dropped_off_at) {
      return <p className="text-sm" data-return-dropped="">You dropped it off {at(r.return_dropped_off_at)}. Your refund is sent once {who} confirms they have it.</p>;
    }
    const fileId = `dcl-return-${v.order_id}`;
    return (
      <div className="space-y-2" data-return-drop-off="">
        <p className="text-sm">Bring the item back to {who}'s pickup address{r.return_day ? ` on ${returnDayWords(r.return_day)} or after` : ""}, then take a photo there.</p>
        {r.drop_off_address && <p className="text-sm" data-return-drop-address="">Address: <span className="font-medium">{r.drop_off_address}</span></p>}
        <label htmlFor={fileId} className="sr-only">Photo of the item where you left it, taken at the pickup address</label>
        <input id={fileId} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} disabled={drop.isPending}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) drop.mutate(f); e.target.value = ""; }} />
        <button type="button" className={primary} disabled={drop.isPending} onClick={() => document.getElementById(fileId)?.click()}>
          {drop.isPending ? "Saving…" : "Take your drop-off photo"}
        </button>
      </div>
    );
  }
  const addrId = `dcl-return-addr-${v.order_id}`;
  return (
    <div className="space-y-2" data-return-collect="">
      <p className="text-sm">{cap(who)} will come for it{r.return_at ? ` ${at(r.return_at)}` : ""}.</p>
      {r.return_address ? (
        <p className="text-sm">Pickup address: <span className="font-medium">{r.return_address}</span></p>
      ) : (
        <>
          <label htmlFor={addrId} className="block text-xs font-medium">Where should they pick it up?</label>
          <input id={addrId} className={input} autoComplete="street-address" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
          <button type="button" className={primary} disabled={addr.isPending || address.trim().length < 5} onClick={() => addr.mutate()}>
            {addr.isPending ? "Saving…" : "Send the address"}
          </button>
        </>
      )}
    </div>
  );
}

/** The seller, while the item is coming back: the way, the buyer's address for a collect, the drop-off. */
export function DeclutterReturnSellerInfo({ v, who }: { v: RefundRequestView; who: string }) {
  const r = v.request;
  if (!r || r.status !== "returning" || !r.return_way) return null;
  if (r.return_way === "drop_off") {
    return r.return_dropped_off_at
      ? <p className="text-sm" data-return-dropped="">{cap(who)} dropped it off at your pickup address {at(r.return_dropped_off_at)}, with a photo.</p>
      : <p className="text-sm" data-return-drop-off="">{cap(who)} brings it to your pickup address{r.return_day ? ` on ${returnDayWords(r.return_day)} or after` : ""}.</p>;
  }
  return (
    <div className="space-y-1" data-return-collect="">
      <p className="text-sm">You pick it up{r.return_at ? ` ${at(r.return_at)}` : ""}.</p>
      {r.return_address && r.return_lat != null && r.return_lng != null ? (
        <p className="text-sm">
          At <span className="font-medium">{r.return_address}</span>.{" "}
          <a className="underline" href={meetupMapUrl({ spot_lat: r.return_lat, spot_lng: r.return_lng, spot_name: r.return_address })} target="_blank" rel="noreferrer">
            Directions
          </a>
        </p>
      ) : (
        <p className="text-ds-12 text-muted-foreground">Waiting for {who} to add the address.</p>
      )}
    </div>
  );
}

/** The seller's optional photo with "I got it back". */
export function DeclutterReturnPhotoPick({ orderId, file, onFile }: { orderId: string; file: File | null; onFile: (f: File | null) => void }) {
  const fileId = `dcl-return-back-${orderId}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={fileId} className="sr-only">Photo of the item you got back (optional)</label>
      <input id={fileId} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1}
        onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <button type="button" className={btn} onClick={() => document.getElementById(fileId)?.click()}>
        {file ? "Retake the photo" : "Add a photo (optional)"}
      </button>
      {file && <span className="text-ds-12 text-muted-foreground">Photo ready.</span>}
    </div>
  );
}

/** Upload the seller's optional photo (null when none). */
export async function sellerReturnPhotoPath(userId: string | undefined, orderId: string, file: File | null): Promise<string | null> {
  if (!file) return null;
  if (!userId) throw new Error("not_authenticated");
  return uploadReturnPhoto(userId, orderId, file);
}
