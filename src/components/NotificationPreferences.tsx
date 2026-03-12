import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Bell, Users, Briefcase, MessageSquare, DollarSign, Star, Megaphone, Shield, Loader2,
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
};

const prefItems: { key: keyof Prefs; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: "job_applications", label: "Job Applications", desc: "When someone applies to your job or your application is updated", icon: <Users className="w-4 h-4" /> },
  { key: "job_updates", label: "Job Updates", desc: "Status changes, completions, and cancellations", icon: <Briefcase className="w-4 h-4" /> },
  { key: "messages", label: "Messages", desc: "New messages from helpers or customers", icon: <MessageSquare className="w-4 h-4" /> },
  { key: "payments", label: "Payments & Earnings", desc: "Payment confirmations, tips, and payout updates", icon: <DollarSign className="w-4 h-4" /> },
  { key: "reviews", label: "Reviews & Ratings", desc: "When someone leaves you a review", icon: <Star className="w-4 h-4" /> },
  { key: "promotions", label: "Promotions & Tips", desc: "Special offers, referral bonuses, and platform news", icon: <Megaphone className="w-4 h-4" /> },
  { key: "system_alerts", label: "System Alerts", desc: "Account security, policy updates, and important notices", icon: <Shield className="w-4 h-4" /> },
  { key: "push_enabled", label: "Push Notifications", desc: "Receive browser push notifications when you're away", icon: <Bell className="w-4 h-4" /> },
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
      .upsert({ user_id: userId, ...updated }, { onConflict: "user_id" });

    setSaving(false);
    if (error) {
      setPrefs(prefs); // revert
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
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-display font-bold text-foreground">Notifications</h2>
          <p className="text-xs text-muted-foreground">Choose which notifications you receive</p>
        </div>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-1">
        {prefItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                {item.icon}
              </div>
              <div className="min-w-0">
                <Label htmlFor={item.key} className="text-sm font-medium text-foreground cursor-pointer">
                  {item.label}
                </Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </div>
            <Switch
              id={item.key}
              checked={prefs[item.key]}
              onCheckedChange={() => toggle(item.key)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationPreferences;
