import { logAdminAction } from "@/lib/adminAudit";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { formatShortDate } from "@/lib/format";
import { AlertTriangle, CheckCircle2, Clock, User, Briefcase, MessageSquare, ExternalLink, Send, Search } from "lucide-react";
import { toast } from "sonner";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import { report } from "@/lib/errorLogger";

type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reported_type: string;
  reason: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  reporter_name?: string;
  reported_name?: string;
  /** False when the actor has no `profiles` row — messaging them is a no-op. */
  reporter_exists?: boolean;
  reported_exists?: boolean;
  assigned_to_name?: string;
};

// Triage states. The DB CHECK (added in migration 20260609160000) allows
// new/investigating/resolved/dismissed alongside the legacy
// pending/reviewed values. We surface 'new' as the default replacement
// for 'pending' but tolerate both so the queue keeps working between
// merge and the manual `supabase db push`.
// Exported for future consumers (analytics, reports drilldowns).
export type TriageState = "new" | "investigating" | "resolved" | "dismissed";

const SLA_BREACH_HOURS = 24;

const AdminReports = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Triage filter — `pending` is the legacy default and we treat it as
  // "new + investigating" so the queue keeps showing everything an
  // admin would expect under the old default.
  const [filter, setFilter] = useState<"pending" | "investigating" | "resolved" | "dismissed" | "all">("pending");
  const [updating, setUpdating] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<{ userId: string; name: string } | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const queryKey = ["admin-reports", filter];
  const { data: reports, isInitialLoading } = useInstantQuery<Report[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      // For the pending queue, oldest-first surfaces SLA-breaching items at
      // the top (they need triage soonest). For resolved/all, newest-first
      // matches the rest of admin views.
      const ascending = filter === "pending" || filter === "investigating";
      let query = (supabase.from as any)("reports")
        .select("*")
        .neq("reported_type", "support")
        .order("created_at", { ascending });
      if (filter === "pending") query = query.in("status", ["pending", "new"]);
      if (filter === "investigating") query = query.eq("status", "investigating");
      if (filter === "resolved") query = query.eq("status", "resolved");
      if (filter === "dismissed") query = query.eq("status", "dismissed");

      const { data, error } = await query;
      if (error) {
        toast.error("Couldn't load reports — refresh to retry");
        return [];
      }

      const reportRows = (data || []) as Report[];
      const userIds = [
        ...new Set(reportRows.flatMap(r => [r.reporter_id, r.reported_id, r.assigned_to].filter(Boolean) as string[])),
      ];
      if (userIds.length > 0) {
      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", userIds);
      if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminReports.hydrateNames" } });
        const nameMap = new Map((profiles || []).map(p => [p.user_id, formatName(p.full_name, "Unknown")]));

        // "Unknown" used to cover two very different situations, and an admin
        // could not tell them apart on the card:
        //
        //   the lookup FAILED  — the name exists, we just could not read it
        //   the user IS GONE   — there is no such row to read
        //
        // Only `assigned_to` has a foreign key (ON DELETE SET NULL);
        // `reporter_id` and `reported_id` have none, so a report survives the
        // deletion of the person it names and keeps pointing at a dead id.
        // Prod has one: report b9a558e0 names a `reported_id` that is absent
        // from BOTH `profiles` and `auth.users`.
        //
        // So: if the read errored, every miss is "unavailable" — we genuinely
        // do not know. If it succeeded, a miss means the row is not there.
        const nameFor = (id: string) =>
          nameMap.get(id) ?? (profilesError ? "Name unavailable" : "Deleted user");

        return reportRows.map(r => ({
          ...r,
          reporter_name: nameFor(r.reporter_id),
          reported_name: nameFor(r.reported_id),
          // Deleted actors cannot receive a message — the notification would
          // be written against a user_id with nothing behind it.
          reporter_exists: nameMap.has(r.reporter_id),
          reported_exists: nameMap.has(r.reported_id),
          assigned_to_name: r.assigned_to ? nameMap.get(r.assigned_to) : undefined,
        }));
      }
      return reportRows;
    },
  });

  const loadReports = () => qc.invalidateQueries({ queryKey });

  const assignToSelf = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUpdating(id);
    // assigned_to lives in a recent migration; cast through any so this
    // works against generated types that may not include the column yet.
    const { error } = await (supabase.from as any)("reports")
      .update({ assigned_to: user.id, status: "investigating" })
      .eq("id", id);
    if (error) {
      // 42703 = undefined column → migration hasn't been applied yet.
      // Fall back to status-only so the queue keeps working.
      if (error.code === "42703") {
        const { error: fallbackErr } = await supabase.from("reports")
          .update({ status: "investigating" as any })
          .eq("id", id);
        if (fallbackErr) toast.error(fallbackErr.message);
        else toast.success("Marked as investigating (assignment column not yet deployed)");
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Assigned to you — set to Investigating");
    }
    // `void supabase.from(...).insert(...)` never sent this: PostgrestBuilder
    // issues its fetch inside then(), so `void` evaluates the builder and
    // discards it without ever calling then(). Trust & Safety had no audit
    // trail at all. logAdminAction awaits and reports failures.
    await logAdminAction("report_assigned_self", "report", id);
    loadReports();
    setUpdating(null);
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("reports").update({ status }).eq("id", id);
    if (error) {
      toast.error(error.message);
      setUpdating(null);
      return;
    }
    // Audit trail for the status change. Best-effort — don't fail the
    // resolution if the audit insert errors (admin already saw success).
    if (user) {
      const report = reports?.find(r => r.id === id);
      const ageHours = report ? Math.round((Date.now() - new Date(report.created_at).getTime()) / 3600_000) : null;
      // Same dead-`void` bug as the assign path above.
      await logAdminAction(
        status === "resolved" ? "report_resolved" : "report_dismissed",
        "report",
        id,
        {
          report_id: id,
          new_status: status,
          age_hours_at_resolution: ageHours,
          sla_breached: ageHours !== null && ageHours > SLA_BREACH_HOURS,
        },
      );
    }
    toast.success(`Report marked as ${status}`);
    loadReports();
    setUpdating(null);
  };

  // SLA: trust & safety reports must be triaged within 24h. Visual
  // indicator at >24h (yellow) and >48h (red) so the queue self-prioritizes.
  const slaInfo = (createdAt: string) => {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const hours = ageMs / 3600_000;
    // Past a couple of days, hours stop being a quantity anyone can read:
    // the queue was rendering "1431h overdue", which is ~60 days. Hours stay
    // for the range where they are still actionable.
    const overdue = (h: number) =>
      h >= 48 ? `${Math.floor(h / 24)}d overdue` : `${Math.floor(h)}h overdue`;
    if (hours > SLA_BREACH_HOURS * 2) return { label: overdue(hours), tone: "red" as const };
    if (hours > SLA_BREACH_HOURS) return { label: overdue(hours), tone: "yellow" as const };
    const hoursLeft = Math.max(0, SLA_BREACH_HOURS - hours);
    return { label: `${Math.ceil(hoursLeft)}h to SLA`, tone: "green" as const };
  };

  const handleSendMessage = async () => {
    if (!messageTarget || !messageText.trim()) return;
    setSendingMessage(true);
    try {
      await createNotification({
        user_id: messageTarget.userId,
        title: "📩 Message from Admin",
        message: messageText.trim(),
        type: "info",
        link: "/profile",
      });
      toast.success(`Message sent to ${messageTarget.name}`);
      setMessageTarget(null);
      setMessageText("");
    } catch {
      toast.error("Couldn't send that message — try again");
    }
    setSendingMessage(false);
  };

  const typeIcon = (type: string) => {
    if (type === "user") return <User className="w-4 h-4" />;
    if (type === "job") return <Briefcase className="w-4 h-4" />;
    if (type === "review") return <Clock className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(["pending", "investigating", "resolved", "dismissed", "all"] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f === "pending" && <Clock className="w-3.5 h-3.5 mr-1" />}
            {f === "investigating" && <Search className="w-3.5 h-3.5 mr-1" />}
            {f === "resolved" && <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
            {f === "dismissed" && <CheckCircle2 className="w-3.5 h-3.5 mr-1 opacity-60" />}
            {f === "pending" ? "New" : f}
          </Button>
        ))}
      </div>

      {isInitialLoading ? (
        <p className="text-muted-foreground text-ds-11 py-8 text-center">Loading reports…</p>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-ds-13">No {filter !== "all" ? filter : ""} reports found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => (
            <div key={report.id} className="rounded-ds-md liquid-glass p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {typeIcon(report.reported_type)}
                  <div>
                    <p className="text-ds-13 font-semibold text-foreground">
                      <button
                        onClick={() => navigate(`/user/${report.reported_id}`)}
                        className="hover:text-primary underline-offset-2 hover:underline transition-colors"
                      >
                        {report.reported_name}
                      </button>
                      <span className="text-muted-foreground font-normal"> — {report.reason}</span>
                    </p>
                    <p className="text-ds-11 text-muted-foreground">
                      Reported by{" "}
                      <button
                        onClick={() => navigate(`/user/${report.reporter_id}`)}
                        className="hover:text-primary underline-offset-2 hover:underline transition-colors"
                      >
                        {report.reporter_name}
                      </button>
                      {" · "}{formatShortDate(report.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {/* Calm "sienna" accent badge, not destructive: a new/pending
                      report isn't a danger/delete action — the mauve destructive
                      color is reserved for genuinely destructive controls. */}
                  <Badge variant="sienna">
                    {report.status === "pending" ? "new" : report.status}
                  </Badge>
                  {report.assigned_to_name && (
                    <Badge variant="outline" className="text-ds-10 gap-0.5">
                      <User className="w-2.5 h-2.5" /> {report.assigned_to_name.split(" ")[0]}
                    </Badge>
                  )}
                  {(report.status === "pending" || report.status === "new" || report.status === "investigating") && (() => {
                    const sla = slaInfo(report.created_at);
                    const slaTone: Tone =
                      sla.tone === "red" ? "danger" :
                      sla.tone === "yellow" ? "notice" :
                      "success";
                    return (
                      <span className={cn("text-ds-10 font-medium px-2 py-0.5 rounded-full", toneBadgeClasses[slaTone])}>
                        {sla.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {report.description && (
                <p className="text-ds-11 text-muted-foreground bg-muted/50 rounded-ds-sm p-3">{report.description}</p>
              )}

              {/* One line, not two: 7 action buttons kept on a single row —
                  fits without scroll on wide admin screens, scrolls horizontally
                  rather than wrapping to a second line on narrow ones. */}
              <div className="flex flex-nowrap gap-2 pt-1 overflow-x-auto [&>button]:shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/user/${report.reported_id}`)}
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" /> View Profile
                </Button>
                {(report.status === "pending" || report.status === "new" || report.status === "investigating") && (
                  <>
                    {!report.assigned_to && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => assignToSelf(report.id)}
                        disabled={updating === report.id}
                      >
                        <User className="w-3.5 h-3.5 mr-1" /> Assign to Me
                      </Button>
                    )}
                    {report.status !== "investigating" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(report.id, "investigating")}
                        disabled={updating === report.id}
                      >
                        <Search className="w-3.5 h-3.5 mr-1" /> Investigating
                      </Button>
                    )}
                    {/* Disabled for a deleted actor: createNotification would
                        write a row against a user_id with nothing behind it,
                        so the admin would get a success toast for a message
                        nobody can ever receive. */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={report.reported_exists === false}
                      title={report.reported_exists === false ? "This account no longer exists" : undefined}
                      onClick={() => { setMessageTarget({ userId: report.reported_id, name: report.reported_name || "User" }); setMessageText(""); }}
                    >
                      <Send className="w-3.5 h-3.5 mr-1" /> Message {report.reported_exists === false ? "Reported" : (report.reported_name?.split(" ")[0] || "Reported")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={report.reporter_exists === false}
                      title={report.reporter_exists === false ? "This account no longer exists" : undefined}
                      onClick={() => { setMessageTarget({ userId: report.reporter_id, name: report.reporter_name || "User" }); setMessageText(""); }}
                    >
                      <Send className="w-3.5 h-3.5 mr-1" /> Message {report.reporter_exists === false ? "Reporter" : (report.reporter_name?.split(" ")[0] || "Reporter")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => updateStatus(report.id, "resolved")}
                      disabled={updating === report.id}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatus(report.id, "dismissed")}
                      disabled={updating === report.id}
                    >
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Message Dialog */}
      <Dialog open={!!messageTarget} onOpenChange={(open) => { if (!open) setMessageTarget(null); }}>
        <DialogContent>
          <DialogHero
            eyebrow={
              <>
                <Send className="w-3.5 h-3.5" /> Message
              </>
            }
            eyebrowClassName="inline-flex items-center gap-1.5"
            title={`Message ${messageTarget?.name}`}
          />
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              This will send an in-app notification to {messageTarget?.name}.
            </p>
            <Textarea
              aria-label="Message to user"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMessageTarget(null)}>Cancel</Button>
            <Button onClick={handleSendMessage} disabled={sendingMessage || !messageText.trim()}>
              {sendingMessage ? "Sending…" : "Send Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminReports;
