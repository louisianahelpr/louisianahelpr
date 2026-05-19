import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Bell, Briefcase, MessageSquare, DollarSign, Star, Megaphone,
  Loader2, Mail, Smartphone, Navigation, CheckCircle2, Lock,
} from "lucide-react";

interface Prefs {
  // Legacy (kept for backward compat / write-through)
  job_applications: boolean;
  job_updates: boolean;
  messages: boolean;
  payments: boolean;
  reviews: boolean;
  promotions: boolean;
  system_alerts: boolean;
  push_enabled: boolean;
  email_job_applications: boolean;
  email_job_updates: boolean;
  email_messages: boolean;
  email_payments: boolean;
  email_reviews: boolean;
  email_promotions: boolean;
  email_system_alerts: boolean;
  // New granular categories
  new_offers: boolean;
  email_new_offers: boolean;
  transit_updates: boolean;
  email_transit_updates: boolean;
  work_status: boolean;
  email_work_status: boolean;
  financial_alerts: boolean;
  email_financial_alerts: boolean;
  /** When true, non-urgent job matches are batched into a daily
      digest instead of being pushed individually. Urgent jobs always
      fire realtime regardless. */
  match_digest_mode: boolean;
}

const defaultPrefs: Prefs = {
  job_applications: true, job_updates: true, messages: true, payments: true,
  reviews: true, promotions: true, system_alerts: true, push_enabled: true,
  email_job_applications: true, email_job_updates: true, email_messages: false,
  email_payments: true, email_reviews: true, email_promotions: false, email_system_alerts: true,
  new_offers: true, email_new_offers: true,
  transit_updates: true, email_transit_updates: false,
  work_status: true, email_work_status: true,
  financial_alerts: true, email_financial_alerts: true,
  match_digest_mode: false,
};

interface Row {
  key: keyof Prefs;
  emailKey: keyof Prefs;
  label: string;
  icon: React.ReactNode;
}

