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
export const PUSH_HINT_ON = "On";
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
    <div
      data-testid="push-device-hint"
      className="px-3 min-[360px]:px-4 py-2.5 font-sans text-ds-13 flex flex-wrap items-center gap-x-3 gap-y-2"
      style={{ color: "hsl(var(--ink-deep) / 0.8)", borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
    >
      <p className="flex-1 min-w-[10rem]">Get alerts on your phone.</p>
      {state === "on" ? (
        <p role="status" data-testid="push-device-hint-result" className="font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
          {PUSH_HINT_ON}
        </p>
      ) : (
        <Button variant="primary" size="sm" className="ml-auto" disabled={state === "asking"} onClick={() => { void turnOn(); }}>
          Turn on phone notifications
        </Button>
      )}
      {state === "blocked" && (
        <p role="status" data-testid="push-device-hint-result" className="basis-full">
          {Capacitor.isNativePlatform() ? PUSH_HINT_BLOCKED_PHONE : PUSH_HINT_BLOCKED_BROWSER}
        </p>
      )}
    </div>
  );
}
