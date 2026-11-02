import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/ui/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { SwitchSlot } from "./SwitchSlot";
import type { Prefs } from "./types";

/**
 * "Job reminders" on the Notifications screen (owner 2026-10-29, via the lead:
 * "they need to kind of get alot to always be reminded... or give em the
 * option to choose which one they get"). Rendered from public.job_reminder_types
 * (migration 20261030031059), so a new reminder is one row there:
 *   - always on (a job can't work without it): shown as "Always on", no switch.
 *     The push fan-out sends it even with its category switched off;
 *   - switchable: ON by default, one switch bound to its
 *     notification_preferences column. Off = it is not sent at all.
 * For everyone who takes or posts jobs (never role-based). Push master off
 * still stops every push; the switch here decides whether the reminder exists.
 */

/** The switchable reminder columns this build can write. A registry row naming any other column shows no switch. */
export const REMINDER_PREF_KEYS = [
  "remind_starting_soon", "remind_finish_job", "remind_payout_followups",
  // Q2483 (20261030035326): the 2-hour, 8 AM and head-out start reminders.
  "remind_two_hours", "remind_morning_of", "remind_head_out",
] as const;
export type ReminderPrefKey = (typeof REMINDER_PREF_KEYS)[number];
const isReminderKey = (c: string | null): c is ReminderPrefKey => (REMINDER_PREF_KEYS as readonly string[]).includes(c ?? "");

interface ReminderType {
  kind: string;
  label: string;
  description: string;
  always_on: boolean;
  pref_column: string | null;
  sort_order: number;
}

/** Postgres "no such table" / PostgREST "not in the schema cache": the migration has not deployed yet. */
const notDeployed = (code: string | undefined) => code === "42P01" || code === "PGRST205";

export function JobRemindersGroup({
  prefs, loaded, savingKey, locked, columnsReady, onToggle,
}: {
  prefs: Prefs;
  loaded: boolean;
  savingKey: string | null;
  locked: boolean;
  /** This remind_* column is deployed (deployLagColumns.ts); until then its switch is read-only. */
  columnsReady: (key: ReminderPrefKey) => boolean;
  onToggle: (key: ReminderPrefKey) => void;
}) {
  // A plain read, not React Query: this screen also renders outside the app's
  // query provider (its tests), and the list is a handful of fixed rows.
  const [types, setTypes] = useState<ReminderType[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "absent">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("job_reminder_types")
          .select("kind, label, description, always_on, pref_column, sort_order")
          .order("sort_order", { ascending: true });
        if (cancelled) return;
        if (error) {
          // Not deployed yet: no section, the rest of the screen still works.
          if (notDeployed(error.code)) {
            setState("absent");
            return;
          }
          report(error, { severity: "warning", tags: { source: "JobRemindersGroup.load" } });
          setState("failed");
          return;
        }
        setTypes((data ?? []) as ReminderType[]);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        report(err, { severity: "warning", tags: { source: "JobRemindersGroup.load" } });
        setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state === "absent") return null;
  return (
    <>
      <div
        className="px-3 min-[360px]:px-4 pt-3 pb-1.5 shrink-0"
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
        data-testid="job-reminders-group"
      >
        <h3 className="font-sans font-semibold text-ds-13 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
          Job reminders
        </h3>
        <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Reminders about jobs you're booked on. Each switch covers app, email and text. The ones a job can't work without are always on.
        </p>
      </div>
      {state === "failed" ? (
        <div className="px-3 min-[360px]:px-4 py-2.5">
          <ErrorState
            variant="inline"
            title="We couldn't load your job reminders."
            onRetry={() => {
              setState("loading");
              setAttempt((a) => a + 1);
            }}
          />
        </div>
      ) : (
        (types ?? []).map((t) => {
          const key = isReminderKey(t.pref_column) ? t.pref_column : null;
          if (!t.always_on && !key) return null;
          return (
            <div
              key={t.kind}
              className="flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
              data-testid={`job-reminder-${t.kind}`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span
                  className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
                  style={{ background: "hsl(var(--bark) / 0.14)", color: "hsl(var(--bark))" }}
                >
                  <BellRing className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <Label className="font-sans font-semibold block text-ds-14 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
                    {t.label}
                  </Label>
                  <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    {t.description}
                  </p>
                </div>
              </div>
              {/* A3-104 (audit 11-01): one switch per reminder, for every channel, so it sits centred across the App and
                  Email columns (51 + gap + 51 px, CategoryRow's widths), never under Email alone. */}
              <div className="shrink-0 ml-1.5 min-[360px]:ml-2 flex justify-center w-[114px] min-[360px]:w-[126px]" data-reminder-switch-cell="">
                {key ? (
                  <SwitchSlot
                    loaded={loaded}
                    savingKey={savingKey}
                    checked={prefs[key] === true}
                    onCheckedChange={() => onToggle(key)}
                    disabled={locked || !columnsReady(key)}
                    ariaLabel={`${t.label} reminder`}
                    savingId={key}
                  />
                ) : (
                  <span className="font-sans font-semibold text-ds-12 whitespace-nowrap" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    Always on
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
