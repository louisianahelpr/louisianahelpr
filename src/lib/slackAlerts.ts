import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Fire-and-forget helper to post operational alerts to Slack via the
 * `slack-ops-alert` edge function. Failures are swallowed — these alerts
 * must NEVER block or break the user-facing flow that triggered them.
 *
 * Use sparingly: only for events the ops team genuinely needs to react to.
 */

type AlertSeverity = "critical" | "warning" | "info";
type AlertKind =
  | "dispute_filed"
  | "fraud_flag"
  | "payout_failed"
  | "auto_suspended"
  | "stripe_webhook_error"
  | "custom";

interface SlackAlertInput {
  kind: AlertKind;
  severity?: AlertSeverity;
  title: string;
  message: string;
  fields?: Record<string, string | number | null | undefined>;
  link?: string;
}

export function fireSlackAlert(input: SlackAlertInput) {
  // Intentionally not awaited.
  supabase.functions
    .invoke("slack-ops-alert", { body: input })
    .catch((err) => {
      report(err, { severity: "warning", tags: { source: "slackAlerts.dispatch", kind: input.kind } });
    });
}
