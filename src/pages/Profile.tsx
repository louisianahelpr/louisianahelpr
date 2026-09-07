import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { assertUploadableAvatar, replaceAvatarObject } from "@/lib/avatarStorage";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import { setSimpleMode } from "@/lib/simpleMode";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import type { User } from "@supabase/supabase-js";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { stripeConnectStatusKey } from "@/hooks/useStripeConnectStatus";
import { sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { lookupParishByZip } from "@/lib/parishLookup";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { splitName } from "@/lib/splitName";
import { requireOnline } from "@/lib/requireOnline";
import {
  useProfileStats,
  useProfileReviews,
  useProfileEarnings,
  useProfileSchedule,
  useProfileViolations,
} from "@/hooks/useProfileTabData";

// Only the landing tab + its lightweight header are needed on first paint.
// Every other tab panel and the rarely-opened dialogs are code-split so the
// Profile route chunk stays small — each is fetched the first time it shows.
// The full non-landing tab router (and its lazy panel imports) lives in the
// co-located <ProfileTabPanels />; only the landing hero + delete dialog are
// referenced directly here.
import { ProfileLanding } from "@/components/profile/ProfileLanding";
import SectionBoundary from "@/components/SectionBoundary";
import { ProfileTabPanels } from "./profile/ProfileTabPanels";
import { TAB_TITLES, resolveTab, type Profile, type Tab } from "./profile/types";
import { hasInAppHistory } from "@/lib/inAppHistory";
import { isEarnedJob } from "@/components/profile/earningsTab/earningsTabHelpers";
const DeleteAccountDialog = lazy(() => import("@/components/profile/DeleteAccountDialog").then(m => ({ default: m.DeleteAccountDialog })));

/**
 * Profile-landing scroll offsets, keyed by history entry.
 *
 * MEASURED ON DEVICE, not assumed. An on-screen probe reported
 * `shell=NONE ref=1009 win=0` while the list was scrolled: `.app-shell-scroll`
 * does not exist on /profile (AppShell is `scrollable={false}` here), the
 * PullToRefreshWrapper below IS the scroller, and window.scrollY is always 0.
 * That is why the global ScrollToTop — which resolves its scroller via
 * `document.querySelector(".app-shell-scroll")` and otherwise falls back to the
 * window — recorded 0 for every profile entry and had nothing to restore.
 *
 * An earlier attempt keyed on `location.key` and still failed, because back was
 * a PUSH at the time (seven sub-pages passed `onBack={() => navigate("/profile")}`)
 * and a push mints a NEW key, so the saved offset was never looked up. That was
 * fixed for the seven real sub-ROUTES (PageHeader `backTo`) — but it was never
 * true for the seventeen in-page TABS, which is the round trip the owner
 * actually reported: "if you're scrolled on the profile tab and you click a
 * profile tab then press back, it brings you all the way back up to the top."
 *
 * Those tabs are not navigations. `setTab` is component state, mirrored into
 * `?tab=` by a `setSearchParams(..., { replace: true })` effect — and a replace
 * still mints a BRAND NEW `location.key`; it replaces the entry, key and all.
 * So one trip into a tab and back burned three distinct keys, the landing
 * looked up the third, and the offset saved under the first was unreachable.
 * Measured at 375px: scroll to 400 → open Notifications → back → scrollTop 0.
 *
 * Keyed on the PATHNAME instead, which is what this always wanted. There is one
 * Profile landing and one scroll position for it; `key` was only ever standing
 * in for "this page", and it was a stand-in that changed underneath us every
 * time the tab param moved.
 */
const profileScrollByKey = new Map<string, number>();

const ProfilePage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: cachedUser, profile: cachedProfile, isLoading: authLoading, refresh: refreshCurrentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const initialTab = resolveTab(searchParams.get("tab"));
  const [tab, setTab] = useState<Tab>(initialTab);

  /**
   * Back out of a tab — to the Profile landing when that is where you came
   * from, and otherwise to wherever you actually came from.
   *
   * The seventeen tabs all hardcoded `setTab("landing")`, so back from
   * Earnings dropped you on the Profile landing whether you had tapped the
   * Earnings row a second earlier or followed a payout notification straight
   * to `/profile?tab=earnings`. In the second case that is the wrong screen
   * AND an extra press, and it made Profile the only sub-surface in the app
   * whose back button ignored history — `/work-record`, `/benefits` and
   * `/pets` all return you to the previous page from the same starting point.
   *
   * `cameFromLanding` is the whole distinction: true once the landing has been
   * rendered in this visit, which is exactly the case where "up" and "back"
   * are the same screen. Deep-linked straight into a tab, we go back a real
   * history entry instead, falling back to the landing when there is no
   * in-app history to go back to (a cold open on the deep link) — the same
   * has-history test `BackButton` already uses.
   */
  const cameFromLanding = useRef(initialTab === "landing");
  useEffect(() => {
    if (tab === "landing") cameFromLanding.current = true;
  }, [tab]);
  const backFromTab = useCallback(() => {
    if (cameFromLanding.current) {
      setTab("landing");
      return;
    }
    if (hasInAppHistory()) navigate(-1);
    else setTab("landing");
  }, [navigate]);

  // One title per tab. Every one of the 18 tabs used to report the same
  // "My Profile — Helpr", so browser history, bookmarks and the tab bar could
  // not tell Security from Payment from Legal. `?tab=` is already the URL
  // source of truth (synced both ways below), so the title follows it.
  // TAB_TITLES has no `landing` key — the bare profile page keeps the plain
  // title rather than repeating itself.
  usePageTitle(
    tab === "landing" || !TAB_TITLES[tab]
      ? "My Profile — Helpr"
      : `${TAB_TITLES[tab]} — My Profile — Helpr`,
  );

  // Sync tab to URL for bookmarkability; React Router owns history so browser
  // back/forward updates searchParams, which the effect below mirrors to state.
  //
  // Opening a tab PUSHES a history entry. It used to replace, so entering a
  // tab added nothing to history and Back skipped the Profile landing
  // entirely: /dashboard -> Profile -> Account Security -> Back landed on
  // /dashboard, with history.length never incrementing. On iOS the swipe-back
  // gesture did the same, which is the one users reach for constantly.
  //
  // Returning to the landing still REPLACES, so Back doesn't walk you through
  // every tab you happened to visit — one Back from a tab lands on the
  // landing, a second leaves Profile.
  useEffect(() => {
    const current = resolveTab(searchParams.get("tab"));
    if (current === tab) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "landing") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: tab === "landing" },
    );
  }, [tab]);

  // Mirror URL → state when back/forward (or a deep link) changes the tab param.
  useEffect(() => {
    const urlTab = resolveTab(searchParams.get("tab"));
    setTab((prev) => (prev === urlTab ? prev : urlTab));
  }, [searchParams]);

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

  // Per-tab data — each section is its own `enabled`-gated React Query keyed
  // under ["profile", userId, <section>], so switching away from a tab and
  // back hits the cache, in-flight requests dedupe, and the prior
  // loading/loaded flag pairs are gone. Each section still surfaces failures
  // through its own inline <ProfileSectionError /> (driven by `.isError`)
  // rather than a page-level banner — so one section failing never blanks
  // the core profile (name, avatar) that loaded fine.
  const statsQuery = useProfileStats(userId);
  // Reviews feed the reviews tab only — the landing's 2-review hero
  // preview was removed, so fetching on the landing bought nothing.
  const reviewsQuery = useProfileReviews(userId, tab === "reviews");
  // Also enabled on the landing tab so the header earnings-sparkline
  // teaser has its (cheap jobs+tips) data without a second query. The
  // result is cached, so opening the Earnings tab next is instant.
  const earningsQuery = useProfileEarnings(
    userId,
    tab === "earnings" || tab === "payment" || tab === "landing",
  );
  // Schedule data drives the merged Schedule + Availability tab — gate
  // on either sub-view so the calendar grid is hot the moment the user
  // flips the internal toggle from Hours → Calendar.
  // Availability is its own tab again and renders no job list, so it no
  // longer needs the schedule fetch — only the calendar tab does.
  const scheduleQuery = useProfileSchedule(userId, tab === "schedule");
  const violationsQuery = useProfileViolations(userId, tab === "warnings");

  const completedCount = statsQuery.data?.completedCount ?? 0;
  const postedCount = statsQuery.data?.postedCount ?? 0;
  const avgRating = statsQuery.data?.avgRating ?? null;
  const reviewCount = statsQuery.data?.reviewCount ?? 0;

  const reviews = reviewsQuery.data ?? [];
  const earningsJobs = earningsQuery.data?.jobs ?? [];
  const tips = earningsQuery.data?.tips ?? [];
  const schedulePostedJobs = scheduleQuery.data?.posted ?? [];
  const scheduleAssignedJobs = scheduleQuery.data?.assigned ?? [];
  const violations = violationsQuery.data ?? [];

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
  const [idUploading, setIdUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  // Senior mode — local state shadows profile.senior_mode; applied to
  // <html> as a CSS class so all pages get the enlarged styles.
  const [seniorMode, setSeniorMode] = useState(false);

  useEffect(() => {
    // Once auth loading is done, resolve the loading state
    if (authLoading) return;
    
    if (cachedUser) {
      setUser(cachedUser);
      if (cachedProfile) {
        setProfile(cachedProfile);
        setFullName(cachedProfile.full_name || "");
        const { firstName: _firstName, lastName: _lastName } = splitName(cachedProfile.full_name);
        setFirstName(_firstName);
        setLastName(_lastName);
        setPhone(cachedProfile.phone || "");
        setLocation(cachedProfile.location || "");
        setZipCode(cachedProfile.zip_code || "");
        setParish(cachedProfile.parish || null);
        setBio(cachedProfile.bio || "");
        setSkills(cachedProfile.skills || "");
        setDateOfBirth(cachedProfile.date_of_birth || "");
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

  // Pull-to-refresh for the Profile landing — re-syncs the profile,
  // Stripe-connect status, helper stats, and review preview. Scoped to
  // the landing's scroll surface via PullToRefreshWrapper below.
  // Invalidating the stats/reviews queries deliberately re-fetches them
  // (the prior `{ force: true }` semantics) while reusing the cache for
  // everything else.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await refreshCurrentUser();
      if (userId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profile", userId, "stats"] }),
          queryClient.invalidateQueries({ queryKey: ["profile", userId, "reviews"] }),
          // The comment above has always claimed pull-to-refresh re-syncs the
          // Stripe-connect status; until this line it did not — the old effect
          // was guarded on `!stripeConnectStatus`, so once it had any answer
          // (including a failed one) nothing could re-ask.
          queryClient.invalidateQueries({ queryKey: stripeConnectStatusKey(userId) }),
        ]);
      }
    },
  });

  // Preserve the landing list's scroll position across a round trip into any
  // profile sub-page. See profileScrollByKey above for why the global handler
  // cannot do this for /profile.
  const routeLocation = useLocation();
  // Pathname, not `key` — see profileScrollByKey above.
  const routeKey = routeLocation.pathname;
  useEffect(() => {
    // `loading` is in the deps deliberately. Profile early-returns a SKELETON
    // while loading, so PullToRefreshWrapper — and therefore containerRef — does
    // not exist on first mount. Without this dep the effect bailed on the null
    // ref and never re-ran when the real list appeared, so the scroll listener
    // was never attached and nothing was ever saved. That is what defeated the
    // previous attempt at this fix, verified on device.
    if (loading || tab !== "landing") return;
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const target = profileScrollByKey.get(routeKey) ?? 0;
    if (target > 0) {
      // Rows depend on async data, so the list's full height does not exist for
      // several frames; assigning scrollTop once clamps to the short content.
      let frames = 0;
      const apply = () => {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(target, Math.max(0, max));
        if (max < target && ++frames < 40) raf = requestAnimationFrame(apply);
      };
      apply();
    }

    const onScroll = () => { profileScrollByKey.set(routeKey, el.scrollTop); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [loading, tab, routeKey, containerRef]);

  // Stripe payout status is fetched by `useStripeConnectStatus()` inside
  // <ProfileLanding />, not here — it used to be a `useState` + `useEffect`
  // pair on this page that could not start until `profile` had been set, and
  // that re-asked Stripe on every single mount. What stays here is the other
  // half of caching it: the two moments the answer can actually have changed.
  //
  // Leaving the Payment tab is one of them — that is where the user finishes
  // (or repairs) payout onboarding, so the landing's cached "no payout
  // account" verdict is exactly what would otherwise go on lying to them.
  // Invalidating an unmounted query is fine: it marks the key stale and the
  // refetch happens when the landing next mounts.
  const prevTabRef = useRef<Tab>(tab);
  useEffect(() => {
    const leftPaymentTab = prevTabRef.current === "payment" && tab !== "payment";
    prevTabRef.current = tab;
    if (leftPaymentTab && userId) {
      queryClient.invalidateQueries({ queryKey: stripeConnectStatusKey(userId) });
    }
  }, [tab, userId, queryClient]);

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
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireOnline()) return;
    if (!user) return;
    const merged = `${firstName.trim()} ${lastName.trim()}`.trim();
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      full_name: merged, phone: phone.trim(), location: location.trim(),
      bio: bio.trim(), skills: skills.trim(),
      date_of_birth: dateOfBirth || null,
      zip_code: zipCode.replace(/\D/g, "").slice(0, 5) || null,
      parish: parish,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) { hapticError(); toast.error("We couldn't save your profile — please try again."); }
    else {
      setFullName(merged);
      setJustSaved(true);
      hapticSuccess();
      setTimeout(() => setJustSaved(false), 1800);
    }
  };

  const handleIdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("That file is over 5 MB — try a smaller one."); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("That file type isn't supported — use JPG, PNG, WEBP, or PDF."); return; }
    setIdUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/id-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("id-documents").upload(path, file, { upsert: true });
    if (upErr) { toast.error("Couldn't upload your ID — " + upErr.message); setIdUploading(false); return; }
    // .select("user_id"): the file is in storage already — this is the write
    // that puts it in the verification queue. A zero-row update returns
    // error === null, and the card would show "pending" for an ID no reviewer
    // would ever see.
    let saved = true;
    try {
      unwrapMutation(
        await supabase.from("profiles").update({ id_document_url: path, idv_status: "pending" }).eq("user_id", user.id).select("user_id"),
        {
          action: "submit your ID for verification",
          rejectedMessage: "Got your ID, but it couldn't be submitted for verification — please try again.",
          context: { userId: user.id },
        },
      );
    } catch (updErr) {
      saved = false;
      toast.error(mutationErrorMessage(updErr, "Got your ID, but couldn't save it to your profile. Try again?"));
    }
    if (saved) {
      setProfile(prev => prev ? ({ ...prev, id_document_url: path, idv_status: "pending" }) : prev);
    }
    setIdUploading(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

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
    setAvatarUploading(true);

    let replaced;
    try {
      assertUploadableAvatar(file);
      replaced = await replaceAvatarObject(supabase, user.id, file, file.type);
    } catch (err) {
      toast.error(mutationErrorMessage(err, "Couldn't upload your photo — please try again."));
      setAvatarUploading(false);
      return;
    }

    const avatarUrl = replaced.publicUrl;

    // The new photo is live but the OLD one survived the sweep, so it is still
    // being served publicly. Say so — this is the case where staying quiet
    // means telling someone their document is gone when it is not.
    if (replaced.staleRemaining.length > 0) {
      toast.error(
        "Your new photo is saved, but we couldn't remove the previous one — it may still be visible. Please try changing your photo again.",
      );
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("user_id", user.id);

    if (updateError) {
      toast.error("Photo uploaded, but couldn't pin it to your profile. Try again?");
    } else {
      setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
    }
    setAvatarUploading(false);
  };

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const handleLogout = async () => { await signOutWithPushCleanup(); navigate("/"); };

  // The whole delete flow — dialog state, the "DELETE" → "DELETE MY ACCOUNT"
  // phrase mapping, the invoke, the sign-out — lives in `useDeleteAccount`,
  // because /account-banned now offers the same flow. A banned user cannot
  // reach this page at all (ProtectedRoute's ban gate runs before its
  // `allowUnapproved` branch), and Apple requires in-app deletion for them
  // too, so there had to be a second entry point. Two entry points sharing one
  // hook; NOT two copies of the handler. The last time this file carried its
  // own copy of a delete-path guard, it drifted from the edge function's and
  // broke deletion for 100% of users — see the hook's header.
  const deleteAccount = useDeleteAccount();

  if (loading) {
    // Loading state mirrors the loaded state's shell so there's no
    // header jump when the skeleton resolves. Uses AppShell + the same
    // DashboardHeader (which carries `.glass-header` → safe-area-top
    // inset) so the HelprMark never overlaps the iOS status bar clock.
    return (
      <AppShell
        scrollable={false}
        contentClassName="overflow-hidden"
        className="bg-premium-page pt-safe-top"
      >
        <div className="container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-4 flex-1 min-h-0 overflow-y-auto">
          <div className="page-measure mx-auto">
            <ProfilePageSkeleton />
          </div>
        </div>
      </AppShell>
    );
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
  const totalEarnings = sumHelperTakeHomeDollars(
    earningsJobs.filter(isEarnedJob),
    helperFeeFallbackPct,
  );

// The last-6-weeks sparkline series was computed here for the header
  // teaser that the owner removed on 2026-08-27; nothing consumes it now.

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
          PageScaffold siblings — hence the split rather than a flat removal. */}
      <div className={`container mx-auto px-5 lg:px-8 xl:px-12 ${tab === "landing" ? "pt-3 lg:pt-5" : ""} pb-0 flex-1 min-h-0 flex flex-col overflow-hidden`}>
        {tab === "landing" ? (
          /* Landing scrolls inside a PullToRefreshWrapper so swiping
             down re-syncs the profile, Stripe status, stats + reviews. */
          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="w-full page-measure mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]"
          >
            <ProfileLanding
              profile={profile}
              userId={userId}
              displayName={displayName}
              initials={initials}
              avgRating={avgRating}
              reviewCount={reviewCount}
              postedCount={postedCount}
              completedCount={completedCount}
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
          <div className="w-full page-measure mx-auto h-full overflow-y-auto px-3 -mx-3 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]">
          <SectionBoundary key={tab} label={`the ${tab.replace(/_/g, " ")} section`}>
          {/* `key={tab}` on the boundary re-mounts this wrapper on every
              tab switch, so `animate-ds-page-in` replays its entrance each
              time a panel opens (S18 polish). */}
          <div className="animate-ds-page-in">
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
            idUploading={idUploading}
            saving={saving}
            justSaved={justSaved}
            onSave={handleSave}
            onAvatarUpload={handleAvatarUpload}
            onIdUpload={handleIdUpload}
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
          />
          </div>
          </SectionBoundary>
          </div>
        )}
      </div>
    </AppShell>

    <BrandConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="Log Out?"
        description="You can sign back in anytime — your account stays intact."
        primaryLabel="Log Out"
        primaryTone="bark"
        primaryHaptic="medium"
        onPrimary={handleLogout}
        secondaryLabel="Cancel"
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
