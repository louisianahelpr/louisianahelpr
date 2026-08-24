import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bell, Mail, Smartphone, AlertTriangle, Users, Briefcase, DollarSign, Star, ShieldAlert, Megaphone } from "lucide-react";

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

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setPrefs(data as NotifPrefs);
    } else if (error && error.code !== "PGRST116") {
      // PGRST116 = "no rows" — expected when prefs don't exist yet
      console.error("[AdminNotifications] loadPrefs:", error);
      toast.error("Couldn't load notification preferences — refresh to retry.");
    } else {
      // Create default preferences
      const { data: newPrefs, error: insertError } = await supabase
        .from("notification_preferences")
        .insert({ user_id: user.id })
        .select()
        .single();
      if (insertError) {
        console.error("[AdminNotifications] createPrefs:", insertError);
        toast.error("Couldn't set up notification preferences — try again.");
      } else if (newPrefs) {
        setPrefs(newPrefs as NotifPrefs);
      }
    }
    setLoading(false);
  };

  const updatePref = async (key: keyof NotifPrefs, value: boolean) => {
    if (!prefs) return;
    const prev = { ...prefs };
    setPrefs({ ...prefs, [key]: value });

    // Cast: Supabase generated types reject computed-key updates because
    // the index signature widens to `[x: string]: never`. The `key` is
    // constrained to `keyof NotifPrefs` so runtime is safe.
    const { error } = await supabase
      .from("notification_preferences")
      .update({ [key]: value } as never)
      .eq("id", prefs.id);

    if (error) {
      setPrefs(prev);
      toast.error("Couldn't update that preference — try again.");
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
      toast.error("Couldn't update preferences — try again.");
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
      toast.error("Couldn't update preferences — try again.");
    } else {
      toast.success(enabled ? "All email notifications enabled" : "All email notifications disabled");
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading notification preferences…</p>;
  if (!prefs) return <p className="text-destructive">Could not load notification preferences.</p>;

  const allPushOn = NOTIFICATION_GROUPS.every(g => prefs[g.pushKey]);
  const allEmailOn = NOTIFICATION_GROUPS.every(g => prefs[g.emailKey]);

  return (
    <div className="space-y-6">
      {/* Master toggles */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-4">
        <h3 className="font-display font-bold text-foreground flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" /> Master Controls
        </h3>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center justify-between gap-3 flex-1 rounded-ds-sm border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" />
              <div>
                <Label
                  htmlFor="all-push"
                  className="text-ds-13 font-medium text-foreground cursor-pointer"
                >
                  All In-App
                </Label>
                <p className="text-ds-11 text-muted-foreground">Push & in-app notifications</p>
              </div>
            </div>
            {/* id + htmlFor, matching the per-category switches below. These two
                master toggles sat next to a plain <p>, so their accessible name
                was empty — a screen reader announced "switch, on" with no way to
                tell which of the two it was. */}
            <Switch id="all-push" checked={allPushOn} onCheckedChange={toggleAllPush} />
          </div>
          <div className="flex items-center justify-between gap-3 flex-1 rounded-ds-sm border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              <div>
                <Label
                  htmlFor="all-email"
                  className="text-ds-13 font-medium text-foreground cursor-pointer"
                >
                  All Email
                </Label>
                <p className="text-ds-11 text-muted-foreground">Email notifications</p>
              </div>
            </div>
            <Switch id="all-email" checked={allEmailOn} onCheckedChange={toggleAllEmail} />
          </div>
        </div>
      </div>

      {/* Per-category controls */}
      <div className="rounded-ds-md liquid-glass divide-y divide-border">
        <div className="p-5">
          <h3 className="font-display font-bold text-foreground">Per-Category Settings</h3>
          <p className="text-ds-11 text-muted-foreground mt-1">Fine-tune which notifications you receive and how.</p>
        </div>
        {NOTIFICATION_GROUPS.map((group) => (
          <div key={group.pushKey} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-ds-sm bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                <group.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-ds-13 font-semibold text-foreground">{group.label}</p>
                <p className="text-ds-11 text-muted-foreground">{group.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-6 sm:gap-4 pl-12 sm:pl-0">
              <div className="flex items-center gap-2">
                <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                <Label htmlFor={`push-${group.pushKey}`} className="text-ds-11 text-muted-foreground cursor-pointer">
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
                <Label htmlFor={`email-${group.emailKey}`} className="text-ds-11 text-muted-foreground cursor-pointer">
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
      <div className="rounded-ds-md liquid-glass p-5 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-accent mt-0.5 shrink-0" />
          <div>
            <p className="text-ds-13 font-medium text-foreground">Note</p>
            <p className="text-ds-11 text-muted-foreground">
              Critical security alerts (disputes, fraud flags, failed payouts) will always generate in-app notifications regardless of these settings. These preferences control whether you also receive push and email alerts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminNotifications;
