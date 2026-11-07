/**
 * CompleteProfile's one write and its recovery (moved out of CompleteProfile.tsx, Q806; code unchanged).
 *
 * saveCompletedProfile: the profile row (name, optional city/ZIP/parish, the 18+ record, the three consent fields),
 * the photo through uploadProfileFiles (the row is saved INSIDE the upload), the append-only legal_acceptances row,
 * and the saved row into the current-user cache. Throws on a refused or zero-row write.
 * recoverCompletedProfile: after a failed save, a profile that is complete anyway (an earlier attempt landed) is read
 * back, cached, and the member goes on to where they were headed.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isProfileComplete } from "@/components/ProtectedRoute";
import { queryKeys } from "@/lib/queryKeys";
import { unwrapMutationRow } from "@/lib/mutationResult";
import { LATEST_PRIVACY_VERSION, LATEST_TERMS_VERSION } from "@/lib/consent";
import { report } from "@/lib/errorLogger";
import type { useLanguage } from "@/lib/i18n/language";
import { uploadProfileFiles } from "./uploadProfileFiles";
import type { ProfileCompletionUpdates } from "./types";
import { withTimeout } from "./constants";

type T = ReturnType<typeof useLanguage>["t"];

export interface CompletedProfileForm {
  user: User;
  profile: { age_attested_at?: string | null } | null | undefined;
  firstName: string;
  lastName: string;
  bio: string;
  location: string;
  zipCode: string;
  resolvedZipParish: string | null | undefined;
  ageBoxShown: boolean;
  avatarFile: File | null;
  t: T;
  queryClient: QueryClient;
}

export async function saveCompletedProfile({
  user, profile, firstName, lastName, bio, location, zipCode, resolvedZipParish, ageBoxShown, avatarFile, t, queryClient,
}: CompletedProfileForm): Promise<void> {
  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  const nowIso = new Date().toISOString();

  // Note: full_name is persisted to the profiles table below. We intentionally
  // skip supabase.auth.updateUser() here because it grabs the auth lock and can
  // collide with the session's autoRefreshToken loop, producing
  // "Acquiring an exclusive Navigator LockManager lock ... lock stolen" errors.

  // Single, lightweight DB update — no large JSON over the wire
  const updates: ProfileCompletionUpdates = {
    full_name: fullName,
    bio: bio.trim(),
    // Optional: an empty field never overwrites what the profile has.
    ...(location.trim() ? { location: location.trim() } : {}),
    ...(zipCode.trim() ? { zip_code: zipCode.trim() } : {}),
    ...(resolvedZipParish ? { parish: resolvedZipParish } : {}), // the live effect's value
    // The 18+ box (checked above): the record ProtectedRoute's gate reads
    // for a Google/Apple sign-up. The first tick's moment is kept.
    ...(ageBoxShown && !profile?.age_attested_at ? { age_attested_at: nowIso } : {}),
    // Stamp the moment the user accepted the rules / terms / privacy.
    // Persisting this means the checklist won't ask again on refresh.
    //
    // Written into the SAME three places the signup path uses, so consent
    // has one shape no matter which screen collected it:
    //   accepted_terms_at      — first-ever consent (immutable server-side)
    //   terms_accepted_at      — acceptance of the version below
    //   terms_version_accepted — which version that was
    // plus an append-only `legal_acceptances` row after the save.
    // Before this, `accepted_terms_at` was the only one this screen wrote
    // and `terms_version_accepted` stayed '' — which meant a user who
    // completed their profile here was left permanently "stale" to
    // TermsReconsentDialog's version check.
    accepted_terms_at: nowIso,
    terms_accepted_at: nowIso,
    terms_version_accepted: LATEST_TERMS_VERSION,
  };

  // Upload files directly to Storage (much faster than base64-through-
  // edge-function), and SAVE THE ROW INSIDE the upload: `uploadProfileFiles`
  // calls this after the photo is stored and before the photo it replaces
  // is deleted. It used to hand back a URL with the old object already
  // gone, so the save below failing (a contact-leak bio, a timeout, a
  // zero-row update) left `avatar_url` on a deleted object.
  // Government ID upload was removed from this page — Stripe Identity
  // (triggered from the first job post) collects the real ID now.
  //
  // Read the persisted row back in the same round-trip. ProtectedRoute's
  // Big-7 completeness gate re-evaluates the instant we navigate to
  // /home, so the cache MUST hold the authoritative saved row — not
  // an optimistic guess that a stale background refetch could clobber.
  //
  // Guarded through unwrapMutation because a null `error` does NOT mean
  // the write happened: an UPDATE matching zero rows (RLS refusing the
  // row, a session whose auth.uid() no longer matches) returns
  // `{ data: [], error: null }`. The previous shape read that as success
  // and fell back to an OPTIMISTIC merge — writing a profile the database
  // does not have into the cache, letting the gate pass, and dropping the
  // user on /home until the next real fetch bounced them back here
  // with nothing to show for the attempt. This is the one write on the
  // screen, and it is the screen's only exit, so a silent rejection has to
  // surface as a failure.
  const userId = user.id;
  const { saved: savedRow, staleAvatarObjects } = await uploadProfileFiles(
    userId,
    avatarFile,
    async ({ avatarUrl }) => {
      if (avatarUrl) updates.avatar_url = avatarUrl;
      return unwrapMutationRow<Record<string, unknown>>(
        await withTimeout(
          Promise.resolve(
            supabase.from("profiles").update(updates).eq("user_id", userId).select("*"),
          ),
          t("profileGate.saveLabel"),
        ),
        {
          action: "save your profile",
          context: { userId },
        },
      );
    },
  );

  // A superseded photo that survived the replace is STILL PUBLIC. Do not
  // fail the submit over it — the new photo is live and the profile points
  // at it — but never let it pass silently either: if the member was
  // replacing a photo they wanted retracted (the licence / passport case
  // this bucket has already seen), silence is the failure.
  if (staleAvatarObjects.length > 0) {
    toast.error(
      t("photo.staleAvatar"),
    );
  }

  // Append the acceptance EVENT to the audit trail. `legal_acceptances` is
  // append-only (INSERT + SELECT policies only, no UPDATE/DELETE), so a
  // version bump adds a record instead of replacing one — which is the
  // whole point of having it alongside the two profile columns. This
  // screen never wrote to it before, so a consent collected here left no
  // audit row at all; only the signup path did.
  //
  // Non-fatal and explicitly checked: a missed audit row must not strand a
  // user on the one screen they cannot leave, but the error is never
  // dropped — a consent trail that silently stops being written is exactly
  // the failure this table exists to prevent.
  const { error: legalErr } = await supabase.from("legal_acceptances").insert({
    user_id: user.id,
    terms_version: LATEST_TERMS_VERSION,
    privacy_version: LATEST_PRIVACY_VERSION,
  });
  if (legalErr) {
    report(legalErr, {
      severity: "warning",
      tags: { source: "CompleteProfile.legalAcceptances" },
      context: { userId: user.id },
    });
  }

  // There used to be a follow-up here: when the saved row still read
  // approval_status 'pending', invoke complete-signup to flip it. The
  // approval step is retired (Q193/Q205b) — nothing reads the column —
  // so the save above IS the completion.
  queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: { isAdmin?: boolean } | undefined) => ({
    ...(current ?? {}),
    // The row Postgres actually persisted — guaranteed non-null by the
    // guard above.
    profile: savedRow,
    isAdmin: current?.isAdmin ?? false,
  }));
  // No invalidate + sleep here: that triggered a background refetch that
  // could resolve the pre-update row mid-navigation (read-after-write
  // race), failing the completeness gate and bouncing the user straight
  // back to /complete-profile (LH-29). The authoritative row above is the
  // single source of truth; staleTime keeps it from refetching on arrival.
}

export async function recoverCompletedProfile({
  user, t, queryClient, navigate, nextDestination,
}: {
  user: User | null | undefined;
  t: T;
  queryClient: QueryClient;
  navigate: (to: string, opts: { replace: boolean }) => void;
  nextDestination: string;
}): Promise<boolean> {
  if (!user?.id) return false;
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle()),
      t("profileGate.checkLabel"),
      12000,
    );
    if (error || !data || !(data.is_legacy_user === true || isProfileComplete(data, user))) return false;

    queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: { isAdmin?: boolean } | undefined) => ({
      ...(current ?? {}),
      profile: data,
      isAdmin: current?.isAdmin ?? false,
    }));
    navigate(nextDestination, { replace: true });
    return true;
  } catch {
    // Recovery is a best-effort second read: the caller shows the save's own error when it fails.
    return false;
  }
}
