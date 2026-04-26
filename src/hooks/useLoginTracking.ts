import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";

// PostHog is dynamically imported to keep posthog-js out of the initial
// bundle. identifyUser() runs after sign-in so the lazy import latency
// is invisible to the user.
async function identifyInPostHog(userId: string, props: Record<string, unknown>) {
  try {
    const { identifyUser } = await import("@/lib/posthog");
    identifyUser(userId, props);
  } catch {
    /* analytics must never break auth */
  }
}

const EMAIL_VERIFIED_KEY = "helpr_email_verified_tracked";

export const useLoginTracking = () => {
  const tracked = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user && !tracked.current) {
        tracked.current = true;

        // Identify user in PostHog so funnels stitch sessions to people
        void identifyInPostHog(session.user.id, {
          email: session.user.email,
          email_verified: !!session.user.email_confirmed_at,
        });

        // Funnel: fire EmailVerified once per user (the moment they first sign in
        // with a confirmed email). Persisted in safeStorage so we don't re-fire
        // on every session, and so iOS WebKit eviction doesn't double-fire.
        if (session.user.email_confirmed_at) {
          const key = `${EMAIL_VERIFIED_KEY}_${session.user.id}`;
          if (!safeStorage.getItem(key)) {
            track(AhaEvent.EmailVerified, { user_id: session.user.id });
            safeStorage.setItem(key, "1");
          }
        }

        window.setTimeout(async () => {
          try {
            await supabase.from("login_history").insert({
              user_id: session.user.id,
              user_agent: navigator.userAgent,
            });
          } catch (e) {
            report(e, { severity: "warning", tags: { source: "useLoginTracking" } });
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
