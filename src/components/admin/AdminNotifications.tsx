import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bell, BellOff, Mail, Smartphone, AlertTriangle, Users, Briefcase, DollarSign, Star, ShieldAlert, Megaphone } from "lucide-react";

type NotifPrefs = {
  id: string;
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
};

const NOTIFICATION_GROUPS = [
  {
    label: "Job Applications",
    description: "When someone applies to your posted jobs",
    icon: Users,
    pushKey: "job_applications" as const,
    emailKey: "email_job_applications" as const,
  },
  {
    label: "Job Updates",
    description: "Status changes, completions, cancellations",
    icon: Briefcase,
    pushKey: "job_updates" as const,
    emailKey: "email_job_updates" as const,
  },
  {
    label: "Messages",
    description: "New chat messages from users",
    icon: Megaphone,
    pushKey: "messages" as const,
    emailKey: "email_messages" as const,
  },
  {
    label: "Payments",
    description: "Escrow, payouts, tips, and fee alerts",
    icon: DollarSign,
    pushKey: "payments" as const,
    emailKey: "email_payments" as const,
  },
  {
    label: "Reviews",
    description: "New ratings and feedback",
    icon: Star,
    pushKey: "reviews" as const,
    emailKey: "email_reviews" as const,
  },
  {
    label: "Promotions",
    description: "Platform updates and announcements",
    icon: Megaphone,
    pushKey: "promotions" as const,
    emailKey: "email_promotions" as const,
  },
  {
    label: "System Alerts",
    description: "Disputes, fraud flags, failed payouts, admin warnings",
    icon: ShieldAlert,
    pushKey: "system_alerts" as const,
    emailKey: "email_system_alerts" as const,
  },
];

const AdminNotifications = () => {
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setPrefs(data as NotifPrefs);
    } else {
      // Create default preferences
      const { data: newPrefs } = await supabase
        .from("notification_preferences")
        .insert({ user_id: user.id })
        .select()
        .single();
      if (newPrefs) setPrefs(newPrefs as NotifPrefs);
    }
    setLoading(false);
  };

  const updatePref = async (key: keyof NotifPrefs, value: boolean) => {
    if (!prefs) return;
    const prev = { ...prefs };
    setPrefs({ ...prefs, [key]: value });

    const { error } = await supabase
      .from("notification_preferences")
      .update({ [key]: value } as any)
      .eq("id", prefs.id);

    if (error) {
      setPrefs(prev);
      toast.error("Failed to update preference");
    }
  };

  const toggleAllPush = async (enabled: boolean) => {
    if (!prefs) return;
    const updates: Partial<NotifPrefs> = { push_enabled: enabled };
    NOTIFICATION_GROUPS.forEach(g => { updates[g.pushKey] = enabled; });

    const prev = { ...prefs };
    setPrefs({ ...prefs, ...updates });

    const { error } = await supabase
      .from("notification_preferences")
      .update(updates)
      .eq("id", prefs.id);

    if (error) {
      setPrefs(prev);
      toast.error("Failed to update preferences");
    } else {
      toast.success(enabled ? "All in-app notifications enabled" : "All in-app notifications disabled");
    }
  };

  const toggleAllEmail = async (enabled: boolean) => {
    if (!prefs) return;
    const updates: Partial<NotifPrefs> = {};
    NOTIFICATION_GROUPS.forEach(g => { updates[g.emailKey] = enabled; });

    const prev = { ...prefs };
    setPrefs({ ...prefs, ...updates });

    const { error } = await supabase
      .from("notification_preferences")
      .update(updates)
      .eq("id", prefs.id);

    if (error) {
      setPrefs(prev);
      toast.error("Failed to update preferences");
    } else {
      toast.success(enabled ? "All email notifications enabled" : "All email notifications disabled");
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading notification preferences…</p>;
  if (!prefs) return <p className="text-destructive">Could not load notification preferences.</p>;

  const allPushOn = NOTIFICATION_GROUPS.every(g => prefs[g.pushKey]);
  const allEmailOn = NOTIFICATION_GROUPS.every(g => prefs[g.emailKey]);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Master toggles */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="font-display font-bold text-foreground flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" /> Master Controls
        </h3>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center justify-between gap-3 flex-1 rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">All In-App</p>
                <p className="text-xs text-muted-foreground">Push & in-app notifications</p>
              </div>
            </div>
            <Switch checked={allPushOn} onCheckedChange={toggleAllPush} />
          </div>
          <div className="flex items-center justify-between gap-3 flex-1 rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">All Email</p>
                <p className="text-xs text-muted-foreground">Email notifications</p>
              </div>
            </div>
            <Switch checked={allEmailOn} onCheckedChange={toggleAllEmail} />
          </div>
        </div>
      </div>

      {/* Per-category controls */}
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        <div className="p-5">
          <h3 className="font-display font-bold text-foreground">Per-Category Settings</h3>
          <p className="text-xs text-muted-foreground mt-1">Fine-tune which notifications you receive and how.</p>
        </div>
        {NOTIFICATION_GROUPS.map((group) => (
          <div key={group.pushKey} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                <group.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{group.label}</p>
                <p className="text-xs text-muted-foreground">{group.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-6 sm:gap-4 pl-12 sm:pl-0">
              <div className="flex items-center gap-2">
                <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                <Label htmlFor={`push-${group.pushKey}`} className="text-xs text-muted-foreground cursor-pointer">
                  Push
                </Label>
                <Switch
                  id={`push-${group.pushKey}`}
                  checked={prefs[group.pushKey]}
                  onCheckedChange={(v) => updatePref(group.pushKey, v)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <Label htmlFor={`email-${group.emailKey}`} className="text-xs text-muted-foreground cursor-pointer">
                  Email
                </Label>
                <Switch
                  id={`email-${group.emailKey}`}
                  checked={prefs[group.emailKey]}
                  onCheckedChange={(v) => updatePref(group.emailKey, v)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-accent-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Note</p>
            <p className="text-xs text-muted-foreground">
              Critical security alerts (disputes, fraud flags, failed payouts) will always generate in-app notifications regardless of these settings. These preferences control whether you also receive push and email alerts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminNotifications;
