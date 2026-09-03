import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
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
  };
}

export function useDeleteAccount(): UseDeleteAccount {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (confirmText !== UI_CONFIRM_PHRASE) return;
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-own-account", {
        body: { confirmation: SERVER_CONFIRM_PHRASE },
      });
      if (error) throw error;
      await signOutWithPushCleanup();
      navigate("/");
    } catch (err: unknown) {
      // `functionErrorMessage` recovers the edge function's real reason from
      // the response body — the SDK's own `.message` is just "non-2xx". That
      // matters most on the refusal paths, where the body carries the only
      // sentence telling the user what to do next (settle escrow, finish the
      // job, retry after a partial purge).
      toast.error(await functionErrorMessage(err, "Couldn't delete your account — try again?"));
    } finally {
      setDeleting(false);
    }
  };

  return {
    requestDelete: () => { setStep(1); setConfirmText(""); setOpen(true); },
    isOpen: open,
    dialogProps: {
      open,
      onOpenChange: setOpen,
      deleteStep: step,
      setDeleteStep: setStep,
      deleteConfirmText: confirmText,
      setDeleteConfirmText: setConfirmText,
      deletingAccount: deleting,
      onDelete: () => { void handleDelete(); },
    },
  };
}

export default useDeleteAccount;
