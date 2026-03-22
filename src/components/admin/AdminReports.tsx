import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, User, Briefcase, MessageSquare } from "lucide-react";
import { toast } from "sonner";

type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reported_type: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  reporter_name?: string;
  reported_name?: string;
};

const AdminReports = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "resolved" | "all">("pending");
  const [updating, setUpdating] = useState<string | null>(null);

  const loadReports = async () => {
    setLoading(true);
    let query = supabase.from("reports").select("*").order("created_at", { ascending: false });
    if (filter === "pending") query = query.eq("status", "pending");
    if (filter === "resolved") query = query.eq("status", "resolved");

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to load reports");
      setLoading(false);
      return;
    }

    // Fetch profile names for reporters and reported users
    const userIds = [...new Set((data || []).flatMap(r => [r.reporter_id, r.reported_id]))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      const nameMap = new Map((profiles || []).map(p => [p.user_id, p.full_name || "Unknown"]));
      setReports((data || []).map(r => ({
        ...r,
        reporter_name: nameMap.get(r.reporter_id) || "Unknown",
        reported_name: nameMap.get(r.reported_id) || "Unknown",
      })));
    } else {
      setReports(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { loadReports(); }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    const { error } = await supabase.from("reports").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Report marked as ${status}`);
      loadReports();
    }
    setUpdating(null);
  };

  const typeIcon = (type: string) => {
    if (type === "user") return <User className="w-4 h-4" />;
    if (type === "job") return <Briefcase className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
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
        <p className="text-muted-foreground text-sm py-8 text-center">Loading reports…</p>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No {filter !== "all" ? filter : ""} reports found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => (
            <div key={report.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {typeIcon(report.reported_type)}
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {report.reported_name}
                      <span className="text-muted-foreground font-normal"> — {report.reason}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reported by {report.reporter_name} · {new Date(report.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Badge variant={report.status === "pending" ? "destructive" : "secondary"} className="shrink-0">
                  {report.status}
                </Badge>
              </div>

              {report.description && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">{report.description}</p>
              )}

              {report.status === "pending" && (
                <div className="flex gap-2 pt-1">
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminReports;
