import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * The signed-in viewer's credential tier — the number a credential-gated job
 * is compared against before the apply form is offered.
 *
 * WHY THIS IS A HOOK OF ITS OWN, AND WHY THE FEED CALLS IT TOO.
 *
 * It used to live inline in `useJobDetailData`, i.e. it was first requested at
 * the moment the job sheet opened. `useQuery` hands back its `initialData`
 * default (0) while the request is in flight, and 0 is not "we do not know" —
 * it is a real verdict, the LOWEST one. So a credential-gated job rendered the
 * "Get verified" footer on frame one and swapped to the inline apply form when
 * the answer landed. Measured on the production bundle at 375x812 with 4x CPU
 * throttling and a 400kbps/400ms link: the sheet stood still for 2.25s and then
 * moved its top edge 28.9px, and once the apply form is no longer late (see the
 * note in Dashboard.tsx) that same swap is worth ~95px, because the two bottoms
 * it chooses between are a 44px footer and a ~237px form. A centred,
 * content-sized sheet absorbs that symmetrically, so BOTH edges move.
 *
 * Reserving space for the unknown is the usual fix, but there is nothing
 * honest to reserve here: the two branches are different heights by design and
 * one of them must be wrong. So the answer is to already KNOW — the feed mounts
 * this hook, which is minutes of user time before any card can be tapped, and
 * the query key and 60s `staleTime` are shared, so the sheet reads it from
 * cache and decides correctly on its first frame.
 *
 * Falls back to 0 gracefully when the RPC is not deployed yet (PGRST202), so
 * ungated jobs stay reachable during a migration lag window.
 */
export function useViewerCredentialTier(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["viewerCredentialTier"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;
      try {
        const { data: tier, error } = await supabase.rpc("get_user_credential_tier", {
          p_user_id: user.id,
        });
        // PGRST202 = function not found (migration not yet applied to prod) —
        // treat as tier 0 so open jobs remain accessible.
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return 0;
          report(error, { tags: { source: "useViewerCredentialTier" } });
          return 0;
        }
        return typeof tier === "number" ? tier : 0;
      } catch (err) {
        // A THROW here is not the same as the handled `error` above: that one
        // is PostgREST answering "no such function" during a deploy window,
        // which is expected and already returns 0 quietly. Reaching this catch
        // means the call itself failed — offline, an auth failure, a malformed
        // response — and the consequence is that every credential-gated job
        // silently looks tier 0 to this viewer. Falling back to 0 is right (it
        // fails OPEN toward showing jobs, and the server still enforces the
        // gate), but doing it without a trace is how a permanently broken tier
        // lookup would never surface. Report, then fall back.
        report(err, { tags: { source: "useViewerCredentialTier.throw" } });
        return 0;
      }
    },
  });
  return data ?? 0;
}
