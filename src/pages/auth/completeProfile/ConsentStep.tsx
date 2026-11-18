/**
 * Owner request 11-14 (deferred profile): the ONE step a Google/Apple sign-up (or an email sign-up whose completion
 * failed) sees before Home. Only the Terms box and, when not ticked at sign-up, the 18+ box, then Continue. Every
 * other profile detail is asked when it is needed (src/lib/profileGateRoutes.ts). The boxes and their words are
 * CompleteProfile's own; the write is the same three consent columns, the 18+ record and the legal_acceptances row
 * saveCompletedProfile writes, and nothing else.
 *
 * Guard: src/test/deferredCompleteProfile.test.tsx.
 */
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import AuthShell from "@/components/auth/AuthShell";
import { supabase } from "@/integrations/supabase/client";
import { LATEST_PRIVACY_VERSION, LATEST_TERMS_VERSION } from "@/lib/consent";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { mutationErrorMessage, unwrapMutationRow } from "@/lib/mutationResult";
import { queryKeys } from "@/lib/queryKeys";
import { userFacingError } from "@/lib/userFacingError";
import type { useLanguage } from "@/lib/i18n/language";
import { withTimeout } from "./constants";

type T = ReturnType<typeof useLanguage>["t"];

/** Saves the consent the step collected and puts the saved row in the current-user cache. Throws on a refused write. */
export async function saveConsent(args: {
  user: User;
  ageBoxShown: boolean;
  profile: { age_attested_at?: string | null; accepted_terms_at?: string | null } | null | undefined;
  t: T;
  queryClient: QueryClient;
}): Promise<void> {
  const { user, ageBoxShown, profile, t, queryClient } = args;
  const nowIso = new Date().toISOString();
  const savedRow = unwrapMutationRow<Record<string, unknown>>(
    await withTimeout(
      Promise.resolve(
        supabase
          .from("profiles")
          .update({
            ...(ageBoxShown && !profile?.age_attested_at ? { age_attested_at: nowIso } : {}),
            // The first-ever consent is pinned server-side (preserve_first_consent): a second write keeps the first.
            ...(profile?.accepted_terms_at ? {} : { accepted_terms_at: nowIso }),
            terms_accepted_at: nowIso,
            terms_version_accepted: LATEST_TERMS_VERSION,
          })
          .eq("user_id", user.id)
          .select("*"),
      ),
      t("profileGate.saveLabel"),
    ),
    { action: "save your agreement", context: { userId: user.id } },
  );
  const { error: legalErr } = await supabase.from("legal_acceptances").insert({
    user_id: user.id,
    terms_version: LATEST_TERMS_VERSION,
    privacy_version: LATEST_PRIVACY_VERSION,
  });
  if (legalErr) {
    report(legalErr, { severity: "warning", tags: { source: "CompleteProfile.consentStep.legalAcceptances" }, context: { userId: user.id } });
  }
  queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: { isAdmin?: boolean } | undefined) => ({
    ...(current ?? {}),
    profile: savedRow,
    isAdmin: current?.isAdmin ?? false,
  }));
}

export function ConsentStep({
  lang,
  t,
  ageBoxShown,
  initiallyAgreed,
  initiallyAdult,
  onSave,
  onSignOut,
  signingOut,
  footer,
}: {
  lang: string;
  t: T;
  ageBoxShown: boolean;
  initiallyAgreed: boolean;
  initiallyAdult: boolean;
  /** Writes the consent and goes on; throws on failure. */
  onSave: () => Promise<void>;
  onSignOut: () => void;
  signingOut: boolean;
  /** Delete account + the dialog: CompleteProfile's own, never a second handler. */
  footer: React.ReactNode;
}) {
  const [agreed, setAgreed] = useState(initiallyAgreed);
  const [adult, setAdult] = useState(initiallyAdult);
  const [saving, setSaving] = useState(false);
  const ready = agreed && (adult || !ageBoxShown);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) { hapticError(); toast.error(t("profileGate.policiesToast")); return; }
    if (ageBoxShown && !adult) { hapticError(); toast.error(t("signup.ageToast")); return; }
    setSaving(true);
    try {
      await onSave();
      hapticSuccess();
    } catch (err) {
      hapticError();
      toast.error(mutationErrorMessage(err, userFacingError(err, t("profileGate.saveFailed"))));
    } finally {
      setSaving(false);
    }
  };

  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>{label}</a>
  );

  return (
    <AuthShell hideBack hideHeader centerColumn maxWidth="lg" noWebChrome>
      <div className="pb-12" data-testid="complete-profile-consent-step">
        <div className="text-center mb-7">
          <h1 className="font-display font-bold text-headline-hero leading-tight mt-2" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}>
            {t("profileGate.consentTitle")}
          </h1>
          <p className="mt-2 text-ds-14" style={{ color: "hsl(var(--olivewood))" }}>{t("profileGate.consentIntro")}</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5">
          <label htmlFor="accept-policies" className="flex min-h-11 items-start gap-2.5 text-ds-13 cursor-pointer" style={{ color: "hsl(var(--olivewood))" }}>
            <Checkbox id="accept-policies" aria-labelledby="accept-policies-label" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-px shrink-0" />
            <span id="accept-policies-label" className="leading-relaxed">
              {/* Design audit area 09 M12: with the 18+ box below, this box does not say 18+ a second time. */}
              {ageBoxShown ? t("profileGate.agreeLead") : t("signup.agreeLead")} {link("/terms", t("signup.terms"))}, {link("/rules", t("signup.rules"))}{` ${t("signup.and")} `}
              {link("/privacy", t("signup.privacy"))}.
              {lang === "es" && <span className="block" data-testid="legal-in-english">{t("lang.legalInEnglish")}</span>}
            </span>
          </label>
          {ageBoxShown && (
            <label htmlFor="age-confirm" className="flex min-h-11 items-start gap-2.5 text-ds-13 cursor-pointer" style={{ color: "hsl(var(--olivewood))" }}>
              <Checkbox id="age-confirm" aria-labelledby="age-confirm-label" checked={adult} onCheckedChange={(v) => setAdult(v === true)} className="mt-px shrink-0" />
              <span id="age-confirm-label" className="leading-relaxed">{t("profileGate.ageConfirm")}</span>
            </label>
          )}
          <Button type="submit" size="lg" className={ready && !saving ? "w-full btn-grad-primary" : "w-full"} disabled={saving || !ready}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            {saving ? t("profileGate.saving") : t("profileGate.continue")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onSignOut} disabled={signingOut} className="w-full">
            {signingOut ? t("profileGate.loggingOut") : t("profileGate.signOut")}
          </Button>
          {footer}
        </form>
      </div>
    </AuthShell>
  );
}
