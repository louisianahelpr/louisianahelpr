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
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (cancelled) return;
      if (data) setPrefs({ ...defaultPrefs, ...(data as any) });
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
      <div className="flex items-center justify-end gap-6 px-4 py-2 border-b border-border/40 relative shrink-0" style={{ background: "hsl(var(--ivory-sand) / 0.3)" }}>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute left-4 top-2.5" />}
        <div className="flex items-center gap-1.5 font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
          <Smartphone className="w-3.5 h-3.5" /> App
        </div>
        <div className="flex items-center gap-1.5 font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
          <Mail className="w-3.5 h-3.5" /> Email
        </div>
      </div>

      {rows.map((item) => (
        <div
          key={item.key}
          className={`flex items-center justify-between px-4 py-2.5 border-b border-border/40 last:border-b-0 shrink-0 transition-opacity ${
            prefs.push_enabled || prefs[item.emailKey] ? "" : "opacity-60"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-primary shrink-0">{item.icon}</span>
            <Label className="text-sm font-medium text-foreground truncate">{item.label}</Label>
          </div>
          <div className={`flex items-center gap-6 shrink-0 ml-2 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}>
            <Switch
              checked={prefs[item.key] && prefs.push_enabled}
              onCheckedChange={() => toggle(item.key)}
              disabled={!loaded || !prefs.push_enabled}
              aria-label={`${item.label} push`}
            />
            <Switch
              checked={prefs[item.emailKey]}
              onCheckedChange={() => toggle(item.emailKey)}
              disabled={!loaded}
              aria-label={`${item.label} email`}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Bell className="w-4 h-4 text-primary shrink-0" />
          <Label className="text-sm font-medium text-foreground truncate">Push Notifications</Label>
        </div>
        <Switch
          checked={prefs.push_enabled}
          onCheckedChange={() => toggle("push_enabled")}
          disabled={!loaded}
          aria-label="Push notifications master toggle"
          className={`mr-[3.75rem] transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 border-t border-border/40 shrink-0" style={{ background: "hsl(var(--ivory-sand) / 0.25)" }}>
        <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
        <p className="font-serif italic leading-snug" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}>
          Critical security alerts — logins, disputes — can't be turned off.
        </p>
      </div>
    </div>
  );
};

export default NotificationPreferences;
