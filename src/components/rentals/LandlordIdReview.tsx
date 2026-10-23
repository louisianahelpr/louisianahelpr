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
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, ImageUp, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitLandlordId, submitOwnershipProof, type MyIdentity } from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { LANDLORD_ID_RETENTION_DAYS } from "../../../supabase/functions/_shared/landlordIdRetention";

/**
 * True when the landlord still has to send an ID photo: not verified by any
 * route and nothing waiting. An 'approved' review whose verdict was later taken
 * away (an admin's idv_reject) counts as needing a new photo, never a dead end.
 */
export const idPhotoNeeded = (id: MyIdentity | undefined): boolean => !!id && !id.verified && id.idStatus !== "pending_review";

/** The notice row: one flat tinted strip with a leading icon (the Homes status look). */
function Notice({ icon: Icon, children }: { icon: typeof Clock; children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3 text-ds-14">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--bark))]" aria-hidden />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function IdStatusNotice({ id }: { id: MyIdentity }) {
  // Owner ruling 2026-10-23: payout setup is paused, so the "or set up payouts"
  // way through is not offered; the ID photo route above is unaffected.
  const setupPaused = usePayoutSetupPaused();
  if (id.verified) return null;
  if (id.idStatus === "pending_review") {
    return (
      <Notice icon={Clock}>
        <p>Your ID is with our team for review. We'll let you know here when it's checked.</p>
      </Notice>
    );
  }
  const again = id.idStatus === "rejected" || id.idStatus === "approved";
  return (
    <Notice icon={again ? ShieldAlert : ShieldCheck}>
      {again ? (
        <>
          <p className="font-semibold">We need a new photo of your ID.</p>
          {id.reviewNote && <p className="text-muted-foreground">Reason: {id.reviewNote}</p>}
        </>
      ) : (
        <p>Every landlord on Louisiana Helpr is ID-verified. Send a photo of your ID with your ownership proof. It's free.</p>
      )}
      {!setupPaused && <p className="text-muted-foreground">
        Or{" "}
        <Link to="/profile?tab=earnings" className="font-medium underline underline-offset-2">
          set up payouts
        </Link>
        : Stripe's ID check there counts too.
      </p>}
    </Notice>
  );
}

/**
 * A file pick that looks like the rest of the app: a full-width tile with the
 * label, and the chosen file's name once picked. The native input stays inside
 * the label (screen readers and tests find it by the label's words).
 */
function FileField({ label, accept, onPick, disabled }: { label: string; accept: string; onPick: (f: File | null) => void; disabled: boolean }) {
  const [name, setName] = useState<string | null>(null);
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-ds-14 focus-within:ring-2 focus-within:ring-ring ${name ? "border-[hsl(var(--bark)/0.5)] bg-[hsl(var(--bark)/0.06)]" : "border-border"} ${disabled ? "cursor-not-allowed text-muted-foreground" : ""}`}
    >
      {name ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[hsl(var(--bark))]" aria-hidden />
      ) : (
        <ImageUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        <span className="block truncate text-ds-13 text-muted-foreground" title={name ?? undefined}>
          {name ?? "Tap to choose a file"}
        </span>
      </span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setName(f?.name ?? null);
          onPick(f);
        }}
      />
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
      className="space-y-3"
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
        <p className="text-ds-13 text-muted-foreground">
          Only our review team sees your ID. We delete the photo {LANDLORD_ID_RETENTION_DAYS} days after it's checked.
        </p>
      )}
      <Button type="submit" className="w-full sm:w-auto" disabled={!ready || send.isPending}>
        {send.isPending ? "Sending…" : "Send for review"}
      </Button>
    </form>
  );
}
