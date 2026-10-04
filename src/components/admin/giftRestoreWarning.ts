import { toast } from "sonner";

/**
 * Q454: an admin refund that refunded the card but could not give the
 * poster's gift card back answers { giftRestoreFailed: true } (the server
 * also pages ops). The admin who pressed the button must see it too.
 */
export function warnIfGiftNotReturned(data: unknown): void {
  if ((data as { giftRestoreFailed?: boolean } | null)?.giftRestoreFailed) {
    toast.warning("Refunded, but the poster's gift card was not returned. Ops has been paged to return it by hand.");
  }
}
