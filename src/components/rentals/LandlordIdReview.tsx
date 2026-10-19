/**
 * Homes' ID step (owner 2026-10-19: REPLACES the paid Stripe check; no charge).
 * A landlord who is not ID-verified by any route sends a photo of their
 * government ID (front; back optional) together with a property's ownership
 * proof, in ONE "Send for review"; an admin approves each, or rejects it with a
 * note. Payout setup (Stripe Connect's own ID check) still counts too.
 *
 *   IdStatusNotice   the landlord's ID state (with our team / needs a new
 *                    photo + the admin's note) and the payouts way through.
 *   SendForReview    the one form: ID photos when the ID is still needed, the
 *                    ownership proof when the property needs it.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitLandlordId, submitOwnershipProof, type MyIdentity } from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { LANDLORD_ID_RETENTION_DAYS } from "../../../supabase/functions/_shared/landlordIdRetention";

/**
 * True when the landlord still has to send an ID photo: not verified by any
 * route and nothing waiting. An 'approved' review whose verdict was later taken
 * away (an admin's idv_reject) counts as needing a new photo, never a dead end.
 */
export const idPhotoNeeded = (id: MyIdentity | undefined): boolean => !!id && !id.verified && id.idStatus !== "pending_review";

export function IdStatusNotice({ id }: { id: MyIdentity }) {
  if (id.verified) return null;
  if (id.idStatus === "pending_review") {
    return (
      <p role="status" className="rounded-xl border border-border bg-muted p-3 text-sm">
        Your ID is with our team for review. We'll let you know here when it's checked.
      </p>
    );
  }
  return (
    <div role="status" className="rounded-xl border border-border bg-muted p-3 text-sm space-y-1">
      {id.idStatus === "rejected" || id.idStatus === "approved" ? (
        <>
          <p className="font-semibold">We need a new photo of your ID.</p>
          {id.reviewNote && <p className="text-muted-foreground">Reason: {id.reviewNote}</p>}
        </>
      ) : (
        <p>Every landlord on Louisiana Helpr is ID-verified. Send a photo of your ID with your ownership proof. It's free.</p>
      )}
      <p className="text-muted-foreground">
        Or{" "}
        <Link to="/profile?tab=earnings" className="font-medium underline underline-offset-2">
          set up payouts
        </Link>
        : Stripe's ID check there counts too.
      </p>
    </div>
  );
}

function FileField({ label, accept, onPick, disabled }: { label: string; accept: string; onPick: (f: File | null) => void; disabled: boolean }) {
  return (
    <label className="block text-sm">
      <span className="block mb-1">{label}</span>
      <input type="file" accept={accept} disabled={disabled} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}

/**
 * The one submit. `propertyId` null: the ID alone (no property waiting for
 * proof, e.g. a new photo after a rejection). Sends the ID first, then the proof.
 */
export function SendForReview({
  uid,
  propertyId,
  needsId,
  needsProof,
  onSent,
}: {
  uid: string;
  propertyId: string | null;
  needsId: boolean;
  needsProof: boolean;
  onSent: () => void;
}) {
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  // Set once the ID went through, so a proof failure after it says the ID is in.
  const idSent = useRef(false);
  const send = useMutation({
    mutationFn: async () => {
      idSent.current = false;
      if (needsId && front) {
        await submitLandlordId(uid, front, back);
        idSent.current = true;
      }
      if (needsProof && proof && propertyId) await submitOwnershipProof(uid, propertyId, proof);
    },
    onSuccess: () => {
      toast.success("Sent. Our team will check it.");
      onSent();
    },
    onError: (e) => {
      const words = rentalsErrorMessage(e);
      if (idSent.current) {
        toast.error(`${words} Your ID was sent for review; only the ownership proof didn't go through.`);
      } else {
        toast.error(words);
      }
      // Show what the server has now (the ID may be waiting while the proof is not).
      onSent();
    },
  });
  if (!needsId && !needsProof) return null;
  const ready = (!needsId || front !== null) && (!needsProof || proof !== null);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) send.mutate();
      }}
    >
      {needsId && (
        <>
          <FileField label="Photo of your ID, front (driver's license, state ID or passport)" accept="image/jpeg,image/png,image/webp,image/heic" onPick={setFront} disabled={send.isPending} />
          <FileField label="Back of your ID (optional)" accept="image/jpeg,image/png,image/webp,image/heic" onPick={setBack} disabled={send.isPending} />
        </>
      )}
      {needsProof && (
        <FileField label="Ownership proof: a deed, tax bill or parish assessor page with your name" accept="image/jpeg,image/png,application/pdf" onPick={setProof} disabled={send.isPending} />
      )}
      {needsId && (
        <p className="text-xs text-muted-foreground">
          Only our review team sees your ID. We delete the photo {LANDLORD_ID_RETENTION_DAYS} days after it's checked.
        </p>
      )}
      <Button type="submit" size="sm" disabled={!ready || send.isPending}>
        {send.isPending ? "Sending…" : "Send for review"}
      </Button>
    </form>
  );
}
