import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";

/** The Notifications tab's "Send a test" card (moved out of NotificationPreferences.tsx, Q806); the send is useSendTestPush. */
export function TestSendCard({ loaded, sendingTest, sendTestPush, pushTokenCount }: {
  loaded: boolean;
  sendingTest: boolean;
  sendTestPush: () => void | Promise<void>;
  pushTokenCount: number | null;
}) {
  return (
    <>
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
            {pushTokenCount === null
              ? "Couldn't check your devices — we'll still test by email and in-app."
              : pushTokenCount === 0
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
    </>
  );
}
