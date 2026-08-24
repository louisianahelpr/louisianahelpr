import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity
// Ignore repeated activity events fired closer together than this so a stream
// of pointermove/scroll events doesn't thrash clearTimeout/setTimeout.
const RESET_THROTTLE_MS = 1000;

// Activity signals that should keep a session alive. `scroll` and `wheel` are
// listened for in the CAPTURE phase (see below) because on AppShell pages the
// scroll happens inside an internal overflow container, and `scroll` does not
// bubble — a window listener in the default (bubble) phase never sees it, so an
// actively-scrolling user was being logged out mid-session. The capture phase
// travels window→target for every event regardless of its `bubbles` flag, so it
// reliably catches inner-container scrolls. `pointermove`/`pointerdown` unify
// mouse + touch + pen; `keydown`/`touchstart` cover the rest.
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
];

export const useSessionTimeout = () => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastResetRef = useRef(0);

  useEffect(() => {
    const arm = () => {
      timerRef.current = setTimeout(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await signOutWithPushCleanup();
          window.location.href = "/login";
        }
      }, TIMEOUT_MS);
    };

    const resetTimer = () => {
      const now = Date.now();
      if (now - lastResetRef.current < RESET_THROTTLE_MS) return;
      lastResetRef.current = now;
      if (timerRef.current) clearTimeout(timerRef.current);
      arm();
    };

    // capture:true so non-bubbling scroll events on inner containers still
    // reset the timer; passive:true so we never block scroll/touch handling.
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, opts));
    arm();

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer, opts));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
};
