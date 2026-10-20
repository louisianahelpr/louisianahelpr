import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import {
  SMS_CONSENT_TEXT_BEFORE_LINKS,
  formatUsPhone,
  normalizeUsPhone,
  parseSmsConsent,
  type SmsConsent,
} from "@/lib/smsConsent";

const QUERY_KEY = ["sms-consent"] as const;

/**
 * Text alerts (owner, 2026-10-20), behind the `sms_alerts` switch.
 *
 * Consent is ONLY the unticked box below, ticked by the member, for the
 * number typed here. A phone saved on the profile is never treated as consent
 * and is not pre-filled. The server (set_sms_consent) normalises the number,
 * stamps the time and the wording version, and refuses while the switch is
 * off for this account; turning texts off always works.
 */
export default function SmsAlertsCard() {
  const enabled = useFeature("sms_alerts");
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const phoneId = useId();
  const consentId = useId();

  const { data: consent, isPending, isError, refetch } = useQuery({
    queryKey: [...QUERY_KEY, user?.id],
    enabled: enabled && !!user,
    queryFn: async (): Promise<SmsConsent> => parseSmsConsent(unwrap(await supabase.rpc("get_my_sms_consent"))),
  });

  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (consent?.phone_e164) setPhone(formatUsPhone(consent.phone_e164));
  }, [consent?.phone_e164]);

  if (!enabled || !user) return null;

  const optedIn = consent?.sms_opt_in === true;
  const stoppedByReply = !optedIn && (consent?.opt_out_source === "sms_stop" || consent?.opt_out_source === "carrier_21610");
  const validPhone = normalizeUsPhone(phone);

  const save = async (optIn: boolean) => {
    setSaving(true);
    try {
      const res = await supabase.rpc("set_sms_consent", { p_opt_in: optIn, p_phone: optIn ? phone : "" });
      if (res.error) {
        toast.error(rpcErrorMessage("set_sms_consent", res.error) ?? "We couldn't save that. Try again.");
        return;
      }
      const next = parseSmsConsent(res.data);
      // The RPC returns the stored state; anything else is not a write.
      if (next.sms_opt_in !== optIn) {
        toast.error("We couldn't save that. Try again.");
        return;
      }
      queryClient.setQueryData([...QUERY_KEY, user.id], next);
      setAgreed(false);
      toast.success(optIn ? "Text alerts are on." : "Text alerts are off.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby={`${consentId}-title`}
      className="mt-4 rounded-2xl liquid-glass overflow-hidden shadow-sm"
      data-testid="sms-alerts-card"
    >
      <div
        className="flex items-center gap-2.5 px-3 min-[360px]:px-4 py-2.5"
        style={{ background: "hsl(var(--bark) / 0.06)", borderBottom: "0.5px solid hsl(var(--bark) / 0.18)" }}
      >
        <span
          className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
          style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}
        >
          <MessageSquareText className="w-3.5 h-3.5" aria-hidden />
        </span>
        <h2 id={`${consentId}-title`} className="font-sans font-semibold text-ds-14 flex-1 min-w-0" style={{ color: "hsl(var(--ink-deep))" }}>
          Text alerts
        </h2>
        {!isPending && !isError && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-sans text-ds-12 font-semibold"
            style={optedIn
              ? { background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }
              : { background: "hsl(var(--ink-deep) / 0.06)", color: "hsl(var(--ink-deep) / 0.7)" }}
          >
            {optedIn ? "On" : "Off"}
          </span>
        )}
      </div>

      <div className="px-3 min-[360px]:px-4 py-3 space-y-3">
        {isError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>
              We couldn't load your text alert settings.
            </p>
            <Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Try again</Button>
          </div>
        ) : isPending ? (
          <div className="h-24 rounded-xl animate-pulse" style={{ background: "hsl(var(--ink-deep) / 0.05)" }} aria-label="Loading text alert settings" />
        ) : optedIn ? (
          <>
            <p className="text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
              Texts go to <span className="font-semibold whitespace-nowrap">{formatUsPhone(consent?.phone_e164 ?? null)}</span>.
            </p>
            <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
              We text about job offers and updates, new jobs near you (never 9pm to 8am) and new messages.
              Texts never include names or addresses. Reply STOP to any text to stop.
            </p>
            <Button variant="outline" className="w-full" disabled={saving} onClick={() => { void save(false); }}>
              Turn off text alerts
            </Button>
          </>
        ) : (
          <>
            {stoppedByReply && (
              <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>
                Texts are off because you replied STOP. Tick the box below to turn them back on.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={phoneId} className="text-ds-13 font-semibold">Mobile number</Label>
              <Input
                id={phoneId}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(225) 555-0123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={phone.length > 0 && !validPhone}
              />
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id={consentId}
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
                aria-describedby={`${consentId}-text`}
              />
              <label id={`${consentId}-text`} htmlFor={consentId} className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep) / 0.85)" }}>
                {SMS_CONSENT_TEXT_BEFORE_LINKS}{" "}
                <Link to="/terms" className="underline underline-offset-2">Terms</Link> and{" "}
                <Link to="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
              </label>
            </div>
            <Button
              variant="primary"
              className="w-full"
              disabled={!agreed || !validPhone || saving}
              onClick={() => { void save(true); }}
            >
              Turn on text alerts
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
