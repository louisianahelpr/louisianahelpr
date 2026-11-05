import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { savePhoneIfChanged } from "@/lib/phoneSaveIfChanged";
import { assertUploadableAvatar, replaceAvatarObject } from "@/lib/avatarStorage";
import { readProfileAvatarUrl } from "@/lib/readProfileAvatarUrl";
import { useAvatarCrop } from "@/components/profile/AvatarCropDialog";
import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import { contactLeakFieldError, contactLeakRejectionMessage } from "@/lib/contactLeakField";
import { setSimpleMode } from "@/lib/simpleMode";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import type { User } from "@supabase/supabase-js";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { lookupParishByZip } from "@/lib/parishLookup";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { EMPTY_FIELDS, hydratedFieldsOf, unlessEdited, type HydratedFields } from "./profileFieldHydration";
import { requireOnline } from "@/lib/requireOnline";
import { useProfileTabQueries } from "./useProfileTabQueries";
// Only the landing tab + its lightweight header are needed on first paint. Every other tab panel and the rarely-opened
// dialogs are code-split so the Profile route chunk stays small — each is fetched the first time it shows. The full
// non-landing tab router (and its lazy panel imports) lives in <ProfileTabPanels />; only the landing hero + delete dialog here.
import { ProfileLanding } from "@/components/profile/ProfileLanding";
import SectionBoundary from "@/components/SectionBoundary";
import { ProfileTabPanels } from "./ProfileTabPanels";
import type { Profile, Tab } from "./types";
import { useProfileTabNav } from "./useProfileTabNav";
import { useProfileLandingScroller } from "./useProfileLandingScroller";
import { ProfileLoadingShell } from "./ProfileLoadingShell";
import { PAGE_COLUMN } from "@/lib/pageColumn";
import { isEarnedJob } from "@/components/profile/earningsTab/earningsTabHelpers";
import { queryKeys } from "@/lib/queryKeys";
import { fetchSmsConsent, smsConsentQueryKey } from "@/lib/smsConsentQuery";
const DeleteAccountDialog = lazy(() => import("@/components/profile/DeleteAccountDialog").then(m => ({ default: m.DeleteAccountDialog })));

