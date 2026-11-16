import { useState } from "react";
import { Capacitor } from "@capacitor/core";
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
      className="mb-4 rounded-2xl liquid-glass overflow-hidden shadow-sm px-4 py-4 font-sans text-ds-13 space-y-3"
      style={{ color: "hsl(var(--ink-deep) / 0.8)" }}
    >
      <div className="space-y-1">
        <h2 id="push-device-hint-title" className="text-ds-15 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{PUSH_HINT_TITLE}</h2>
        {/* F454 (audit 11-10): the button says what you get, not the setting's name. */}
        <p>Hear about messages and job updates as they happen.</p>
      </div>
      {state === "on" ? (
        <p role="status" data-testid="push-device-hint-result" className="font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
          {PUSH_HINT_ON}
        </p>
      ) : (
        <Button variant="primary" size="sm" className="w-full" disabled={state === "asking"} onClick={() => { void turnOn(); }}>
          Get alerts on this phone
        </Button>
      )}
      {state === "blocked" && (
        <p role="status" data-testid="push-device-hint-result">
          {Capacitor.isNativePlatform() ? PUSH_HINT_BLOCKED_PHONE : PUSH_HINT_BLOCKED_BROWSER}
        </p>
      )}
    </section>
  );
}
