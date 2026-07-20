import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const AUTH_BOOTSTRAP_TIMEOUT_MS = 2500;
// See ProtectedRoute.tsx — dev-only + opt-in via `?debug_auth=1`.
const DEBUG_AUTH =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debug_auth");

type AuthSnapshot = { user: User | null; isReady: boolean };

let authSnapshot: AuthSnapshot = { user: null, isReady: false };
let authBootstrapStarted = false;
const authListeners = new Set<(snapshot: AuthSnapshot) => void>();

const emitAuthSnapshot = (snapshot: AuthSnapshot) => {
  // Sentry breadcrumb on the first isReady=true transition — gives any
  // post-auth-ready error a clear "we got through the auth bootstrap"
  // marker in the dashboard. One-shot via the prior snapshot check.
  const justBecameReady = !authSnapshot.isReady && snapshot.isReady;
  authSnapshot = snapshot;
  if (DEBUG_AUTH) {
    console.log("[auth] snapshot", {
      isReady: snapshot.isReady,
      hasUser: !!snapshot.user,
      userId: snapshot.user?.id ?? null,
    });
  }
  if (justBecameReady) {
    void import("@/lib/sentry").then(({ markColdLaunchPhase }) =>
      markColdLaunchPhase("auth-ready-resolved"),
    );
  }
  authListeners.forEach((listener) => listener(snapshot));
};

const getSessionWithTimeout = async (): Promise<Session | null> => {
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), AUTH_BOOTSTRAP_TIMEOUT_MS),
      ),
    ]);

    if (!result) return null;
    return result.data.session ?? null;
  } catch {
    return null;
  }
};

export const useAuthReady = () => {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(authSnapshot);

  useEffect(() => {
    authListeners.add(setSnapshot);
    if (authSnapshot.isReady) setSnapshot(authSnapshot);

    if (!authBootstrapStarted) {
      authBootstrapStarted = true;
      let initialized = false;

      const markReady = (session: Session | null) => {
        initialized = true;
        emitAuthSnapshot({ user: session?.user ?? null, isReady: true });
      };

      supabase.auth.onAuthStateChange((event, session) => {
        if (DEBUG_AUTH) {
          console.log("[auth] onAuthStateChange", {
            event,
            hasSession: !!session,
            userId: session?.user?.id ?? null,
          });
        }
        if (session || event === "SIGNED_OUT" || event !== "INITIAL_SESSION") {
          initialized = true;
          emitAuthSnapshot({ user: session?.user ?? null, isReady: true });
        }
      });

      void getSessionWithTimeout().then((session) => {
        if (DEBUG_AUTH) {
          console.log("[auth] getSession", {
            hasSession: !!session,
            userId: session?.user?.id ?? null,
            initialized,
          });
        }
        if (session || !initialized || !authSnapshot.user) markReady(session);
      });

      window.setTimeout(() => {
        if (!initialized) emitAuthSnapshot({ user: authSnapshot.user, isReady: true });
      }, AUTH_BOOTSTRAP_TIMEOUT_MS + 250);
    }

    return () => {
      authListeners.delete(setSnapshot);
    };
  }, []);

  return snapshot;
};