const ProfilePage = () => {
  const navigate = useNavigate();
  const { user: cachedUser, profile: cachedProfile, isLoading: authLoading, refresh: refreshCurrentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const { tab, setTab, openFromSettings, backFromTab } = useProfileTabNav();
  // ONE SETTLED PAINT for the landing (Q169, Q?profile-declutter-shift). Board 18's activity tiles read the
  // section switches (useSectionTabs: "Coming soon" or not); painted before the answer, a tile changes under
  // the reader (prod precedent: a late Declutter row moved Settings 90px, CLS 0.0599). The skeleton holds until
  // all answer, at most ARRIVAL_CAP_MS, so Log out never hides.
  const declutterSwitch = useFeatureStatus("declutter");
  const shopsSwitch = useFeatureStatus("shops");
  const rentalsSwitch = useFeatureStatus("rentals");
  const landingReady = useArrivalGate(!loading, declutterSwitch.settled && shopsSwitch.settled && rentalsSwitch.settled);
  const showSkeleton = tab === "landing" ? !landingReady : loading;

  // Fall back to the id useAuthReady already holds. The local `user` state is
  // only populated once `authLoading` flips false — i.e. after the profiles +
  // user_roles round has landed — but every per-tab query below is keyed and
  // filtered on nothing more than the user id, which the restored session
  // carries from frame one. Reading `user?.id` alone therefore held all of
  // them back a full network round (~215ms measured RTT) for data they never
  // needed. They now issue in parallel with that round instead of after it.
  // The page skeleton still waits on `loading`, so nothing renders half-
  // populated; the requests are simply already in flight when it clears.
  const userId = user?.id ?? cachedUser?.id;
  // Q2706 (11-05): Notifications' largest paint waited on the text-alerts consent read, which the card only started
  // after the tab's chunks loaded. Start it here, as soon as the member and the tab are known; the card mounts with
  // its answer (src/lib/smsConsentQuery.ts, src/test/notificationsConsentReadStartsEarly.test.ts).
  useEffect(() => {
    if (tab !== "notifications" || !userId) return;
    void queryClient.prefetchQuery({ queryKey: smsConsentQueryKey(userId), queryFn: fetchSmsConsent });
  }, [tab, userId, queryClient]);

  const {
    statsQuery,
    reviewsQuery,
    earningsQuery,
    scheduleQuery,
    violationsQuery,
    completedCount,
    postedCount,
    avgRating,
    reviewCount,
    helperBadgeStats,
    reviews,
    earningsJobs,
    tips,
    schedulePostedJobs,
    scheduleAssignedJobs,
    violations,
  } = useProfileTabQueries(userId, tab);

  // Profile fields
  const [, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [parish, setParish] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  // Senior mode — local state shadows profile.senior_mode; applied to
  // <html> as a CSS class so all pages get the enlarged styles.
  const [seniorMode, setSeniorMode] = useState(false);
  const loadedFields = useRef<HydratedFields>(EMPTY_FIELDS);

  useEffect(() => {
    // Once auth loading is done, resolve the loading state
    if (authLoading) return;
    
    if (cachedUser) {
      setUser(cachedUser);
      if (cachedProfile) {
        setProfile(cachedProfile);
        setFullName(cachedProfile.full_name || "");
        // A late load or a refetch never wipes a field the member edited (profileFieldHydration.ts).
        const was = loadedFields.current, now = (loadedFields.current = hydratedFieldsOf(cachedProfile));
        setFirstName(unlessEdited(was.firstName, now.firstName)); setLastName(unlessEdited(was.lastName, now.lastName));
        setPhone(unlessEdited(was.phone, now.phone)); setLocation(unlessEdited(was.location, now.location));
        setZipCode(unlessEdited(was.zipCode, now.zipCode)); setParish(unlessEdited(was.parish, now.parish));
        setBio(unlessEdited(was.bio, now.bio)); setSkills(unlessEdited(was.skills, now.skills));
        setDateOfBirth(unlessEdited(was.dateOfBirth, now.dateOfBirth));
        setSeniorMode(!!(cachedProfile as unknown as { senior_mode?: boolean }).senior_mode);
      }
      setLoading(false);
      // Stats load via useProfileStats — enabled once `user` is set below.
    } else {
      // No user — stop loading (ProtectedRoute will redirect)
      setLoading(false);
    }
  }, [cachedUser, cachedProfile, authLoading]);

  // No separate auth listener needed — useCurrentUser handles it via React Query

  // Auto-lookup parish from zip (Louisiana sales tax)
  useEffect(() => {
    const cleaned = zipCode.replace(/\D/g, "");
    if (cleaned.length !== 5) return;
    let cancelled = false;
    lookupParishByZip(cleaned).then((p) => { if (!cancelled && p) setParish(p); });
    return () => { cancelled = true; };
  }, [zipCode]);

  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = useProfileLandingScroller({ showSkeleton, tab, userId, refreshCurrentUser, queryClient });

  const handleToggleSeniorMode = async (enabled: boolean) => {
    if (!user) return;
    // Optimistic update
    setSeniorMode(enabled);
    document.documentElement.classList.toggle("senior-mode", enabled);
    // Mirror to device storage so the merged boot path (lib/simpleMode)
    // applies the scale on first paint next launch — before the profile
    // row has loaded. Same one-mode merge as index.css (2026-08-24).
    setSimpleMode(enabled);
    // Persist to profile — graceful fallback for PGRST202 if migration
    // hasn't been applied yet (senior_mode column may not exist on prod yet).
    const { error } = await supabase
      .from("profiles")
      .update({ senior_mode: enabled })
      .eq("user_id", user.id);
    if (error) {
      // Roll back optimistic update only if it's not a missing-column error
      if (!error.message?.includes("senior_mode")) {
        setSeniorMode(!enabled);
        document.documentElement.classList.toggle("senior-mode", !enabled);
        toast.error("Couldn't save setting — try again.");
      }
      // Missing column = migration not yet pushed; keep UI state, don't toast.
    } else {
      // The session carries the flag too, so the account's NEXT new device
      // paints at the right size before its profile loads (Q200). Best-effort:
      // App.tsx re-mirrors it whenever the loaded profile disagrees, so the
      // cached profile must hold the new value FIRST: otherwise the
      // USER_UPDATED re-render sees the stale profile and writes the old
      // value straight back (Q200 review).
      await refreshCurrentUser(); // Q200: before the hint
      const { error: metaError } = await supabase.auth.updateUser({ data: { senior_mode: enabled } });
      if (metaError) console.warn("[senior-mode] session hint not saved", metaError.message);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireOnline()) return;
    if (!user) return;
    const merged = `${firstName.trim()} ${lastName.trim()}`.trim();
    // Contact details in a bio are REJECTED by the database (23514); the
    // field shows the same sentence inline, so block before the round-trip.
    const bioLeak = contactLeakFieldError(bio, "bio");
    if (bioLeak) { hapticError(); toast.error(bioLeak); return; }
    setSaving(true);
    // The values as submitted, so the success path can tell whether a field
    // was edited again while the request was in flight.
    const submitted = { phone, location, zipCode, bio, skills };
    let saved: Pick<Profile, "full_name" | "phone" | "location" | "bio" | "skills" | "date_of_birth" | "zip_code" | "parish">;
    try {
      const phoneResult = await savePhoneIfChanged(user.id, phone.trim(), profile?.phone ?? ""); // Q1586(a): never in the UPDATE
      if (phoneResult && !phoneResult.ok) { setSaving(false); hapticError(); toast.error(phoneResult.message); return; }
      // `.select(...)` + unwrapMutation: a null `error` is not a write; the row is the new baseline.
      [saved] = unwrapMutation(
        await supabase.from("profiles").update({
          full_name: merged, location: location.trim(), bio: bio.trim(), skills: skills.trim(),
          ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}), // never blank a saved birthday
          zip_code: zipCode.replace(/\D/g, "").slice(0, 5) || null,
          parish: parish,
        }).eq("user_id", user.id)
          .select("full_name, phone, location, bio, skills, date_of_birth, zip_code, parish"),
        { action: "save your profile", context: { userId: user.id } },
      );
    } catch (err) {
      setSaving(false);
      hapticError();
      toast.error(contactLeakRejectionMessage(err) ?? mutationErrorMessage(err, "We couldn't save your profile — please try again."));
      return;
    }
    setSaving(false);
    // MOVE THE BASELINE: ProfileEditForm's `dirty` compares against `profile`; a pre-save baseline brought
    // "Save Changes" back after "Saved" (+0.7s / +3.7s) and made an edit back to the old value unsaveable.
    setProfile((prev) => (prev ? { ...prev, ...saved } : prev));
    // The fields take the stored (trimmed / normalised) values too, or a
    // trailing space keeps them "dirty" against the new baseline — but only
    // where the field still holds what was submitted, so typing during the
    // round-trip is not overwritten.
    const keep = <T,>(sent: T, next: T) => (cur: T) => (cur === sent ? next : cur);
    setPhone(keep(submitted.phone, saved.phone ?? ""));
    setLocation(keep(submitted.location, saved.location ?? ""));
    setZipCode(keep(submitted.zipCode, saved.zip_code ?? ""));
    setBio(keep(submitted.bio, saved.bio ?? ""));
    setSkills(keep(submitted.skills, saved.skills ?? ""));
    setFullName(saved.full_name ?? merged);
    setJustSaved(true);
    hapticSuccess();
    setTimeout(() => setJustSaved(false), 1800);
  };

  const { requestCrop: requestAvatarCrop, dialog: avatarCropDialog } = useAvatarCrop();
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Reset so picking the same file again after a cancel still fires onChange.
    e.target.value = "";
    if (!picked || !user) return;
    // Let the member frame it first — the circle crops anything left to chance.
    const file = await requestAvatarCrop(picked);
    if (!file) return;

    // ── THIS IS THE "I UPLOADED THE WRONG THING" PATH ────────────────────
    //
    // The member who uploads a photo of their driver's licence by mistake,
    // notices, and comes back to swap in a selfie arrives HERE. So this call
    // has to actually retract the old object, not just add a new one beside
    // it — which is what it did until 2026-09-01: the key embedded the picked
    // file's own extension (`avatar.${file.name.split(".").pop()}`, so also
    // `avatar.undefined` for a file with no dot), a `.png` over a `.jpg` was a
    // second public object, and the licence stayed anonymously fetchable at
    // 200 forever. `replaceAvatarObject` derives the key from the CONTENT TYPE
    // and deletes every other `avatar.*` in the folder, verifying the delete
    // by re-listing. See `@/lib/avatarStorage`.
    //
    // Type + size are checked in there too, against the bucket's OWN limits,
    // rather than the looser `startsWith("image/")` this used (which accepted
    // image/heic and image/svg+xml — neither is in the bucket's
    // allowed_mime_types, so both failed at the server with an opaque message).
    //
    // The ROW is handed to `replaceAvatarObject`, not written after it: the
    // old object is deleted only once Postgres confirms the row names the new
    // one. This used to write the row LAST, with no `.select()`, so a failed
    // or zero-row update left `avatar_url` on the object the sweep had just
    // deleted — a broken photo on every screen that renders this member.
    setAvatarUploading(true);

    const userId = user.id;
    let uploaded = false;
    let replaced;
    try {
      assertUploadableAvatar(file);
      replaced = await replaceAvatarObject(supabase, userId, file, file.type, {
        write: async (publicUrl: string) => {
          uploaded = true;
          unwrapMutation(
            await supabase
              .from("profiles")
              .update({ avatar_url: publicUrl })
              .eq("user_id", userId)
              .select("id"),
            { action: "pin your new photo to your profile", context: { userId } },
          );
        },
        read: () => readProfileAvatarUrl(userId),
      });
    } catch (err) {
      toast.error(
        uploaded
          ? mutationErrorMessage(err, "Photo uploaded, but couldn't pin it to your profile. Try again?")
          : mutationErrorMessage(err, "Couldn't upload your photo — please try again."),
      );
      setAvatarUploading(false);
      return;
    }

    const avatarUrl = replaced.publicUrl;
    setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(userId) });

    // Q1001: the line above refreshes the dock's avatar. Below: the OLD photo survived the sweep and is still public, so say so.
    if (replaced.staleRemaining.length > 0) {
      toast.error(
        "Your new photo is saved, but we couldn't remove the previous one — it may still be visible. Please try changing your photo again.",
      );
    }
    setAvatarUploading(false);
  };

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  // The whole delete flow — dialog state, the "DELETE" → "DELETE MY ACCOUNT"
  // phrase mapping, the invoke, the sign-out — lives in `useDeleteAccount`,
  // because /account-banned now offers the same flow. A banned user cannot
  // reach this page at all (ProtectedRoute's ban gate runs on every
  // protected route), and Apple requires in-app deletion for them
  // too, so there had to be a second entry point. Two entry points sharing one
  // hook; NOT two copies of the handler. The last time this file carried its
  // own copy of a delete-path guard, it drifted from the edge function's and
  // broke deletion for 100% of users — see the hook's header.
  const deleteAccount = useDeleteAccount();

  if (showSkeleton) {
    return <ProfileLoadingShell tab={tab} backFromTab={backFromTab} />;
  }

  const displayName = profile?.full_name?.trim() || (user?.email ? user.email.split("@")[0] : "");
  const initials = (profile?.full_name?.trim() || user?.email || "?")
    .split(/[\s@.]/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  // Take-home math (budget − per-job platform fee + net urgent bonus, divided
  // across a group job's roster, mirroring the release-payout edge function)
  // lives in `helperEarnings.ts` so this page, /wrapped, /work-record and the
  // Earnings tab can never drift apart again. The tier rate is the LAST-RESORT
  // fee for legacy rows that recorded neither a stamped `platform_fee_amount`
  // nor a frozen `helper_fee_percent`.
  const helperFeeFallbackPct = tierFeePercent(
    profile?.subscription_tier ?? null,
    profile?.subscription_expires_at ?? null,
  );
  // `isEarnedJob`, not `status === "completed"` — the same definition
  // EarningsTab uses for the figure it prints. A completed job whose payment
  // was refunded to the poster or charged back stays `completed` forever, and
  // counting it here made this total disagree with the Earnings tab's about
  // the same helper. See src/components/profile/earningsTab/earningsTabHelpers.ts.
  // Q753: the one-time setup fee still due comes off once, as EarningsTab does.
  const totalEarnings = sumHelperTakeHomeDollars(earningsJobs.filter(isEarnedJob), helperFeeFallbackPct, firstPayoutFee);

  return (
    <>
    <AppShell
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page pt-safe-top"
    >
      {/* THE SAME CONTAINER STRING PageScaffold USES, character for character.
          Profile is the one main screen not built on PageScaffold, and it had
          drifted: its container carried an inline
          `calc(var(--safe-area-top) + 0.75rem)` while the wrapper INSIDE it
          added another `pt-3 lg:pt-5`. Two paddings where its four siblings
          have one, so the first card on Profile started at y=88 while Home,
          Posts, Jobs and Messages all started at y=76 — measured at 1440.

          The safe-area inset moves to the AppShell's `pt-safe-top`, which is
          exactly where PageScaffold puts it, so the inset is applied in ONE
          layer here too (owner: same spacing across Home / Posts / Jobs /
          Messages / Profile).

          `pt-3 lg:pt-5` is CONDITIONAL on the landing tab (owner, 2026-08-30:
          "spacing not correct" — the same double-padding bug the comment below
          already describes fixing once, recreated at a different layer). Every
          non-landing tab now renders through ProfileTabHeader → PageHeader,
          which owns its OWN `pt-4` above the title as part of the app-wide
          "equal air above and below" rule. Keeping this container's padding
          for those tabs stacked a second top gap in front of PageHeader's —
          measured 20px (this padding) + 16px (PageHeader) = 36px above the
          title against a clean 16px below it. The landing tab has no
          PageHeader of its own (ProfileLanding renders straight into this
          container), so it still needs this padding to match its
          PageScaffold siblings — hence the split rather than a flat removal.

          2026-09-20: THE SPLIT IS GONE, and with it the condition. The landing
          now renders its own `<PageHeader>` too (ProfileLanding.tsx — the
          owner's "align the landing title to x=72"), so all 26 Profile
          surfaces own their top gap through the one component that owns it
          everywhere else in the app, and this container contributes none. The
          landing-only `pt-3 lg:pt-5` would now be the second gap the note
          above describes removing — 20px here plus PageHeader's 16 — on the
          one screen it used to be correct for. */}
      <div className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "landing" ? (
          /* Landing scrolls inside a PullToRefreshWrapper so swiping
             down re-syncs the profile, Stripe status, stats + reviews. */
          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="w-full page-measure mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 pb-safe-nav"
          >
            <div className={`${PAGE_COLUMN} shrink-0 flex flex-col gap-3 lg:gap-4`}>
            <ProfileLanding
              profile={profile}
              userId={userId}
              displayName={displayName}
              initials={initials}
              avgRating={avgRating}
              reviewCount={reviewCount}
              postedCount={postedCount}
              completedCount={completedCount}
              helperBadgeStats={helperBadgeStats}
              onSelectTab={(key) => setTab(key as Tab)}
              onNavigate={navigate}
              /* Inline job lists now load via an enabled-gated query that
                 fires when the posted/completed tab opens, so the prior
                 imperative prefetch is a no-op. */
              onLoadInlineJobs={() => {}}
              onRequestDelete={deleteAccount.requestDelete}
              onRequestLogout={() => setShowLogoutDialog(true)}
              statsError={statsQuery.isError}
              onRetryStats={() => { statsQuery.refetch(); }}

            />
            </div>
          </PullToRefreshWrapper>
        ) : (
          /* Non-landing tabs — own inner scroll surface. The
             SectionBoundary keyed on `tab` isolates a render error in
             any one tab so it never red-screens the profile chrome
             (header, back button, tab list). The boundary is rebuilt
             every time the user switches tabs so the previous tab's
             error state is cleared automatically. */
          /* NO `pt-3 lg:pt-5` here. The container ABOVE this already carries
              `pt-3 lg:pt-5` — the same double-padding that was removed from the
              landing branch (see the container comment above: "Two paddings
              where its four siblings have one"). The landing branch's
              PullToRefreshWrapper was fixed; this one, which every non-landing
              TAB renders through, kept its own copy, so all 18 tabs paid the
              inset twice and their titles sat a full `pt-3` lower than
              everything else.

              Measured on the iOS simulator (2026-08-27), distance from the
              bottom of the safe area to the top of the title's ink, and from
              the bottom of the ink to the top of the first content card:

                screen                       above    below
                Profile Review (reference)   28.0pt   35.3pt
                Account Security tab         40.7pt   26.3pt   <- 12.7pt lower

              12.7pt measured against 12pt of duplicated padding. Removing the
              copy puts every tab title on the same line as Profile Review's and
              makes the gap above and below the title very nearly equal, which
              is what the owner asked for ("it needs to be the same height above
              and below"). */
          /* `mx-auto` is GONE and `w-full` is now an explicit bleed width.
              Both halves of that are one bug: `mx-auto` and `-mx-3` set the
              same property, `mx-auto` won, so the negative margin that was
              meant to cancel `px-3` never applied and every Profile tab shipped
              a naked +12px inset per side. (`.page-measure` centres itself in
              index.css, so `mx-auto` bought nothing even before that.) With the
              margins live, the box has to be 1.5rem wider than its parent or it
              only shifts left instead of widening. Measured at 375 on
              ?tab=availability: first card 311px at x=32 before, 335px at x=20
              after — i.e. identical to the PageScaffold pages (Dashboard's is
              335 at x=20). Same fix as AppPage.tsx (9e3f3ad7f), found by the
              shell-cards lane. */
          /* VN-37 was TRIED HERE AND REVERTED (2026-09-14). Do not try it again
              without reading this.

              The owner asked for "that small gap to the left and right of
              content" to be filled on the Profile tab pages. This wrapper
              bleeds 12px (`-mx-3`) to pay back the `px-3` it needs so that
              `overflow-y-auto` — which computes `overflow-x` to `auto` too —
              does not slice card shadows off flat, so its content box lands
              exactly on the container's content edge. The fix attempted was to
              bleed 24px at `xl` instead of 12, moving the cards 12px further
              out.

              Measured on prod at 1440 (frame 0->1192) before touching
              anything, and this is why it was reverted:

                /home ............. panel  48 -> 1144
                /posts .............. panel  48 -> 1144
                /messages .............. panel  48 -> 1144
                /profile?tab=reviews ... card   48 -> 1144

              Pixel-identical. The Profile tabs are not inset relative to
              anything — they are already flush with every PageScaffold
              sibling, which is the parity the 2026-09-11 commit deliberately
              established (see the note below it at 375). Bleeding here moved
              Profile alone to x=36 and split the shared fixed-shell family,
              since src/components/AppPage.tsx carries this wrapper string
              byte-for-byte.

              The gap the owner saw is the CONTAINER gutter, shared by Profile,
              AppPage, PageScaffold and the top bars. Owner, 2026-09-15 (VN-37,
              pop-up): shrink it from 48px to 24px at desktop — done app-wide as
              `px-5 lg:px-6 xl:px-6`, never one screen at a time. */
          <div className="page-measure w-[calc(100%+1.5rem)] h-full overflow-y-auto px-3 -mx-3 pb-safe-nav">
          <SectionBoundary key={tab} label={`the ${tab.replace(/_/g, " ")} section`}>
          {/* No entrance animation (owner, 2026-10-08: pages appear in
              place, like Messages; see PageScaffold). */}
          <div className={PAGE_COLUMN}>
          <ProfileTabPanels
            tab={tab}
            onBackFromTab={backFromTab}
            user={user}
            profile={profile}
            setProfile={setProfile}
            firstName={firstName}
            lastName={lastName}
            phone={phone}
            setPhone={setPhone}
            location={location}
            setLocation={setLocation}
            zipCode={zipCode}
            setZipCode={setZipCode}
            bio={bio}
            setBio={setBio}
            skills={skills}
            setSkills={setSkills}
            initials={initials}
            avatarUploading={avatarUploading}
            saving={saving}
            justSaved={justSaved}
            onSave={handleSave}
            onAvatarUpload={handleAvatarUpload}
            earningsQuery={earningsQuery}
            scheduleQuery={scheduleQuery}
            reviewsQuery={reviewsQuery}
            violationsQuery={violationsQuery}
            earningsJobs={earningsJobs}
            tips={tips}
            schedulePostedJobs={schedulePostedJobs}
            scheduleAssignedJobs={scheduleAssignedJobs}
            reviews={reviews}
            violations={violations}
            totalEarnings={totalEarnings}
            avgRating={avgRating}
            reviewCount={reviewCount}
            seniorMode={seniorMode}
            onToggleSeniorMode={handleToggleSeniorMode}
            onSelectTab={openFromSettings} onRequestLogout={() => setShowLogoutDialog(true)} onRequestDelete={deleteAccount.requestDelete}
          />
          </div>
          </SectionBoundary>
          </div>
        )}
      </div>
    </AppShell>

    {avatarCropDialog}

    <SignOutConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="Log out?"
        description="You can sign back in anytime — your account stays intact."
        label="Log out"
        after={() => navigate("/")}
      />

      {/* Mounted only once the user opens it — the dialog chunk (and its
          confirm-flow deps) is fetched on demand rather than with the route. */}
      {deleteAccount.isOpen && (
        <Suspense fallback={null}>
          <DeleteAccountDialog {...deleteAccount.dialogProps} />
        </Suspense>
      )}
    </>
  );
};

export default ProfilePage;
