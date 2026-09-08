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
  /**
   * True once the server has confirmed the account is gone — the dialog swaps
   * to its final panel and refuses to show anything that reads as "not done".
   */
  accountDeleted: boolean;
  /** Sign out and leave. Fired by the final panel's only button. */
  onAcknowledgeDeleted: () => void;
  /**
   * Extra rows for the "Kept, without your name" column.
   *
   * Exists for /account-banned, the second entry point to this flow. A banned
   * user's deletion keeps one thing nobody else's does — the ban itself,
   * recorded against a hash of their email so it survives the account
   * (20260903014600_ban_survives_self_deletion.sql). The whole argument for
   * RetentionSummary below is that a delete dialog which misdescribes the
   * delete is a trust defect; a suspended user pressing Delete Forever in the
   * belief that it clears their suspension would be exactly that defect, so
   * the caller that has the context adds the line.
   *
   * Data rather than a `variant` flag: this is copy, and copy belongs to the
   * screen that knows what is true on it.
   */
  extraKeptItems?: string[];
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
function RetentionSummary({ extraKeptItems }: { extraKeptItems?: string[] }) {
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
    // Caller-supplied, and it leads nothing — the shared three are the same
    // for everybody, and the extra row is the one that only applies here.
    ...(extraKeptItems ?? []),
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
  accountDeleted,
  onAcknowledgeDeleted,
  extraKeptItems,
}: DeleteAccountDialogProps) {
  // Delegate, and nothing else. This used to also run
  // `setDeleteConfirmText(""); setDeleteStep(1)` on every close — harmless
  // while "close" only ever meant "cancelled", but "Delete Forever" is wrapped
  // in `DialogPrimitive.Close` by dialog.tsx (every action inside a
  // `role="alertdialog"` is), so a successful delete ALSO fires this. It would
  // rewind the dialog to step 1 while the request was in flight, flashing
  // "Delete Your Helpr Account?" at someone whose account was already gone.
  // `useDeleteAccount.requestDelete()` already resets both on the way in,
  // which is the only moment either needs resetting.
  const handleOpenChange = (o: boolean) => { onOpenChange(o); };

  /**
   * The confirmation. Deletion is the most irreversible action in the app and
   * it used to end in silence: the handler signed out and dropped the user on
   * the marketing landing page with no message, which is indistinguishable
   * from a session expiring. Measured 2026-09-06 on the real screen — after
   * "Delete Forever" the app navigated to `/` and rendered "Log In / Get
   * Started" with zero toasts fired. Someone who sees nothing happen clicks
   * again, or concludes their data is still there.
   *
   * A toast could not carry this even if one were fired: `applyToastPolicy()`
   * (src/lib/toastPolicy.ts) suppresses every `toast.success` without an
   * action, app-wide. So the confirmation is a panel the user has to dismiss,
   * and dismissing it IS the acknowledgement — the sign-out and the redirect
   * hang off it.
   */
  if (accountDeleted) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent role="alertdialog">
          {/* The shared Hero, not a hand-rolled <h2>. Every popup in the app
              wears one header treatment; this one was drawing its own, which
              popupShellInventory catches precisely so a new dialog cannot
              quietly become the app's 150th slightly-different header. */}
          <DialogHero
            title={<><Check className="w-5 h-5" strokeWidth={2.5} /> Your account is deleted.</>}
          />
          <div className="text-center space-y-4 py-2" role="status" aria-live="polite">
            <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
              Your profile, photos and ID documents have been erased. The payment
              records the law requires us to keep no longer carry your name.
            </p>
            <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              You&rsquo;re being signed out on this device. Nothing else is needed.
            </p>
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={onAcknowledgeDeleted}>Done</DialogSecondaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
        secondaryLabel="Cancel"
      >
        <RetentionSummary extraKeptItems={extraKeptItems} />
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
