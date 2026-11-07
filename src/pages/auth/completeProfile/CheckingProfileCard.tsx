/**
 * CompleteProfile's wait card: signed in, but the profile row is not there yet (a brand-new account, or a slow first
 * read), with a way out (moved out of CompleteProfile.tsx, Q806; markup unchanged).
 */
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import type { useLanguage } from "@/lib/i18n/language";

type T = ReturnType<typeof useLanguage>["t"];

export function CheckingProfileCard({ signingOut, onSignOut, t }: { signingOut: boolean; onSignOut: () => void; t: T }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--card-shadow)]">
      <div className="flex justify-center mb-4">
        <HelprSpinner size={24} />
      </div>
      <h1 className="text-headline-hero font-display font-bold text-foreground">{t("profileGate.checking")}</h1>
      <p className="mt-2 text-ds-11 text-muted-foreground">
        {t("profileGate.checkingBody")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={onSignOut}
        disabled={signingOut}
        className="mt-5 w-full"
      >
        <X className="w-4 h-4 mr-2" /> {signingOut ? t("profileGate.loggingOut") : t("profileGate.signOut")}
      </Button>
    </div>
  );
}
