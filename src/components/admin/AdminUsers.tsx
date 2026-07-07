import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

// UUID v4-ish pattern. Loose enough to accept any 8-4-4-4-12 hex group;
// strict enough that a plain email won't false-match.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AdminUsers = () => {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");

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
      toast.error("Couldn't load users — refresh to retry");
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
  const [searchParams, setSearchParams] = useSearchParams();
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
    <div className="space-y-3">
      <div className="flex gap-0.5 bg-secondary/50 rounded-ds-sm p-0.5 w-full">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-0 px-1 py-1.5 rounded-md text-ds-10 sm:text-ds-13 font-medium transition-colors flex items-center justify-center gap-0.5 ${
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="truncate">{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="text-[9px] sm:text-ds-10 bg-destructive/10 text-destructive px-1 py-0.5 rounded-full flex-shrink-0">{t.count}</span>
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

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="search"
          aria-label="Search users by name, email, phone, or job UUID"
          placeholder="Name, email, phone, or paste a job UUID…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 text-ds-13 flex-1"
        />
        <Select value={sortDir} onValueChange={(v) => setSortDir(v as typeof sortDir)}>
          <SelectTrigger className="h-9 text-ds-13 sm:w-[220px]">
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
      </div>

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
            Open job
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
            Clear search
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground text-center py-8">No users in this category.</p>
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
    </div>
  );
};

export default AdminUsers;
