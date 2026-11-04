import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { safeDocumentUrl } from "@/lib/storagePath";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";

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
 * Deliberately NOT tier-gated: this is the surface a brand-new helper uses to
 * prove they can do the work, which is exactly when they have no completed jobs
 * and no subscription.
 *
 * The `avatars` bucket is public and usePortfolio stores public URLs, so these
 * need no signing.
 *
 * Q2026 (Instagram-style profiles, lead decision (A) 2026-11-04): this is THE
 * past-work grid. It shows only the Helpr's own uploads, never job proof photos
 * (the private proof-photos bucket; often taken inside someone's home). A square
 * grid that stays a grid at every width (3 across on a phone, 4 from sm, 6 from
 * lg, so a 1440 screen is not three 370px photos), and a tap opens the photo in
 * the app's own viewer (PhotoLightbox) instead of a bare image in a new tab.
 */
export function HelperWorkPhotos({ urls }: { urls: string[] }) {
  // Only what a browser can actually show. complete-signup once wrote bare
  // PRIVATE user-documents paths here, which render as broken images on the
  // public profile (and must not be signed for public view). No client sends
  // those today (0 on prod, 2026-09-23), but a bad element must never render
  // as a broken tile — and never as a raw href.
  const shown = (urls ?? []).map((u) => safeDocumentUrl(u)).filter((u): u is string => !!u);
  if (shown.length === 0) return null;

  return <WorkPhotoGrid shown={shown} />;
}

function WorkPhotoGrid({ shown }: { shown: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3" data-work-photo-grid="">
      <h2 className="text-ds-17 font-display font-semibold text-foreground flex items-center gap-2">
        <ImageIcon className="w-5 h-5 text-primary" /> Recent work
        <span className="text-ds-13 font-normal text-muted-foreground">
          {shown.length} {shown.length === 1 ? "photo" : "photos"}
        </span>
      </h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1">
        {shown.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`Open work photo ${i + 1} of ${shown.length}`}
            className="relative aspect-square rounded-ds-sm overflow-hidden bg-muted active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              loading="lazy"
              src={url}
              alt={`Work sample ${i + 1}`}
              decoding="async"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
      <PhotoLightbox photos={shown} lightboxIndex={open} setLightboxIndex={setOpen} />
    </div>
  );
}
