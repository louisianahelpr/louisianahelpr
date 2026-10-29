import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useDataExport } from "@/hooks/useDataExport";
import { DATA_EXPORT_ANCHOR, dataRightsTarget } from "./dataExportAnchor";

/** The card's anchor: on the Legal tab's Privacy panel when signed in,
 *  `/privacy` when signed out (see dataRightsTarget). */
export { DATA_EXPORT_ANCHOR } from "./dataExportAnchor";

/**
 * GDPR Art. 20 / CCPA data portability — the "Download your data" control.
 *
 * WHERE IT LIVES. On the Privacy Policy itself (owner, 2026-09-14, VN-47:
 * move "Download your data" to the Privacy page; remove it from the Legal
 * tab). History: a standalone `/data-rights` page until 2026-08-18, then a
 * card under every document on the Profile Legal tab, where it sat below
 * each policy's own "Questions? Contact support" footer and brought a second
 * "contact support" link with it. Rendered by `PrivacyContent`, so it shows
 * on the public /privacy page AND in the Legal tab's Privacy panel — the one
 * document that grants the right. The `/data-rights` redirect that pointed
 * here was deleted with Q194 (2026-09-23): links name this anchor directly.
 *
 * Signed out (the public /privacy page), the button is a sign-in link rather
 * than a disabled control — there is no one to export for yet.
 *
 * Deliberately NOT here: account deletion (GDPR Art. 17 erasure). It lives on
 * the Profile landing / Settings screen, so there is exactly ONE entry point
 * to an irreversible action.
 *
 * Own component so the `exporting` state re-renders this card, not the whole
 * policy document around it.
 */
export function DataExportCard() {
  // The app-wide auth snapshot (getSession-backed, local, offline-safe) rather
  // than a network getUser() call, which used to leave `userId` null and the
  // button permanently disabled even with a valid local session.
  //
  // `isReady` gates the signed-in/signed-out choice. Until the snapshot has
  // settled `user` is null for EVERYONE — including a signed-in reader whose
  // session is still restoring (up to the restore grace in useAuthReady) — so
  // deciding from `user` alone showed that reader "Sign In to Download".
  const { user, isReady } = useAuthReady();
  const userId = user?.id ?? null;
  // The export itself is shared with Settings' "Download my data" row (A3-I4).
  const { exporting, startExport } = useDataExport(userId);

  // Scroll to the card when the URL names it — the sign-in link returns to
  // this anchor (on /profile?tab=legal&doc=privacy; see dataRightsTarget),
  // and the policy's own "Data portability" row
  // links here in-page. Mirrors PolicySection's hash handling.
  useEffect(() => {
    const check = () => {
      if (window.location.hash.replace(/^#/, "") !== DATA_EXPORT_ANCHOR) return;
      requestAnimationFrame(() => {
        document.getElementById(DATA_EXPORT_ANCHOR)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      });
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  return (
    <section id={DATA_EXPORT_ANCHOR} aria-labelledby="legal-data-export" className="space-y-2 scroll-mt-20">
      <div className="rounded-2xl liquid-glass squircle p-card">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Download className="w-4 h-4" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="legal-data-export"
              className="font-display font-bold text-foreground leading-tight text-ds-15"
            >
              Download your data
            </h2>
            <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
              Get a copy of what your Helpr account holds — profile, jobs, messages, payments, reviews, settings, and links to your uploaded files — as a single JSON file.
            </p>
          </div>
        </div>
        {/* flex-wrap lets the format hint and the button stack on a narrow
            phone instead of squeezing the 44px-tall button below target size. */}
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3"
          style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
        >
          <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            JSON file
          </span>
          {!isReady ? (
            // Auth still settling: a neutral, disabled control in the shape of
            // the signed-in one — never a Sign In link someone may not need.
            <Button variant="primary" size="sm" className="shrink-0" disabled aria-busy>
              Download my data
            </Button>
          ) : userId ? (
            <Button
              onClick={() => void startExport()}
              disabled={exporting}
              aria-busy={exporting}
              variant="primary"
              size="sm"
              className="shrink-0"
            >
              {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />Preparing…</> : "Download my data"}
            </Button>
          ) : (
            <Button variant="primary" size="sm" className="shrink-0" asChild>
              {/* Straight to where a signed-in reader finds this card — the
                  in-app Legal tab — not through /data-rights (Q194: no link we
                  mint goes through a redirect), and not /privacy, which is the
                  nav-less public page. */}
              <Link to={`/login?redirect=${encodeURIComponent(dataRightsTarget(true))}`}>
                Sign In to Download
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* The GDPR/CCPA footnote travels WITH the export control. It no longer
          carries its own "contact support" link (VN-47): the policy's
          PolicyFooter directly below already ends with "Questions? Contact
          support", and two links to one place read as a mistake. */}
      <p className="text-ds-11 leading-relaxed px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Under the EU GDPR and California CCPA, you have specific rights about how Helpr handles your personal data.
      </p>
    </section>
  );
}
