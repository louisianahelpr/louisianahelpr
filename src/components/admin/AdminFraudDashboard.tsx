import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldAlert, CheckCircle2, AlertTriangle, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { logAdminAction } from "@/lib/adminAudit";

interface FraudFlag {
  id: string;
  user_id: string;
  flag_type: string;
  details: string | null;
  job_id: string | null;
  resolved: boolean;
  created_at: string;
  user_name?: string;
}

const FLAG_TYPES = [
  { value: "all", label: "All Types" },
  { value: "off_platform_contact", label: "Off-Platform Contact" },
  { value: "fast_completion", label: "Fast Completion" },
  { value: "high_dispute_rate", label: "High Dispute Rate" },
  { value: "referral_abuse", label: "Referral Abuse" },
  { value: "application_spam", label: "Application Spam" },
  { value: "review_manipulation", label: "Review Manipulation" },
  { value: "message_flooding", label: "Message Flooding" },
  { value: "scope_creep", label: "Scope Creep (3+ revisions)" },
];

const AdminFraudDashboard = () => {
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const loadFlags = async () => {
    setLoading(true);
    let query = (supabase.from as any)("fraud_flags")
      .select("*")
      .eq("resolved", showResolved)
      .order("created_at", { ascending: false })
      .limit(100);

    if (filter !== "all") query = query.eq("flag_type", filter);

    const { data } = await query;
    if (!data) { setFlags([]); setLoading(false); return; }

    // Fetch user names
    const userIds = [...new Set((data as any[]).map((f: any) => f.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);

    const nameMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
    setFlags((data as any[]).map((f: any) => ({ ...f, user_name: formatName(nameMap.get(f.user_id), "Unknown") })));
    setLoading(false);
  };

  useEffect(() => { loadFlags(); }, [filter, showResolved]);

  const resolveFlag = async (flag: FraudFlag) => {
    setResolving(flag.id);
    const { error } = await (supabase.from as any)("fraud_flags")
      .update({ resolved: true })
      .eq("id", flag.id);

    if (error) toast.error(error.message);
    else {
      toast.success("Flag resolved");
      await logAdminAction("resolve_fraud_flag", "fraud_flag", flag.id, { flag_type: flag.flag_type, user_id: flag.user_id });
      await loadFlags();
    }
    setResolving(null);
  };

  const flagColor: Record<string, string> = {
    off_platform_contact: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    fast_completion: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    high_dispute_rate: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    referral_abuse: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    application_spam: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    review_manipulation: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
    message_flooding: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-destructive" /> Fraud Flags
        </h2>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FLAG_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Show Unresolved" : "Show Resolved"}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading flags…</p>
      ) : flags.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{showResolved ? "No resolved flags" : "No unresolved fraud flags — looking good!"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map(flag => (
            <div key={flag.id} className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-foreground">{flag.user_name}</span>
                  <Badge className={flagColor[flag.flag_type] || "bg-muted text-muted-foreground"}>
                    {flag.flag_type.replace(/_/g, " ")}
                  </Badge>
                </div>
                {flag.details && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{flag.details}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(flag.created_at), { addSuffix: true })}
                </p>
              </div>
              {!flag.resolved && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolving === flag.id}
                  onClick={() => resolveFlag(flag)}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {resolving === flag.id ? "Resolving…" : "Resolve"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminFraudDashboard;
