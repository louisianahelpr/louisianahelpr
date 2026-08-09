import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { formatCategory } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { logAdminAction } from "@/lib/adminAudit";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { unwrap } from "@/lib/supabaseResult";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";
import { report } from "@/lib/errorLogger";

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
  { value: "burst_job_posting", label: "Burst Job Posting" },
  { value: "multi_reporter_flag", label: "Multi-Reporter Pile-On" },
  { value: "rapid_cancellation_pattern", label: "Rapid Cancellation" },
  { value: "duplicate_content_posting", label: "Duplicate Content" },
];

const AdminFraudDashboard = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const queryKey = ["admin-fraud-flags", filter, showResolved];
  const { data: flags, isInitialLoading } = useInstantQuery<FraudFlag[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      let query = supabase.from("fraud_flags")
        .select("*")
        .eq("resolved", showResolved)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("flag_type", filter);

      const data = unwrap(await query);
      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((f: any) => f.user_id))];
      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminFraudDashboard.hydrateNames" } });

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      return data.map((f: any) => ({ ...f, user_name: formatName(nameMap.get(f.user_id), "Unknown") }));
    },
  });

  const resolveFlag = async (flag: FraudFlag) => {
    setResolving(flag.id);
    const { error } = await supabase.from("fraud_flags")
      .update({ resolved: true })
      .eq("id", flag.id);

    if (error) toast.error(error.message);
    else {
      toast.success("Flag resolved");
      await logAdminAction("resolve_fraud_flag", "fraud_flag", flag.id, { flag_type: flag.flag_type, user_id: flag.user_id });
      qc.invalidateQueries({ queryKey });
    }
    setResolving(null);
  };

  // Fraud flag types collapse to 3 severity tones — DANGER (money /
  // reputation risk), WARNING (behavior anomaly), INFO (informational
  // signal). Previously each flag hand-picked its own color from a
  // rainbow palette, producing 12 different shades for 12 flag types.
  // The audit's cohesion note was that "high_dispute_rate" (red-100
  // text-red-800) and "multi_reporter_flag" (also red-100 text-red-800)
  // were correctly the same color while "referral_abuse" (rose-100)
  // and "burst_job_posting" (rose-100) shared a fourth. Collapsed to
  // the shared tone map so all admin severity chips read the same.
  const flagTone: Record<string, Tone> = {
    off_platform_contact: "warning",
    fast_completion: "notice",
    high_dispute_rate: "danger",
    referral_abuse: "danger",
    application_spam: "info",
    review_manipulation: "danger",
    message_flooding: "warning",
    scope_creep: "warning",
    burst_job_posting: "warning",
    multi_reporter_flag: "danger",
    rapid_cancellation_pattern: "danger",
    duplicate_content_posting: "warning",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger aria-label="Flag type" className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FLAG_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Show Unresolved" : "Show Resolved"}
          </Button>
        </div>
      </div>

      {isInitialLoading ? (
        <p className="text-ds-11 text-muted-foreground">Loading flags…</p>
      ) : flags.length === 0 ? (
        <div className="rounded-ds-md liquid-glass p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-ds-11 text-muted-foreground">{showResolved ? "No resolved flags" : "No unresolved fraud flags — looking good!"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map(flag => (
            <div key={flag.id} className="rounded-ds-md liquid-glass p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ds-13 text-foreground">{flag.user_name}</span>
                  <Badge className={toneBadgeClasses[flagTone[flag.flag_type] ?? "neutral"]}>
                    {formatCategory(flag.flag_type)}
                  </Badge>
                </div>
                {flag.details && (
                  <p className="text-ds-11 text-muted-foreground line-clamp-2">{flag.details}</p>
                )}
                <p className="text-ds-11 text-muted-foreground">
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
