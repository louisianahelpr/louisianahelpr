import { Camera } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface PhotoProofToggleProps {
  requirePhotoProof: boolean;
  setRequirePhotoProof: (next: boolean) => void;
}

/**
 * "Require before & after photos" — the poster's per-job call.
 *
 * This used to be unconditional: every job demanded a before AND an after
 * photo from the helper before they could mark it done, enforced in the
 * database by enforce_helper_completion_gates(). That is the right rule for
 * work with a visible result and a dead end for a delivery or a dog walk,
 * where there is no "before" to photograph and the helper simply cannot
 * complete the job.
 *
 * Pre-set from the category and then owned by the poster. The switch is shown
 * for EVERY category, on purpose — the pre-set is a guess about the job, and
 * the poster is the one who knows. Hiding it where we guessed "off" would make
 * the requirement un-restorable for a delivery that genuinely wants evidence.
 */
export function PhotoProofToggle({
  requirePhotoProof,
  setRequirePhotoProof,
}: PhotoProofToggleProps) {
  return (
    <div
      className={`rounded-ds-md border p-4 space-y-2 ${
        requirePhotoProof ? "border-primary/30 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor="require-photo-proof"
          className="flex items-center gap-2 cursor-pointer"
        >
          <Camera className="w-4 h-4 text-primary" />
          <span className="text-ds-13 font-semibold text-foreground">
            Require before &amp; after photos
          </span>
        </label>
        <Switch
          id="require-photo-proof"
          checked={requirePhotoProof}
          onCheckedChange={setRequirePhotoProof}
        />
      </div>
      <p className="text-ds-11 text-muted-foreground">
        {requirePhotoProof
          ? "Your Helpr has to upload a photo before they start and another when they finish. Those photos are the proof that releases your payment."
          : "Your Helpr can mark this job done without uploading photos. Good for deliveries, errands and pet care, where a before-and-after shot doesn't show much."}
      </p>
    </div>
  );
}
