import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bell, Mail, Smartphone, AlertTriangle, Users, Briefcase, DollarSign, Star, ShieldAlert, Megaphone, Navigation, CheckCircle2, Receipt } from "lucide-react";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { unwrapMutation } from "@/lib/mutationResult";

type NotifPrefs = {
  id: string;
  job_applications: boolean;
  job_updates: boolean;
  messages: boolean;
  payments: boolean;
  reviews: boolean;
  promotions: boolean;
  system_alerts: boolean;
  /** Push master. Its own column — gates the categories, never rewrites them. */
  push_enabled: boolean;
  /** Email master, the twin of `push_enabled` (migration 20260907032218).
   *  OPTIONAL until that migration deploys and types are regenerated: the row
   *  comes back from `select("*")`, so before the column exists the field is
   *  simply absent. Optional is also the safe direction at runtime — absent
   *  reads falsy and the screen falls back to the derived master rather than
   *  claiming email is off. */
  email_enabled?: boolean;
  email_job_applications: boolean;
  email_job_updates: boolean;
  email_messages: boolean;
  email_payments: boolean;
  email_reviews: boolean;
  email_promotions: boolean;
  email_system_alerts: boolean;
  new_offers: boolean;
  email_new_offers: boolean;
  transit_updates: boolean;
  email_transit_updates: boolean;
  work_status: boolean;
  email_work_status: boolean;
  financial_alerts: boolean;
  email_financial_alerts: boolean;
};

