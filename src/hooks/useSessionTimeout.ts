import { useEffect, useRef } from "react";
import { toast } from "sonner";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity

// Supabase client is dynamically imported (NOT statically) to keep the
// ~205KB supabase-js chunk out of the entry bundle. This hook only fires
// after 30 minutes of inactivity, so the import latency is invisible.
// Without this, App.tsx -> SessionManager -> useSessionTimeout pulled
// supabase into the critical path and blocked first paint on the chunk's
// top-level await (keychainStorageAdapter hydratePromise) on native cold
// starts. See src/integrations/supabase/client.ts.
async function getSupabase() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

export const useSessionTimeout = () => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await supabase.auth.signOut();
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
