import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { photoPublicUrl } from "@/lib/declutter/api";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { FallbackImg } from "./FallbackImg";

/** The Browse card's picture, small: the cover photo, or the category icon on its tint (never a blank box). */
export function ListingThumb({ path, category }: { path: string | undefined; category: string }) {
  return (
    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-photo-empty" data-listing-thumb="">
      <PhotoPlaceholder icon={categoryIcon(category)} seed={category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" />
      {path && <FallbackImg src={photoPublicUrl(path)} alt="" loading="lazy" className="relative h-full w-full object-cover" />}
    </span>
  );
}
