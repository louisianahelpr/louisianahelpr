import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useLoginTracking = () => {
  const tracked = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user && !tracked.current) {
        tracked.current = true;
        try {
          await (supabase.from as any)("login_history").insert({
            user_id: session.user.id,
            user_agent: navigator.userAgent,
          });
        } catch (e) {
          console.error("Login tracking failed:", e);
        }
      }
      if (event === "SIGNED_OUT") {
        tracked.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);
};
