import { Dialog, DialogDestructiveAction, DialogSecondaryAction, DialogContent, DialogDescription, DialogFooter, DialogHero } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
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

/**
 * What the deletion actually does — erased on the left, kept on the right.
 *
 * This exists because the dialog used to claim the opposite of the truth. Its
 * one line of consequence copy read "Permanent. Job history, earnings records,
 * and verified credentials will be gone for good", and every clause of that
 * was wrong in a way that mattered:
 *
 *  * Earnings records are NOT gone. `payout_transfers` rows are retained —
 *    they carry statutory financial-reporting weight and a payout ledger with
 *    a hole in it cannot be reconciled. What goes is the NAME on them.
 *  * Job history is only partly gone: jobs that never took a payment are
 *    deleted, jobs that did are kept as financial records with the address and
 *    free text stripped.
 *  * It said nothing at all about the two things a departing user would most
 *    want to know — that their ID document and photo really are destroyed, and
 *    that reviews they WROTE stay on other Helprs' profiles. That second one
 *    is not a detail: a review is part of the reviewee's public record, and
 *    for a Helpr here their rating is their livelihood. Deleting an account
 *    used to silently erase every review its owner had ever written, moving
 *    other people's ratings. It no longer does — and the person clicking
 *    Delete deserves to know that before they click it, not after.
 *
 * Keep this in sync with `purge_user_data()` in
 * 20260901033011_account_deletion_retention_policy.sql and with
 * `_shared/accountPurge.ts`. If the policy changes, this copy changes with it;
 * a delete dialog that misdescribes the delete is a trust defect, not a typo.
 */
function RetentionSummary() {
  // Kept deliberately terse. The first draft of this copy was accurate but ran
  // 103px past the fold on a 375×812 phone, which put the primary action below
  // the scroll on first paint — measured, not guessed. The dialog does scroll,
  // so nothing was unreachable, but a destructive confirm whose buttons you
  // have to go looking for is a hierarchy defect. Same facts, fewer words.
  const erased = [
    "Your name, photo, phone, email and address",
    "Your ID document and verification files",
    "Messages you sent, your notifications, saved jobs and devices",
    "Reviews other people left about you",
    "Jobs you posted that nobody applied to and that took no payment",
    // Referral credit is real spendable value and it does not survive the
    // account, so the person deciding deserves to know before they decide —
    // same reason the callout above names the forfeited payouts.
    "Any referral credit you haven't spent",
  ];
  const kept = [
    "Payment records — the law requires we keep them",
    "Reviews you wrote — they stay on that Helpr's profile",
    "Jobs that took a payment, minus your address",
  ];

  return (
    <div className="my-1 grid gap-3 sm:grid-cols-2">
      <div>
        <p
          className="text-ds-11 font-semibold uppercase tracking-wide mb-1.5"
          style={{ color: "hsl(var(--destructive))" }}
        >
          Erased for good
        </p>
        <ul className="space-y-1">
          {erased.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-ds-11 leading-snug">
              <X
                aria-hidden="true"
                className="w-3 h-3 shrink-0 mt-[3px]"
                style={{ color: "hsl(var(--destructive))" }}
              />
              <span style={{ color: "hsl(var(--olivewood) / 0.9)" }}>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p
          className="text-ds-11 font-semibold uppercase tracking-wide mb-1.5"
          style={{ color: "hsl(var(--olivewood))" }}
        >
          Kept, without your name
        </p>
        <ul className="space-y-1">
          {kept.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-ds-11 leading-snug">
              <Check
                aria-hidden="true"
                className="w-3 h-3 shrink-0 mt-[3px]"
                style={{ color: "hsl(var(--olivewood))" }}
              />
              <span style={{ color: "hsl(var(--olivewood) / 0.9)" }}>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

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
        description="This can't be undone. Here's exactly what happens."
        callout={{
          icon: AlertTriangle,
          // Two money consequences, both of which the user can act on BEFORE
          // confirming. The membership clause is here because deletion now
          // actually cancels the Stripe subscription (it never used to — a
          // deleted account kept billing), and a charge stopping is exactly
          // the kind of thing a person should not discover from their bank.
          text: "Pending payouts will be forfeited and your membership stops billing. Cash out from Earnings first.",
        }}
        primaryLabel="Continue"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={(e) => { e.preventDefault(); setDeleteStep(2); }}
        secondaryLabel="Keep Account"
      >
        <RetentionSummary />
      </BrandConfirmDialog>
    );
  }

  // Step 2 keeps its own shell because it needs an inline input and
  // the title includes a sienna AlertTriangle icon — slightly outside
  // the BrandConfirmDialog contract.
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent role="alertdialog">
        <DialogHero
          title={<><AlertTriangle className="w-5 h-5" /> Final confirmation</>}
        />
        {/* The field used to carry the only instruction — a placeholder that
            vanishes the moment you start typing, with nothing above it saying
            why. `aria-label` covered screen readers; sighted users got a bare
            box under a title. This is the visible instruction that stays put. */}
        <DialogDescription>
          Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> below to confirm.
        </DialogDescription>
        <Input
          autoFocus
          aria-label={`Type ${CONFIRM_PHRASE} to confirm account deletion`}
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          className="my-2 h-11 text-center font-mono tracking-wide rounded-ds-md"
          disabled={deletingAccount}
        />
        {/* Plain DialogFooter. `sm:flex-col-reverse sm:space-x-0` pinned
            step 2 of this dialog to a full-width stack on desktop while step 1
            — the BrandConfirmDialog directly before it — went to an inline
            right-aligned row, so the buttons jumped layout mid-flow. */}
        <DialogFooter>
          <DialogSecondaryAction
            disabled={deletingAccount}
            onClick={(e) => { e.preventDefault(); setDeleteStep(1); setDeleteConfirmText(""); }}
          >
            Back
          </DialogSecondaryAction>
          {/* The shared destructive treatment, not a hand-copied sienna style
              block. This is the same button step 1 renders through
              BrandConfirmDialog's `primaryTone="sienna"`, so the two steps of
              one flow must not be painted by two different code paths. */}
          <DialogDestructiveAction
            disabled={deleteConfirmText !== CONFIRM_PHRASE || deletingAccount}
            onClick={() => { void hapticError(); onDelete(); }}
          >
            {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Delete Forever
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteAccountDialog;
