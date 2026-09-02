/**
 * AdminUserRow
 *
 * Single-row card rendered inside the VirtualList for the admin user
 * management screen. Extracted verbatim from AdminUsers.tsx —
 * behaviour-preserving structural refactor.
 */
import { memo } from "react";
import { formatName } from "@/lib/utils";
import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import {
  Star, ShieldAlert, Clock, MailIcon, ShieldCheck,
  Briefcase, MapPin, CreditCard, Flag,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  type Profile,
  isVerifiedEmail,
  isPendingReview,
  isAwaitingEmail,
  wasFlaggedByStripe,
  statusBadge,
} from "../adminUserHelpers";
import { NotesIndicator } from "./NotesIndicator";
import type { Tab } from "./useAdminUsersFilter";

interface NoteEntry {
  note: string;
  created_at: string;
  category: string;
}

interface AdminUserRowProps {
  p: Profile;
  tab: Tab;
  notesSummary: Record<string, { count: number; recent: NoteEntry[] }>;
  strikesSummary: Record<string, number>;
  ratingSummary: Record<string, { avg: number; count: number }>;
  jobsCompletedSummary: Record<string, number>;
  paySummary: Record<string, number>;
  openReportsSummary: Record<string, number>;
  lastLoginSummary: Record<string, string>;
  onOpen: (p: Profile) => void;
}

