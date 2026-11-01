import { lazy, Suspense, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LATEST_TERMS_VERSION, termsAcceptanceIsCurrent } from "@/lib/consent";

const TermsReconsentDialog = lazy(() =>
  import("@/components/TermsReconsentDialog").then((m) => ({ default: m.TermsReconsentDialog })),
);

/**
 * Who may be asked to re-agree: a confirmed email (an unconfirmed one sits on
 * /signup-pending and is not double-gated), a loaded profile, not banned.
 * `ban_status` is NEVER empty (the column defaults to 'active', verified in
 * prod 2026-09-07), so the banned states are named.
 */
export function termsReconsentEligible(
  user: Pick<User, "id" | "email_confirmed_at"> | null | undefined,
  profile: { ban_status?: string | null } | null | undefined,
): boolean {
  return (
    !!user?.id &&
    !!user.email_confirmed_at &&
    !!profile &&
    !["temp_banned", "permanently_banned", "banned"].includes(profile.ban_status ?? "")
  );
}

/**
 * What App.tsx mounts beside every signed-in page for the Terms re-consent
 * dialog (B83, 11-01). The dialog's code is ~101 KB gzip past boot (the shared
 * dialog shell and what it pulls), and it was fetched ~2.6 s into every /home
 * on Slow 4G for a dialog that is closed for everyone who is current, which is
 * nearly everyone.
 *
 * This part reads the one column the dialog decides on from the signed-in
 * profile row (useCurrentUser reads profiles select=* from the server on every
 * load, never from the device) and fetches the dialog only when that version
 * is behind LATEST_TERMS_VERSION. It sent its own profiles read until
 * 2026-11-01: one more request on every signed-in page (Q104 budget, release
 * gate). The dialog then does its own read and opens (it stays the one place
 * the rule and the write live). No profile yet fetches nothing: the same
 * fail-closed choice the dialog makes. Once fetched it stays mounted, so it
 * can close by itself after I Agree.
 *
 * Guard: src/test/chromeWaitsOnlyForItsOwnCode.test.tsx.
 */
export function TermsReconsentMount() {
  const { user, profile } = useCurrentUser();
  const eligible = termsReconsentEligible(user, profile);
  const accepted = (profile as { terms_version_accepted?: string | null } | null)?.terms_version_accepted ?? "";
  const [behind, setBehind] = useState(false);

  useEffect(() => {
    if (!eligible || behind) return;
    if (!termsAcceptanceIsCurrent(accepted, LATEST_TERMS_VERSION)) setBehind(true);
  }, [eligible, accepted, behind]);

  if (!behind) return null;
  return (
    <Suspense fallback={null}>
      <TermsReconsentDialog />
    </Suspense>
  );
}
