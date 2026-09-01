import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { channelNonce } from "@/lib/realtimeChannel";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Search, Mail, Smartphone, Bell, AlertCircle, Loader2, AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import { toneTextClasses } from "@/components/admin/tones";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";

interface LogRow {
  id: string;
  user_id: string;
  recipient_email: string | null;
  category: string;
  channel: string;
  status: string;
  subject: string | null;
  job_id: string | null;
  error_message: string | null;
  message_id: string | null;
  created_at: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  new_offers: "New Offers",
  transit_updates: "Transit",
  work_status: "Work Status",
  financial_alerts: "Financial",
  reviews: "Reviews",
  messages: "Messages",
  promotions: "Promotions",
  system: "System",
};

const STATUS_VARIANT: Record<string, string> = {
  sent: cn("bg-success/15 border-success/30", toneTextClasses.success),
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  suppressed: cn("bg-warning/15 border-warning/30", toneTextClasses.warning),
  skipped: "bg-muted text-muted-foreground border-border",
  // Push only. One row per device registration APNs/FCM rejected as
  // permanently dead (410 / BadDeviceToken / NOT_FOUND) and that
  // send-push-notification then DELETEd. It is not a delivery failure — the
  // send is over — it is a user quietly losing their push registration, which
  // is the single thing in this log most worth being able to see. Warning
  // colour, not destructive: something needs looking at, nothing is on fire.
  token_deleted: cn("bg-warning/15 border-warning/30", toneTextClasses.warning),
};

/**
 * Channel presentation.
 *
 * This screen used to be a two-way `channel === "email" ? Email : In-App`
 * ternary, written when `push` was a value the column could hold but that
 * nothing ever wrote — so every push row would have rendered, wrongly, as
 * "In-App". (Prod on 2026-09-01: 137 in_app, 53 email, 0 push, for the life of
 * the project. send-push-notification now writes the push rows; see
 * supabase/functions/_shared/notificationLog.ts.)
 *
 * The icons distinguish where the notification LANDED: an envelope for mail,
 * a phone for the one that lit up a lock screen, the app's own bell for the
 * one that only ever existed inside the app.
 */
const CHANNEL_META: Record<string, { label: string; Icon: typeof Mail }> = {
  email: { label: "Email", Icon: Mail },
  push: { label: "Push", Icon: Smartphone },
  in_app: { label: "In-App", Icon: Bell },
};

const channelMeta = (channel: string) =>
  CHANNEL_META[channel] ?? { label: channel, Icon: Bell };

const PAGE_SIZE = 50;

interface AdminNotificationLogsProps {
  initialSearch?: string;
}

/**
 * Loading, error and empty are THREE different things.
 *
 * Both the table and the mobile list folded all three into a single centred
 * <p>, so "still fetching", "the fetch failed" and "your filter matches
 * nothing" arrived in identical grey text — a failed load was
 * indistinguishable from an empty result, which is the one distinction an
 * operator staring at a log actually needs.
 *
 * Split out and given the shared EmptyState the other admin screens use, so a
 * genuine failure reads as a failure and carries its own icon.
 */
function LogsPlaceholder({
  isInitialLoading,
  isError,
}: {
  isInitialLoading: boolean;
  isError: boolean;
}) {
  if (isInitialLoading) {
    return (
      <EmptyState
        variant="inline"
        icon={Loader2}
        title="Loading notification logs"
        body="Fetching the most recent sends."
      />
    );
  }
  if (isError) {
    return (
      <EmptyState
        variant="inline"
        icon={AlertTriangle}
        title="We couldn't load logs"
        body="The fetch failed — use the retry button above."
      />
    );
  }
  return (
    <EmptyState
      variant="inline"
      icon={Inbox}
      title="No logs match your filters"
      body="Nothing has been sent that fits the current selection."
    />
  );
}