// All ELEVEN preference columns `notification_type_pref_map` routes through —
// the same set the user-facing screen lists in
// `src/components/notificationPreferences/constants.tsx`, and the set
// `src/test/notificationTypeRegistries.test.ts` derives from the map's seed
// rows and diffs both registries against.
//
// This list held seven. `new_offers`, `transit_updates`, `work_status` and
// `financial_alerts` had no control here at all, so an admin could not turn
// off transit pings or payout alerts from the admin surface — and, until the
// masters below stopped blanket-writing the categories, "All Email off" left
// those four still sending, because the blanket write only covered the rows it
// could see.
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
  {
    label: "Job Offers",
    description: "Direct offers made to you for a specific job",
    icon: Briefcase,
    pushKey: "new_offers" as const,
    emailKey: "email_new_offers" as const,
  },
  {
    label: "Transit Updates",
    description: "On the way / arrived pings from a Helpr",
    icon: Navigation,
    pushKey: "transit_updates" as const,
    emailKey: "email_transit_updates" as const,
  },
  {
    label: "Work Status",
    description: "Started and completed updates on a job in progress",
    icon: CheckCircle2,
    pushKey: "work_status" as const,
    emailKey: "email_work_status" as const,
  },
  {
    label: "Payments & Tips",
    description: "Tip received, payout sent, instant payout",
    icon: Receipt,
    pushKey: "financial_alerts" as const,
    emailKey: "email_financial_alerts" as const,
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

    // maybeSingle(), NOT single(). `single()` asks PostgREST for
    // `application/vnd.pgrst.object+json`, and a zero-row result under that
    // Accept header is answered with **HTTP 406 / PGRST116** — which Chrome
    // logs as `Failed to load resource: the server responded with a status of
    // 406`. That console error was this screen's, and it fired on every
    // admin's FIRST visit, because "no prefs row yet" is the expected state
    // the branch below exists to repair. The old code handled PGRST116
    // correctly but provoked an HTTP error to learn about it.
    // `maybeSingle()` keeps the plain `application/json` header, unwraps the
    // one row client-side, and returns `data: null` on zero rows with HTTP
    // 200 — same semantics, no error in the console.
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      setPrefs(data as NotifPrefs);
    } else if (error) {
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
    try {
      unwrapMutation(
        await supabase
          .from("notification_preferences")
          .update({ [key]: value } as never)
          .eq("id", prefs.id)
          .select("id"),
        { action: "update that preference" },
      );
    } catch {
      setPrefs(prev);
      toast.error("Couldn't update that preference — try again.");
    }
  };

  // ── Masters write ONE column each and never touch the categories ──
  //
  // Both of these used to blanket-write every category column alongside the
  // master, so turning a master off destroyed the admin's per-category choices
  // and turning it back on wrote `true` over all of them. `email_promotions`
  // came back on that way — a silent re-subscribe to marketing mail, which is
  // the one category where re-consenting somebody by accident carries legal
  // weight. The push master did it too, and additionally wrote `push_enabled`,
  // so it was destroying state it did not even need to read.
  //
  // Both master columns are gates enforced server-side without any help from
  // the category columns: `push_enabled` in `fan_out_push_on_notification`,
  // `email_enabled` in `send-notification-email`. Writing the categories was
  // never what made the master work — it was only what made it lossy.
  const setMaster = async (
    key: "push_enabled" | "email_enabled",
    enabled: boolean,
    action: string,
  ) => {
    if (!prefs) return;
    const prev = { ...prefs };
    setPrefs({ ...prefs, [key]: enabled });

    try {
      unwrapMutation(
        await supabase
          .from("notification_preferences")
          .update({ [key]: enabled } as never)
          .eq("id", prefs.id)
          .select("id"),
        { action },
      );
    } catch {
      setPrefs(prev);
      toast.error("Couldn't update preferences — try again.");
    }
  };

  const toggleAllPush = (enabled: boolean) =>
    void setMaster("push_enabled", enabled, "update push preferences");

  const toggleAllEmail = (enabled: boolean) =>
    void setMaster("email_enabled", enabled, "update email preferences");

  if (loading) return <p className="text-muted-foreground">Loading notification preferences…</p>;
  if (!prefs) return <p className="text-destructive">We couldn't load notification preferences.</p>;

  // The master switches read their own column, not a derived "are all eleven
  // categories on". Derived state is what made the old master ambiguous: it
  // showed OFF for an admin who had merely unticked one category, and there
  // was nowhere to store "muted, but remember my choices".
  //
  // `email_enabled` may be absent for the length of the deploy window between
  // migration 20260907032218 landing and this bundle landing (two pipelines,
  // one merge). PostgREST omits the key rather than returning false, and `!==
  // false` reads that absence as "no master yet" instead of muting the screen.
  const allPushOn = prefs.push_enabled;
  const allEmailOn = prefs.email_enabled !== false;

  return (
    <AdminViewShell>
      {/* Master toggles */}
      <AdminCard
        title={<span className="flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /> Master Controls</span>}
      >
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
                <p className="text-ds-11 text-muted-foreground">Mutes every push below. Your per-category choices are kept.</p>
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
                <p className="text-ds-11 text-muted-foreground">Mutes every email below. Your per-category choices are kept.</p>
              </div>
            </div>
            <Switch id="all-email" checked={allEmailOn} onCheckedChange={toggleAllEmail} />
          </div>
        </div>
      </AdminCard>

      {/* Per-category controls. The rows bleed to the card's edges — hence the
          negative inset that cancels AdminCard's own padding — so the dividers
          run the full width the way a settings list should. */}
      <AdminCard
        title="Per-Category Settings"
        contentClassName="-mx-4 sm:-mx-5 -mb-4 sm:-mb-5 divide-y divide-border border-t border-border"
      >
        {NOTIFICATION_GROUPS.map((group) => (
          <div key={group.pushKey} className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
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
                {/* Shows category AND master, and the master being off greys
                    the row rather than rewriting it — so the stored category
                    value survives a master off → on cycle. */}
                <Switch
                  id={`push-${group.pushKey}`}
                  checked={prefs[group.pushKey] && allPushOn}
                  disabled={!allPushOn}
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
                  checked={prefs[group.emailKey] && allEmailOn}
                  disabled={!allEmailOn}
                  onCheckedChange={(v) => updatePref(group.emailKey, v)}
                />
              </div>
            </div>
          </div>
        ))}
      </AdminCard>

      {/* Footnote, not a section. This is a caveat ABOUT the settings above,
          so it reads as fine print under them rather than as a third titled
          card competing with the two that carry controls. */}
      <div className="flex items-start gap-2 px-1">
        <AlertTriangle className="w-4 h-4 text-accent mt-0.5 shrink-0" />
        <p className="text-ds-11 text-muted-foreground">
          Critical security alerts (disputes, fraud flags, failed payouts) will always generate in-app notifications regardless of these settings. These preferences control whether you also receive push and email alerts.
        </p>
      </div>
    </AdminViewShell>
  );
};

export default AdminNotifications;
