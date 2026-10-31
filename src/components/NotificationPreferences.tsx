// Quiet-hours window stored here is enforced server-side by the
// send-push-notification edge function (PR #446).
import { Fragment, useEffect, useState } from "react";
import { useAuthReady } from "@/hooks/useAuthReady";
import { confirmConsequential } from "@/lib/toastPolicy";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { hapticError, hapticLight } from "@/lib/haptics";
import {
  Bell, Loader2, Mail, Smartphone, Lock, Moon, Send,
} from "lucide-react";
import { QuietHoursClock } from "@/components/profile/QuietHoursClock";
import { functionErrorMessage } from "@/lib/supabaseResult";
import type { Prefs, Row } from "./notificationPreferences/types";
import { defaultPrefs, trimTime, rows } from "./notificationPreferences/constants";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { promotionsEmailOn } from "@/lib/promotionsEmail";
import { SwitchSlot } from "./notificationPreferences/SwitchSlot";
import { QuoteRemindersRow } from "./notificationPreferences/QuoteRemindersRow";
import { MessagePreviewRow } from "./notificationPreferences/MessagePreviewRow";
import { QuietTimeInput } from "./notificationPreferences/QuietTimeInput";
import { ALL_PRESENT, columnsPresentIn, declutterColumnsPresent, stripMissingColumns, type ColumnPresence } from "./notificationPreferences/deployLagColumns";
import { CategoryRow } from "./notificationPreferences/CategoryRow";
import { DeclutterNotificationGroup } from "./notificationPreferences/DeclutterNotificationGroup";
import { JobRemindersGroup } from "./notificationPreferences/JobRemindersGroup";
import { NotificationPrefsLoadFailed } from "./notificationPreferences/NotificationPrefsLoadFailed";
import { emailSkipCopy, joinList, type TestSendResult } from "./notificationPreferences/testNotificationCopy";

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
  // The member's saved row could not be read (Q2311). Every switch stays
  // disabled and nothing is written until a retry reads it: `prefs` then holds
  // only `defaultPrefs`, and both writers send the WHOLE row, so one press
  // would save those defaults over every setting the member really has
  // (email_messages, quiet hours and the rest). `loadAttempt` re-runs the
  // load effect from the retry button.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const locked = !loaded || loadFailed;
  // Push-token count drives the "Send test" button. Zero = no devices
  // registered (probably haven't opened the iOS app and granted
  // permission yet); button is disabled with explanatory copy.
  const [pushTokenCount, setPushTokenCount] = useState<number>(0);
  const [sendingTest, setSendingTest] = useState(false);
  // Deploy-lag guard: which new notification_preferences columns the loaded
  // row really has; a missing one is stripped from writes (deployLagColumns.ts).
  const [columns, setColumns] = useState<ColumnPresence>(ALL_PRESENT);
  const emailMasterColumn = columns.email_enabled;
  // The sign-up email box (profiles.marketing_consent). It decides what the
  // Promotions EMAIL switch shows while the member has never chosen
  // (email_promotions NULL, Q2299): see src/lib/promotionsEmail.ts.
  const [marketingConsent, setMarketingConsent] = useState(false);

  // READ AUTH FROM THE SHARED SNAPSHOT, NOT A ONE-SHOT SAMPLE.
  //
  // This effect used to open with `await supabase.auth.getUser()` and
  // `if (cancelled || !user) return;` on a `[]` dep array. `user` resolves
  // asynchronously — getUser goes to the network whenever the access token
  // needs refreshing — so a cold load could sample it as `null`, take the
  // early return, and never reach `setLoaded(true)`. Nothing retried, because
  // the deps were empty.
  //
  // The visible result: EVERY switch on this tab stayed `disabled={!loaded}`
  // forever, with no error, no spinner and no explanation. The user simply
  // could not change a notification preference until they reloaded the page.
  //
  // Measured on prod by the press sweep, run 35768341847, /profile?tab=notifications
  // as the customer persona: 38 controls found, 26 FAILED, every one of them a
  // `<button disabled role="switch" data-disabled="">` that never became
  // clickable inside 16s — Quiet hours, Job Offers push, Job Offers email,
  // Applications push and the rest.
  //
  // This is the same defect shape `useAppShellViewport` already records: an
  // effect that "ran on mount, read `null`, and REMOVED the `desktop-rail`
  // class". Treating a not-yet-resolved auth state as a definitive "signed
  // out" is the bug, both times. `useAuthReady` exists for exactly this — it
  // exposes `isReady` so callers can tell "no user" from "not yet", and it
  // normalises the corrupt-session case in one place.
  const { user: authUser, isReady: authReady } = useAuthReady();
  const authUserId = authUser?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    // Not resolved yet: stay unloaded and wait for the snapshot to settle.
    // This effect re-runs when it does, because that is now a dependency.
    if (!authReady) return;
    (async () => {
      const user = authUser;
      // Genuinely signed out — a real answer, not a pending one. Mark loaded so
      // the tab stops presenting itself as mid-load; the controls have nothing
      // to write to and the surrounding route guards own that case.
      if (!user) {
        if (!cancelled) setLoaded(true);
        return;
      }
      if (cancelled) return;
      setUserId(user.id);
      // Both queries are independent (token count vs. preferences row) —
      // fire them together instead of one-after-another. Sequential
      // awaits here were the main contributor to the long blank period
      // before the toggles hydrated (two round-trips instead of one).
      const [{ count: tokenCount }, { data, error }, consentRead] = await Promise.all([
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
        supabase
          .from("profiles")
          .select("marketing_consent")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setPushTokenCount(tokenCount ?? 0);
      // Display only: a failed read shows a never-chosen Promotions switch as
      // off, and pressing it then writes an explicit ON, which is still the
      // member's own choice. Logged, not toasted: nothing is lost.
      if (consentRead.error) {
        console.error("[NotificationPreferences] failed to load the sign-up email choice:", consentRead.error);
      }
      setMarketingConsent(consentRead.data?.marketing_consent === true);
      // No row yet is expected (defaults apply); a real query failure is not.
      if (error) {
        console.error("[NotificationPreferences] failed to load preferences:", error);
        // No toast: the card below says so and carries the Try again button
        // (ErrorState also reports the failure), so a toast was a second
        // message for one failure with a "try again" that had no button.
        setLoadFailed(true);
        setLoaded(true);
        return;
      }
      setLoadFailed(false);
      if (data) {
        // The cast is a LEFTOVER, not a requirement. It was added while
        // `quiet_start` / `quiet_end` were still absent from the generated
        // types; they have since been regenerated and both columns are
        // present (src/integrations/supabase/types.ts, `quiet_end` /
        // `quiet_start` on notification_preferences). Reading through
        // Record<string, unknown> is still safe — Postgres returns NULL when
        // a column is absent on an older deploy, and the upsert below
        // selectively writes only the keys we care about — but nothing here
        // needs the widening any more.
        const row = data as Record<string, unknown>;
        setColumns(columnsPresentIn(row));
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
    // DEPEND ON THE ID, NOT THE OBJECT.
    //
    // `authReady` and the user are real dependencies — the whole point is that
    // this re-runs when auth settles instead of sampling once. But depending on
    // `authUser` itself makes the effect re-run on every render where the hook
    // hands back a new object with the same contents, and this effect SETS
    // STATE, so that is an infinite loop: effect -> setState -> render -> new
    // identity -> effect.
    //
    // Caught by `notificationMasterSwitch.test.tsx` hanging rather than
    // failing, once its stub returned a fresh `{ user, isReady }` each call.
    // A stub is allowed to do that; a component must not depend on it not to.
    // The id is a primitive and is what every query below actually uses.
  }, [authReady, authUserId, loadAttempt]);

  // Both writers below send the WHOLE prefs object, so both have to drop
  // `email_enabled` while the column is still deploying (see
  // `emailMasterColumn`). One place, so the two paths cannot diverge.
  //
  // `email_promotions` is written ONLY by a press on its own switch (Q2299).
  // It is the one consent column with a never-chosen NULL, and the whole-row
  // write would otherwise send whatever this screen holds for it: after a
  // failed load that is defaultPrefs' NULL, which would silently erase a
  // member's Promotions-off and restart the welcome and come-back emails
  // (lh-silent-failure review, 2026-10-21, finding 1).
  const writable = (p: Prefs, pressed?: keyof Prefs): Partial<Prefs> => {
    const payload: Partial<Prefs> = { ...p };
    stripMissingColumns(payload, columns);
    if (pressed !== "email_promotions") delete payload.email_promotions;
    return payload;
  };

  // What a switch shows. Promotions email alone can be never chosen (NULL),
  // and then shows what the senders do (src/lib/promotionsEmail.ts).
  const shownOn = (key: keyof Prefs): boolean =>
    key === "email_promotions"
      ? promotionsEmailOn(prefs.email_promotions, marketingConsent)
      : prefs[key] === true;

  const toggle = async (key: keyof Prefs) => {
    // After a failed load `prefs` is only the defaults: writing it would
    // overwrite the member's real settings (Q2311).
    if (!userId || loadFailed) return;
    // The opposite of what the switch SHOWS, so the first press on a
    // never-chosen Promotions email is an explicit choice either way.
    const newVal = !shownOn(key);
    const updated = { ...prefs, [key]: newVal };

    // No write-through mirroring any more. `job_applications` used to be
    // slaved to `new_offers`, `payments` to `financial_alerts`, and
    // `job_updates` to `transit_updates || work_status`, because those three
    // columns had no switch of their own — the mirror was standing in for a
    // control. They have switches now (constants.tsx), so mirroring would do
    // the opposite of what it was for: turn "Applications" off, then touch
    // "Job Offers", and the user's explicit choice would be silently
    // overwritten by a value they never set.
    hapticLight();
    setPrefs(updated);
    setSavingKey(key);

    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...writable(updated, key) }, { onConflict: "user_id" });

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
    if (!userId || loadFailed) return;
    const updated = { ...prefs, ...patch };
    hapticLight();
    setPrefs(updated);
    setSavingKey(key);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...writable(updated) }, { onConflict: "user_id" });
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

  // ── Email master switch — one column, exactly like the Push master ──
  //
  // `email_enabled` is a real column (migration 20260907032218) and toggling
  // it writes THAT COLUMN AND NOTHING ELSE. The eleven `email_*` category
  // columns keep whatever the user set, so turning the master off and on again
  // restores their choices instead of resetting them.
  //
  // It used to be derived — "on" meant `emailRowKeys.some(...)`, and toggling
  // blanket-wrote the same value to all eleven columns. Measured 2026-09-06 on
  // an account with `email_messages`, `email_transit_updates` and
  // `email_promotions` deliberately off: a master off → on cycle left all
  // eleven `true`. Muting email for a weekend silently re-subscribed the
  // account to marketing mail, which is the one category where re-consenting
  // someone by accident carries legal weight (CAN-SPAM / GDPR). Push never had
  // the bug precisely because its master was its own column; this is the same
  // shape, not a second mechanism.
  //
  // The `emailMasterColumn` fallback keeps the old derived reading during the
  // migration/bundle deploy window — see the state declaration above.
  const emailRowKeys = rows.map((r) => r.emailKey);
  const emailMasterEnabled = emailMasterColumn
    ? prefs.email_enabled
    : emailRowKeys.some((k) => prefs[k]);
  const toggleEmailMaster = () => {
    if (emailMasterColumn) {
      void toggle("email_enabled");
      return;
    }
    // Pre-migration only: the destructive blanket write, kept so the control
    // still does something during the deploy window rather than silently
    // no-op'ing. It stops being reachable the moment the column lands.
    const newVal = !emailMasterEnabled;
    const patch: Partial<Prefs> = {};
    emailRowKeys.forEach((k) => {
      (patch as Record<string, boolean>)[k] = newVal;
    });
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
          // The copy is built server-side (Q223): only an admin may send
          // free text, so the test names the fixed "test" template.
          body: { user_id: userId, template: "test" },
        },
      );
      if (error) throw error;

      const channels = data?.channels;
      // An older deploy of the edge function (no `channels` in the body) still
      // has to end in feedback rather than in silence — just without the
      // per-channel claim we can no longer back up.
      if (!channels) {
        confirmConsequential("Test sent — check the bell icon, and your email.");
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
        confirmConsequential(`Sent to ${joinList(landed)}.${pushNote ? " No device is registered for push." : ""}`);
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

  // A normal card, not a flex child. It used to be `flex-1 min-h-0 ... flex
  // flex-col`, which only works inside a height-constrained flex column — and
  // it was the reason the Notifications tab carried its own
  // `h-full min-h-0 flex flex-col overflow-hidden` wrapper while every other
  // Profile tab used `space-y-4`. The tab shells are one shell now (owner,
  // many times over), so this scrolls with the page like every sibling rather
  // than scrolling inside itself.
  //
  // That removal was HALF done and left the page unscrollable (VN-46, owner
  // 2026-09-14: "this page doesn't scroll" — the Test row and the security
  // note stayed cut off under Promotions). The card stopped being a flex
  // column, but the category rows kept their own
  // `flex-1 min-h-0 overflow-y-auto overscroll-contain` region. With no
  // bounded height above it `flex-1 min-h-0` resolved to the content's own
  // height, so that region never scrolled itself — while `overscroll-contain`
  // still stopped the wheel from chaining to the Profile scroll container
  // behind it. Dead end both ways. There is now NO nested scroller anywhere in
  // this card: the only scroll surface on the tab is Profile.tsx's wrapper, and
  // `src/components/profile/profileTabScroll.test.ts` fails the moment one
  // comes back — in ANY tab panel, not just this file.
  // ONE PAINT (Q169). The rows are data-shaped — Quiet Hours grows its
  // From/To rows only when it is on — so painting the table with default
  // values first and the real ones later moved every row below it (measured
  // at 375: 82px, CLS 0.055). Until the preferences are in, the tab keeps the
  // placeholder its chunk load already showed; then the real table, once.
  // One category row (notificationPreferences/CategoryRow), shared by the main
  // list and the Declutter group. Q1585 (owner, 2026-10-12): the "Daily Match
  // Digest" choice is gone; the server ignores match_digest_mode.
  const renderRow = (item: Row) => (
    <CategoryRow key={item.key} item={item} prefs={prefs} emailMasterEnabled={emailMasterEnabled}
      emailShownOn={shownOn(item.emailKey)} saving={saving} loaded={loaded} savingKey={savingKey}
      locked={locked} onToggle={toggle} />
  );

  if (!loaded) return <ProfileTabBodyReserve tab="notifications" />;

  return (
    <div className="rounded-2xl liquid-glass overflow-hidden shadow-sm">
      {/* The saved settings could not be read: say so, offer a retry, and keep
          every switch below disabled so no press can save the defaults over
          them (Q2311). */}
      {loadFailed && (
        <NotificationPrefsLoadFailed
          onRetry={() => {
            setLoaded(false);
            setLoadFailed(false);
            setLoadAttempt((n) => n + 1);
          }}
        />
      )}
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
            className="flex items-center justify-center gap-1 w-[51px] font-sans uppercase text-ds-10"
            style={{ color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}
          >
            <Smartphone className="w-3 h-3 shrink-0" /> App
          </div>
          <div
            className="flex items-center justify-center gap-1 w-[51px] font-sans uppercase text-ds-10"
            style={{ color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}
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
              Master switch
            </Label>
          </div>
        </div>
        {/* Master switches for BOTH columns, and each one is now backed by its
            own DB column — `push_enabled` and `email_enabled`. The Email
            master used to be derived from the per-category `email_*` fields,
            which is what made it destructive; see toggleEmailMaster. Aligned
            with the App / Email column headers directly below. */}
        <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
          <SwitchSlot
            loaded={loaded}
            savingKey={savingKey}
            checked={prefs.push_enabled}
            onCheckedChange={() => toggle("push_enabled")}
            disabled={locked}
            ariaLabel="Push notifications master toggle"
            savingId="push_enabled"
          />
          <SwitchSlot
            loaded={loaded}
            savingKey={savingKey}
            checked={emailMasterEnabled}
            onCheckedChange={toggleEmailMaster}
            disabled={locked}
            ariaLabel="Email notifications master toggle"
            // `toggle()` names its spinner after the column it writes, so the
            // id has to follow which path toggleEmailMaster took.
            savingId={emailMasterColumn ? "email_enabled" : "email_master"}
            title="Off mutes every email below. Your per-category choices are kept."
          />
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
                Quiet hours
              </Label>
              {/* Was "Mute non-critical pushes overnight. Security alerts still
                  fire." — the second sentence is the same false promise as the
                  old footer. `send-push-notification` returns on
                  `isInQuietHours(...)` before it loads a single token
                  (index.ts, the quiet-hours gate), with no exemption for
                  `warning`, `system_alert` or `admin_alert`: EVERY push is held
                  inside the window. The in-app bell row is still written by the
                  trigger that fired the function, so the notification is
                  waiting when the app opens — which is the true version of the
                  reassurance and what this now says.

                  Separately, and NOT fixed here: that gate evaluates the window
                  in UTC because no per-user timezone is stored, so a Louisiana
                  user's 22:00–07:00 actually mutes 17:00–02:00 local. Reported
                  to the orchestrator rather than papered over in copy — the
                  times below deliberately carry no "local" claim. */}
              <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Hold pushes overnight. Everything still lands in the bell icon.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
            <SwitchSlot
              loaded={loaded}
              savingKey={savingKey}
              checked={quietEnabled}
              onCheckedChange={toggleQuiet}
              disabled={locked || !prefs.push_enabled}
              ariaLabel="Quiet hours"
              savingId="quiet_hours"
            />
            {/* THE EM-DASH IS 0.7, NOT 0.3 — and both copies of it in this
                file (here and the saved-Helpr row) moved together.
                At 0.3 it measured 1.79:1 against a 4.5:1 AA floor: the faintest
                text in the app and, at ds-14, genuinely hard to see rather than
                merely quiet. It is NOT exempt as decoration: it is the cell's
                value — "there is no email version of this row" — and a reader
                who cannot see it reads the row as if the email column were
                simply missing.
                0.7 is the floor that clears AA (ladder on parchment: 0.3 →
                1.79, 0.5 → 2.84, 0.65 → 4.24, 0.7 → 4.90) and it is an ink the
                app already uses in 39 other places, so no new value is
                invented. It stays below the 0.8 the row labels wear, and the
                column still reads as "app only, intentionally" — only now it
                reads at all. */}
            <div className="w-[51px] flex justify-center" title="Push-only — no email version of this">
              <span
                className="font-sans text-ds-14"
                style={{ color: "hsl(var(--olivewood) / 0.7)" }}
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
              <QuietTimeInput label="From" ariaLabel="Quiet hours start time" value={prefs.quiet_start ?? "22:00"} onChange={(v) => void patchPrefs({ quiet_start: v }, "quiet_hours")} disabled={locked || !prefs.push_enabled || saving} />
              <QuietTimeInput label="to" ariaLabel="Quiet hours end time" value={prefs.quiet_end ?? "07:00"} onChange={(v) => void patchPrefs({ quiet_end: v }, "quiet_hours")} disabled={locked || !prefs.push_enabled || saving} />
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

      {/* "Show message words" sits right under Messages (Messages audit M6). */}
      {rows.map((item) => item.key !== "messages" ? renderRow(item) : (
        <Fragment key={item.key}>
          {renderRow(item)}
          {columns.message_preview && (
            <MessagePreviewRow
              loaded={loaded}
              savingKey={savingKey}
              checked={prefs.message_preview && prefs.messages && prefs.push_enabled}
              onToggle={() => void toggle("message_preview")}
              disabled={locked || !prefs.messages || !prefs.push_enabled}
              dimmed={!prefs.messages || !prefs.push_enabled}
              saving={saving}
            />
          )}
        </Fragment>
      ))}
      {!loadFailed && <JobRemindersGroup prefs={prefs} loaded={loaded} savingKey={savingKey} locked={locked} columnsReady={(key) => columns[key]} onToggle={(key) => void toggle(key)} />}

      {/* Saved-Helpr availability nudges: a STANDALONE opt-in (owner 2026-09-15), OFF by default, not a
          type-routed category row; the saved-helper-availability-push cron reads this column directly. Push-only. */}
      <div
        className={`flex items-center justify-between px-3 min-[360px]:px-4 py-2.5 shrink-0 transition-opacity ${prefs.push_enabled ? "" : "opacity-85"} ${saving ? "opacity-80 cursor-wait" : ""}`}
        style={{
          borderTop: "0.5px solid hsl(var(--olivewood) / 0.08)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
            style={{
              background: "hsl(var(--bark) / 0.14)",
              color: "hsl(var(--bark))",
            }}
          >
            <Bell className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Saved Helpr openings
            </Label>
            <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Get a nudge when a Helpr you've saved opens up new availability. Off by default.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 min-[360px]:gap-6 shrink-0 ml-1.5 min-[360px]:ml-2">
          <SwitchSlot
            loaded={loaded}
            savingKey={savingKey}
            checked={prefs.saved_helper_availability}
            onCheckedChange={() => toggle("saved_helper_availability")}
            disabled={locked || !prefs.push_enabled}
            ariaLabel="Saved Helpr availability nudges"
            savingId="saved_helper_availability"
          />
          {/* Push-only — no email version. */}
          <div className="w-[51px] flex justify-center" title="Push-only — no email version of this">
            <span
              className="font-sans text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              aria-hidden
            >
              —
            </span>
            <span className="sr-only">Push-only, no email version</span>
          </div>
        </div>
      </div>

      <QuoteRemindersRow
        loaded={loaded}
        savingKey={savingKey}
        checked={prefs.email_quote_reminders && emailMasterEnabled}
        onToggle={() => toggle("email_quote_reminders")}
        disabled={locked || !emailMasterEnabled || !columns.email_quote_reminders}
        dimmed={!emailMasterEnabled}
        saving={saving}
      />

      {/* The Declutter group (owner 2026-10-28): once its columns are deployed (a missing column could not save). Last,
          after the Jobs rows, so nothing that is not Declutter sits under it (NIGHT-SET-Declutterse-4). */}
      {declutterColumnsPresent(columns) && <DeclutterNotificationGroup renderRow={renderRow} />}

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
              background: "hsl(var(--bark) / 0.10)",
              color: "hsl(var(--bark))",
            }}
          >
            <Send className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <Label
              className="font-sans font-semibold block text-ds-14 mb-0"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Send a test
            </Label>
            <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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

      <div
        className="flex items-start gap-1.5 px-4 py-2 shrink-0"
        style={{
          background: "hsl(var(--ivory-sand) / 0.4)",
          borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)",
        }}
      >
        {/* ── This used to read "Critical security alerts — logins, disputes —
            can't be turned off." Every clause of it was false, verified
            against prod 2026-09-06:

            * There is NO sign-in or security notification type. The
              `notifications_type_check` constraint permits 18 values and 17 of
              them appear in prod; none is a login alert. The app cannot send
              the thing the sentence promised.
            * Disputes reach the two parties as type `warning`, which
              `notification_type_pref_map` routes to `system_alerts` — an
              ordinary user-controllable column, switched by the System Alerts
              row twelve pixels above this line.
            * Nothing was exempt from the master either: turning the Email
              master off wrote `email_system_alerts = false` along with
              everything else.

            The claim is not made true here because it cannot be made true from
            this file. `warning` is a mixed bag — "Job disputed" and "Account
            temporarily suspended" share it with "Last chance to review" and
            "Job expired" (prod counts, 2026-09-06) — so exempting the type
            would make review-nag mail un-silenceable, which is a worse consent
            problem than the one being fixed. A genuinely un-silenceable
            dispute alert needs its own notification type, and the producers
            that would emit it belong to the disputes lane. Filed with them.

            So this says what the screen actually does, and nothing more. The
            auth clause is accurate and worth keeping: password resets and
            sign-in mail come from Supabase Auth (`resetPasswordForEmail`,
            `src/pages/auth/ForgotPassword.tsx:61`), never through
            `notification_preferences`, so no switch on this screen can stop
            them and no switch on this screen claims to. */}
        <Lock className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
        <p
          className="font-sans leading-snug text-ds-11"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Every alert above follows these switches — including safety and
          dispute alerts, which arrive under System Alerts. Password and
          sign-in emails come from our login system and aren't controlled here.
        </p>
      </div>
    </div>
  );
};

export default NotificationPreferences;
