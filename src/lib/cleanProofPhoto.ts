import { cleanListingPhoto } from "@/lib/declutter/photos";
import { ListingPhotoError } from "@/lib/declutter/errors";
import { report } from "@/lib/errorLogger";

/**
 * A proof photo with its EXIF gone, GPS included, before it uploads (lead, 10-30: after photos feed portfolios and
 * disputes, and a Helpr's photo taken at home carries their home). The listing photo path does the work; it never
 * hands the original back, so a photo that can't be cleaned is refused rather than uploaded with its location.
 *
 * Larger and finer than a listing photo, because this is what a dispute is decided on.
 * Null means it couldn't be cleaned, and the caller says so. Run on a HEIC only after heicToJpeg.
 */
const PROOF_MAX_SIDE = 2560;
const PROOF_QUALITY = 0.85;

export async function cleanProofPhoto(file: File): Promise<File | null> {
  try {
    return await cleanListingPhoto(file, PROOF_MAX_SIDE, PROOF_QUALITY);
  } catch (err) {
    if (!(err instanceof ListingPhotoError)) report(err, { tags: { source: "cleanProofPhoto" } });
    return null;
  }
}
