import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { identifyUser } from "@/lib/posthog";

const EMAIL_VERIFIED_KEY = "helpr_email_verified_tracked";

export const useLoginTracking = () => {
  const tracked = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user && !tracked.current) {
        tracked.current = true;

        // Identify user in PostHog so funnels stitch sessions to people
        identifyUser(session.user.id, {
          email: session.user.email,
          email_verified: !!session.user.email_confirmed_at,
        });

        // Funnel: fire EmailVerified once per user (the moment they first sign in
        // with a confirmed email). Persisted in localStorage so we don't re-fire
        // on every session.
        if (session.user.email_confirmed_at) {
          const key = `${EMAIL_VERIFIED_KEY}_${session.user.id}`;
          if (!localStorage.getItem(key)) {
            track(AhaEvent.EmailVerified, { user_id: session.user.id });
            localStorage.setItem(key, "1");
          }
        }

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
