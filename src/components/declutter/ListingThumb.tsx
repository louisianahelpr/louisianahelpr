import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { photoPublicUrl } from "@/lib/declutter/api";
import { squarePhotoUrl, THUMB_PHOTO_PX } from "@/lib/declutter/photoSizes";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { FallbackImg } from "./FallbackImg";

/**
 * The Browse card's picture, small: the cover photo, or the category icon on its tint (never a blank box). The photo is
 * the 160 px square (photoSizes.ts), the original only if that fails (B77).
 */
export function ListingThumb({ path, category }: { path: string | undefined; category: string }) {
  return (
    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-photo-empty" data-listing-thumb="">
      <PhotoPlaceholder icon={categoryIcon(category)} seed={category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" />
      {path && <FallbackImg src={squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path)} retrySrc={photoPublicUrl(path)} width={THUMB_PHOTO_PX} height={THUMB_PHOTO_PX} alt="" loading="lazy" decoding="async" className="relative h-full w-full object-cover" />}
    </span>
  );
}
