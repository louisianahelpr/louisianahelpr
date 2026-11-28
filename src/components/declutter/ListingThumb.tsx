import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { photoPublicUrl } from "@/lib/declutter/api";
import { squarePhotoUrl, THUMB_PHOTO_PX } from "@/lib/declutter/photoSizes";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { FallbackImg } from "./FallbackImg";

/**
 * The Browse card's picture, small: the cover photo, or the category icon on its tint (never a blank box). The photo is
 * the 160 px square (photoSizes.ts), the original only if that fails (B77).
 */
export function ListingThumb({ path, category, small = false, row = false }: { path: string | undefined; category: string; /** 44 px, rounded-lg: a row inside a pick list (Offer a trade, design audit r3 #10). */ small?: boolean; /** 56 px, rounded-xl: a Selling listing row (polish audit 11-27 #11). */ row?: boolean }) {
  const size = small ? "h-11 w-11 rounded-lg" : row ? "h-14 w-14 rounded-xl" : "h-16 w-16 rounded-2xl";
  return (
    <span className={`relative shrink-0 overflow-hidden bg-photo-empty ${size}`} data-listing-thumb="">
      <PhotoPlaceholder icon={categoryIcon(category)} seed={category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" />
      {path && <FallbackImg src={squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path)} retrySrc={photoPublicUrl(path)} width={THUMB_PHOTO_PX} height={THUMB_PHOTO_PX} alt="" loading="lazy" decoding="async" className="relative h-full w-full object-cover" />}
    </span>
  );
}
