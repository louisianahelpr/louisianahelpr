import { useEffect, useRef } from "react";
import { loadModule } from "@/lib/loadModule";
import { track, AhaEvent } from "@/lib/analytics";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { backgroundImport } from "@/lib/chunkReload";

// PostHog is dynamically imported to keep posthog-js out of the initial
// bundle. identifyUser() runs after sign-in so the lazy import latency
// is invisible to the user.
async function identifyInPostHog(userId: string, props: Record<string, unknown>) {
  try {
    const { identifyUser } = await backgroundImport(() => import("@/lib/posthog"), "posthog");
    identifyUser(userId, props);
  } catch {
    /* analytics must never break auth */
  }
}

// The Supabase client is loaded, not imported: this hook is on the boot path, and the client (supabase-js,
// ~30 KB gz) is on its way off it (Q2705/Q2706, plan in Builder 3's 11-04 handoff).
const supabaseClient = () => loadModule(() => import("@/integrations/supabase/client"));

const EMAIL_VERIFIED_KEY = "helpr_email_verified_tracked";

export const useLoginTracking = () => {
  const tracked = useRef(false);

  useEffect(() => {
    let live = true;
    let unsubscribe: (() => void) | null = null;
    void supabaseClient()
      .then((m) => {
        // A null load (a recovery reload is under way) tracks nothing; the reloaded page subscribes again.
        if (!live || !m) return;
        const supabase = m.supabase;
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
            // A returned error is a failed write too (CLAUDE.md: never drop
            // the Supabase error); it was discarded, so a broken login history
            // was invisible.
            const { error } = await supabase.from("login_history").insert({
              user_id: session.user.id,
              user_agent: navigator.userAgent,
            });
            if (error) report(error, { severity: "warning", tags: { source: "useLoginTracking" } });
          } catch (e) {
            report(e, { severity: "warning", tags: { source: "useLoginTracking" } });
          }
        }, 0);
      }

      if (event === "SIGNED_OUT") {
        tracked.current = false;
      }
    });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((e: unknown) => report(e, { severity: "warning", tags: { source: "useLoginTracking" } }));

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);
};
