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
      const { error } = await supabase
        .from("profiles")
        .update({
          terms_version_accepted: LATEST_TERMS_VERSION,
          terms_accepted_at: nowIso,
        })
        .eq("user_id", userId);
      if (error) throw error;
      // Also append to legal_acceptances so the auditable log captures the
      // re-consent event (not just the version-pin on profiles). Non-fatal
      // if this insert fails — the version pin above is what actually
      // silences the dialog, so a legal_acceptances hiccup shouldn't strand
      // the user in a loop of the same modal.
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
      toast.error("Couldn't record your acceptance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHero
          eyebrow="We updated our terms"
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
            className="rounded-ds-md"
          >
            {submitting ? "Saving…" : "I Agree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
