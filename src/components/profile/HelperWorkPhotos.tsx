import { ImageIcon } from "lucide-react";
import { openableDocumentUrl, safeDocumentUrl } from "@/lib/storagePath";

/**
 * Recent work — the photos a helper uploads once in Edit Profile
 * (RecentWorkSection → profiles.portfolio_urls), shown to posters here.
 *
 * Why this exists (owner, 2026-08-29): the upload side had been built and
 * `portfolio_urls` was even SELECTed by useUserProfileData, but nothing ever
 * rendered it — so a helper's uploaded work was visible to admins only. The
 * apply step papered over that with a per-application file picker, which made
 * helpers re-attach the same certificate on every single application. Now the
 * photos live on the profile once and every poster sees them.
 *
 * Deliberately NOT tier-gated. HelperPortfolio below it (completed-job proof
 * photos) is Pro+, but that one only has anything to show after a helper has
 * finished jobs through the platform. This is the surface a brand-new helper
 * uses to prove they can do the work, which is exactly when they have no
 * completed jobs and no subscription — gating it would empty it for the only
 * people who need it.
 *
 * The `avatars` bucket is public and usePortfolio stores public URLs, so these
 * need no signing.
 */
export function HelperWorkPhotos({ urls }: { urls: string[] }) {
  // Only what a browser can actually show. complete-signup once wrote bare
  // PRIVATE user-documents paths here, which render as broken images on the
  // public profile (and must not be signed for public view). No client sends
  // those today (0 on prod, 2026-09-23), but a bad element must never render
  // as a broken tile — and never as a raw href.
  const shown = (urls ?? []).map((u) => safeDocumentUrl(u)).filter((u): u is string => !!u);
  if (shown.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-ds-17 font-display font-semibold text-foreground flex items-center gap-2">
        <ImageIcon className="w-5 h-5 text-primary" /> Recent Work
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {shown.map((url, i) => (
          <a
            key={url}
            // profiles.portfolio_urls is the helper's own column (no shape
            // CHECK) and this renders to every viewer: never a raw href.
            href={openableDocumentUrl(url) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="relative aspect-square rounded-ds-md overflow-hidden border border-border/60 active:scale-[0.98] transition-transform"
          >
            <img
              src={url}
              alt={`Work sample ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </a>
        ))}
      </div>
    </div>
  );
}
