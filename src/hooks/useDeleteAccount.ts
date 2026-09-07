import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { clearPersistedAuthToken } from "@/lib/persistedAuthToken";
import { functionErrorMessage } from "@/lib/supabaseResult";

/**
 * Account deletion, as one flow, for every screen that offers it.
 *
 * ── Why this is a hook and not a copied handler ─────────────────────────────
 * There are now TWO entry points: the Profile landing (the ordinary one) and
 * /account-banned (the only screen a suspended or banned user can reach, and
 * therefore the only place Apple's in-app-deletion requirement can be met for
 * them — `ProtectedRoute` runs the ban gate before its `allowUnapproved`
 * branch, so every protected route bounces them here).
 *
 * A second copy of this handler is not a hypothetical risk in this file's
 * history. In-app deletion was 100% broken for every user for a day because a
 * client-side pre-check duplicated the edge function's `job_status` list and
 * the two drifted — one copy carried enum members that do not exist, Postgres
 * rejected the whole query with 22P02, and the throw happened before the
 * invoke. The fix was to delete the duplicate. Adding a second delete button
 * would have recreated exactly that shape, so the flow moves here and both
 * screens render the same `DeleteAccountDialog` off the same state.
 *
 * ── The confirmation-phrase mapping is deliberate ───────────────────────────
 * The dialog asks the user to type "DELETE" (short enough to thumb-type on a
 * phone). The edge function validates the legacy "DELETE MY ACCOUNT" phrase.
 * The mapping lives here, once, rather than in each caller.
 *
 * ── There is deliberately no client-side pre-check ──────────────────────────
 * `delete-own-account` refuses (409) while the user is party to an in-flight
 * job or holds escrow, with a human message that `functionErrorMessage`
 * surfaces verbatim. One guard, server-side, where it has to live anyway.
 */

/** What the dialog asks the user to type. */
const UI_CONFIRM_PHRASE = "DELETE";
/** What the edge function has validated since before the dialog was shortened. */
const SERVER_CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export interface UseDeleteAccount {
  /** Open the flow from step 1 with a cleared input. */
  requestDelete: () => void;
  /** True while the dialog should be mounted. */
  isOpen: boolean;
  /** Spread straight onto `<DeleteAccountDialog {...dialogProps} />`. */
  dialogProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    deleteStep: 1 | 2;
    setDeleteStep: (step: 1 | 2) => void;
    deleteConfirmText: string;
    setDeleteConfirmText: (value: string) => void;
    deletingAccount: boolean;
    onDelete: () => void;
    accountDeleted: boolean;
    onAcknowledgeDeleted: () => void;
  };
}

