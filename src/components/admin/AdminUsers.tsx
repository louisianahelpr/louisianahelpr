import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { safeStorage } from "@/lib/safeStorage";
import { VirtualList } from "@/components/VirtualList";
import { AutoRestrictedRail } from "./AutoRestrictedRail";
import { DenyUserDialog } from "./DenyUserDialog";
import { BanDialog } from "./BanDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { EditEmailDialog } from "./EditEmailDialog";
import { ManualVerifyDialog } from "./ManualVerifyDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ReuploadIdDialog } from "./ReuploadIdDialog";
import { FormalWarningDialog } from "./FormalWarningDialog";
import { AdminUserDetailDialog } from "./AdminUserDetailDialog";
import { type Profile } from "./adminUserHelpers";
import { useAdminUserSummaries } from "./useAdminUserSummaries";
import { makeOpenProfile } from "./adminusers/useOpenProfile";
import { makeAdminUserActions } from "./adminusers/useAdminUserActions";
import { filterAndSortProfiles, getTabCounts, type Tab, type SortDir } from "./adminusers/useAdminUsersFilter";
import { AdminUserRow } from "./adminusers/AdminUserRow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard } from "./AdminViewShell";

// UUID v4-ish pattern. Loose enough to accept any 8-4-4-4-12 hex group;
// strict enough that a plain email won't false-match.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AdminUsers = () => {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL owns which tab is showing, matching Admin.tsx's rule for ?view=
  // ("The URL is the source of truth for the current view"). As local state
  // this survived nothing: a refresh dropped you back on Pending, browser-Back
  // stepped out of Users entirely instead of back a tab, and a filtered list
  // could not be linked to anyone. `tab` is re-derived from searchParams every
  // render, so back/forward and deep links all resolve through one path.
  const TABS: Tab[] = ["pending", "awaiting_email", "approved", "denied", "banned", "all"];
  const rawTab = searchParams.get("tab");
  const tab: Tab = (TABS as string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "pending";
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    // "pending" is the default, so it stays out of the URL rather than
    // decorating every link with the value it would have had anyway.
    if (next === "pending") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  // Auto-restricted rail moved to its own component (AutoRestrictedRail).
  // Owns its own data fetch + reverse handler. Parent only forwards the
  // "Review" callback so the existing profile detail dialog can open.

  // Profile detail view
  const [viewProfile, setViewProfile] = useState<Profile | null>(null);
  const [profileReviews, setProfileReviews] = useState<{ rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string }[]>([]);
  const [profileReviewsLeft, setProfileReviewsLeft] = useState<{ rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[]>([]);
  const [profileViolations, setProfileViolations] = useState<any[]>([]);
  const [, setProfileBans] = useState<any[]>([]);
  const [idDocSignedUrl, setIdDocSignedUrl] = useState<string | null>(null);
  const [emailTracking, setEmailTracking] = useState<{ event_type: string; email_type: string; created_at: string }[]>([]);
  const [emailSendStats, setEmailSendStats] = useState<{ template_name: string; count: number; last_sent: string }[]>([]);
  // Jobs history (worked as helper + posted as customer) — the Jobs-tab
  // filter/sort state lives inside AdminUserDetailDialog now.
  const [profileJobs, setProfileJobs] = useState<any[]>([]);

  // Deny dialog — moved into DenyUserDialog component. Parent only
  // tracks "which profile is being denied right now"; the dialog
  // owns reason + saving state internally.
  const [denyProfile, setDenyProfile] = useState<Profile | null>(null);

  // Ban dialog — moved into BanDialog component. Parent only tracks
  // which profile is targeted; dialog owns type/reason/duration/saving.
  const [banProfile, setBanProfile] = useState<Profile | null>(null);

  // Edit email dialog
  // Edit email dialog — moved into EditEmailDialog component.
  const [editEmailProfile, setEditEmailProfile] = useState<Profile | null>(null);

  // Delete denied account
  // Delete dialog — moved into DeleteUserDialog component.
  const [deleteProfile, setDeleteProfile] = useState<Profile | null>(null);

  // Per-action dialog targets — each dialog owns its own form state +
  // edge-fn invocation + saving flag internally now (ReuploadIdDialog,
  // FormalWarningDialog, ManualVerifyDialog, ResetPasswordDialog). The
  // parent only tracks "which profile is the dialog targeting."
  const [reuploadProfile, setReuploadProfile] = useState<Profile | null>(null);
  const [warningProfile, setWarningProfile] = useState<Profile | null>(null);
  const [manualVerifyProfile, setManualVerifyProfile] = useState<Profile | null>(null);
  const [resetPwProfile, setResetPwProfile] = useState<Profile | null>(null);

  // Per-user supplemental data (ratings, strikes, pay, activity, notes,
  // open reports) — owned by the useAdminUserSummaries hook.
  const {
    notesSummary,
    strikesSummary,
    lastLoginSummary,
    paySummary,
    ratingSummary,
    jobsCompletedSummary,
    openReportsSummary,
    loadSummaries,
  } = useAdminUserSummaries();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("alpha");

  // UUID drill — when the admin pastes a job UUID into the search box,
  // jump to the Jobs admin view with that job pre-opened. We don't auto-
  // navigate on first keystroke; the admin clicks the surfaced banner.
  const trimmedQuery = searchQuery.trim();
  const isUuid = UUID_RE.test(trimmedQuery);

  // Track which user IDs the admin has already seen (per tab category) — persisted in storage
  const SEEN_KEY = "admin_seen_user_ids_v1";
  const [seenUserIds, setSeenUserIds] = useState<Set<string>>(() => {
    try {
      const raw = safeStorage.getItem(SEEN_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const markUsersSeen = (ids: string[]) => {
    if (!ids.length) return;
    setSeenUserIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (changed) {
        try {
          safeStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(next)));
        } catch {}
      }
      return next;
    });
  };

  const loadProfiles = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[AdminUsers] loadProfiles:", error);
      toast.error("Couldn't load users — refresh to retry.");
    } else if (data) {
      setProfiles(data);
      // Load supplemental data in parallel (non-blocking). `profiles` (the
      // prior render's state) is passed for loadActivitySummary's
      // failed-ID detection — matching the previous closure behaviour.
      loadSummaries(data.map((p) => p.user_id), profiles);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  // Build openProfile from the extracted factory. Memoized so the
  // reference stays stable across renders — the memoized AdminUserRow
  // relies on a stable `onOpen` to skip re-rendering unchanged rows.
  // All deps are useState setters, so this only ever runs once.
  const openProfile = useMemo(
    () =>
      makeOpenProfile({
        setViewProfile,
        setIdDocSignedUrl,
        setEmailTracking,
        setEmailSendStats,
        setProfileJobs,
        setProfileReviews,
        setProfileReviewsLeft,
        setProfileViolations,
        setProfileBans,
      }),
    [],
  );

  // Deep-link from admin notifications: /admin?view=people&user=<id>.
  // Once profiles are loaded, find the user and open their detail dialog
  // automatically. Strip the ?user= param afterwards so navigating back
  // doesn't re-open the dialog every time.
  useEffect(() => {
    const userIdParam = searchParams.get("user");
    if (!userIdParam || profiles.length === 0) return;
    const target = profiles.find((p) => p.user_id === userIdParam);
    if (target) {
      openProfile(target);
      const next = new URLSearchParams(searchParams);
      next.delete("user");
      setSearchParams(next, { replace: true });
    }
  }, [profiles, searchParams]);

  const [resending, setResending] = useState<string | null>(null);

  // Action callbacks — extracted into makeAdminUserActions
  const { approveUser, resendApprovalEmail, resendDenialEmail, resendVerificationEmail, unbanUser } =
    makeAdminUserActions({ loadProfiles, setViewProfile, resending, setResending });

  const viewHistoryFor = (profile: Profile) => {
    // Notify the Admin page to switch to notification logs filtered for this user
    window.dispatchEvent(new CustomEvent("admin:view-user-history", {
      detail: { userId: profile.user_id, email: profile.email },
    }));
    setViewProfile(null);
  };

  // Filter + sort — extracted into filterAndSortProfiles
  const filtered = filterAndSortProfiles({
    profiles,
    tab,
    searchQuery,
    sortDir,
    strikesSummary,
    lastLoginSummary,
    paySummary,
  });

  const isUnseen = (p: Profile) => !seenUserIds.has(p.user_id);

  // When the admin views a tab, mark the users they're seeing as "seen" so the
  // notification badge clears after a short dwell. Runs on tab change + new data.
  useEffect(() => {
    if (loading || filtered.length === 0) return;
    const ids = filtered.map((p) => p.user_id);
    const t = setTimeout(() => markUsersSeen(ids), 800);
    return () => clearTimeout(t);

  }, [tab, profiles.length, loading]);

  // Tab counts — extracted into getTabCounts
  const { pendingCount, awaitingEmailCount, bannedCount, approvedCount, deniedCount, allCount } =
    getTabCounts(profiles, isUnseen);

  if (loading) return <p className="text-muted-foreground">Loading users…</p>;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "awaiting_email", label: "Email", count: awaitingEmailCount },
    { key: "approved", label: "Active", count: approvedCount },
    { key: "banned", label: "Banned", count: bannedCount },
    { key: "denied", label: "Denied", count: deniedCount },
    { key: "all", label: "All", count: allCount },
  ];

  const tabCountLabel: Record<Tab, string> = {
    pending: "pending",
    awaiting_email: "pending email verification",
    approved: "active",
    banned: "banned",
    denied: "denied",
    all: "total",
  };

  return (
    <AdminViewShell>
      {/* Scrolls rather than dividing the width six ways. With `flex-1` each
          tab got ~1/6 of 402pt and had to share that with a count badge, so
          "Active" rendered as "Acti…" — a filter that will not say what it
          filters. Same overflow treatment as the app's other chip rows. */}
      {/* `w-fit max-w-full`, not `w-full`. The tinted track is the SHAPE OF THE
          CONTROL, so painting it edge-to-edge left six small tabs huddled at
          the left of a wide grey band with nothing in the rest of it — the
          track stopped reading as a segmented control and started reading as a
          slab the page had failed to fill. It still scrolls when the six tabs
          genuinely exceed the width. */}
      {/* Segmented control = a real tablist, and it has to say so. These six
          chips choose which population the list below shows, but they shipped
          as bare <button>s: a screen reader announced "Pending, button" with
          no group, no set size, and — the part that actually costs someone —
          no indication of WHICH one is currently showing, because the active
          state was carried only by background colour. `aria-selected` is the
          non-visual half of that highlight. Matches the tablist AdminPayoutBatches
          already ships, so the two segmented controls in admin now behave the
          same for assistive tech as they do visually. */}
      <div
        role="tablist"
        aria-label="Filter users by status"
        className="flex gap-0.5 bg-secondary/50 rounded-ds-sm p-0.5 w-fit max-w-full overflow-x-auto scrollbar-none [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            /* `relative` is load-bearing, not decoration. The count badge below
               carries an `sr-only` span, and `sr-only` is `position:absolute`.
               With no positioned ancestor between it and the page, its
               containing block resolved ABOVE this strip's `overflow-x-auto`,
               so it escaped the clip and contributed its static x-offset
               (~397px) to the DOCUMENT's scrollable overflow — the whole
               /admin?view=people page scrolled 77px sideways at 320 and 22px at
               375, failing CLAUDE.md's zero-horizontal-overflow rule. Making
               the button the containing block keeps the sr-only box inside the
               scroller, where it is clipped like everything else. */
            className={`relative shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-md text-ds-10 sm:text-ds-13 font-medium transition-colors flex items-center justify-center gap-1 ${
              tab === t.key ? "btn-grad-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              /* The bare number read as loose digits after the label ("Active
                 22"). Naming it makes the count a fact instead of noise, and
                 hiding the visual twin stops it being announced twice. It says
                 "users" rather than anything like "needing attention": these
                 counts are per-tab populations (All is every user, Active is
                 every approved one), not a work queue. */
              /* Neutral, NOT destructive. These are populations — "Active 27",
                 "All 28" — and the comment above already says so, yet they
                 shipped in the alarm colour, so a healthy user base rendered as
                 six red warnings and the one colour that means "something is
                 wrong" in this console (open reports, strikes, disputed jobs)
                 also meant "how many rows are in this tab". One alarm colour,
                 one meaning per view. */
              <span className="text-ds-9 sm:text-ds-10 bg-muted text-muted-foreground px-1 py-0.5 rounded-full flex-shrink-0">
                <span aria-hidden="true">{t.count}</span>
                <span className="sr-only">{`${t.count} ${t.count === 1 ? "user" : "users"}`}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Recently auto-restricted rail — extracted into its own component.
          Hides itself when empty; reverse + review handlers live there. */}
      <AutoRestrictedRail
        onReview={(userId) => {
          const p = profiles.find((pr) => pr.user_id === userId);
          if (p) openProfile(p);
        }}
        onChange={() => loadProfiles()}
      />

      {/* Search — panelled as the view's filter block, so the page reads
          header → filters → list like every other admin view. */}
      <AdminCard title="Find a User" contentClassName="flex flex-col sm:flex-row gap-2">
        {/* A magnifier and a placeholder. It had neither — just an aria-label —
            so it rendered as a bare empty pill with no indication of what it
            searched or that it was a search field at all. */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" aria-hidden />
          <Input
            type="search"
            aria-label="Search users by name, email, phone, or job UUID"
            placeholder="Search name, email, phone or job ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 text-ds-13 w-full pl-9"
          />
        </div>
        <Select value={sortDir} onValueChange={(v) => setSortDir(v as typeof sortDir)}>
          <SelectTrigger aria-label="Sort by" className="h-9 text-ds-13 sm:w-[220px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Most Recent</SelectItem>
            <SelectItem value="asc">Longest Inactive</SelectItem>
            <SelectItem value="alpha">Alphabetical (A–Z)</SelectItem>
            <SelectItem value="joined_new">Joined: Newest First</SelectItem>
            <SelectItem value="joined_old">Joined: Oldest First</SelectItem>
            <SelectItem value="never_logged_in">Never Logged In First</SelectItem>
            <SelectItem value="pay_high">Pay: High → Low</SelectItem>
            <SelectItem value="pay_low">Pay: Low → High</SelectItem>
            {tab === "approved" && (
              <>
                <SelectItem value="standing_worst">Standing: Worst First</SelectItem>
                <SelectItem value="standing_best">Standing: Best First</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </AdminCard>

      {isUuid && (
        <div className="rounded-ds-md border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ds-13 font-semibold text-foreground">Looks like a job UUID</p>
            <p className="text-ds-11 text-muted-foreground truncate font-mono">{trimmedQuery}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md bg-primary text-primary-foreground text-ds-11 font-semibold px-3 h-8 hover:bg-primary/90 transition-colors"
            onClick={() => {
              setSearchQuery("");
              navigate(`/admin?view=jobs&job=${trimmedQuery}`);
            }}
          >
            Open Job
          </button>
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <p className="text-ds-11 text-muted-foreground">
          {filtered.length} {tabCountLabel[tab]} {filtered.length === 1 ? "user" : "users"}
        </p>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-ds-11 text-primary hover:underline"
          >
            Clear Search
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={Users}
          title="No users here"
          body={`Nothing is ${tabCountLabel[tab]} right now. Try another tab above.`}
        />
      ) : (
        <VirtualList
          items={filtered}
          getKey={(p) => p.id}
          estimateSize={100}
          overscan={8}
          className="space-y-2"
          renderItem={(p) => (
            <AdminUserRow
              p={p}
              tab={tab}
              notesSummary={notesSummary}
              strikesSummary={strikesSummary}
              ratingSummary={ratingSummary}
              jobsCompletedSummary={jobsCompletedSummary}
              paySummary={paySummary}
              openReportsSummary={openReportsSummary}
              lastLoginSummary={lastLoginSummary}
              onOpen={openProfile}
            />
          )}
        />
      )}


      {/* Profile Detail Dialog (extracted to AdminUserDetailDialog) */}
      <AdminUserDetailDialog
        viewProfile={viewProfile}
        setViewProfile={setViewProfile}
        profileReviews={profileReviews}
        profileReviewsLeft={profileReviewsLeft}
        profileViolations={profileViolations}
        profileJobs={profileJobs}
        idDocSignedUrl={idDocSignedUrl}
        emailTracking={emailTracking}
        emailSendStats={emailSendStats}
        lastLoginSummary={lastLoginSummary}
        resending={resending}
        loadProfiles={loadProfiles}
        approveUser={approveUser}
        resendApprovalEmail={resendApprovalEmail}
        resendDenialEmail={resendDenialEmail}
        resendVerificationEmail={resendVerificationEmail}
        unbanUser={unbanUser}
        viewHistoryFor={viewHistoryFor}
        setEditEmailProfile={setEditEmailProfile}
        setDenyProfile={setDenyProfile}
        setBanProfile={setBanProfile}
        setDeleteProfile={setDeleteProfile}
        setManualVerifyProfile={setManualVerifyProfile}
        setWarningProfile={setWarningProfile}
        setResetPwProfile={setResetPwProfile}
      />

      {/* Deny Reason Dialog */}
      <DenyUserDialog
        profile={denyProfile}
        onClose={() => setDenyProfile(null)}
        onSuccess={() => {
          loadProfiles();
          setViewProfile(null);
        }}
      />

      {/* Ban / Warning Dialog */}
      <BanDialog
        profile={banProfile}
        onClose={() => setBanProfile(null)}
        onSuccess={() => {
          loadProfiles();
          setViewProfile(null);
        }}
      />

      {/* Edit Email + Delete dialogs — extracted into their own components. */}
      <EditEmailDialog
        profile={editEmailProfile}
        onClose={() => setEditEmailProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />
      <DeleteUserDialog
        profile={deleteProfile}
        onClose={() => setDeleteProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* Manually Verify — extracted into ManualVerifyDialog. */}
      <ManualVerifyDialog
        profile={manualVerifyProfile}
        onClose={() => setManualVerifyProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* ID Re-upload — extracted into ReuploadIdDialog. */}
      <ReuploadIdDialog
        profile={reuploadProfile}
        onClose={() => setReuploadProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* Reset Password — extracted into ResetPasswordDialog. */}
      <ResetPasswordDialog
        profile={resetPwProfile}
        onClose={() => setResetPwProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* Formal Warning — extracted into FormalWarningDialog. */}
      <FormalWarningDialog
        profile={warningProfile}
        onClose={() => setWarningProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />
    </AdminViewShell>
  );
};

export default AdminUsers;
