import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Bell, Users, Briefcase, MessageSquare, DollarSign, Star, Megaphone, Shield, Loader2, Mail, Smartphone,
} from "lucide-react";

interface Prefs {
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
}

const defaultPrefs: Prefs = {
  job_applications: true,
  job_updates: true,
  messages: true,
  payments: true,
  reviews: true,
  promotions: true,
  system_alerts: true,
  push_enabled: true,
  email_job_applications: true,
  email_job_updates: true,
  email_messages: false,
  email_payments: true,
  email_reviews: true,
  email_promotions: false,
  email_system_alerts: true,
};

const prefItems: { key: keyof Prefs; emailKey: keyof Prefs; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: "job_applications", emailKey: "email_job_applications", label: "Job Applications", desc: "When someone applies to your job or your application is updated", icon: <Users className="w-4 h-4" /> },
  { key: "job_updates", emailKey: "email_job_updates", label: "Job Updates", desc: "Status changes, completions, and cancellations", icon: <Briefcase className="w-4 h-4" /> },
  { key: "messages", emailKey: "email_messages", label: "Messages", desc: "New messages from helpers or customers", icon: <MessageSquare className="w-4 h-4" /> },
  { key: "payments", emailKey: "email_payments", label: "Payments & Earnings", desc: "Payment confirmations, tips, and payout updates", icon: <DollarSign className="w-4 h-4" /> },
  { key: "reviews", emailKey: "email_reviews", label: "Reviews & Ratings", desc: "When someone leaves you a review", icon: <Star className="w-4 h-4" /> },
  { key: "promotions", emailKey: "email_promotions", label: "Promotions & Tips", desc: "Special offers, referral bonuses, and platform news", icon: <Megaphone className="w-4 h-4" /> },
  { key: "system_alerts", emailKey: "email_system_alerts", label: "System Alerts", desc: "Account security, policy updates, and important notices", icon: <Shield className="w-4 h-4" /> },
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
        setPrefs({
          job_applications: data.job_applications,
          job_updates: data.job_updates,
          messages: data.messages,
          payments: data.payments,
          reviews: data.reviews,
          promotions: data.promotions,
          system_alerts: data.system_alerts,
          push_enabled: data.push_enabled,
          email_job_applications: (data as any).email_job_applications ?? true,
          email_job_updates: (data as any).email_job_updates ?? true,
          email_messages: (data as any).email_messages ?? false,
          email_payments: (data as any).email_payments ?? true,
          email_reviews: (data as any).email_reviews ?? true,
          email_promotions: (data as any).email_promotions ?? false,
          email_system_alerts: (data as any).email_system_alerts ?? true,
        });
      }
      setLoading(false);
    };
    load();
  }, []);

  const toggle = async (key: keyof Prefs) => {
    if (!userId) return;
    const newVal = !prefs[key];
    const updated = { ...prefs, [key]: newVal };
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
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

      <div className="space-y-1">
        {prefItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                {item.icon}
              </div>
              <div className="min-w-0">
                <Label className="text-sm font-medium text-foreground">
                  {item.label}
                </Label>
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
      </div>

      {/* Push notifications - separate section */}
      <div className="pt-2 border-t border-border/40">
        <div className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <Label className="text-sm font-medium text-foreground">
                Push Notifications
              </Label>
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
    </div>
  );
};

export default NotificationPreferences;