import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";

/** The owner's wording (2026-10-12, Q1286). */
export const WIPE_NOTICE =
  "For your security, details entered before your email was confirmed were cleared. Please add them again.";

/**
 * Whether the signed-in account's details were cleared by the Q447
 * pre-verification takeover wipe (someone typed a profile on an address they
 * had not confirmed; the real owner then signed in with Google/Apple). The
 * wipe record is server-only, so has_pre_verification_wipe() answers for the
 * caller alone.
 *
 * Fails CLOSED to "no notice": the line explains an empty form, it gates
 * nothing. A missing function (PGRST202, before the migration deploys) is
 * silent; any other error is reported, not dropped.
 */
function usePreVerificationWipe(): boolean {
  const { user } = useCurrentUser();
  const userId = user?.id;
  const { data } = useQuery({
    queryKey: ["pre-verification-wipe", userId],
    enabled: !!userId,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const { data: wiped, error } = await supabase.rpc("has_pre_verification_wipe");
      if (error) {
        if ((error as { code?: string }).code !== "PGRST202") {
          report(error, { severity: "warning", tags: { source: "usePreVerificationWipe" } });
        }
        return false;
      }
      return wiped === true;
    },
  });
  return data === true;
}

/** /complete-profile's intro line, plus the wipe notice when it applies. */
export function CompleteProfileIntro() {
  const wiped = usePreVerificationWipe();
  return (
    <>
      <p className="mt-3 font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        We need a few details before you can use Helpr. This keeps the community safe.
      </p>
      {wiped && (
        <p
          role="status"
          data-testid="pre-verification-wipe-notice"
          className="mt-3 rounded-ds-md border border-border/60 bg-card px-3 py-2 font-sans text-ds-13"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {WIPE_NOTICE}
        </p>
      )}
    </>
  );
}
