import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const AUTH_BOOTSTRAP_TIMEOUT_MS = 4000;

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
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let initialized = false;

    const markReady = (session: Session | null) => {
      if (!mounted) return;
      initialized = true;
      setUser(session?.user ?? null);
      setIsReady(true);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setIsReady(true);
      initialized = true;
    });

    void getSessionWithTimeout().then((session) => {
      if (!mounted || initialized) return;
      markReady(session);
    });

    const fallbackTimer = window.setTimeout(() => {
      if (!mounted || initialized) return;
      initialized = true;
      setIsReady(true);
    }, AUTH_BOOTSTRAP_TIMEOUT_MS + 250);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  return { user, isReady };
};
