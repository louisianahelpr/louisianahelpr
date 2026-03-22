import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, CheckCircle2, Clock, Mail } from "lucide-react";
import { toast } from "sonner";

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

const subjectFromReason = (reason: string) => {
  return reason.replace(/^\[.*?\]\s*/, "");
};

const AdminSupport = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "resolved" | "all">("pending");
  const [updating, setUpdating] = useState<string | null>(null);

  const loadTickets = async () => {
    setLoading(true);
    let query = supabase
      .from("reports")
      .select("*")
      .eq("reported_type", "support")
      .order("created_at", { ascending: false });

    if (filter === "pending") query = query.eq("status", "pending");
    if (filter === "resolved") query = query.neq("status", "pending");

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to load support tickets");
      setLoading(false);
      return;
    }

    const userIds = [...new Set((data || []).map(r => r.reporter_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
      setTickets((data || []).map(r => ({
        ...r,
        reporter_name: profileMap.get(r.reporter_id)?.full_name || "Unknown",
        reporter_email: profileMap.get(r.reporter_id)?.email || "",
      })));
    } else {
      setTickets(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { loadTickets(); }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    const { error } = await supabase.from("reports").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Ticket marked as ${status}`);
      loadTickets();
    }
    setUpdating(null);
  };

  return (
    <div className="space-y-4">
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

      {loading ? (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No {filter !== "all" ? filter : ""} support tickets.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const cat = categoryFromReason(ticket.reason);
            const subject = subjectFromReason(ticket.reason);
            return (
              <div key={ticket.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      {cat.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{subject || "No subject"}</p>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cat.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ticket.reporter_name}
                        {ticket.reporter_email && <span className="text-muted-foreground/60"> · {ticket.reporter_email}</span>}
                        {" · "}
                        {new Date(ticket.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Badge variant={ticket.status === "pending" ? "destructive" : "secondary"} className="shrink-0">
                    {ticket.status}
                  </Badge>
                </div>

                {ticket.description && (
                  <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">{ticket.description}</p>
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
