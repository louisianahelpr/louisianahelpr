import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, CheckCircle2, Clock, Mail } from "lucide-react";
import { toast } from "sonner";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { formatShortDate } from "@/lib/format";
import { report } from "@/lib/errorLogger";

type Ticket = {
  id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  reporter_name?: string;
  reporter_email?: string;
};

const categoryFromReason = (reason: string) => {
  if (reason.includes("[Admin Message]")) return { label: "Message", icon: <MessageSquarePlus className="w-4 h-4" /> };
  if (reason.includes("[Suggestion]")) return { label: "Suggestion", icon: <Lightbulb className="w-4 h-4" /> };
  if (reason.includes("[Issue Report]")) return { label: "Issue", icon: <AlertTriangle className="w-4 h-4" /> };
  if (reason.includes("[Help Request]")) return { label: "Help", icon: <HelpCircle className="w-4 h-4" /> };
  return { label: "Support", icon: <Mail className="w-4 h-4" /> };
};

const subjectFromReason = (reason: string) => reason.replace(/^\[.*?\]\s*/, "");

const AdminSupport = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "resolved" | "all">("pending");
  const [updating, setUpdating] = useState<string | null>(null);

  const queryKey = ["admin-support", filter];
  const { data: tickets, isInitialLoading } = useInstantQuery<Ticket[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      let query = supabase
        .from("reports")
        .select("*")
        .eq("reported_type", "support")
        .order("created_at", { ascending: false });

      if (filter === "pending") query = query.eq("status", "pending");
      if (filter === "resolved") query = query.neq("status", "pending");

      const { data, error } = await query;
      if (error) {
        toast.error("Couldn't load support tickets — refresh to retry");
        return [];
      }

      const userIds = [...new Set((data || []).map(r => r.reporter_id))];
      if (userIds.length > 0) {
      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
      if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminSupport.hydrateNames" } });
        const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
        return (data || []).map(r => ({
          ...r,
          reporter_name: formatName(profileMap.get(r.reporter_id)?.full_name, "Unknown"),
          reporter_email: profileMap.get(r.reporter_id)?.email || "",
        }));
      }
      return (data || []) as Ticket[];
    },
  });

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    const { error } = await supabase.from("reports").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Ticket marked as ${status}`);
      qc.invalidateQueries({ queryKey });
    }
    setUpdating(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {(["pending", "resolved", "all"] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f === "pending" && <Clock className="w-3.5 h-3.5 mr-1" />}
            {f === "resolved" && <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
            {f}
          </Button>
        ))}
      </div>

      {isInitialLoading ? (
        <p className="text-muted-foreground text-ds-11 py-8 text-center">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-ds-13">No {filter !== "all" ? filter : ""} support tickets.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const cat = categoryFromReason(ticket.reason);
            const subject = subjectFromReason(ticket.reason);
            return (
              <div key={ticket.id} className="rounded-ds-md liquid-glass p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-ds-sm bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      {cat.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-ds-13 font-semibold text-foreground">{subject || "No subject"}</p>
                        <Badge variant="outline" className="text-ds-10 px-1.5 py-0">{cat.label}</Badge>
                      </div>
                      <p className="text-ds-11 text-muted-foreground">
                        {ticket.reporter_name}
                        {ticket.reporter_email && <span className="text-muted-foreground/60"> · {ticket.reporter_email}</span>}
                        {" · "}
                        {formatShortDate(ticket.created_at)}
                      </p>
                    </div>
                  </div>
                  {/* Calm "sienna" accent badge, not destructive: a pending
                      support ticket isn't a danger/delete action — the mauve
                      destructive color is reserved for genuinely destructive
                      controls. */}
                  <Badge variant={ticket.status === "pending" ? "sienna" : "secondary"} className="shrink-0 capitalize">
                    {ticket.status}
                  </Badge>
                </div>

                {ticket.description && (
                  <p className="text-ds-11 text-muted-foreground bg-muted/50 rounded-ds-sm p-3 whitespace-pre-wrap">{ticket.description}</p>
                )}

                {ticket.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => updateStatus(ticket.id, "resolved")}
                      disabled={updating === ticket.id}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatus(ticket.id, "dismissed")}
                      disabled={updating === ticket.id}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminSupport;
