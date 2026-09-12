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
// The "Available now" toggle came across with this half; it is an
// availability signal, not a calendar entry.
//
// IT NO LONGER MEANS "FOUR HOURS". It used to call `set_available_now` with a
// hardcoded `p_hours: 4` — a number nobody chose, on a screen that also shows
// a Sun–Sat grid of the helper's real hours, with neither system reading the
// other. Tapped at 10:44 PM it announced "Until 2:44 AM" directly underneath a
// grid that said the helper works 9 AM to 5 PM. Two answers to one question,
// eight inches apart, and the made-up one was the one posters saw.
//
// THE GRID IS AUTHORITATIVE, and the toggle now derives from it. That is the
// right way round for three reasons: the grid is the only one of the two the
// helper actually configured; "available now" is a claim about *today*, which
// is exactly what today's row already answers; and deriving it deletes the
// magic constant instead of asking the helper to re-state in hours what they
// already stated as a time. So turning it on now means "I am ready, up to the
// end of today's hours", and the row says which time that is BEFORE it is
// tapped rather than surprising the helper afterwards.
//
// When the grid cannot answer — today is switched off, or today's end time has
// already passed — nothing is invented. The row says so and offers an explicit,
// labelled two-hour signal, which is a choice the helper can see rather than a
// default they cannot.

import { useState, useEffect, useCallback } from "react";
import { report } from "@/lib/errorLogger";
import { HelperAvailability } from "@/components/HelperAvailability";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";

/** "17:00" → "5:00 PM". The grid stores wall-clock strings, not instants, so
 *  this formats the string itself rather than round-tripping through a Date
 *  and picking up the device's zone on the way. */
const formatHHMM = (hhmm: string) => {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${(mStr || "00").padStart(2, "0")} ${period}`;
};

interface AvailabilityTabProps {
  userId: string;
  onBack: () => void;
}

/** The platform zone. Every wall-clock the two sides of a job read has to be
 *  the same one, so both the derivation and the display pin to it rather than
 *  to whatever the device believes. */
const ZONE = "America/Chicago";

/** Today's date-and-time in the platform zone, as `{ day, minutes }` — the
 *  day-of-week index the grid is keyed on, and minutes since midnight. Read
 *  via `Intl` rather than the Date getters so a helper in another zone (or
 *  with a wrong device clock) still resolves against Louisiana's calendar,
 *  which is the calendar the grid rows mean. */
function nowInZone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  // `hour12: false` yields "24" for midnight in some ICU versions.
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m || 0);
};

/** The explicit fallback when the grid has no answer for the rest of today.
 *  Named, not hidden in a call site, because it is the one duration here that
 *  is a product decision rather than a reading of the helper's own hours. */
const FALLBACK_HOURS = 2;

/** The end time `HelperAvailability` seeds its grid with for a helper who has
 *  saved nothing yet. Duplicated deliberately rather than imported, because it
 *  is a CONTRACT between the two halves of this screen: if the grid's default
 *  ever changes, this must change with it or the row starts lying again. */
const DEFAULT_END = "17:00";

type TodaysHours =
  | { kind: "grid"; hours: number; endLabel: string }
  | { kind: "off" }
  | { kind: "past"; endLabel: string }
  | { kind: "unknown" };

export function AvailabilityTab({ userId, onBack }: AvailabilityTabProps) {
  // "Available now" toggle state
  const [availableUntil, setAvailableUntil] = useState<Date | null>(null);
  const [toggling, setToggling] = useState(false);
  // Today's row from the SAME `helper_availability` grid rendered below, so
  // the two halves of this screen cannot contradict each other. `"unknown"`
  // until it loads (or if it fails), and an unknown grid falls back rather
  // than blocking the toggle — a helper must always be able to say they are
  // free, even when we could not read their hours.
  const [todaysHours, setTodaysHours] = useState<TodaysHours>({ kind: "unknown" });

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

  // The weekly grid, read for TODAY only. Same table, same filters as
  // HelperAvailability's own load (`helper_id`, `specific_date IS NULL`) — it
  // is deliberately the same query rather than a second notion of "hours",
  // because the entire point of this change is that there is one.
  useEffect(() => {
    let cancelled = false;
    const { day, minutes } = nowInZone();
    supabase
      .from("helper_availability")
      .select("is_available, end_time")
      .eq("helper_id", userId)
      .is("specific_date", null)
      .eq("day_of_week", day)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Never dropped. Staying "unknown" degrades to the labelled
          // fallback, which is honest; a silent failure would quietly
          // reintroduce a duration nobody chose.
          report(error, { severity: "warning", tags: { source: "AvailabilityTab.loadTodaysHours" } });
          return;
        }
        if (data && data.is_available === false) {
          setTodaysHours({ kind: "off" });
          return;
        }
        // NO ROW IS NOT "NOT AVAILABLE". A helper who has never saved their
        // hours has no `helper_availability` rows at all, and the grid below
        // renders `DEFAULT_*` for them — "available every day, 9–5" — as its
        // starting shape. Reading a missing row as "off" here therefore
        // reintroduced, in one step, the exact contradiction this whole change
        // exists to remove: measured on the test helper, the row said "You're
        // not scheduled today" directly above a grid showing Fri 9 AM – 5 PM.
        // A missing row must resolve to whatever the grid DRAWS for it.
        const endTime = (data?.end_time as string | undefined) || DEFAULT_END;
        const endMinutes = minutesOf(endTime);
        const endLabel = formatHHMM(endTime);
        if (endMinutes <= minutes) {
          setTodaysHours({ kind: "past", endLabel });
          return;
        }
        setTodaysHours({ kind: "grid", hours: (endMinutes - minutes) / 60, endLabel });
      });
    return () => { cancelled = true; };
  }, [userId]);

  const isAvailable = availableUntil != null && availableUntil > new Date();

  /* What turning the switch ON will actually claim — computed here so the row
     can SAY it before it is tapped. The old row said only "Signal you're ready
     to start a job today" and then produced "Until 2:44 AM"; a switch whose
     consequence is only legible after you flip it is the defect, not just the
     number it picked. */
  const pendingHours =
    todaysHours.kind === "grid" ? todaysHours.hours : FALLBACK_HOURS;
  const offSubtitle = useCallback(() => {
    switch (todaysHours.kind) {
      case "grid":
        return `Ready until ${todaysHours.endLabel} — your hours for today`;
      case "off":
        return `You're not scheduled today · signal ${FALLBACK_HOURS} hours anyway`;
      case "past":
        return `Today's hours ended at ${todaysHours.endLabel} · signal ${FALLBACK_HOURS} more hours`;
      default:
        return "Signal you're ready to start a job today";
    }
  }, [todaysHours]);

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
        // DERIVED, not hardcoded. `set_available_now(p_hours numeric)` — the
        // live signature, checked with pg_get_functiondef — takes a NUMERIC,
        // so the fraction of an hour between now and today's end time goes
        // straight through and no migration is needed. The server still
        // computes and returns the expiry; this only stops us telling it a
        // number the helper never chose.
        const { data, error } = await (supabase.rpc as any)("set_available_now", { p_hours: pendingHours });
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

      {/* "Available now" — a ready-to-start-today signal for helprs, bounded by
          the SAME weekly grid rendered directly below it. Shows on applicant
          cards so posters can prioritize immediately-available helpers. */}
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
              ? `Until ${availableUntil!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ZONE })}`
              : offSubtitle()}
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