const rows: Row[] = [
  { key: "new_offers", emailKey: "email_new_offers", label: "Job Offers", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { key: "messages", emailKey: "email_messages", label: "Messages", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { key: "transit_updates", emailKey: "email_transit_updates", label: "Transit (On the Way / Arrived)", icon: <Navigation className="w-3.5 h-3.5" /> },
  { key: "work_status", emailKey: "email_work_status", label: "Work Status", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { key: "financial_alerts", emailKey: "email_financial_alerts", label: "Payments & Tips", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { key: "reviews", emailKey: "email_reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { key: "promotions", emailKey: "email_promotions", label: "Promotions", icon: <Megaphone className="w-3.5 h-3.5" /> },
];

const NotificationPreferences = () => {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      setUserId(user.id);
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      // No row yet is expected (defaults apply); a real query failure is not.
      if (error) {
        console.error("[NotificationPreferences] failed to load preferences:", error);
        toast.error("Couldn't load notification preferences");
      } else if (data) {
        setPrefs({ ...defaultPrefs, ...data });
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async (key: keyof Prefs) => {
    if (!userId) return;
    const newVal = !prefs[key];
    const updated = { ...prefs, [key]: newVal };

    if (key === "new_offers") updated.job_applications = newVal;
    if (key === "email_new_offers") updated.email_job_applications = newVal;
    if (key === "transit_updates" || key === "work_status") {
      updated.job_updates = updated.transit_updates || updated.work_status;
    }
    if (key === "email_transit_updates" || key === "email_work_status") {
      updated.email_job_updates = updated.email_transit_updates || updated.email_work_status;
    }
    if (key === "financial_alerts") updated.payments = newVal;
    if (key === "email_financial_alerts") updated.email_payments = newVal;

    setPrefs(updated);
    setSaving(true);

    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...updated } as any, { onConflict: "user_id" });

    setSaving(false);
    if (error) {
      setPrefs(prefs);
      toast.error("Failed to save preference");
    }
  };

  return (
    <div className="flex-1 min-h-0 rounded-2xl liquid-glass overflow-hidden shadow-sm flex flex-col">
      {/* Push master toggle moved to the TOP — it gates every row below
          it, so it's the lead control. Bark-tinted backdrop signals
          "this is the master switch" without shouting. */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0 relative"
        style={{
          background: "hsl(var(--bark) / 0.06)",
          borderBottom: "0.5px solid hsl(var(--bark) / 0.18)",
        }}
      >
        {saving && (
          <Loader2 className="w-4 h-4 animate-spin absolute left-3 top-3" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
        )}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}
          >
            <Bell className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-display italic font-bold leading-tight block"
              style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Push Notifications
            </Label>
            <p className="font-serif italic text-[0.7rem]" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Master switch for everything below
            </p>
          </div>
        </div>
        {/* Master toggle uses the App-column slot width so the toggle
            visually aligns with the App switches in the rows below.
            Email-column slot stays empty — push master only gates
            push, not email. */}
        <div className={`flex items-center gap-7 shrink-0 ml-2 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}>
          <div className="w-11 flex justify-center">
            <Switch
              checked={prefs.push_enabled}
              onCheckedChange={() => toggle("push_enabled")}
              disabled={!loaded}
              aria-label="Push notifications master toggle"
            />
          </div>
          <div className="w-11" aria-hidden />
        </div>
      </div>

      {/* Column header — App / Email column labels positioned to
          sit directly above the switch columns below. Fixed-width
          slots keep the labels aligned with their toggles regardless
          of icon/text rendering quirks across browsers. */}
      <div
        className="flex items-center justify-end px-4 py-1.5 shrink-0"
        style={{
          background: "hsl(var(--ivory-sand) / 0.4)",
          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)",
        }}
      >
        <div className="flex items-center gap-7">
          <div
            className="flex items-center justify-center gap-1 w-11 font-serif italic uppercase"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.16em" }}
          >
            <Smartphone className="w-3 h-3" /> App
          </div>
          <div
            className="flex items-center justify-center gap-1 w-11 font-serif italic uppercase"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.16em" }}
          >
            <Mail className="w-3 h-3" /> Email
          </div>
        </div>
      </div>

      {/* Digest mode toggle — when on, non-urgent job-match pushes are
          batched into one daily summary instead of firing per-match.
          Sits between the master and the per-category rows so it reads
          as a delivery preference, not a category. */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 shrink-0 transition-opacity ${prefs.push_enabled ? "" : "opacity-60"} ${saving ? "opacity-80 cursor-wait" : ""}`}
        style={{
          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--gold-warm) / 0.14)",
              color: "hsl(var(--gold-warm))",
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block truncate"
              style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}
            >
              Daily match digest
            </Label>
            <p className="font-serif italic mt-0.5" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.7)" }}>
              Batch non-urgent matches into one push per day. Urgent jobs still fire instantly.
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-7 shrink-0 ml-2 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}>
          <div className="w-11 flex justify-center">
            <Switch
              checked={prefs.match_digest_mode}
              onCheckedChange={() => toggle("match_digest_mode")}
              disabled={!loaded || !prefs.push_enabled}
              aria-label="Daily match digest"
            />
          </div>
          {/* Email column placeholder — digest is a push-only delivery
              mode, but the dash keeps the two-column grid visually
              honest so the row reads as "app only, intentionally". */}
          <div className="w-11 flex justify-center" aria-hidden>
            <span
              className="font-serif"
              style={{ color: "hsl(var(--olivewood) / 0.35)", fontSize: "0.85rem" }}
            >
              —
            </span>
          </div>
        </div>
      </div>

      {rows.map((item, idx) => (
        <div
          key={item.key}
          className={`flex items-center justify-between px-4 py-2.5 shrink-0 transition-opacity ${
            prefs.push_enabled || prefs[item.emailKey] ? "" : "opacity-60"
          } ${saving ? "opacity-80 cursor-wait" : ""}`}
          style={{
            borderBottom: idx < rows.length - 1 ? "0.5px solid hsl(var(--olivewood) / 0.08)" : "none",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.10)",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              {item.icon}
            </span>
            <Label
              className="font-sans font-semibold truncate"
              style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}
            >
              {item.label}
            </Label>
          </div>
          <div className={`flex items-center gap-7 shrink-0 ml-2 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}>
            <div className="w-11 flex justify-center">
              <Switch
                checked={prefs[item.key] && prefs.push_enabled}
                onCheckedChange={() => toggle(item.key)}
                disabled={!loaded || !prefs.push_enabled}
                aria-label={`${item.label} push`}
              />
            </div>
            <div className="w-11 flex justify-center">
              <Switch
                checked={prefs[item.emailKey]}
                onCheckedChange={() => toggle(item.emailKey)}
                disabled={!loaded}
                aria-label={`${item.label} email`}
              />
            </div>
          </div>
        </div>
      ))}

      <div
        className="flex items-start gap-1.5 px-4 py-2 shrink-0"
        style={{
          background: "hsl(var(--ivory-sand) / 0.4)",
          borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)",
        }}
      >
        <Lock className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.45)" }} />
        <p
          className="font-serif italic leading-snug"
          style={{ fontSize: "0.66rem", color: "hsl(var(--olivewood) / 0.55)" }}
        >
          Critical security alerts — logins, disputes — can't be turned off.
        </p>
      </div>
    </div>
  );
};

export default NotificationPreferences;
