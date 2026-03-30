import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useLoginTracking = () => {
  const tracked = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user && !tracked.current) {
        tracked.current = true;

        window.setTimeout(async () => {
          try {
            await supabase.from("login_history").insert({
              user_id: session.user.id,
              user_agent: navigator.userAgent,
            });
          } catch (e) {
            console.error("Login tracking failed:", e);
          }
        }, 0);
      }

      if (event === "SIGNED_OUT") {
        tracked.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);
};
