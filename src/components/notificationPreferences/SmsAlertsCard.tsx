import { useEffect, useId, useRef, useState } from "react";
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
  smsConfirmWaitingFresh,
  type SmsConsent,
} from "@/lib/smsConsent";

const QUERY_KEY = ["sms-consent"] as const;

/**
 * Text alerts (owner, 2026-10-20), behind the `sms_alerts` switch.
 *
 * Consent is ONLY the unticked box below, ticked by the member, for the
 * number typed here, AND a YES the phone itself sends back (double opt-in:
 * ticking sends one confirmation text; alerts start on the reply). A phone
 * saved on the profile is never treated as consent and is not pre-filled.
 * The server (set_sms_consent) refuses a NEW request while the switch is off
 * for this account; turning texts off always works, so a member who is opted
 * in or pending still sees this card (with only "turn off") if the switch is
 * narrowed later.
 *
 * `inPrompt` (owner, 2026-10-31, LEAD-PHONE-PROMPT-DONE): inside the one-time
 * "Add your phone" prompt, a confirmed phone reads "You're all set" and offers
 * no "Turn off" (that is Settings' job); `onAllSet` fires once texts are on,
 * with `alreadyOn` true when they were on from the first read.
 */
export default function SmsAlertsCard({ inPrompt = false, onAllSet }: { inPrompt?: boolean; onAllSet?: (alreadyOn: boolean) => void } = {}) {
  const enabled = useFeature("sms_alerts");
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const phoneId = useId();
  const consentId = useId();

  const { data: consent, isPending, isError, error: loadError, refetch } = useQuery({
    queryKey: [...QUERY_KEY, user?.id],
    // Read even with the switch off: an opted-in member must always be able
    // to turn texts off here. Before the migration is live the RPC is missing
    // and the card simply stays hidden (error + switch off renders nothing).
    enabled: !!user,
    queryFn: async (): Promise<SmsConsent> => parseSmsConsent(unwrap(await supabase.rpc("get_my_sms_consent"))),
    // While a confirmation text is waiting, re-read every few seconds so the
    // phone's YES flips this card to On (owner 2026-10-28: the card still said
    // Waiting after YES, and its Cancel then turned the new alerts off). Capped
    // at 10 min after the text was sent; window focus still re-reads after that.
    refetchInterval: (q) => (smsConfirmWaitingFresh(q.state.data) ? 3000 : false),
  });

  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (consent?.phone_e164) setPhone(formatUsPhone(consent.phone_e164));
  }, [consent?.phone_e164]);

  const optedIn = consent?.sms_opt_in === true;
  // What the FIRST read said: on from the start means the prompt had nothing to ask.
  const firstOptedIn = useRef<boolean | null>(null);
  if (consent && firstOptedIn.current === null) firstOptedIn.current = optedIn;
  useEffect(() => {
    if (inPrompt && optedIn) onAllSet?.(firstOptedIn.current === true);
  }, [inPrompt, optedIn, onAllSet]);
  const pendingPhone = consent?.pending_phone ?? null;
  // NO SILENT OPT-OUT (owner bug, 2026-11-01): she confirmed her phone here at 10:03 PM and at 10:04 tapped the
  // card's only button, a full-width "Turn off text alerts", to close it; texts went off. Now a confirm seen on
  // this screen shows "You're all set" with a primary Done that keeps texts on, and Turn off is a small link
  // that asks first. src/components/notificationPreferences/smsAlertsNoSilentOptOut.test.tsx.
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [askStop, setAskStop] = useState(false);
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && optedIn) setJustConfirmed(true);
    wasWaiting.current = !!pendingPhone && !optedIn;
  }, [pendingPhone, optedIn]);
  if (!user) return null;
  // Switch off: only someone with texts on (or a request waiting) sees the card.
  if (!enabled && !optedIn && !pendingPhone) return null;

  const stoppedByReply = !optedIn && (consent?.opt_out_source === "sms_stop" || consent?.opt_out_source === "carrier_21610");
  // A STOPped number is blocked at the carrier until the phone texts START,
  // so ticking the box again for the SAME number could never work.
  const sameStoppedNumber = stoppedByReply && normalizeUsPhone(phone) === consent?.phone_e164;
  const validPhone = normalizeUsPhone(phone);

  const save = async (optIn: boolean) => {
    setSaving(true);
    try {
      // Cancelling a waiting request: if the phone already replied YES, keep
      // the alerts on instead of turning them straight back off.
      if (!optIn && pendingPhone && !optedIn) {
        const fresh = (await refetch()).data;
        if (fresh?.sms_opt_in) {
          toast.success("Text alerts are on.");
          return;
        }
      }
      // Cancelling a request that never confirmed: no opt-out is recorded (the server writes one only for a
      // member who was opted in), so say what really happened.
      const cancellingRequest = !optIn && !optedIn;
      const res = await supabase.rpc("set_sms_consent", { p_opt_in: optIn, p_phone: optIn ? phone : "" });
      if (res.error) {
        toast.error(rpcErrorMessage("set_sms_consent", res.error) ?? "We couldn't save that. Try again.");
        return;
      }
      const next = parseSmsConsent(res.data);
      // The RPC returns the stored state; anything else is not a write. A
      // request is stored as PENDING (texts start on the phone's YES).
      const stored = optIn ? next.pending_phone !== null || next.sms_opt_in : !next.sms_opt_in && next.pending_phone === null;
      if (!stored) {
        toast.error("We couldn't save that. Try again.");
        return;
      }
      queryClient.setQueryData([...QUERY_KEY, user.id], next);
      setAgreed(false);
      setAskStop(false);
      if (optIn) toast.success("Check your phone: reply YES and the 4-digit code in the text we just sent.");
      else if (cancellingRequest) {
        toast.success("Request cancelled. Text alerts stay off.");
      } else toast.success("Text alerts are off.");
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
            {optedIn ? "On" : pendingPhone ? "Waiting" : "Off"}
          </span>
        )}
      </div>

      <div className="px-3 min-[360px]:px-4 py-3 space-y-3">
        {isError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>
              {rpcErrorMessage("get_my_sms_consent", loadError) ?? "We couldn't load your text alert settings."}
            </p>
            <Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Try again</Button>
          </div>
        ) : isPending ? (
          <div className="h-24 rounded-xl animate-pulse" style={{ background: "hsl(var(--ink-deep) / 0.05)" }} role="status" aria-label="Loading text alert settings" />
        ) : pendingPhone && !optedIn ? (
          <>
            <p className="text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
              We texted <span className="font-semibold whitespace-nowrap">{formatUsPhone(pendingPhone)}</span>.
              Reply <span className="font-semibold">YES</span> and the 4-digit code in that text (like YES 1234) to turn on alerts.
            </p>
            <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
              Nothing else is sent to this number until it replies with the code. No text after a few minutes? Check the number and try again.
            </p>
            <Button variant="outline" className="w-full" disabled={saving} onClick={() => { void save(false); }}>
              Cancel this request
            </Button>
          </>
        ) : optedIn && inPrompt ? (
          <p className="text-ds-14" style={{ color: "hsl(var(--ink-deep))" }} role="status">
            You're all set, texts go to <span className="font-semibold whitespace-nowrap">{formatUsPhone(consent?.phone_e164 ?? null)}</span>.
          </p>
        ) : optedIn && justConfirmed ? (
          <>
            <p className="text-ds-14" style={{ color: "hsl(var(--ink-deep))" }} role="status">
              You're all set, texts go to <span className="font-semibold whitespace-nowrap">{formatUsPhone(consent?.phone_e164 ?? null)}</span>.
            </p>
            <Button variant="primary" className="w-full" onClick={() => setJustConfirmed(false)}>
              Done
            </Button>
          </>
        ) : optedIn ? (
          <>
            <p className="text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
              Texts go to <span className="font-semibold whitespace-nowrap">{formatUsPhone(consent?.phone_e164 ?? null)}</span>.
            </p>
            <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
              We text only when you haven't seen an alert in the app after a few minutes: job offers, applications,
              changes and problems on your jobs, payment or payout problems, and new messages. Nothing non-urgent
              between 9pm and 8am (it waits until morning). Texts never include names or addresses. Reply STOP to any text to stop.
            </p>
            {askStop ? (
              <div className="rounded-xl p-3 space-y-2" style={{ background: "hsl(var(--ink-deep) / 0.05)" }} role="group" aria-label="Stop text alerts?">
                <p className="text-ds-14 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Stop text alerts?</p>
                <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>You won't get texts about messages or jobs.</p>
                {/* App-wide rule (owner 11-01): in a side-by-side pair the primary sits on the RIGHT. */}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled={saving} onClick={() => { void save(false); }}>
                    Stop
                  </Button>
                  <Button variant="primary" className="flex-1" disabled={saving} onClick={() => setAskStop(false)}>
                    Keep them
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="min-h-[44px] font-sans text-ds-13 font-semibold underline underline-offset-2"
                style={{ color: "hsl(var(--ink-deep) / 0.7)" }}
                disabled={saving}
                onClick={() => setAskStop(true)}
              >
                Turn off text alerts
              </button>
            )}
          </>
        ) : (
          <>
            {stoppedByReply && (
              <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>
                Texts are off because you replied STOP. To turn them back on, reply START to any text from us.
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
              disabled={!agreed || !validPhone || saving || sameStoppedNumber || !enabled}
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
