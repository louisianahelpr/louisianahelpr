import { useId, useMemo, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useAuthReady } from "@/hooks/useAuthReady";
import { track } from "@/lib/analytics";
import { report } from "@/lib/errorLogger";
import {
  ALERT_WORDS as W,
  PriceAlertError,
  alertItemsFromPlan,
  looksLikeEmail,
  readAlertsOnDevice,
  saveAlertsOnDevice,
  subscribePriceAlerts,
} from "@/lib/giftPriceAlertsApi";
import { usePlan } from "./plannerStore";

/**
 * Saved-gift price alerts (owner approved in a pop-up, 2026-11-21): under the planner's lists, "Email me if any of
 * these drop in price, and a reminder before Dec 15", an email field (filled in when signed in), an explicit consent
 * box (never pre-ticked) and "unsubscribe anytime". Works signed out (email only) and signed in. Reads the same lists
 * the planner and the guides' "save for someone" lists keep (plannerStore); it never changes them. Layers:
 * supabase/functions/_shared/giftPriceAlerts.ts. Guard: src/test/giftPriceAlerts.test.ts.
 */
export function PriceAlertsOptIn() {
  const plan = usePlan();
  const { user } = useAuthReady();
  const items = useMemo(() => alertItemsFromPlan(plan), [plan]);
  const [onDevice, setOnDevice] = useState(() => readAlertsOnDevice());
  const [email, setEmail] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ids = useId();

  const typed = email ?? onDevice?.email ?? user?.email ?? "";

  if (items.length === 0) {
    return (
      <div className="gg-fun-card" data-price-alerts="empty">
        <p className="gg-finder-q m-0 mb-1">{W.title}</p>
        <p className="gg-fun-note m-0">{W.none}</p>
      </div>
    );
  }

  if (onDevice && !editing) {
    const more = items.length > onDevice.count;
    return (
      <div className="gg-fun-card" data-price-alerts="on">
        <p className="gg-finder-q m-0 mb-1">{W.title}</p>
        <p className="gg-fun-note m-0" role="status">{W.on(onDevice.email, onDevice.count)}</p>
        {more && <p className="gg-fun-note m-0">{W.changed}</p>}
        <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setEditing(true)} data-price-alerts-update="">{W.update}</Button>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(typed)) return setErr(W.badEmail);
    if (!consent) return setErr(W.needConsent);
    setErr(null);
    setBusy(true);
    try {
      const count = await subscribePriceAlerts(typed, items, true);
      const saved = { email: typed.trim().toLowerCase(), count, at: Date.now() };
      saveAlertsOnDevice(saved);
      setOnDevice(saved);
      setEditing(false);
      setConsent(false);
      track("gift_price_alerts_on", { gifts: count, signed_in: !!user });
    } catch (x) {
      // A refusal with words (bad address, rate limited, not deployed yet) is shown to the person; anything else is
      // unexpected, so it is reported as well as shown.
      if (!(x instanceof PriceAlertError) || x.words === W.failed) report(x, { tags: { source: "gift_price_alerts.subscribe" } });
      setErr(x instanceof PriceAlertError ? x.words : W.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gg-fun-card" onSubmit={submit} aria-labelledby={`${ids}-t`} data-price-alerts="form" noValidate>
      <p id={`${ids}-t`} className="gg-finder-q m-0 mb-1">{W.title}</p>
      <p className="gg-fun-note m-0 mb-2">{W.lead}</p>
      <Input type="email" inputMode="email" autoComplete="email" aria-label={W.email} placeholder={W.email} value={typed} maxLength={254}
        onChange={(e) => setEmail(e.target.value)} data-price-alerts-email="" />
      <label className="mt-2 flex min-h-11 items-start gap-2 text-sm" htmlFor={`${ids}-c`}>
        <Checkbox id={`${ids}-c`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" data-price-alerts-consent="" />
        <span>{W.consent}</span>
      </label>
      <p className="gg-fun-note m-0 mt-1">{W.unsubscribe}</p>
      <Button type="submit" className="btn-grad-primary mt-2" disabled={busy} data-price-alerts-submit="">{busy ? W.sending : W.button}</Button>
      {err && <p className="gg-fun-err" role="alert">{err}</p>}
    </form>
  );
}
