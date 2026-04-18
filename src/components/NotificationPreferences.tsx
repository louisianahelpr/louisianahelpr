import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Bell, Briefcase, MessageSquare, DollarSign, Star, Megaphone, Shield,
  Loader2, Mail, Smartphone, Navigation, CheckCircle2, Inbox, Lock,
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

interface Group {
  title: string;
  icon: React.ReactNode;
  items: { key: keyof Prefs; emailKey: keyof Prefs; label: string; desc: string; icon: React.ReactNode }[];
}

const groups: Group[] = [
  {
    title: "Jobs & Offers",
    icon: <Inbox className="w-4 h-4" />,
    items: [
      { key: "new_offers", emailKey: "email_new_offers", label: "New Offers", desc: "When someone applies to your job or accepts your offer", icon: <Briefcase className="w-4 h-4" /> },
      { key: "messages", emailKey: "email_messages", label: "Messages", desc: "Direct messages from posters or helprs", icon: <MessageSquare className="w-4 h-4" /> },
    ],
  },
  {
    title: "Safety & Tracking",
    icon: <Navigation className="w-4 h-4" />,
    items: [
      { key: "transit_updates", emailKey: "email_transit_updates", label: "Transit Updates", desc: "On the Way and Arrived alerts from your helper", icon: <Navigation className="w-4 h-4" /> },
      { key: "work_status", emailKey: "email_work_status", label: "Work Status", desc: "In Progress and Completed updates", icon: <CheckCircle2 className="w-4 h-4" /> },
    ],
  },
  {
    title: "Financial Alerts",
    icon: <DollarSign className="w-4 h-4" />,
    items: [
      { key: "financial_alerts", emailKey: "email_financial_alerts", label: "Payments, Payouts & Tips", desc: "Escrow confirmations, payout releases, and tip notifications", icon: <DollarSign className="w-4 h-4" /> },
    ],
  },
  {
    title: "Reputation",
    icon: <Star className="w-4 h-4" />,
    items: [
      { key: "reviews", emailKey: "email_reviews", label: "Reviews & Ratings", desc: "When someone leaves you a review", icon: <Star className="w-4 h-4" /> },
    ],
  },
  {
    title: "Platform",
    icon: <Megaphone className="w-4 h-4" />,
    items: [
      { key: "promotions", emailKey: "email_promotions", label: "Promotions & Tips", desc: "Special offers, referral bonuses, and platform news", icon: <Megaphone className="w-4 h-4" /> },
    ],
  },
];

const NotificationPreferences = () => {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (data) {
        setPrefs({ ...defaultPrefs, ...(data as any) });
      }
      setLoading(false);
    };
    load();
  }, []);

  const toggle = async (key: keyof Prefs) => {
    if (!userId) return;
    const newVal = !prefs[key];
    const updated = { ...prefs, [key]: newVal };

    // Mirror new granular toggles into legacy fields so old code paths still work
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end h-5">
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Channel headers */}
      <div className="flex items-center justify-end gap-6 px-4 pb-1 border-b border-border/40">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Smartphone className="w-3.5 h-3.5" />
          <span>In-App</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Mail className="w-3.5 h-3.5" />
          <span>Email</span>
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.title} className="space-y-1">
          <div className="flex items-center gap-2 px-4 pb-1">
            <span className="text-primary">{group.icon}</span>
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </h3>
          </div>
          {group.items.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <Label className="text-sm font-medium text-foreground">{item.label}</Label>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0 ml-3">
                <Switch
                  checked={prefs[item.key]}
                  onCheckedChange={() => toggle(item.key)}
                  aria-label={`${item.label} in-app`}
                />
                <Switch
                  checked={prefs[item.emailKey]}
                  onCheckedChange={() => toggle(item.emailKey)}
                  aria-label={`${item.label} email`}
                />
              </div>
            </div>
          ))}
        </section>
      ))}

      {/* Push notifications */}
      <div className="pt-2 border-t border-border/40">
        <div className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <Label className="text-sm font-medium text-foreground">Push Notifications</Label>
              <p className="text-xs text-muted-foreground">Receive browser push notifications when you're away</p>
            </div>
          </div>
          <Switch
            checked={prefs.push_enabled}
            onCheckedChange={() => toggle("push_enabled")}
            aria-label="Push notifications"
          />
        </div>
      </div>

      {/* Safety footer */}
      <div className="flex items-start gap-2.5 mx-4 p-3 rounded-xl bg-muted/40 border border-border/50">
        <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Critical account security alerts (login attempts, account changes, dispute resolutions) cannot be disabled.
        </p>
      </div>
    </div>
  );
};

export default NotificationPreferences;
