// Quiet-hours window stored here is enforced server-side by the
// send-push-notification edge function (PR #446).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import {
  Bell, CheckCircle2, Loader2, Mail, Smartphone, Lock, Moon, Send,
} from "lucide-react";
import { QuietHoursClock } from "@/components/profile/QuietHoursClock";
import { functionErrorMessage } from "@/lib/supabaseResult";
import type { Prefs } from "./notificationPreferences/types";
import { defaultPrefs, trimTime, rows } from "./notificationPreferences/constants";

/** One delivery channel's outcome, as reported by `create-notification`. */
type TestChannel = {
  status?: "sent" | "skipped" | "failed" | "queued";
  /** Machine reason for a skip/failure (e.g. `email_disabled`). */
  reason?: string;
  /** Masked recipient, e.g. `lexi…@gmail.com`. */
  detail?: string;
  /** The `notification_preferences` column that suppressed the email. */
  pref_column?: string;
  /** Push only: how many devices this account has registered. */
  devices?: number;
};

type TestSendResult = {
  success?: boolean;
  notification_id?: string;
  channels?: { in_app?: TestChannel; email?: TestChannel; push?: TestChannel };
};

// The email pref column the server names maps back to the row label the user
// can actually see and flip on this very screen, so the failure copy points at
// a switch rather than at a database column.
const EMAIL_PREF_LABEL: Record<string, string> = {
  email_new_offers: "Job Offers",
  email_messages: "Messages",
  email_transit_updates: "Transit Updates",
  email_work_status: "Work Status",
  email_financial_alerts: "Payments & Tips",
  email_reviews: "Reviews",
  email_promotions: "Promotions",
  email_system_alerts: "system alerts",
};

/** `["a", "b", "c"]` -> `"a, b and c"`. */
const joinList = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const emailSkipCopy = (ch: TestChannel): string => {
  switch (ch.reason) {
    case "email_disabled": {
      const label = ch.pref_column ? EMAIL_PREF_LABEL[ch.pref_column] : undefined;
      return label
        ? `the Email switch for ${label} is off`
        : "email is turned off for this category";
    }
    case "no_email":
      return "your account has no email address on file";
    case "suppressed":
      return "your email address is on our bounce list";
    case "suppression_check_failed":
      return "we couldn't check your email address";
    default:
      return "the email was skipped";
  }
};