const AdminUserRowBase = ({
  p,
  tab,
  notesSummary,
  strikesSummary,
  ratingSummary,
  jobsCompletedSummary,
  paySummary,
  openReportsSummary,
  lastLoginSummary,
  onOpen,
}: AdminUserRowProps) => {
  const chip = (key: string, content: React.ReactNode, tone = "bg-secondary/40 text-muted-foreground") => (
    <span key={key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-ds-11 font-medium ${tone}`}>
      {content}
    </span>
  );

  const lastLogin = lastLoginSummary[p.user_id];
  const isOnline = lastLogin
    ? (Date.now() - new Date(lastLogin).getTime()) < 24 * 60 * 60 * 1000
    : false;

  return (
    <div
      className="rounded-ds-md liquid-glass p-3 cursor-pointer hover:bg-secondary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onOpen(p)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(p);
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="relative flex-shrink-0">
          {/* Migrated onto the shared `<UserAvatar>` (2026-08-31). This is a
              virtualized list, which is the case the shared component is
              specifically hardened for: rows are RECYCLED, so a per-row
              `avatarFailed` flag that never resets would keep every subsequent
              occupant of a slot on the monogram path. `<UserAvatar>` resets its
              verdict on `src` change for exactly that reason.

              What was here: a bare `<img>` with no error path, falling back to
              a flat `bg-secondary` circle carrying ONE character
              (`formatName(...)[0]`) only when `avatar_url` was null. Every
              blank-but-200 avatar on prod rendered as a flat coloured circle
              among hundreds of rows an admin scans to find one person. See
              `src/lib/avatarImage.ts`. */}
          <UserAvatar
            userId={p.user_id}
            src={p.avatar_url}
            name={p.full_name}
            pixelSize={40}
            aria-hidden
            className="w-10 h-10 border border-border"
            fallbackClassName="text-ds-11 ring-0"
          />
          {isOnline && (
            <span
              aria-label="Active in last 24h"
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-card"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-foreground text-ds-13 truncate">{formatName(p.full_name, "—")}</p>
            {statusBadge(p)}
            <NotesIndicator userId={p.user_id} notesSummary={notesSummary} />
          </div>
          {/* Wait-time countdown — shown for both pending review and awaiting-email-verification */}
          {(tab === "pending" || tab === "awaiting_email") && (isPendingReview(p) || isAwaitingEmail(p)) && (() => {
            const waitMs = Date.now() - new Date(p.created_at).getTime();
            const waitHours = waitMs / (1000 * 60 * 60);
            const waitDays = Math.floor(waitHours / 24);
            const remHours = Math.floor(waitHours % 24);
            const label = waitDays > 0
              ? `${waitDays}d ${remHours}h waiting`
              : `${Math.floor(waitHours)}h waiting`;
            const tone = waitHours >= 48
              ? "bg-destructive/15 text-destructive border-destructive/30"
              : waitHours >= 24
              ? "bg-accent/20 text-accent border-accent/30"
              : "bg-primary/10 text-primary border-primary/20";
            return (
              <Badge variant="outline" className={`mt-1 h-5 px-2 text-ds-10 font-semibold ${tone}`}>
                <Clock className="w-2.5 h-2.5 mr-1" />
                {label}
              </Badge>
            );
          })()}

          {/* Denial reason — surfaced prominently for denied users */}
          {p.approval_status === "denied" && (
            <p className="text-ds-11 font-medium text-destructive truncate mt-1" title={p.denial_reason || "No reason on file"}>
              Denied: {p.denial_reason || "No reason on file"}
            </p>
          )}

          {/* Meta chips — only for verified users */}
          {isVerifiedEmail(p) && p.approval_status !== "denied" && (() => {
            const strikes = strikesSummary[p.user_id] || 0;
            const rating = ratingSummary[p.user_id];
            const jobsDone = jobsCompletedSummary[p.user_id] || 0;
            const ltv = paySummary[p.user_id] || 0;
            const openReports = openReportsSummary[p.user_id] || 0;
            const isApproved = p.approval_status === "approved";
            const neverLoggedIn = isApproved && !lastLogin;
            const hasIdv = p.idv_status === "verified";
            const hasStripe = !!p.stripe_account_id;
            // Same legacy-role pattern as deniedCount above.
            const isHelper = (p as { role?: string }).role !== "customer";
            const parish = p.parish;

            return (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {/* Standing — only show when there's something to flag, OR when no recent login signal exists.
                    Avoids duplicating "Good" alongside the "active X ago" chip. */}
                {(strikes > 0 || !lastLogin) && chip(
                  "standing",
                  <>
                    <ShieldCheck className="w-3 h-3" />
                    {strikes === 0
                      ? "Good"
                      : strikes === 1
                        ? "1st Strike"
                        : strikes === 2
                          ? "Final Warning"
                          : "Banned"}
                  </>,
                  strikes === 0
                    ? "bg-primary/10 text-primary"
                    : strikes >= 3
                      ? "bg-destructive/15 text-destructive"
                      : strikes === 2
                        ? "bg-destructive/15 text-destructive"
                        : "bg-accent/20 text-accent"
                )}

                {/* Open reports/disputes — only show when present */}
                {openReports > 0 && chip(
                  "reports",
                  <>
                    <Flag className="w-3 h-3" />
                    {openReports} open
                  </>,
                  "bg-destructive/15 text-destructive"
                )}

                {/* Rating + count (helpers especially, but show for anyone with reviews) */}
                {rating && rating.count > 0 && chip(
                  "rating",
                  <>
                    <Star className="w-3 h-3 fill-current" />
                    {rating.avg.toFixed(1)} ({rating.count})
                  </>
                )}

                {/* Jobs completed */}
                {jobsDone > 0 && chip(
                  "jobs",
                  <>
                    <Briefcase className="w-3 h-3" />
                    {jobsDone} job{jobsDone !== 1 ? "s" : ""}
                  </>
                )}

                {/* Lifetime value (earned for helpers, spent for customers).
                    No DollarSign icon: every OTHER chip in this row pairs its
                    icon with a value that names its own unit ("12 jobs",
                    "3 open"), so the glyph is decoration there. Here the
                    value is a bare number and the icon was doing the "$"'s
                    job — rendering "$ 450", a gap through the middle of the
                    figure. A currency symbol is typography; it goes in the
                    text node with the digits. */}
                {ltv > 0 && chip(
                  "ltv",
                  <span className="tabular-nums">
                    ${ltv >= 1000 ? `${(ltv / 1000).toFixed(1)}k` : Math.round(ltv)}
                  </span>
                )}

                {/* Parish — moderation/location signal */}
                {parish && chip(
                  "parish",
                  <>
                    <MapPin className="w-3 h-3" />
                    {parish}
                  </>
                )}

                {/* Online / last seen */}
                {neverLoggedIn ? chip(
                  "online",
                  <>
                    <Clock className="w-3 h-3" />
                    Never logged in
                  </>,
                  "bg-destructive/15 text-destructive font-semibold"
                ) : lastLogin && chip(
                  "online",
                  <>
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(lastLogin), { addSuffix: true })}
                  </>
                )}

                {/* IDV verified — small icon-only chip for helpers */}
                {isHelper && hasIdv && chip(
                  "idv",
                  <>
                    <ShieldCheck className="w-3 h-3" />
                    ID
                  </>,
                  "bg-primary/10 text-primary"
                )}

                {/* Stripe connected — icon-only chip for helpers */}
                {isHelper && hasStripe && chip(
                  "stripe",
                  <>
                    <CreditCard className="w-3 h-3" />
                    Payout
                  </>,
                  "bg-primary/10 text-primary"
                )}

                {/* Follow-up reminder counter — shows how many nudge emails the system has sent */}
                {(() => {
                  const status = p.approval_status;
                  // eslint-disable-next-line no-useless-assignment
                  let count = 0;
                  // eslint-disable-next-line no-useless-assignment
                  let lastAt: string | null = null;
                  // eslint-disable-next-line no-useless-assignment
                  let label = "";
                  if (status === "pending" && !isVerifiedEmail(p)) {
                    count = p.verification_email_count || 0;
                    lastAt = p.last_verification_email_at;
                    label = "Verify";
                  } else if (status === "approved") {
                    // Hide if user is already actively logged in — no need to track welcome nudges
                    if (lastLogin) return null;
                    count = p.approval_email_count || 0;
                    lastAt = p.last_approval_email_at;
                    label = "Welcome";
                  } else if (status === "denied") {
                    count = p.denial_email_count || 0;
                    lastAt = p.last_denial_email_at;
                    label = "Denial";
                  } else {
                    return null;
                  }
                  if (count === 0) return null;
                  const tone = count >= 3
                    ? "bg-destructive/15 text-destructive font-semibold"
                    : count >= 2
                    ? "bg-accent/20 text-accent"
                    : "bg-secondary/40 text-muted-foreground";
                  return chip(
                    "reminders",
                    <>
                      <MailIcon className="w-3 h-3" />
                      {label} {count}/3
                      {lastAt && <span className="opacity-70">· {formatDistanceToNow(new Date(lastAt), { addSuffix: true })}</span>}
                    </>,
                    tone
                  );
                })()}
              </div>
            );
          })()}
        </div>
      </div>
      {p.approval_status === "pending" && isVerifiedEmail(p) && wasFlaggedByStripe(p) && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap items-center">
          <Badge variant="outline" className="h-7 px-2 flex items-center gap-1 text-ds-10 bg-accent/10 text-accent border-accent/30">
            <ShieldAlert className="w-3 h-3" />
            Flagged by Stripe
          </Badge>
        </div>
      )}
    </div>
  );
};

// Memoized: this row is rendered for every user in the virtualized admin
// list, so a parent re-render (filter typing, summary loads) would
// otherwise re-render every visible row. With a stable `onOpen` callback
// and per-row `p`, unchanged rows skip re-render.
export const AdminUserRow = memo(AdminUserRowBase);
AdminUserRow.displayName = "AdminUserRow";
