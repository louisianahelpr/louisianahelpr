import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity

export const useSessionTimeout = () => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await signOutWithPushCleanup();
          const { toast } = await import("sonner");
          toast.info("You've been logged out due to inactivity");
          window.location.href = "/login";
        }
      }, TIMEOUT_MS);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
};
