// Merged Schedule + Availability tab (handoff item #22).
//
// Combines the two previously-separate Profile tabs into one surface
// with an internal sub-toggle. Deep links to /schedule and
// /availability still work (App.tsx Navigate redirects survive,
// pointing to /profile?tab=schedule and ?tab=availability respectively),
// and ProfilePage maps both `tab` values onto this component while
// passing the correct initial sub-view.
//
// Sub-view choice is reflected back to the parent via onSubViewChange
// so the URL `?tab=` param stays in sync with the user's selection
// without a full route navigation.

import { useState, useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";
import { ScheduleTab } from "@/components/profile/ScheduleTab";
import { HelperAvailability } from "@/components/HelperAvailability";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Switch } from "@/components/ui/switch";
import { CalendarDays, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticSuccess } from "@/lib/haptics";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

export type ScheduleSubView = "calendar" | "availability";

interface ScheduleAvailabilityTabProps {
  initialView: ScheduleSubView;
  /** Notified whenever the user flips the sub-toggle, so the parent
      can keep the URL `?tab=` param in sync. */
  onSubViewChange?: (view: ScheduleSubView) => void;
  postedJobs: Job[];
  assignedJobs: Job[];
  loading: boolean;
  userId: string;
  onBack: () => void;
}

export function ScheduleAvailabilityTab({
  initialView,
  onSubViewChange,
  postedJobs,
  assignedJobs,
  loading,
  userId,
  onBack,
}: ScheduleAvailabilityTabProps) {
  const [view, setView] = useState<ScheduleSubView>(initialView);

  // "Available now" toggle state
  const [availableUntil, setAvailableUntil] = useState<Date | null>(null);
  const [toggling, setToggling] = useState(false);

  // Load current availability status from profiles.
  // `available_until` is a new column added by migration; use `any` cast
  // because the generated types won't include it until types are regenerated.
  useEffect(() => {
    (supabase.from("profiles") as any)
      .select("available_until")
      .eq("user_id", userId)
      .single()
      .then(({ data }: { data: any }) => {
        if (data?.available_until) {
          const until = new Date(data.available_until as string);
          setAvailableUntil(until > new Date() ? until : null);
        }
      });
  }, [userId]);

  const isAvailable = availableUntil != null && availableUntil > new Date();

  const toggleAvailability = async () => {
    setToggling(true);
    hapticSuccess();
    try {
      if (isAvailable) {
        const { error } = await (supabase.rpc as any)("clear_available_now");
        if (error && error.code !== "PGRST202") throw error;
        setAvailableUntil(null);
        toast.success("Availability cleared");
      } else {
        const { data, error } = await (supabase.rpc as any)("set_available_now", { p_hours: 4 });
        if (error && error.code !== "PGRST202") throw error;
        if (data) setAvailableUntil(new Date(data));
        else setAvailableUntil(new Date(Date.now() + 4 * 60 * 60 * 1000));
        toast.success("You're marked as available for the next 4 hours");
      }
    } catch {
      toast.error("Couldn't update availability — try again");
    } finally {
      setToggling(false);
    }
  };

  const switchView = (next: ScheduleSubView) => {
    if (next === view) return;
    setView(next);
    onSubViewChange?.(next);
  };

  const isCalendar = view === "calendar";

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        eyebrow={isCalendar ? "Calendar" : "Hours"}
        title={isCalendar ? "My schedule" : "Availability"}
        meta={
          isCalendar
            ? "Your upcoming jobs and bookings"
            : "Tell posters when you can work"
        }
        onBack={onBack}
      />

      <SubViewToggle view={view} onChange={switchView} />

      {isCalendar ? (
        <ScheduleTab
          postedJobs={postedJobs}
          assignedJobs={assignedJobs}
          loading={loading}
          userId={userId}
          onBack={onBack}
          hideHeader
        />
      ) : (
        <>
          {/* "Available now" toggle — quick 4-hour signal for helprs
              who are ready to start a job today. Shows on applicant
              cards so posters can prioritize immediately-available helpers. */}
          <div
            className="rounded-ds-lg px-4 py-3.5 flex items-center justify-between gap-4 mb-4"
            style={{
              background: isAvailable ? "hsl(var(--sage) / 0.08)" : "hsl(var(--parchment) / 0.5)",
              border: isAvailable ? "1px solid hsl(var(--sage) / 0.25)" : "1px solid hsl(var(--olivewood) / 0.12)",
            }}
          >
            <div>
              <p className="text-ds-14 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {isAvailable ? "Available now" : "Mark as available"}
              </p>
              <p className="text-ds-12 text-muted-foreground">
                {isAvailable
                  ? `Until ${availableUntil!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                  : "Signal you're ready to start a job today"}
              </p>
            </div>
            <Switch
              checked={isAvailable}
              onCheckedChange={toggleAvailability}
              disabled={toggling}
              aria-label={isAvailable ? "Turn off available now" : "Turn on available now"}
            />
          </div>

          <div className="rounded-2xl liquid-glass p-5">
            <HelperAvailability userId={userId} />
          </div>
        </>
      )}
    </div>
  );
}

function SubViewToggle({
  view,
  onChange,
}: {
  view: ScheduleSubView;
  onChange: (v: ScheduleSubView) => void;
}) {
  const tabs: { id: ScheduleSubView; label: string; icon: typeof Clock }[] = [
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "availability", label: "Hours", icon: Clock },
  ];
  return (
    <div role="tablist" aria-label="Schedule view" className="shrink-0">
      <div
        className="inline-flex p-1 rounded-ds-md"
        style={{
          background: "hsl(var(--ivory-sand) / 0.55)",
          border: "1px solid hsl(var(--olivewood) / 0.12)",
        }}
      >
        {tabs.map((t) => {
          const active = view === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              className="inline-flex items-center gap-1.5 rounded-ds-sm px-3 py-1.5 text-ds-11 font-sans font-semibold transition-all active:scale-[0.97]"
              style={{
                background: active ? "hsl(var(--bark))" : "transparent",
                color: active ? "hsl(var(--parchment))" : "hsl(var(--olivewood))",
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ScheduleAvailabilityTab;
