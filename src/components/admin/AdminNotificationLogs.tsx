import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Search, Mail, Smartphone, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

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
  sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  suppressed: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  skipped: "bg-muted text-muted-foreground border-border",
};

const PAGE_SIZE = 50;

interface AdminNotificationLogsProps {
  initialSearch?: string;
}

const AdminNotificationLogs = ({ initialSearch = "" }: AdminNotificationLogsProps) => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [page, setPage] = useState(0);

  // Sync external initialSearch changes (e.g. when admin clicks "View History" again)
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("notification_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (category !== "all") q = q.eq("category", category);
    if (status !== "all") q = q.eq("status", status);
    if (channel !== "all") q = q.eq("channel", channel);

    const { data, error } = await q;
    if (!error) setRows((data as LogRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category, status, channel, page]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-notification-logs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_logs" }, () => {
        if (page === 0) load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-muted-foreground">
          Every alert sent via in-app or email. Failed deliveries are highlighted in red.
        </p>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {failureCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          <AlertCircle className="w-4 h-4" />
          {failureCount} failed deliver{failureCount === 1 ? "y" : "ies"} on this page
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email, subject, or user id"
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="suppressed">Suppressed</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="in_app">In-App</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-2xl border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
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
              {loading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center">
                  <Loader2 className="w-5 h-5 animate-spin inline-block text-muted-foreground" />
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No notification logs match your filters.
                </td></tr>
              )}
              {!loading && filtered.map((row) => (
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
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      {row.channel === "email"
                        ? <Mail className="w-3.5 h-3.5" />
                        : <Smartphone className="w-3.5 h-3.5" />}
                      {row.channel === "email" ? "Email" : "In-App"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {CATEGORY_LABEL[row.category] ?? row.category}
                  </td>
                  <td className="px-4 py-2.5 max-w-[200px] truncate">
                    {row.recipient_email || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 max-w-[280px] truncate">
                    <div className="truncate">{row.subject || <span className="text-muted-foreground">—</span>}</div>
                    {row.error_message && (
                      <div className="text-xs text-destructive truncate mt-0.5">{row.error_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className={cn("text-xs capitalize", STATUS_VARIANT[row.status] || "")}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page + 1} • Showing {filtered.length} of {rows.length} loaded
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminNotificationLogs;
