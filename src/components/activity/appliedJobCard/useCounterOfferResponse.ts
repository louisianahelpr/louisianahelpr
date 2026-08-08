import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";

/**
 * Counter-offer response — local state so the pending card reflects the
 * helper's accept/decline immediately without waiting for a data refetch.
 */
export function useCounterOfferResponse() {
  const [counterResponding, setCounterResponding] = useState(false);
  const [localCounterStatus, setLocalCounterStatus] = useState<"countered" | "counter_accepted" | "counter_declined" | null>(null);

  const handleRespondCounter = async (appId: string, accept: boolean) => {
    setCounterResponding(true);
    try {
      // `respond_to_counter_offer` isn't in the generated RPC union yet
      // (migration lag — PGRST202-tolerant call). Cast the rpc fn rather
      // than `as any` so the args object stays type-checked.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: "respond_to_counter_offer",
        args: { p_application_id: string; p_accept: boolean },
      ) => Promise<{ error: { code?: string } | null }>;
      const { error } = await rpc("respond_to_counter_offer", {
        p_application_id: appId,
        p_accept: accept,
      });
      if (error) {
        if (error.code === "PGRST202") {
          toast.error("Couldn't respond to the counter-offer right now — try again?");
        } else {
          hapticError();
          toast.error("Couldn't respond to the counter-offer. Please try again.");
        }
        return;
      }
      setLocalCounterStatus(accept ? "counter_accepted" : "counter_declined");
      hapticSuccess();
      toast.success(accept ? "Counter accepted! The poster will be notified." : "Counter declined. The poster will be notified.");
    } catch {
      hapticError();
      toast.error("Couldn't respond to that offer — try again?");
    } finally {
      setCounterResponding(false);
    }
  };

  return { counterResponding, localCounterStatus, handleRespondCounter };
}
