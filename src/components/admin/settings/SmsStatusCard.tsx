import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeature } from "@/hooks/useFeature";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { FEATURE_AUDIENCE_LABEL, type FeatureAudience } from "@/config/featureSwitches";
import { AdminCard } from "../AdminViewShell";

type Row = { created_at: string; category: string | null; kind: string | null; status: string; reason: string | null; error_code: string | null };
type ProviderCheck = {
  configured: boolean;
  secrets?: Record<string, boolean>;
  credentials_ok?: boolean;
  http_status?: number;
  error_code?: number | null;
  service_name?: string | null;
  inbound_webhook_set?: boolean;
  sender_count?: number;
  tollfree_verification?: Array<{ status: string }> | null;
};

/** One line, in plain words, for the read-only Twilio check (sms-provider-check). */
function providerLine(p: ProviderCheck): string {
  if (!p.configured) {
    const missing = Object.entries(p.secrets ?? {}).filter(([, v]) => !v).map(([k]) => k);
    return missing.length ? `Twilio secrets missing: ${missing.join(", ")}.` : "Twilio secrets are set but not in the expected format (AC… / MG…).";
  }
  if (!p.credentials_ok) {
    return p.http_status === 401 ? "Twilio refused the Account SID / Auth Token." : p.http_status === 404 ? "No Messaging Service with that SID on this Twilio account." : `Twilio check failed (HTTP ${p.http_status ?? "?"}).`;
  }
  const tf = p.tollfree_verification;
  const verification = tf == null ? "toll-free verification: couldn't read" : tf.length === 0 ? "toll-free verification: not submitted" : `toll-free verification: ${tf.map((v) => v.status).join(", ")}`;
  return `Twilio OK: "${p.service_name ?? "service"}", ${p.sender_count ?? 0} sender number(s), inbound webhook ${p.inbound_webhook_set ? "set" : "NOT set"}, ${verification}.`;
}

type Status = { audience: string | null; opted_in: number; pending?: number; sent_24h: number; failed_24h: number; recent: Row[] };

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
  member_quiet_hours: "member's quiet hours",
  no_pending: "no request waiting",
  phone_in_use: "number used by another account",
  cap_confirm: "confirmation limit",
};

const KIND: Record<string, string> = {
  message: "New message",
  job_match: "Nearby job",
  job_offer: "Job offer",
  job_update: "Job update",
  confirm: "Confirmation (reply YES)",
};

/**
 * Admin -> Settings: the SMS alerts log (owner, 2026-10-20). Shown while
 * the `sms_alerts` switch reaches this admin. No phone numbers or names:
 * admin_sms_status returns none.
 */
export function SmsStatusCard() {
  const enabled = useFeature("sms_alerts");
  const { data, status, fetchStatus, error, refetch } = useQuery({
    queryKey: ["admin-sms-status"],
    enabled,
    queryFn: async (): Promise<Status> => unwrap(await supabase.rpc("admin_sms_status")) as unknown as Status,
  });
  const provider = useQuery({
    queryKey: ["admin-sms-provider-check"],
    enabled: false,
    queryFn: async (): Promise<ProviderCheck> => {
      const { data, error } = await supabase.functions.invoke("sms-provider-check", { method: "POST" });
      if (error) throw error;
      return data as ProviderCheck;
    },
  });
  // Offline with nothing loaded is not "No texts yet" (Q571).
  const phase = useFeedPhase({ status, fetchStatus });
  if (!enabled) return null;

  const audience = data?.audience as FeatureAudience | null | undefined;
  return (
    <AdminCard
      title="Text alerts (SMS)"
      subtitle={audience ? `Switch: ${FEATURE_AUDIENCE_LABEL[audience] ?? audience}` : undefined}
      action={<Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Refresh</Button>}
    >
      {phase === "offline-empty" ? (
        <OfflineEmptyState body="The text alert log will show here once you're back online." onRetry={() => { void refetch(); }} />
      ) : phase === "error" ? (
        <p className="text-ds-13" role="alert">{rpcErrorMessage("admin_sms_status", error) ?? "Couldn't load the text alert log."}</p>
      ) : phase === "loading" || !data ? (
        <div className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(var(--ink-deep) / 0.05)" }} role="status" aria-label="Loading text alert log" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-center">
            {[
              ["Opted in", data.opted_in],
              ["Waiting YES", data.pending ?? 0],
              ["Sent 24h", data.sent_24h],
              ["Failed 24h", data.failed_24h],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl py-2" style={{ background: "hsl(var(--ink-deep) / 0.04)" }}>
                <div className="font-semibold text-ds-17 tabular-nums">{n}</div>
                <div className="text-ds-12" style={{ color: "hsl(var(--ink-deep) / 0.65)" }}>{label}</div>
              </div>
            ))}
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl px-3 py-2" style={{ background: "hsl(var(--ink-deep) / 0.04)" }}>
            <p className="text-ds-13 min-w-0" role="status">
              {provider.isFetching ? "Checking Twilio (read-only, no text is sent)…"
                : provider.isError ? "Couldn't run the Twilio check. Try again."
                : provider.data ? providerLine(provider.data)
                : "Check that the Twilio secrets work. Read-only: no text is sent."}
            </p>
            <Button variant="outline" size="sm" className="shrink-0" disabled={provider.isFetching} onClick={() => { void provider.refetch(); }}>
              Check Twilio
            </Button>
          </div>
          {data.recent.length === 0 ? (
            <EmptyState icon={MessageSquareText} title="No texts yet" body="Texts and skips show here once someone opts in." />
          ) : (
            <ul className="divide-y" style={{ borderColor: "hsl(var(--ink-deep) / 0.08)" }}>
              {data.recent.map((r, i) => (
                <li key={`${r.created_at}-${i}`} className="flex items-center justify-between gap-2 py-2 text-ds-13">
                  <span className="min-w-0">
                    <span className="font-medium block">{KIND[r.kind ?? ""] ?? r.category ?? "Notification"}</span>
                    <span className="block text-ds-12" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
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