const NotificationPreferences = () => {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  // Tracks WHICH toggle is in flight (not just whether *something* is
  // saving) so the inline spinner can render next to the actual switch
  // being changed instead of floating in one fixed spot unrelated to
  // the control the user is touching.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const saving = savingKey !== null;
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Push-token count drives the "Send test" button. Zero = no devices
  // registered (probably haven't opened the iOS app and granted
  // permission yet); button is disabled with explanatory copy.
  const [pushTokenCount, setPushTokenCount] = useState<number>(0);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      setUserId(user.id);
      // Both queries are independent (token count vs. preferences row) —
      // fire them together instead of one-after-another. Sequential
      // awaits here were the main contributor to the long blank period
      // before the toggles hydrated (two round-trips instead of one).
      const [{ count: tokenCount }, { data, error }] = await Promise.all([
        // Push tokens count — head:true so we only get the count, not rows.
        supabase
          .from("push_tokens")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("notification_preferences")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setPushTokenCount(tokenCount ?? 0);
      // No row yet is expected (defaults apply); a real query failure is not.
      if (error) {
        console.error("[NotificationPreferences] failed to load preferences:", error);
        toast.error("Couldn't load notification preferences — try again?");
      } else if (data) {
        // Cast through `any` because the generated supabase/types.ts
        // doesn't include `quiet_start` / `quiet_end` until the new
        // migration is applied + types are regenerated. The column is
        // safe to read either way (Postgres returns NULL when absent
        // on an older deploy, and the upsert below selectively writes
        // only the keys we care about).
        const row = data as Record<string, unknown>;
        setPrefs({
          ...defaultPrefs,
          ...(data as Partial<Prefs>),
          quiet_start: trimTime(row.quiet_start as string | null | undefined),
          quiet_end: trimTime(row.quiet_end as string | null | undefined),
        });
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async (key: keyof Prefs) => {
    if (!userId) return;
    const newVal = !prefs[key];
    const updated = { ...prefs, [key]: newVal };

    if (key === "new_offers") updated.job_applications = newVal;
    if (key === "email_new_offers") updated.email_job_applications = newVal;
    if (key === "transit_updates" || key === "work_status") {
      updated.job_updates = updated.transit_updates || updated.work_status;
    }
    if (key === "email_transit_updates" || key === "email_work_status") {
      updated.email_job_updates = updated.email_transit_updates || updated.email_work_status;
    }
    if (key === "financial_alerts") updated.payments = newVal;
    if (key === "email_financial_alerts") updated.email_payments = newVal;

    setPrefs(updated);
    setSavingKey(key);

    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...updated } as any, { onConflict: "user_id" });

    setSavingKey(null);
    if (error) {
      setPrefs(prefs);
      hapticError();
      toast.error("We couldn't save that preference — please try again.");
    }
  };

  // Patch a partial-update onto prefs and persist. Used by the
  // quiet-hours toggle/time controls (and the Email master switch) so
  // we can write several keys together (a single round-trip) instead
  // of sequential `toggle()` round-trips that would each fight for the
  // optimistic-state slot. `key` identifies which control to show the
  // inline spinner next to.
  const patchPrefs = async (patch: Partial<Prefs>, key: string) => {
    if (!userId) return;
    const updated = { ...prefs, ...patch };
    setPrefs(updated);
    setSavingKey(key);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...updated } as any, { onConflict: "user_id" });
    setSavingKey(null);
    if (error) {
      setPrefs(prefs);
      hapticError();
      toast.error("We couldn't save quiet hours — please try again.");
    }
  };

  const quietEnabled = !!prefs.quiet_start && !!prefs.quiet_end;
  const toggleQuiet = () => {
    if (quietEnabled) {
      void patchPrefs({ quiet_start: null, quiet_end: null }, "quiet_hours");
    } else {
      // Sensible default: 22:00 → 07:00 — a typical sleep window. The
      // user can change either bound inline.
      void patchPrefs({ quiet_start: "22:00", quiet_end: "07:00" }, "quiet_hours");
    }
  };

  // Email master switch. There's no dedicated `email_enabled` column
  // (only `push_enabled` exists server-side), so this reuses the
  // existing per-category `email_*` plumbing: "on" means at least one
  // email category is enabled, and toggling flips every email category
  // exposed in the row list together in one round-trip. This mirrors
  // how `push_enabled` gates the App column without needing a schema
  // change.
  const emailRowKeys = rows.map((r) => r.emailKey);
  const emailMasterEnabled = emailRowKeys.some((k) => prefs[k]);
  const toggleEmailMaster = () => {
    const newVal = !emailMasterEnabled;
    const patch: Partial<Prefs> = {};
    emailRowKeys.forEach((k) => {
      (patch as Record<string, boolean>)[k] = newVal;
    });
    // Keep legacy mirror fields (read by older server code paths) in sync,
    // same as the single-row toggle() does.
    patch.email_job_applications = newVal;
    patch.email_job_updates = newVal;
    void patchPrefs(patch, "email_master");
  };

  // Test notification — proves the pipeline end-to-end. Insert a
  // notification row for ourselves; a DB trigger fans it out to
  // send-push-notification (see migration 20260506120000) AND
  // create-notification itself chains send-notification-email with the
  // service-role key. create-notification is the user-callable wrapper
  // that lets a signed-in user target *themselves* (it 403s on any
  // other user_id unless the caller is admin), so we don't need a
  // service-role bearer here.
  //
  // Previously this whole button was disabled with zero registered push
  // devices, which left web/desktop users (and anyone who hasn't opened
  // the native app yet) with no way to test ANY channel — even though
  // the same call also lands an in-app bell notification and an email.
  // Push is just one of three channels this call exercises, so only the
  // absence of a signed-in user (or a call in flight) should block it.
  const sendTestPush = async () => {
    if (!userId || sendingTest) return;
    setSendingTest(true);
    try {
      // Read `data`, not just `error`. A 200 from create-notification used to
      // be reported as "Test sent — check your email and the bell icon" even on
      // runs where the email had been silently skipped (the Email switch for
      // this category was off, the address was suppressed, or Resend refused
      // it) — the function returned a blanket `{ success: true }` and the copy
      // promised delivery it had no evidence for. It now reports each channel,
      // and this toast says only what actually happened.
      const { data, error } = await supabase.functions.invoke<TestSendResult>(
        "create-notification",
        {
          body: {
            user_id: userId,
            title: "Test from Helpr",
            message: "If you got this, notifications are working. " + new Date().toLocaleTimeString(),
            type: "info",
          },
        },
      );
      if (error) throw error;

      const channels = data?.channels;
      // An older deploy of the edge function (no `channels` in the body) still
      // has to end in feedback rather than in silence — just without the
      // per-channel claim we can no longer back up.
      if (!channels) {
        toast.success("Test sent — check the bell icon, and your email.");
        return;
      }

      // Keep the row's own copy honest: the device count the server just
      // measured beats whatever we read when the screen first mounted.
      if (typeof channels.push?.devices === "number") {
        setPushTokenCount(channels.push.devices);
      }

      const devices = channels.push?.devices ?? 0;

      const landed: string[] = [];
      if (channels.in_app?.status === "sent") landed.push("the bell icon");
      if (channels.email?.status === "sent") {
        landed.push(channels.email.detail ? `email to ${channels.email.detail}` : "email");
      }
      if (devices > 0) {
        landed.push(`push to ${devices} device${devices === 1 ? "" : "s"}`);
      }

      // Something went wrong that the user did not already know about.
      const issues: string[] = [];
      if (channels.email?.status === "skipped") {
        issues.push(emailSkipCopy(channels.email));
      } else if (channels.email?.status === "failed") {
        issues.push("the email couldn't be sent");
      }
      // Zero registered devices is a stated fact, not a surprise — the row's
      // own subtitle already says so. It is worth repeating in the result so
      // "nothing buzzed my phone" has an answer, but it does not by itself
      // make an otherwise-clean send into a warning.
      const pushNote = devices === 0 ? "no device is registered for push" : null;

      if (landed.length === 0) {
        hapticError();
        toast.error(`Test didn't reach you — ${joinList([...issues, ...(pushNote ? [pushNote] : [])]) || "no channel was available"}.`);
      } else if (issues.length > 0) {
        toast.warning(`Sent to ${joinList(landed)} — but ${joinList([...issues, ...(pushNote ? [pushNote] : [])])}.`);
      } else {
        toast.success(`Sent to ${joinList(landed)}.${pushNote ? " No device is registered for push." : ""}`);
      }
    } catch (err: unknown) {
      hapticError();
      // The SDK's own message on a non-2xx is the useless "Edge Function
      // returned a non-2xx status code"; the real reason is in the response
      // body, which functionErrorMessage digs out.
      toast.error(await functionErrorMessage(err, "Test failed — please try again."));
    } finally {
      setSendingTest(false);
    }
  };

  // One slot = one switch column cell. Renders a skeleton pill while the
  // initial fetch is in flight (instead of an invisible-but-technically-
  // there switch behind opacity-0, which is what made the toggles look
  // "unresponsive" during the blank load period), and — once loaded —
  // an inline spinner scoped to THIS switch while it's the one being
  // saved, rather than one global spinner floating in an unrelated spot.
  const SwitchSlot = ({
    checked, onCheckedChange, disabled, ariaLabel, savingId, title,
  }: {
    checked: boolean; onCheckedChange: () => void; disabled: boolean; ariaLabel: string; savingId: string; title?: string;
  }) => (
    <div className="w-[51px] flex justify-center relative" title={title}>
      {loaded ? (
        <>
          <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={ariaLabel} />
          {savingKey === savingId && (
            <Loader2
              className="w-3 h-3 animate-spin absolute -top-1.5 -right-0.5 z-10 pointer-events-none"
              style={{ color: "hsl(var(--olivewood))" }}
              aria-label="Saving"
            />
          )}
        </>
      ) : (
        <div
          className="h-[31px] w-[51px] rounded-full animate-pulse"
          style={{ background: "hsl(var(--olivewood) / 0.14)" }}
          aria-hidden
        />
      )}
    </div>
  );

  // A normal card, not a flex child. It used to be `flex-1 min-h-0 ... flex
  // flex-col`, which only works inside a height-constrained flex column — and
  // it was the reason the Notifications tab carried its own
  // `h-full min-h-0 flex flex-col overflow-hidden` wrapper while every other
  // Profile tab used `space-y-4`. The tab shells are one shell now (owner,
  // many times over), so this scrolls with the page like every sibling rather
  // than scrolling inside itself.
  return (
    <div className="rounded-2xl liquid-glass overflow-hidden shadow-sm">
      {/* Column header — App / Email column labels sit directly above
          the master switches (and every row's switches) below, since
          the master row now carries its own two-column switch pair too.
          Fixed-width slots keep the labels aligned with their toggles
          regardless of icon/text rendering quirks across browsers. */}
      <div
        className="flex items-center justify-end px-4 py-1.5 shrink-0"
        style={{
          background: "hsl(var(--ivory-sand) / 0.4)",
          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)",
        }}
      >
        <div className="flex items-center gap-6">
          <div
            className="flex items-center justify-center gap-1 w-[51px] font-serif italic uppercase text-ds-10"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.12em" }}
          >
            <Smartphone className="w-3 h-3 shrink-0" /> App
          </div>
          <div
            className="flex items-center justify-center gap-1 w-[51px] font-serif italic uppercase text-ds-10"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.12em" }}
          >
            <Mail className="w-3 h-3 shrink-0" /> Email
          </div>
        </div>
      </div>

      {/* Push + Email master toggles — gate every row below them, so
          they're the lead control. Bark-tinted backdrop signals "this
          is the master switch" without shouting. */}
      {/* ── Why every row below drops its glyph and tightens up under 360px ──
          The label column here is whatever is left after fixed furniture, and
          at 320 there is almost nothing left. Measured 2026-09-01: the panel is
          254px inside, and the row spends 32 on `px-4`, 28+10 on the category
          glyph, 51+24+51 on the two switch slots and the gap between them, and
          8 on `ml-2` — 204px of furniture, leaving the label and its
          description a 50px column.

          Everything in that column was already failing at the DEFAULT scale, not
          just the Senior one: "Master Switch" rendered "Mast…", "Promotions"
          rendered "Promo…", and the descriptions stacked one word per line. The
          `constants.tsx` note that sizes these labels assumed a ~131px column,
          which is what they get at 375 — it never accounted for 320.

          Senior Mode then made it worse rather than better, which is the defect
          this change exists to fix: at 17px the same labels needed 113–125px in
          a column that had not moved.

          So, below 360px only: hide the decorative glyph (38px — it is
          duplicated by the label's own words and carries no information the
          label does not), `px-3` instead of `px-4` (8px), and `gap-3`/`ml-1.5`
          between the switch slots (16px). That returns 62px, tripling the label
          column to ~112px — enough for "Promotions" on one line and for the
          two-word labels to WRAP onto two, which is why `truncate` comes off
          them as well. They are short, bounded, Title Case pairs (see
          `constants.tsx`), so wrapping them is bounded too; this is not the
          unbounded prose case that wants a clamp. From 360 up nothing changes. */}
      <div
        className="flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 relative"
        style={{
          background: "hsl(var(--bark) / 0.06)",
          borderBottom: "0.5px solid hsl(var(--bark) / 0.18)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
            style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}
          >
            <Bell className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Master Switch
            </Label>
          </div>
        </div>
        {/* Master switches for BOTH columns — App (push_enabled, backed
            by its own DB column) and Email (derived from the per-category
            email_* fields — see toggleEmailMaster). Aligned with the App /
            Email column headers directly below. */}
        <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
          <SwitchSlot
            checked={prefs.push_enabled}
            onCheckedChange={() => toggle("push_enabled")}
            disabled={!loaded}
            ariaLabel="Push notifications master toggle"
            savingId="push_enabled"
          />
          <SwitchSlot
            checked={emailMasterEnabled}
            onCheckedChange={toggleEmailMaster}
            disabled={!loaded}
            ariaLabel="Email notifications master toggle"
            savingId="email_master"
            // There's no dedicated email_enabled column — "on" here means
            // "at least one email category is on" (see emailMasterEnabled
            // above), so it reads as on from a partial state too. Toggling
            // it always sets every category to the same value; it does not
            // remember or restore a prior partial mix.
            title="Turns all email categories on or off together"
          />
        </div>
      </div>

      {/* Scrollable category region — master toggle + column header stay
          pinned above, the security note stays pinned below, and the
          digest + per-category rows scroll between them so every option
          is reachable on a short viewport. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      {/* Digest mode toggle — when on, non-urgent job-match pushes are
          batched into one daily summary instead of firing per-match.
          Sits between the master and the per-category rows so it reads
          as a delivery preference, not a category. */}
      <div
        className={`flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${prefs.push_enabled ? "" : "opacity-85"} ${saving ? "opacity-80 cursor-wait" : ""}`}
        style={{
          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.14)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Daily Match Digest
            </Label>
            <p className="font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Batch non-urgent matches into one push per day. Urgent jobs still fire instantly.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
          <SwitchSlot
            checked={prefs.match_digest_mode}
            onCheckedChange={() => toggle("match_digest_mode")}
            disabled={!loaded || !prefs.push_enabled}
            ariaLabel="Daily match digest"
            savingId="match_digest_mode"
          />
          {/* Email column placeholder — digest is a push-only delivery
              mode, but the dash keeps the two-column grid visually
              honest so the row reads as "app only, intentionally". */}
          <div className="w-[51px] flex justify-center" title="Push-only — no email version of this">
            <span
              className="font-serif text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.3)" }}
              aria-hidden
            >
              —
            </span>
            <span className="sr-only">Push-only, no email version</span>
          </div>
        </div>
      </div>

      {/* Quiet hours — when on, non-critical pushes are suppressed
          between start and end (security alerts always fire). Sits
          between the digest toggle and the per-category rows so it
          reads as a delivery preference, not a category. */}
      <div
        className={`px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${prefs.push_enabled ? "" : "opacity-85"} ${saving ? "opacity-80 cursor-wait" : ""}`}
        style={{
          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
              style={{
                background: "hsl(var(--bark) / 0.10)",
                color: "hsl(var(--bark))",
              }}
            >
              <Moon className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <Label
                className="font-sans font-semibold block text-ds-14 mb-0"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Quiet Hours
              </Label>
              <p className="font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Mute non-critical pushes overnight. Security alerts still fire.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
            <SwitchSlot
              checked={quietEnabled}
              onCheckedChange={toggleQuiet}
              disabled={!loaded || !prefs.push_enabled}
              ariaLabel="Quiet hours"
              savingId="quiet_hours"
            />
            <div className="w-[51px] flex justify-center" title="Push-only — no email version of this">
              <span
                className="font-serif text-ds-14"
                style={{ color: "hsl(var(--olivewood) / 0.3)" }}
                aria-hidden
              >
                —
              </span>
              <span className="sr-only">Push-only, no email version</span>
            </div>
          </div>
        </div>
        {quietEnabled && (
          <div className="mt-2 flex items-start gap-3 pl-[2.375rem]">
            <div className="flex-1 flex items-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                <span className="font-serif italic">From</span>
                <input
                  type="time"
                  value={prefs.quiet_start ?? "22:00"}
                  onChange={(e) => void patchPrefs({ quiet_start: e.target.value }, "quiet_hours")}
                  disabled={!prefs.push_enabled || saving}
                  aria-label="Quiet hours start time"
                  className="rounded-ds-sm border border-border/40 bg-card px-2 py-1 text-ds-11 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="inline-flex items-center gap-1.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                <span className="font-serif italic">to</span>
                <input
                  type="time"
                  value={prefs.quiet_end ?? "07:00"}
                  onChange={(e) => void patchPrefs({ quiet_end: e.target.value }, "quiet_hours")}
                  disabled={!prefs.push_enabled || saving}
                  aria-label="Quiet hours end time"
                  className="rounded-ds-sm border border-border/40 bg-card px-2 py-1 text-ds-11 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
            </div>
            {/* Visual donut — translates the start/end times into a 24hr
                arc so it's immediately clear *which* hours are muted.
                Pure visual, no interaction. */}
            <QuietHoursClock
              start={prefs.quiet_start ?? "22:00"}
              end={prefs.quiet_end ?? "07:00"}
              size={48}
            />
          </div>
        )}
      </div>

      {rows.map((item) => (
        <div
          key={item.key}
          className={`flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${
            prefs.push_enabled || prefs[item.emailKey] ? "" : "opacity-85"
          } ${saving ? "opacity-80 cursor-wait" : ""}`}
          style={{
            borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.10)",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              {item.icon}
            </span>
            <Label
              className="font-sans font-semibold text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {item.label}
            </Label>
          </div>
          <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
            <SwitchSlot
              checked={prefs[item.key] && prefs.push_enabled}
              onCheckedChange={() => toggle(item.key)}
              disabled={!loaded || !prefs.push_enabled}
              ariaLabel={`${item.label} push`}
              savingId={item.key}
            />
            <SwitchSlot
              checked={prefs[item.emailKey]}
              onCheckedChange={() => toggle(item.emailKey)}
              disabled={!loaded}
              ariaLabel={`${item.label} email`}
              savingId={item.emailKey}
            />
          </div>
        </div>
      ))}

      {/* Test button — proves push + email + in-app end-to-end (see
          sendTestPush above). Zero registered push devices no longer
          disables the whole thing — email and the in-app bell still
          fire, so the copy just narrows what to expect. Placed at the
          BOTTOM of the list — it's a diagnostic action, not a
          preference, so it shouldn't compete with the settings above it
          for the user's first glance. */}
      <div
        className="flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0"
        style={{
          borderTop: "0.5px solid hsl(var(--olivewood) / 0.08)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.10)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <Send className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Send a Test
            </Label>
            <p className="font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {pushTokenCount === 0
                ? "No devices registered — we'll test by email and in-app instead."
                : `Push to ${pushTokenCount} registered device${pushTokenCount === 1 ? "" : "s"}, plus email and in-app.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={sendTestPush}
          disabled={!loaded || sendingTest}
          className="shrink-0 ml-2 inline-flex items-center gap-1 rounded-ds-sm px-2 py-1 text-ds-10 font-sans font-semibold active:scale-[0.96] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(var(--bark))",
          }}
          aria-label="Send test notification"
        >
          {sendingTest ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> Sending
            </>
          ) : (
            <>
              <Send className="w-3 h-3" /> Test
            </>
          )}
        </button>
      </div>
      </div>

      <div
        className="flex items-start gap-1.5 px-4 py-2 shrink-0"
        style={{
          background: "hsl(var(--ivory-sand) / 0.4)",
          borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)",
        }}
      >
        <Lock className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
        <p
          className="font-serif italic leading-snug text-ds-11"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Critical security alerts — logins, disputes — can't be turned off.
        </p>
      </div>
    </div>
  );
};

export default NotificationPreferences;
