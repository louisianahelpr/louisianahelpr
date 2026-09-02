// TermsReconsentDialog — fires when the current user's row has an outdated
// `terms_version_accepted`. A material Terms change bumps LATEST_TERMS_VERSION
// in src/lib/consent.ts and supabase/functions/_shared/legalVersions.ts,
// which causes the mismatch and triggers this dialog on the user's next
// authed load. Non-dismissible: the primary CTA is the only way out.
//
// Rollout note: existing users have `terms_version_accepted = ''` (migration
// default), so this dialog will fire once for every current user the first
// time they open the app after this ships. Intended — it's the affirmative
// re-consent event the Cowork audit flagged as missing.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertDialog, AlertDialogContent, AlertDialogHero, AlertDialogFooter, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LATEST_TERMS_VERSION } from "@/lib/consent";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function TermsReconsentDialog() {
  const { user, profile, refresh } = useCurrentUser();
  const qc = useQueryClient();
  const [acceptedVersion, setAcceptedVersion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const userId = user?.id ?? null;
  // Only prompt users who have finished the front door — an unconfirmed
  // email sits on /account-pending and shouldn't be double-gated. Denied /
  // banned users bounce to their status pages via ProtectedRoute long
  // before this component matters, so `approved` is the only state that
  // benefits from a re-consent nag.
  const isEligible =
    !!userId &&
    !!user?.email_confirmed_at &&
    profile?.approval_status === "approved" &&
    !profile?.ban_status;

  // Fetch the accepted version off the user's own profile row. Kept
  // separate from useCurrentUser's SharedProfile shape so the shared slice
  // stays lean — this column is only ever needed here.
  useEffect(() => {
    if (!isEligible || !userId) {
      setLoaded(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("terms_version_accepted")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Fail-closed on read: don't nag the user if the fetch itself is
        // broken. Log so a systemic RLS/schema issue isn't invisible.
        report(error, { tags: { source: "TermsReconsentDialog.load" } });
        setAcceptedVersion(LATEST_TERMS_VERSION);
      } else {
        setAcceptedVersion((data?.terms_version_accepted as string | null) ?? "");
      }
      setLoaded(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isEligible, userId]);

  const isStale = loaded && acceptedVersion !== LATEST_TERMS_VERSION;
  const open = !!isEligible && !!isStale;

  const handleAccept = async () => {
    if (!userId) return;
    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      // `.select("user_id")` + `unwrapMutation`, and the ORDER below is now
      // load-bearing. This write used to stop at `if (error) throw error`,
      // which cannot see the failure that actually matters here: an UPDATE
      // matching zero rows returns `{ data: [], error: null }`, so an RLS
      // refusal or a wrong `user_id` fell straight through as success.
      //
      // What the user saw: hapticSuccess(), the non-dismissible gate closing,
      // and no error — then the same modal again on the next cold launch, with
      // no explanation, forever. And because the audit insert below ran
      // REGARDLESS, `legal_acceptances` recorded a consent event for a version
      // `profiles` never pinned: two systems permanently disagreeing about
      // whether this person accepted. On an age-restricted platform that
      // handles money, an unrecorded — or falsely recorded — consent is a
      // compliance exposure, not a UI nit.
      //
      // So the version pin must PROVE it landed before the audit row claims it
      // did. A throw here skips the insert and lands in the catch below.
      unwrapMutation(
        await supabase
          .from("profiles")
          .update({
            terms_version_accepted: LATEST_TERMS_VERSION,
            terms_accepted_at: nowIso,
          })
          .eq("user_id", userId)
          .select("user_id"),
        {
          action: "record your acceptance of the updated terms",
          rejectedMessage:
            "We couldn't record your acceptance. Please try again, or contact support if it keeps happening.",
          context: { userId, termsVersion: LATEST_TERMS_VERSION },
        },
      );
      // Append the re-consent EVENT to the auditable log. Still non-fatal, and
      // now that is a defensible position rather than an accidental one: the
      // pin above is confirmed, so a failure here loses the timestamped trail
      // of this event but cannot make the two systems contradict each other.
      // Reported, never swallowed.
      const { error: legalErr } = await supabase.from("legal_acceptances").insert({
        user_id: userId,
        terms_version: LATEST_TERMS_VERSION,
        privacy_version: LATEST_TERMS_VERSION,
      });
      if (legalErr) {
        report(legalErr, { tags: { source: "TermsReconsentDialog.legalAcceptances" } });
      }
      hapticSuccess();
      setAcceptedVersion(LATEST_TERMS_VERSION);
      // Refresh so any downstream consumer of the profile sees the change.
      await refresh();
      qc.invalidateQueries({ queryKey: queryKeys.currentUser.byId(userId) });
    } catch (err) {
      hapticError();
      report(err instanceof Error ? err : new Error(String(err)), {
        tags: { source: "TermsReconsentDialog.accept" },
      });
      // `mutationErrorMessage` returns the `rejectedMessage` above for a
      // silent zero-row rejection and the generic line for anything else, so
      // the user is not told "please try again" about a write that will keep
      // being refused.
      toast.error(
        mutationErrorMessage(err, "Couldn't record your acceptance. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Deliberately non-dismissible: this is a hard re-consent gate, so there
    // is no `onOpenChange`. `closeDisabled` tells the shared shell that, so
    // the corner ✕ renders inert-and-dimmed instead of looking like a live
    // dismiss that silently does nothing when tapped.
    <AlertDialog open={open}>
      <AlertDialogContent closeDisabled>
        <AlertDialogHero
          title="Please Take a Moment to Re-Agree"
        />
        <AlertDialogFooter>
          <AlertDialogAction
            disabled={submitting}
            onClick={(e) => {
              // Keep the dialog on screen while the write runs so a slow
              // network doesn't briefly hide → re-show the modal.
              e.preventDefault();
              void handleAccept();
            }}
          >
            {submitting ? "Saving…" : "I Agree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