export function useDeleteAccount(): UseDeleteAccount {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // True once the server has confirmed the account is gone. Drives the
  // dialog's final panel — the confirmation the flow never had.
  const [deleted, setDeleted] = useState(false);

  // `finish` can be reached twice from one tap. "Done" is a
  // `DialogSecondaryAction` inside a `role="alertdialog"`, so dialog.tsx wraps
  // it in `DialogPrimitive.Close` (see MaybeClose) — the click fires our
  // handler AND `onOpenChange(false)`, and both routes lead here.
  const finishing = useRef(false);

  /**
   * Sign out and leave. Runs ONLY after the account is confirmed gone, and
   * cannot report failure — see `handleDelete` for why that matters.
   */
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      await signOutWithPushCleanup();
    } catch (err) {
      // The account no longer exists, so a failed sign-out is a local cleanup
      // problem, not a deletion problem, and it must never be shown to the
      // user as one. Logged rather than swallowed.
      console.error("[deleteAccount] sign-out after deletion failed", err);
      // But it cannot just be logged, either. The token that `signOut()` failed
      // to remove is exactly what `MarketingRedirect` reads on `/`, so leaving
      // it behind sends the user to `/dashboard` as a signed-in user of an
      // account that no longer exists — measured 2026-09-06 with the sign-out
      // forced to reject: URL `/dashboard`, greeting rendered, token still in
      // localStorage. Pulling the key is the floor under a failed sign-out.
      clearPersistedAuthToken();
    }
    setOpen(false);
    setDeleted(false);
    setDeleting(false);
    navigate("/", { replace: true });
  };

  const handleDelete = async () => {
    if (confirmText !== UI_CONFIRM_PHRASE) return;
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-own-account", {
        body: { confirmation: SERVER_CONFIRM_PHRASE },
      });
      if (error) throw error;
    } catch (err: unknown) {
      // `functionErrorMessage` recovers the edge function's real reason from
      // the response body — the SDK's own `.message` is just "non-2xx". That
      // matters most on the refusal paths, where the body carries the only
      // sentence telling the user what to do next (settle escrow, finish the
      // job, retry after a partial purge).
      toast.error(await functionErrorMessage(err, "Couldn't delete your account — try again?"));
      setDeleting(false);
      return;
    }

    // ── PAST THIS LINE THE ACCOUNT IS GONE ─────────────────────────────────
    // Nothing below may report a failure, and nothing below may be inside the
    // `try` above. It used to be: `invoke` / `signOutWithPushCleanup()` /
    // `navigate("/")` sat in ONE try block under one catch, so any failure in
    // the sign-out — which happens AFTER the purge and after
    // `auth.admin.deleteUser` — surfaced as "Couldn't delete your account —
    // try again?" and skipped the navigate, leaving the person on their own
    // profile page, still holding a session token, being told the most
    // irreversible action in the app had not happened. It had.
    //
    // Reproduced 2026-09-06 against the real /profile screen with the delete
    // stubbed 200 and `supabase.auth.signOut` forced to reject: dialog closed,
    // URL still /profile, avatar and name still rendered, auth token still in
    // localStorage, and the only feedback was that toast. `auth.signOut()` can
    // genuinely reject — auth-js throws `NavigatorLockAcquireTimeoutError` out
    // of `_acquireLock` when another tab holds the storage lock — so this was
    // reachable, not theoretical. External QA reported exactly that screen.
    setDeleting(false);
    setDeleted(true);
  };

  // The dialog must stay mounted and open for as long as the flow owns the
  // screen — INCLUDING after the button that started it has already closed it.
  //
  // "Delete Forever" is a `DialogDestructiveAction`, and inside a
  // `role="alertdialog"` dialog.tsx wraps those in `DialogPrimitive.Close`
  // (`MaybeClose`) so every confirm button dismisses its own dialog. That is
  // the house convention and it is correct for the 43 confirms written against
  // it — but it means the popup is gone the instant the tap lands, while the
  // request it fired is still in the air. The old flow never noticed because
  // it navigated away on success; a flow that has something left to SAY does.
  // Deriving `open` here rather than trying to suppress that Close keeps this
  // independent of Radix's event ordering: React batches the click's state
  // updates, so the very next render already sees `deleting`.
  const shouldBeOpen = open || deleting || deleted;

  return {
    requestDelete: () => {
      finishing.current = false;
      setStep(1);
      setConfirmText("");
      setDeleted(false);
      setOpen(true);
    },
    isOpen: shouldBeOpen,
    dialogProps: {
      open: shouldBeOpen,
      // While the confirmation is up, dismissing it is the same act as
      // pressing Done: the account is gone either way, so the one thing that
      // must not happen is being returned to a signed-in app.
      onOpenChange: (next: boolean) => {
        // A delete already sent cannot be called back, so a dismiss while it is
        // in flight is ignored rather than obeyed.
        if (!next && deleted) { void finish(); return; }
        setOpen(next);
      },
      deleteStep: step,
      setDeleteStep: setStep,
      deleteConfirmText: confirmText,
      setDeleteConfirmText: setConfirmText,
      deletingAccount: deleting,
      onDelete: () => { void handleDelete(); },
      accountDeleted: deleted,
      onAcknowledgeDeleted: () => { void finish(); },
    },
  };
}

export default useDeleteAccount;
