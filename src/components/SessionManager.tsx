import { useEffect } from "react";
import { useLoginTracking } from "@/hooks/useLoginTracking";
import { useNativePushSetup } from "@/lib/nativePush";
import { useWebPushAskAfterJobAction, useWebPushBootSync } from "@/hooks/useWebPush";
import { useDynamicTypeSync, OS_LARGE_TEXT_THRESHOLD } from "@/lib/accessibility";
import { seniorModeMetadataPatch, sessionSeniorFlag, syncSeniorMode } from "@/lib/simpleMode";
import { useCppVariantRouter } from "@/lib/cppRouting";
import { useSignupSourceReport } from "@/lib/signupSource";
import { useAppShellViewport } from "@/hooks/useAppShellViewport";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useAppLifecycle } from "@/lib/appLifecycle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDarkMode } from "@/hooks/useDarkMode";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const supabaseClient = () => import("@/integrations/supabase/client");

// App-wide boot hooks with no UI, mounted once inside <BrowserRouter> by App.tsx.
// Moved verbatim out of App.tsx (component-size ratchet, Q806); App.tsx still
// renders <SessionManager /> at the same place in the tree.
export const SessionManager = () => {
  // Idle sign-out is DISABLED (pre-launch testing — it was logging testers
  // out mid-audit). To restore it, re-add `useSessionTimeout();` here; the
  // hook and its tests are deliberately left in place so this is a one-line
  // revert.
  //
  // Before restoring it, note it was wrong twice over. `useSessionTimeout`
  // forced a full signOut() after 30 minutes without a DOM event:
  //
  //  1. It is not a security control. A client-side timer is defeated by
  //     moving a finger, and an attacker holding the unlocked device does
  //     exactly that — so it only ever fired on legitimate users who paused
  //     to read. Session lifetime is server-enforced by Supabase Auth (JWT
  //     expiry + refresh-token rotation); that is where the policy belongs.
  //  2. This hook is mounted app-wide, and phone web IS the native iOS app.
  //     A backgrounded phone trivially idles past 30 minutes, so a user who
  //     put the app down — or who tapped a "you've been hired" push an hour
  //     later — was dumped on /login with their token erased.
  //
  // It had already been patched once for logging out active users
  // (eb97aec0, "stop logging out active users on AppShell pages") because
  // scroll inside AppShell's inner container never reached the window
  // listener. That was the same bug class: the timer cannot actually tell
  // idle from busy.
  useLoginTracking();
  useNativePushSetup();
  const dynamicTypeScale = useDynamicTypeSync();
  useDarkMode(); // initializes data-theme from localStorage / system preference
  useCppVariantRouter();
  useAppShellViewport();
  useStatusBarStyle();
  // Bridge Capacitor appStateChange → TanStack focusManager and
  // @capacitor/network → onlineManager. Without this, refetchOnWindowFocus
  // is dead inside WKWebView (browser focus events don't fire reliably on
  // iOS) so the dashboard / messages / balances show stale data after the
  // user returns from a context-switch, and offline → online doesn't
  // auto-refetch. No-op on web.
  useAppLifecycle();

  // Feed the two inputs this component owns into the Senior Mode resolver and
  // let IT write the class. The profile flag is a manual account-level opt-in;
  // the Dynamic Type bridge (LH-22) honors the user's system-level text-size
  // choice without them having to flip the in-app toggle.
  //
  // This used to `classList.toggle("senior-mode", profileSenior || osLargeText)`
  // directly, and that unconditional write is what erased the DEVICE preference
  // `initSimpleMode()` had applied ~20ms earlier before first paint — the
  // /profile?tab=accessibility toggle turned the app on and was silently undone
  // on the next launch. The third input lives in simpleMode.ts (it has to, it
  // runs before React), so the decision lives there too; see the trace in that
  // file's header.
  const { profile, user } = useCurrentUser();
  // Web push (owner approved 2026-10-29): with permission already granted,
  // keep this browser's subscription row current on every signed-in boot; and
  // after a job action, explain notifications in the in-app sheet (the browser
  // prompt only ever comes from its button). Both are no-ops in the native app.
  useWebPushBootSync(user?.id);
  // OPS-5: where this member came from (two short words, no personal data), sent once per new account.
  useSignupSourceReport(user?.id);
  useWebPushAskAfterJobAction();
  useEffect(() => {
    // null until the profile lands, so the cached account flag the first
    // paint used is not switched off and back on (Q169).
    const profileSenior = profile ? !!(profile as unknown as { senior_mode?: boolean }).senior_mode : null;
    const osLargeText = dynamicTypeScale >= OS_LARGE_TEXT_THRESHOLD;
    // Until the profile lands, the SESSION carries the account flag (Q200):
    // a first sign-in on a new device has no per-device cache yet.
    syncSeniorMode({ profileSenior, osLargeText, sessionSenior: sessionSeniorFlag(user) });
  }, [profile, user, dynamicTypeScale]);
  // Keep that session hint in step with the profile. Written only when they
  // disagree (absent metadata counts as "off"), so an account that never used
  // Senior Mode is never written to. Best-effort: a failure only means the
  // next new device paints once at the default size, as it did before Q200.
  useEffect(() => {
    const profileSenior = profile ? !!(profile as unknown as { senior_mode?: boolean }).senior_mode : null;
    const patch = seniorModeMetadataPatch(user, profileSenior);
    if (!patch) return;
    void supabaseClient()
      .then(({ supabase }) => supabase.auth.updateUser({ data: patch }))
      .then((r) => { if (r.error) console.warn("[senior-mode] session hint not saved", r.error.message); })
      .catch((e: unknown) => console.warn("[senior-mode] session hint not saved", e));
  }, [profile, user]);


  return null;
};
