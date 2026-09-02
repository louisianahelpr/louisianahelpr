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
// The signal we filter on is auto_suspended_until being set. That USED to mean
// "written by the auto_restrict trigger only" — but leaving it null on a manual
// admin temp ban was a bug, not a discriminator: it is the column the
// sweep_expired_auto_bans cron reads to END a suspension, so an admin-issued
// "7-day ban" never expired. BanDialog now writes it too, which means this rail
// shows every account currently under a temporary restriction, however it was
// applied. The heading says "Temporarily restricted" rather than
// "Auto-restricted" for exactly that reason — the review-and-reverse action is
// the same either way, and an admin should be able to see and undo BOTH.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Eye } from "lucide-react";
import { toast } from "sonner";
import { toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
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
    // .select("user_id"): reversing an auto-restriction that matches zero rows
    // returns error === null, and the row used to disappear from this rail while
    // the user stayed restricted.
    try {
      unwrapMutation(
        await supabase
          .from("profiles")
          .update({ ban_status: "active", auto_suspended_until: null })
          .eq("user_id", userId)
          .select("user_id"),
        {
          action: "reverse this restriction",
          rejectedMessage: "The restriction wasn't reversed — this account is unchanged. Check your admin permissions and try again.",
          context: { targetUserId: userId },
        },
      );
    } catch (err) {
      toast.error(mutationErrorMessage(err, "Couldn't reverse that restriction — try again."));
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
      // "Restriction lifted" means they can work again — send them to the
      // feed, the way admin-user-actions' own dismiss branch does.
      link: "/dashboard",
    });
    hapticSuccess();
    setReversing(null);
    await load();
    onChange?.();
  };

  if (users.length === 0) return null;

  return (
    <div className={cn("rounded-ds-md border border-warning/40 bg-warning/10 p-3 space-y-2", toneTextClasses.warning)}>
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" />
        <p className="text-ds-11 font-semibold">
          Temporarily restricted ({users.length}) — review and reverse if mistaken
        </p>
      </div>
      {/* Scroll rail on phones, GRID from `sm` up. As a pure flex rail of
          fixed 220px cards, a single auto-restricted account left a 1128px
          warning band on the desktop Users screen holding one small card and
          ~880px of nothing — the "content stops a third of the way across"
          dead-space defect. The grid lets one card sit in a normal column and
          many cards fill the row instead of disappearing off the right edge. */}
      <div
        className={cn(
          "flex gap-2 overflow-x-auto pb-1 sm:overflow-visible",
          // Column count follows the ITEM count, capped at 4. A fixed 4-up
          // grid left a single restricted account in a 270px card with ~830px
          // of empty warning band beside it; scaling the track count means one
          // card fills the row and four still tile cleanly.
          // One card => a plain single-column grid at EVERY width, phones
          // included. Left as a flex rail it kept its 220px min-width and sat
          // in the left half of a 402px iPhone screen with the rest of the
          // warning band empty (measured in the simulator).
          users.length === 1 ? "grid grid-cols-1"
            : users.length === 2 ? "sm:grid sm:grid-cols-2"
            : users.length === 3 ? "sm:grid sm:grid-cols-2 lg:grid-cols-3"
            : "sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        )}
      >
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
              className={cn(
                "rounded-ds-sm bg-background border border-warning/30 p-2.5 space-y-1.5 text-foreground",
                // The 220px floor is what makes a MULTI-card rail scroll
                // instead of squashing. With a single card it is just a
                // dead-space generator, so it only applies from two up.
                users.length > 1 && "shrink-0 min-w-[220px] sm:min-w-0 sm:shrink",
              )}
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
                  className={cn("h-7 text-ds-11 px-2 flex-1 border-warning/40 hover:bg-warning/10", toneTextClasses.warning)}
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
