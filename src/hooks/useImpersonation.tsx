import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ImpersonationState {
  /** True when ?impersonate=<userId> is in the URL. */
  active: boolean;
  /** The user id from the URL, or null. */
  targetUserId: string | null;
  /** Display name for the banner. */
  targetName: string | null;
  /** No-op + toast for any mutation gated by `assertWritable`. */
  assertWritable: () => boolean;
  /** Stop impersonating — strips the search param. */
  exit: () => void;
}

const ImpersonationContext = createContext<ImpersonationState>({
  active: false,
  targetUserId: null,
  targetName: null,
  assertWritable: () => true,
  exit: () => {},
});

/**
 * Provider that reads `?impersonate=<userId>` from the URL.
 *
 * The provider must wrap pages that include any mutation guarded by
 * `useImpersonation().assertWritable()`. It's safe to mount globally —
 * when no impersonate param is present, `assertWritable` is a no-op
 * passthrough.
 */
export const ImpersonationProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const targetUserId = searchParams.get("impersonate");
  const [targetName, setTargetName] = useState<string | null>(null);

  useEffect(() => {
    if (!targetUserId) {
      setTargetName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (!cancelled) setTargetName((data?.full_name as string | undefined) ?? targetUserId.slice(0, 8));
    })();
    return () => { cancelled = true; };
  }, [targetUserId]);

  const value = useMemo<ImpersonationState>(() => ({
    active: !!targetUserId,
    targetUserId,
    targetName,
    assertWritable: () => {
      if (!targetUserId) return true;
      toast.message("Read-only impersonation", {
        description: "Mutations are blocked while viewing another account. Exit the banner to act as yourself.",
      });
      return false;
    },
    exit: () => {
      const next = new URLSearchParams(searchParams);
      next.delete("impersonate");
      setSearchParams(next);
    },
  }), [targetUserId, targetName, searchParams, setSearchParams]);

  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>;
};

export const useImpersonation = () => useContext(ImpersonationContext);
