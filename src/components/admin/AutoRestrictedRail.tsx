// AutoRestrictedRail — extracted from AdminUsers.tsx as the first step
// of breaking that 2,464-line god component apart.
//
// Surfaces every user currently auto-temp-banned by the
// auto_restrict_repeat_violators trigger so admins can reverse mistaken
// auto-actions in one tap. Self-contained: owns its own data fetch + the
// reverse handler. Parent only needs to provide an `onReview` callback
// for the per-card "Review" button (opens the existing profile detail
// dialog in AdminUsers) and an optional `onChange` callback if the
// parent wants to refetch profile lists after a reversal.
//
// The "auto-ban" signal we filter on is auto_suspended_until being set —
// only the auto_restrict trigger writes that column. Manual admin temp
// bans leave it null and therefore never appear here.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Eye } from "lucide-react";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { createNotification } from "@/lib/notifications";
import { hapticSuccess } from "@/lib/haptics";

interface AutoRestrictedUser {
  user_id: string;
  full_name: string | null;
  email: string | null;
  auto_suspended_until: string;
  violation_count: number;
}

interface AutoRestrictedRailProps {
  /** Tap on a card's "Review" button — parent opens its profile detail. */
  onReview: (userId: string) => void;
  /** Called after a successful reverse so the parent can refetch lists. */
  onChange?: () => void;
}

export function AutoRestrictedRail({ onReview, onChange }: AutoRestrictedRailProps) {
  const [users, setUsers] = useState<AutoRestrictedUser[]>([]);
  const [reversing, setReversing] = useState<string | null>(null);

  const load = async () => {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, auto_suspended_until")
      .eq("ban_status", "temp_banned")
      .not("auto_suspended_until", "is", null)
      .gt("auto_suspended_until", new Date().toISOString())
      .order("auto_suspended_until", { ascending: false })
      .limit(10);
    if (profErr) {
      report(profErr, { severity: "warning", tags: { source: "AutoRestrictedRail.loadProfiles" } });
      return;
    }
    if (!profs || profs.length === 0) {
      setUsers([]);
      return;
    }
    const ids = profs.map((p) => p.user_id);
    const { data: vios, error: vioErr } = await supabase
      .from("user_violations")
      .select("user_id")
      .in("user_id", ids);
    if (vioErr) {
      report(vioErr, { severity: "warning", tags: { source: "AutoRestrictedRail.loadViolations" } });
    }
    const counts: Record<string, number> = {};
    (vios ?? []).forEach((v) => {
      if (v.user_id) counts[v.user_id] = (counts[v.user_id] || 0) + 1;
    });
    setUsers(
      profs.map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        auto_suspended_until: p.auto_suspended_until as string,
        violation_count: counts[p.user_id] || 0,
      })),
    );
  };

  useEffect(() => {
    load();
  }, []);

  const reverse = async (userId: string) => {
    setReversing(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ ban_status: "active", auto_suspended_until: null })
      .eq("user_id", userId);
    if (error) {
      toast.error(`Couldn't reverse: ${error.message}`);
      setReversing(null);
      return;
    }
    await logAdminAction("reverse_auto_ban", "profile", userId, {
      reason: "admin reversed auto-restrict",
    });
    await createNotification({
      user_id: userId,
      title: "Restriction lifted",
      message: "An admin reviewed your account and lifted the temporary restriction.",
      type: "success",
      link: "/profile",
    });
    hapticSuccess();
    toast.success("Auto-ban reversed.");
    setReversing(null);
    await load();
    onChange?.();
  };

  if (users.length === 0) return null;

  return (
    <div className="rounded-ds-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-300" />
        <p className="text-ds-11 font-semibold text-amber-900 dark:text-amber-200">
          Auto-restricted ({users.length}) — review and reverse if mistaken
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {users.map((u) => {
          const daysLeft = Math.max(
            0,
            Math.ceil(
              (new Date(u.auto_suspended_until).getTime() - Date.now()) /
                (1000 * 60 * 60 * 24),
            ),
          );
          return (
            <div
              key={u.user_id}
              className="shrink-0 min-w-[220px] rounded-ds-sm bg-background border border-amber-500/30 p-2.5 space-y-1.5"
            >
              <p className="text-ds-11 font-semibold truncate">
                {formatName(u.full_name, u.email || "User")}
              </p>
              <p className="text-ds-10 text-muted-foreground">
                {u.violation_count} violations · {daysLeft}d left
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-ds-11 px-2 flex-1"
                  onClick={() => onReview(u.user_id)}
                >
                  <Eye className="w-3 h-3 mr-1" /> Review
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reversing === u.user_id}
                  className="h-7 text-ds-11 px-2 flex-1 border-amber-500/40 hover:bg-amber-500/10"
                  onClick={() => reverse(u.user_id)}
                >
                  {reversing === u.user_id ? "..." : "Reverse"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
