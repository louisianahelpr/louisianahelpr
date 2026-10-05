import { useEffect, useState } from "react";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { unwrap } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserIdentity } from "@supabase/supabase-js";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { confirmConsequential } from "@/lib/toastPolicy";
import { takeOAuthRedirectError } from "@/lib/oauthRedirectError";
import { connectProvider, type SocialProvider } from "@/lib/socialAuth";

/**
 * Q446 — Profile > Security > Sign-in methods. Shows which ways in open THIS
 * account and lets anyone connect Apple or Google to it (linkIdentity), so a
 * person who ever made a second account by mistake, or whose Apple sign-in
 * hides their email, can keep one account. Every provider offered on the
 * sign-in screen is offered here (src/test/oneAccountPerPerson.test.ts).
 * A method can be removed only while another one remains.
 */
const CONNECTABLE_PROVIDERS: readonly SocialProvider[] = ["apple", "google"];

const NAME: Record<SocialProvider, string> = { apple: "Apple", google: "Google" };

function useIdentities() {
  return useQuery<UserIdentity[]>({
    queryKey: ["security", "identities"],
    queryFn: async () => {
      return unwrap(await supabase.auth.getUserIdentities())?.identities ?? [];
    },
    staleTime: 30_000,
  });
}

export function SignInMethodsCard() {
  const queryClient = useQueryClient();
  const { data: identities, isLoading, isError } = useIdentities();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [removing, setRemoving] = useState<UserIdentity | null>(null);

  // A web connect returns here; say what happened (once).
  useEffect(() => {
    const back = takeOAuthRedirectError();
    if (back?.message) toast.error(userFacingError(back.message, "That sign-in couldn't be connected. Try again."), { id: "connect-provider" });
  }, []);

  const asked = params.get("connect");
  const has = (p: string) => (identities ?? []).some((i) => i.provider === p);
  const hasEmail = has("email");
  const count = identities?.length ?? 0;

  const connect = async (provider: SocialProvider) => {
    setBusy(provider);
    const result = await connectProvider(provider);
    if (result.kind === "redirecting") return; // browser leaves for the provider
    setBusy(null);
    if (result.kind === "success") {
      await queryClient.invalidateQueries({ queryKey: ["security", "identities"] });
      confirmConsequential(`${NAME[provider]} connected. It now opens this account.`);
    } else if (result.kind === "error") {
      toast.error(userFacingError(result.message, "That sign-in couldn't be connected. Try again."), { id: "connect-provider" });
    }
  };

  const remove = async () => {
    const identity = removing;
    if (!identity) return;
    setRemoving(null);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) {
      report(error, { severity: "error", tags: { area: "auth", op: "unlinkIdentity", provider: identity.provider } });
      toast.error("Couldn't remove that sign-in method — try again?", { id: "connect-provider" });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["security", "identities"] });
    confirmConsequential("Sign-in method removed.");
  };

  return (
    <div className="rounded-2xl liquid-glass p-3.5" id="sign-in-methods">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <KeyRound className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            Sign-in methods
          </h2>
          <p className="text-ds-11 font-sans mt-0.5" style={{ color: isError ? "hsl(var(--destructive))" : "hsl(var(--olivewood) / 0.8)" }}>
            {isError ? "We couldn't load your sign-in methods." : "Each one opens this same account."}
          </p>
          {isError && <ReportErrorScreen source="SignInMethodsCard.identities" title="We couldn't load your sign-in methods." />}
        </div>
      </div>

      {asked && !isLoading && !isError && CONNECTABLE_PROVIDERS.some((p) => (asked === p || asked === "any") && !has(p)) && (
        <p className="text-ds-13 leading-snug mt-3 rounded-xl px-3 py-2" style={{ background: "hsl(var(--bark) / 0.06)", color: "hsl(var(--ink-deep))" }} role="status">
          {asked === "any" ? "Connect Apple or Google" : `Connect ${NAME[asked as SocialProvider]}`} below so it signs you in to this account from now on.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        <MethodRow label="Email and password" state={isLoading ? "loading" : hasEmail ? "on" : "off"} />
        {CONNECTABLE_PROVIDERS.map((p) => {
          const identity = (identities ?? []).find((i) => i.provider === p);
          return (
            <MethodRow
              key={p}
              label={NAME[p]}
              state={isLoading ? "loading" : identity ? "on" : "off"}
              action={
                isLoading || isError ? null : identity ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={count < 2}
                    title={count < 2 ? "Add another way in first" : undefined}
                    aria-label={`Remove ${NAME[p]} sign-in`}
                    onClick={() => setRemoving(identity)}
                  >
                    Remove
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={busy !== null}
                    aria-label={`Connect ${NAME[p]}`}
                    onClick={() => void connect(p)}
                  >
                    {busy === p ? "Connecting…" : `Connect ${NAME[p]}`}
                  </Button>
                )
              }
            />
          );
        })}
      </ul>

      <BrandConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing ? NAME[removing.provider as SocialProvider] ?? removing.provider : ""} sign-in?`}
        description="You'll still sign in with your other method. You can connect it again any time."
        primaryLabel="Remove"
        primaryTone="sienna"
        onPrimary={() => void remove()}
        secondaryLabel="Keep it"
      />
    </div>
  );
}

function MethodRow({ label, state, action = null }: { label: string; state: "loading" | "on" | "off"; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 min-h-[44px]">
      <div className="min-w-0 flex-1">
        <p className="text-ds-14 font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
          {label}
        </p>
        {state === "loading" ? (
          <Skeleton className="h-3 w-20 mt-1 rounded-full" />
        ) : (
          <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {state === "on" ? "Connected" : "Not connected"}
          </p>
        )}
      </div>
      {action}
    </li>
  );
}
