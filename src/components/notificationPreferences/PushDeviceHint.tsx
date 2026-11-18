import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRequestPushPermissionOutcome } from "@/lib/nativePush";

/**
 * No phone or browser registered for push (owner 2026-11-01): say how to get alerts at the TOP of the
 * notification settings, not only in the "Send a test" row at the bottom.
 *
 * A3-90 (lead 11-01; the owner herself has no push device): the hint is an action, not a sentence. "Turn on phone
 * notifications" runs the app's own request (useRequestPushPermissionOutcome: our rationale dialog, then the OS or
 * browser prompt and, on web, saving this browser's subscription), then shows what happened. "Not now" in our own
 * dialog changes nothing.
 */
const PUSH_HINT_ON = "On";
const PUSH_HINT_TITLE = "Push notifications";
export const PUSH_HINT_BLOCKED_PHONE = "Blocked in your phone's Settings: open Settings → Louisiana Helpr → Notifications.";
export const PUSH_HINT_BLOCKED_BROWSER = "Blocked in this browser: allow notifications for this site in the browser's settings.";

export function PushDeviceHint() {
  const requestPush = useRequestPushPermissionOutcome();
  const [state, setState] = useState<"idle" | "asking" | "on" | "blocked">("idle");

  const turnOn = async () => {
    setState("asking");
    const outcome = await requestPush();
    setState(outcome === "granted" ? "on" : outcome === "refused" ? "blocked" : "idle");
  };

  return (
    // M11 (owner 11-16: push before text alerts): its own titled section, first on the page, with a full-width button.
    <section
      data-testid="push-device-hint"
      aria-labelledby="push-device-hint-title"
      className="mb-4 rounded-2xl liquid-glass overflow-hidden shadow-sm font-sans text-ds-13"
      style={{ color: "hsl(var(--ink-deep) / 0.8)" }}
    >
      {/* Design audit 11-17 #26: the same header as the Text alerts card under it (SmsAlertsCard): an icon circle, the
          tinted band, the title and an On / Off pill. */}
      <div
        className="flex items-center gap-2.5 px-3 min-[360px]:px-4 py-2.5"
        style={{ background: "hsl(var(--bark) / 0.06)", borderBottom: "0.5px solid hsl(var(--bark) / 0.18)" }}
      >
        <span
          className="shrink-0 w-7 h-7 rounded-full hidden min-[360px]:flex items-center justify-center"
          style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}
        >
          <Bell className="w-3.5 h-3.5" aria-hidden />
        </span>
        <h2 id="push-device-hint-title" className="font-sans font-semibold text-ds-14 flex-1 min-w-0" style={{ color: "hsl(var(--ink-deep))" }}>{PUSH_HINT_TITLE}</h2>
        <span
          {...(state === "on" ? { role: "status", "data-testid": "push-device-hint-result" } : {})}
          className="shrink-0 rounded-full px-2 py-0.5 font-sans text-ds-12 font-semibold"
          style={state === "on"
            ? { background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }
            : { background: "hsl(var(--ink-deep) / 0.06)", color: "hsl(var(--ink-deep) / 0.7)" }}
        >
          {state === "on" ? PUSH_HINT_ON : "Off"}
        </span>
      </div>
      <div className="px-3 min-[360px]:px-4 py-3 space-y-3">
        {/* F454 (audit 11-10): the button says what you get, not the setting's name. */}
        <p>Hear about messages and job updates as they happen.</p>
        {state !== "on" && (
          <Button variant="primary" size="sm" className="w-full" disabled={state === "asking"} onClick={() => { void turnOn(); }}>
            Get alerts on this phone
          </Button>
        )}
        {state === "blocked" && (
          <p role="status" data-testid="push-device-hint-result">
            {Capacitor.isNativePlatform() ? PUSH_HINT_BLOCKED_PHONE : PUSH_HINT_BLOCKED_BROWSER}
          </p>
        )}
      </div>
    </section>
  );
}