const AdminNotificationLogs = ({ initialSearch = "" }: AdminNotificationLogsProps) => {
  const qc = useQueryClient();
  const { user } = useAuthReady();
  const adminId = user?.id;
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [page, setPage] = useState(0);

  // Sync external initialSearch changes (e.g. when admin clicks "View History" again)
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  // Admin-scoped + filter-scoped. Includes adminId so cached logs from one
  // admin don't surface to another on the same device (or to a non-admin
  // who logs in after — the persister has 24h maxAge). Belt + suspenders:
  // also marked `meta: { persist: false }` below so notification-log
  // recipient emails never land in IDB.
  const queryKey = queryKeys.admin.notificationLogs(adminId, { category, status, channel, page });

  const { data: rows, isFetching, isInitialLoading, isError, refetch } = useInstantQuery<LogRow[]>({
    key: queryKey,
    fallback: [],
    enabled: !!adminId,
    meta: { persist: false },
    fetcher: async () => {
      let q = supabase
        .from("notification_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (category !== "all") q = q.eq("category", category);
      if (status !== "all") q = q.eq("status", status);
      if (channel !== "all") q = q.eq("channel", channel);

      // unwrap() surfaces a failed select as isError so the page shows a
      // recoverable retry instead of silently rendering an empty table.
      return (unwrap(await q) as LogRow[]) ?? [];
    },
  });

  useEffect(() => {
    // Deliberately unfiltered (admin-only): unlike user-facing channels — which
    // MUST carry a user-scoped server-side `filter` per the realtime rule — this
    // is the admin notification-log viewer, whose whole purpose is to reflect
    // EVERY notification the platform sends. Scoping it to one user would defeat
    // the feature. The `channelNonce()` still gives it a unique channel name so
    // Supabase doesn't dedupe it against another admin channel, and the
    // `page === 0` guard keeps the invalidation burst sane.
    const ch = supabase
      .channel(`admin-notification-logs-${channelNonce()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_logs" }, () => {
        // Prefix invalidate — matches every (adminId, filters) variant
        // currently cached for this admin's session.
        if (page === 0) qc.invalidateQueries({ queryKey: queryKeys.admin.notificationLogsAll });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [page, qc]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      (r.recipient_email ?? "").toLowerCase().includes(s) ||
      (r.subject ?? "").toLowerCase().includes(s) ||
      (r.user_id ?? "").toLowerCase().includes(s)
    );
  }, [rows, search]);

  const failureCount = rows.filter(r => r.status === "failed").length;

  return (
    <AdminViewShell>
      {/* The lead sentence, Refresh, the failure banner, four filter controls
          and the table were six stacked blocks on the bare page. They are one
          thing — a delivery log and the controls that scope it — so they are
          one card: subtitle, header action, then filters over content. */}
      <AdminCard
        title="Delivery Log"
        subtitle="Every alert sent via in-app or email. Failed deliveries are red."
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
        contentClassName="space-y-4"
      >
      {failureCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-ds-md bg-destructive/10 border border-destructive/30 text-destructive text-ds-13">
          <AlertCircle className="w-4 h-4" />
          {failureCount} failed deliver{failureCount === 1 ? "y" : "ies"} on this page
        </div>
      )}

      {isError && (
        // Page-level fetch failure — the filter form stays usable above so
        // an admin can adjust filters and retry, but the table itself is
        // replaced by a recoverable retry surface.
        <ErrorState
          variant="inline"
          title="We couldn't load notification logs."
          body="Tap Try again. Delivery records are safe — this is just a fetch hiccup."
          onRetry={() => refetch()}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            aria-label="Search notifications"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email, subject, or user id"
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Category filter"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Status filter"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="suppressed">Suppressed</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              {/* Push-only: a device registration APNs/FCM rejected as dead and
                  we deleted. Filterable on its own because "who quietly lost
                  push?" is a question worth asking directly. */}
              <SelectItem value="token_deleted">Token deleted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger aria-label="Channel filter"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="in_app">In-App</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="push">Push</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-ds-md border border-border/60 overflow-hidden bg-background/40">
        {/* Desktop table — hidden on small screens */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-ds-13">
            <thead className="bg-muted/40 text-ds-11 uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">When</th>
                <th className="text-left px-4 py-2.5 font-semibold">Channel</th>
                <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                <th className="text-left px-4 py-2.5 font-semibold">Recipient</th>
                <th className="text-left px-4 py-2.5 font-semibold">Subject</th>
                <th className="text-left px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6">
                  <LogsPlaceholder isInitialLoading={isInitialLoading} isError={isError} />
                </td></tr>
              )}
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-border hover:bg-muted/30 transition-colors",
                    row.status === "failed" && "bg-destructive/5 hover:bg-destructive/10"
                  )}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const { label, Icon } = channelMeta(row.channel);
                      return (
                        <span className="inline-flex items-center gap-1.5 text-ds-11">
                          <Icon className="w-3.5 h-3.5" />
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-ds-11">
                    {CATEGORY_LABEL[row.category] ?? row.category}
                  </td>
                  <td className="px-4 py-2.5 max-w-[200px] truncate">
                    {row.recipient_email || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 max-w-[280px] truncate">
                    <div className="truncate">{row.subject || <span className="text-muted-foreground">—</span>}</div>
                    {row.error_message && (
                      <div className="text-ds-11 text-destructive truncate mt-0.5">{row.error_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className={cn("text-ds-11 capitalize", STATUS_VARIANT[row.status] || "")}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile stacked cards — shown below md breakpoint */}
        <div className="md:hidden">
          {filtered.length === 0 ? (
            <div className="px-4 py-6">
              <LogsPlaceholder isInitialLoading={isInitialLoading} isError={isError} />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "px-4 py-3 space-y-2",
                    row.status === "failed" && "bg-destructive/5"
                  )}
                >
                  {/* Top row: status badge + channel + timestamp */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn("text-ds-11 capitalize", STATUS_VARIANT[row.status] || "")}>
                        {row.status}
                      </Badge>
                      {(() => {
                        const { label, Icon } = channelMeta(row.channel);
                        return (
                          <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
                            <Icon className="w-3.5 h-3.5" />
                            {label}
                          </span>
                        );
                      })()}
                    </div>
                    <span className="text-ds-11 text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {/* Recipient + category */}
                  <div className="flex items-center justify-between gap-2 text-ds-13">
                    <span className="truncate text-foreground">
                      {row.recipient_email || <span className="text-muted-foreground italic">No recipient</span>}
                    </span>
                    <span className="text-ds-11 text-muted-foreground flex-shrink-0">
                      {CATEGORY_LABEL[row.category] ?? row.category}
                    </span>
                  </div>
                  {/* Subject */}
                  {row.subject && (
                    <p className="text-ds-11 text-muted-foreground truncate">{row.subject}</p>
                  )}
                  {/* Error */}
                  {row.error_message && (
                    <p className="text-ds-11 text-destructive truncate">{row.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pager wraps rather than crushing the count against the buttons at
          375, and uses the same "·" separator the rest of the app does. */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-ds-13">
        <span className="text-muted-foreground">
          Page {page + 1} · Showing {filtered.length} of {rows.length} loaded
        </span>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage(p => Math.max(0, p - 1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={rows.length < PAGE_SIZE || isFetching} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      </div>
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminNotificationLogs;
