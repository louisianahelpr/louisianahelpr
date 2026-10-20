import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeature } from "@/hooks/useFeature";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { FEATURE_AUDIENCE_LABEL, type FeatureAudience } from "@/config/featureSwitches";
import { AdminCard } from "../AdminViewShell";

type Row = { created_at: string; category: string | null; kind: string | null; status: string; reason: string | null; error_code: string | null };
type Status = { audience: string | null; opted_in: number; sent_24h: number; failed_24h: number; recent: Row[] };

/** Plain words for sms_claim's skip reasons (public.sms_claim). */
const REASON: Record<string, string> = {
  not_eligible: "not a texted type",
  no_consent: "not opted in",
  suppressed_seed: "test account",
  switch_off: "switch off",
  twilio_not_configured: "Twilio secrets not set",
  pref_off: "category turned off",
  quiet_hours: "quiet hours",
  cap_daily_total: "daily limit",
  cap_job_matches: "nearby-jobs limit",
  coalesced_messages: "message texted < 10 min ago",
  cap_work_status: "job-status limit",
};

const KIND: Record<string, string> = {
  message: "New message",
  job_match: "Nearby job",
  job_offer: "Job offer",
  job_update: "Job update",
};

/**
 * Admin -> Settings: the SMS alerts log (owner, 2026-10-20). Shown while
 * the `sms_alerts` switch reaches this admin. No phone numbers or names:
 * admin_sms_status returns none.
 */
export function SmsStatusCard() {
  const enabled = useFeature("sms_alerts");
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["admin-sms-status"],
    enabled,
    queryFn: async (): Promise<Status> => unwrap(await supabase.rpc("admin_sms_status")) as unknown as Status,
  });
  if (!enabled) return null;

  const audience = data?.audience as FeatureAudience | null | undefined;
  return (
    <AdminCard
      title="Text alerts (SMS)"
      subtitle={audience ? `Switch: ${FEATURE_AUDIENCE_LABEL[audience] ?? audience}` : undefined}
      action={<Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Refresh</Button>}
    >
      {isError ? (
        <p className="text-ds-13" role="alert">{rpcErrorMessage("admin_sms_status", error) ?? "Couldn't load the text alert log."}</p>
      ) : isPending ? (
        <div className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(var(--ink-deep) / 0.05)" }} aria-label="Loading text alert log" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Opted in", data.opted_in],
              ["Sent 24h", data.sent_24h],
              ["Failed 24h", data.failed_24h],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl py-2" style={{ background: "hsl(var(--ink-deep) / 0.04)" }}>
                <div className="font-semibold text-ds-17 tabular-nums">{n}</div>
                <div className="text-ds-12" style={{ color: "hsl(var(--ink-deep) / 0.65)" }}>{label}</div>
              </div>
            ))}
          </div>
          {data.recent.length === 0 ? (
            <EmptyState icon={MessageSquareText} title="No texts yet" body="Texts and skips show here once someone opts in." />
          ) : (
            <ul className="divide-y" style={{ borderColor: "hsl(var(--ink-deep) / 0.08)" }}>
              {data.recent.map((r, i) => (
                <li key={`${r.created_at}-${i}`} className="flex items-center justify-between gap-2 py-2 text-ds-13">
                  <span className="min-w-0">
                    <span className="font-medium">{KIND[r.kind ?? ""] ?? r.category ?? "Notification"}</span>{" "}
                    <span style={{ color: "hsl(var(--ink-deep) / 0.6)" }}>
                      {new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </span>
                  <Badge variant={r.status === "failed" ? "destructive" : r.status === "sent" ? "default" : "secondary"} className="shrink-0">
                    {r.status === "skipped" ? `Skipped: ${REASON[r.reason ?? ""] ?? r.reason}` : r.status === "failed" ? `Failed ${r.error_code ?? ""}`.trim() : r.status === "sent" ? "Sent" : "Queued"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AdminCard>
  );
}
