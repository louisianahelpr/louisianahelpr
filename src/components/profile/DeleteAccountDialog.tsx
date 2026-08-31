import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHero } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2 } from "lucide-react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { hapticError } from "@/lib/haptics";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleteStep: 1 | 2;
  setDeleteStep: (step: 1 | 2) => void;
  deleteConfirmText: string;
  setDeleteConfirmText: (value: string) => void;
  deletingAccount: boolean;
  onDelete: () => void;
}

// Step 2 asks users to type a confirmation phrase. Short enough that
// thumb-typing on iPhone isn't punishment, long enough that nobody
// hits Delete forever by accident.
const CONFIRM_PHRASE = "DELETE";

export function DeleteAccountDialog({
  open,
  onOpenChange,
  deleteStep,
  setDeleteStep,
  deleteConfirmText,
  setDeleteConfirmText,
  deletingAccount,
  onDelete,
}: DeleteAccountDialogProps) {
  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setDeleteConfirmText(""); setDeleteStep(1); }
  };

  if (deleteStep === 1) {
    return (
      <BrandConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Delete Your Helpr Account?"
        description="Permanent. Job history, earnings records, and verified credentials will be gone for good."
        callout={{
          icon: AlertTriangle,
          text: "Any pending or in-transit Stripe payouts will be forfeited. Cash out your available balance from the Earnings tab first.",
        }}
        primaryLabel="Continue"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={(e) => { e.preventDefault(); setDeleteStep(2); }}
        secondaryLabel="Keep Account"
      />
    );
  }

  // Step 2 keeps its own shell because it needs an inline input and
  // the title includes a sienna AlertTriangle icon — slightly outside
  // the BrandConfirmDialog contract.
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHero
          title={<><AlertTriangle className="w-5 h-5" /> Final confirmation</>}
        />
        {/* The field used to carry the only instruction — a placeholder that
            vanishes the moment you start typing, with nothing above it saying
            why. `aria-label` covered screen readers; sighted users got a bare
            box under a title. This is the visible instruction that stays put. */}
        <AlertDialogDescription>
          Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> below to confirm.
        </AlertDialogDescription>
        <Input
          autoFocus
          aria-label={`Type ${CONFIRM_PHRASE} to confirm account deletion`}
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          className="my-2 h-11 text-center font-mono tracking-wide rounded-ds-md"
          disabled={deletingAccount}
        />
        {/* Plain AlertDialogFooter. `sm:flex-col-reverse sm:space-x-0` pinned
            step 2 of this dialog to a full-width stack on desktop while step 1
            — the BrandConfirmDialog directly before it — went to an inline
            right-aligned row, so the buttons jumped layout mid-flow. */}
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={deletingAccount}
            onClick={(e) => { e.preventDefault(); setDeleteStep(1); setDeleteConfirmText(""); }}
          >
            Back
          </AlertDialogCancel>
          {/* The shared destructive treatment, not a hand-copied sienna style
              block. This is the same button step 1 renders through
              BrandConfirmDialog's `primaryTone="sienna"`, so the two steps of
              one flow must not be painted by two different code paths. */}
          <AlertDialogAction
            variant="destructive"
            disabled={deleteConfirmText !== CONFIRM_PHRASE || deletingAccount}
            onClick={() => { void hapticError(); onDelete(); }}
          >
            {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Delete Forever
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteAccountDialog;
