// Availability — Profile tab.
//
// SPLIT from the merged Schedule+Availability tab (2026-08-19, owner
// request). That tab put "Calendar" and "Hours" behind an in-page segmented
// control, which meant one Profile row opened a screen that then asked you to
// pick again, and the header title changed under a back button that didn't.
// They are two separate concerns — what is already booked vs. when you are
// willing to work — so they are now two separate Profile tabs, each reached
// from its own row and each with its own plain ProfileTabHeader.
//
// The "Available now" 4-hour toggle came across with this half; it is an
// availability signal, not a calendar entry.

import { useState, useEffect } from "react";
import { report } from "@/lib/errorLogger";
import { HelperAvailability } from "@/components/HelperAvailability";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";

interface AvailabilityTabProps {
  userId: string;
  onBack: () => void;
}

export function AvailabilityTab({ userId, onBack }: AvailabilityTabProps) {
  // "Available now" toggle state
  const [availableUntil, setAvailableUntil] = useState<Date | null>(null);
  const [toggling, setToggling] = useState(false);

  // Load current availability status from profiles.
  // `available_until` is a column added by migration; the `any` cast is
  // carried over verbatim because the generated types don't include it yet.
  useEffect(() => {
    (supabase.from("profiles") as any)
      .select("available_until")
      .eq("user_id", userId)
      .single()
      .then(({ data, error }: { data: any; error: unknown }) => {
        // Degrade to "not available now" (the safe default for a status
        // toggle), but never silently — CLAUDE.md: never drop the error.
        if (error) {
          report(error, { severity: "warning", tags: { source: "AvailabilityTab.loadStatus" } });
          return;
        }
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
      // The `error.code !== "PGRST202"` escape that used to wrap both calls is
      // gone. CLAUDE.md allows swallowing PGRST202 as a DEPLOY-LAG fallback for
      // a BRAND-NEW RPC; these two shipped in migration 20260612430000 and have
      // been live for months. Today a PGRST202 means the function was dropped
      // or EXECUTE was revoked — and the old code answered that by flipping the
      // switch to "Available now" anyway. The toggle stayed on, the database
      // was untouched, and posters never saw the helper as available.
      if (isAvailable) {
        const { error } = await (supabase.rpc as any)("clear_available_now");
        if (error) throw error;
        setAvailableUntil(null);
      } else {
        const { data, error } = await (supabase.rpc as any)("set_available_now", { p_hours: 4 });
        if (error) throw error;
        // No `else` branch inventing `now + 4h`. That fabricated a server state
        // that did not exist: the card then rendered "Available now · Until
        // 6:42 PM" off a number computed in the browser. A missing return value
        // from a function whose whole job is to return the new expiry is a
        // failure, not a default.
        if (!data) throw new Error("set_available_now returned no expiry");
        setAvailableUntil(new Date(data));
      }
    } catch (err) {
      // Was a bare `catch {}` → toast. A dropped or revoked RPC is exactly the
      // failure this screen cannot see on its own, so it needs a signal.
      report(err, { severity: "error", tags: { source: "AvailabilityTab.toggle" }, context: { userId } });
      hapticError();
      toast.error("Couldn't update availability — try again.");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title="Availability"
        onBack={onBack}
      />

      {/* "Available now" — quick 4-hour signal for helprs ready to start a
          job today. Shows on applicant cards so posters can prioritize
          immediately-available helpers. */}
      <div
        className="rounded-ds-lg px-4 py-3.5 flex items-center justify-between gap-4"
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
              // Pinned to the platform zone. Without `timeZone` this renders in
              // the DEVICE's zone, so a helper travelling (or with a wrong
              // device clock) read a different wall-clock expiry than the
              // poster reading the same signal on the applicant card.
              ? `Until ${availableUntil!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}`
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
    </div>
  );
}

export default AvailabilityTab;
