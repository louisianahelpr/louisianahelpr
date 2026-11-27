import { Camera } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import "@/lib/i18n/enPostJob";
import { useLanguage } from "@/lib/i18n/language";

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
  const { t: tr } = useLanguage();
  // Switch BESIDE its label, not pushed to the far edge (owner, 2026-09-14,
  // VN-49: "too spaced out"). At 1440 the form is ~1500px wide, so
  // `justify-between` put the title at one end, the switch at the other and
  // the explanation trailing across the middle. Tighter padding and a
  // prose-width description keep it reading as one compact control.
  return (
    // Polish audit 11-27 #10: a plain row (no green-tinted card inside the "Add photos and more" group). Guard: src/test/postJobNoCardsInCards1127.test.ts.
    <div data-flat-row="" className="py-1 space-y-1">
      <div className="flex items-center gap-3">
        <label
          htmlFor="require-photo-proof"
          className="flex items-center gap-2 cursor-pointer"
        >
          <Camera className="w-4 h-4 text-primary shrink-0" />
          <span className="text-ds-13 font-semibold text-foreground">
            {tr("postJob.f.photoProof")}
          </span>
        </label>
        <Switch
          id="require-photo-proof"
          checked={requirePhotoProof}
          onCheckedChange={setRequirePhotoProof}
        />
      </div>
      <p className="text-ds-11 text-muted-foreground leading-snug max-w-prose">
        {requirePhotoProof
          ? tr("postJob.f.photoProofOn")
          : tr("postJob.f.photoProofOff")}
      </p>
    </div>
  );
}
