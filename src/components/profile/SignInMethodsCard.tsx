import { useEffect, useState } from "react";
import { hapticError } from "@/lib/haptics";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { userFacingError } from "@/lib/userFacingError";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User, UserIdentity } from "@supabase/supabase-js";
import { SECURITY_AUTH_USER_KEY, identitiesOf, readSecurityAuthUser } from "./securityAuthUser";
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
import "@/lib/i18n/enAccount";
import { t, useLanguage } from "@/lib/i18n/language";

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

/** The tab's one auth `/user` read (securityAuthUser.ts, Q1648), never a second getUserIdentities() round trip. */
function useIdentities() {
  return useQuery<User, Error, UserIdentity[]>({
    queryKey: SECURITY_AUTH_USER_KEY,
    queryFn: readSecurityAuthUser,
    select: identitiesOf,
    staleTime: 30_000,
    // The whole auth User (phone, metadata, factors) never goes to IndexedDB.
    meta: { persist: false },
  });
}

export function SignInMethodsCard() {
  useLanguage();
  const queryClient = useQueryClient();
  const { data: identities, isLoading, isError, refetch } = useIdentities();
  // Q1771: a failed read with nothing cached is UNKNOWN, not "no linked
  // sign-ins". The rows (each would read "Not connected") give way to Retry.
  const unknown = isError && !identities;
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [removing, setRemoving] = useState<UserIdentity | null>(null);

  // A web connect returns here; say what happened (once).
  useEffect(() => {
    const back = takeOAuthRedirectError();
    if (back?.message) toast.error(userFacingError(back.message, t("sim.connectFailed")), { id: "connect-provider" });
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
      await queryClient.invalidateQueries({ queryKey: SECURITY_AUTH_USER_KEY });
      confirmConsequential(t("sim.connected", { name: NAME[provider] }));
    } else if (result.kind === "error") {
      toast.error(userFacingError(result.message, t("sim.connectFailed")), { id: "connect-provider" });
    } else if (result.kind === "cancelled") {
      // Same small signal as the main sign-in's cancel: the tap registered.
      hapticError();
      toast(t("sim.cancelled", { name: NAME[provider] }), { id: "connect-provider" });
    }
  };

  const remove = async () => {
    const identity = removing;
    if (!identity) return;
    setRemoving(null);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) {
      report(error, { severity: "error", tags: { area: "auth", op: "unlinkIdentity", provider: identity.provider } });
      toast.error(t("sim.removeFailed"), { id: "connect-provider" });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: SECURITY_AUTH_USER_KEY });
    confirmConsequential(t("sim.removed"));
  };

  // Named before the JSX: the press sweep reads every string inside primaryLabel as a commit label.
  const removeLabel = t("sim.remove");
  return (
    <div className="rounded-2xl liquid-glass p-3.5" id="sign-in-methods">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <KeyRound className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            {t("sim.title")}
          </h2>
          <p className="text-ds-11 font-sans mt-0.5" style={{ color: isError ? "hsl(var(--destructive-ink))" : "hsl(var(--olivewood) / 0.8)" }}>
            {isError ? t("sim.loadFailed") : t("sim.sameAccount")}
          </p>
          {isError && <ReportErrorScreen source="SignInMethodsCard.identities" title={t("sim.loadFailed")} />}
        </div>
        {/* Retry in the action slot, the two-step card's shape (TwoFactorCard). */}
        {unknown && (
          <Button size="sm" variant="outline" className="shrink-0" aria-label={t("sim.retryLabel")} onClick={() => void refetch()}>
            {t("sim.retry")}
          </Button>
        )}
      </div>

      {asked && !isLoading && !isError && CONNECTABLE_PROVIDERS.some((p) => (asked === p || asked === "any") && !has(p)) && (
        <p className="text-ds-13 leading-snug mt-3 rounded-xl px-3 py-2" style={{ background: "hsl(var(--bark) / 0.06)", color: "hsl(var(--ink-deep))" }} role="status">
          {asked === "any" ? t("sim.askAny") : t("sim.askOne", { name: NAME[asked as SocialProvider] })}
        </p>
      )}

      {!unknown && (
      // Design audit r3 #39: the rows start under the title (32 px tile + 8 px gap), not 40 px left of it.
      <ul className="mt-3 space-y-2 pl-10" data-sign-in-rows="">
        <MethodRow label={t("sim.emailPassword")} state={isLoading ? "loading" : hasEmail ? "on" : "off"} />
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
                    title={count < 2 ? t("sim.addFirst") : undefined}
                    aria-label={t("sim.removeName", { name: NAME[p] })}
                    onClick={() => setRemoving(identity)}
                  >
                    {removeLabel}
                  </Button>
                ) : (
                  // Polish audit 11-27 #70: Connect is a 15px text link like the email's Change, not two outline pills of
                  // different widths ("Connect Apple" / "Connect Google") beside rows whose "Connected" has no control.
                  <Button
                    size="sm"
                    variant="link"
                    className="shrink-0 px-0 text-ds-15 font-semibold text-[hsl(var(--bark))]"
                    data-sign-in-connect={p}
                    disabled={busy !== null}
                    aria-label={t("sim.connectName", { name: NAME[p] })}
                    onClick={() => void connect(p)}
                  >
                    {busy === p ? t("sim.connecting") : t("sim.connectName", { name: NAME[p] })}
                  </Button>
                )
              }
            />
          );
        })}
      </ul>
      )}

      <BrandConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("sim.removeTitle", { name: removing ? NAME[removing.provider as SocialProvider] ?? removing.provider : "" })}
        description={t("sim.removeBody")}
        primaryLabel={removeLabel}
        primaryTone="sienna"
        onPrimary={() => void remove()}
        secondaryLabel={t("sim.keep")}
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
            {state === "on" ? t("sim.on") : t("sim.off")}
          </p>
        )}
      </div>
      {action}
    </li>
  );
}
